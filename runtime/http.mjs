// Contract: docs/HOST_API.md ("http").

export class CloudflareError extends Error {
  constructor(url) {
    super(`Cloudflare challenge at ${url}`);
    this.name = "CloudflareError";
    this.url = url;
  }
}

// encodeURIComponent on both sides (leaves A-Z a-z 0-9 - _ . ! ~ * ' ( ) literal), joined by "&".
export function encodeForm(object) {
  return Object.entries(object)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export function isCloudflareChallenge(status, headers, body) {
  if (status !== 403 && status !== 503) return false;
  if (headers["cf-mitigated"] === "challenge") return true;
  return body.includes("<title>Just a moment...</title>");
}

const hasHeader = (headers, name) => Object.keys(headers).some((k) => k.toLowerCase() === name);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// In-memory cookie jar. Only name, value and Domain/Max-Age/Expires are honored; Path, Secure,
// HttpOnly, SameSite and port are ignored. Cookies are sent in insertion order.
function createJar() {
  const cookies = new Map(); // key -> { name, value, domain, hostOnly }
  const keyOf = (c) => `${c.hostOnly ? "h" : "d"}\n${c.domain}\n${c.name}`;

  function store(setCookie, host) {
    const parts = setCookie.split(";");
    const eq = parts[0].indexOf("=");
    if (eq < 0) return;
    const name = parts[0].slice(0, eq).trim();
    const value = parts[0].slice(eq + 1).trim();
    if (!name) return;
    let domain = "";
    let maxAge = null;
    let expires = null;
    for (const attr of parts.slice(1)) {
      const i = attr.indexOf("=");
      const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
      const val = i < 0 ? "" : attr.slice(i + 1).trim();
      if (key === "domain") domain = val.replace(/^\./, "").toLowerCase();
      else if (key === "max-age" && /^-?\d+$/.test(val)) maxAge = Number(val);
      else if (key === "expires") {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expires = t;
      }
    }
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) return;
    const cookie = { name, value, domain: domain || host, hostOnly: !domain };
    const expired = maxAge !== null ? maxAge <= 0 : expires !== null && expires <= Date.now();
    if (expired) cookies.delete(keyOf(cookie));
    else cookies.set(keyOf(cookie), cookie);
  }

  function header(host) {
    const pairs = [];
    for (const c of cookies.values()) {
      const match = c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`);
      if (match) pairs.push(`${c.name}=${c.value}`);
    }
    return pairs.join("; ");
  }

  return { store, header };
}

export function createHttp({ userAgent, fetchImpl = fetch }) {
  const jar = createJar();

  async function request(method, url, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (!hasHeader(headers, "user-agent")) headers["User-Agent"] = userAgent;
    let body = options.body;
    if (body !== undefined && body !== null) {
      if (typeof body === "object") {
        body = encodeForm(body);
        if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      // Bytes, not a string: fetch would add "Content-Type: text/plain;charset=UTF-8" to a string body.
      body = new TextEncoder().encode(String(body));
    } else {
      body = undefined;
    }
    if (!hasHeader(headers, "cookie")) {
      const cookie = jar.header(hostOf(url));
      if (cookie) headers.Cookie = cookie;
    }
    const response = await fetchImpl(url, { method, headers, body, redirect: "follow" });
    const text = await response.text();
    const finalUrl = response.url || url;
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (name === "set-cookie") return;
      responseHeaders[name] = name in responseHeaders ? `${responseHeaders[name]}, ${value}` : value;
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) {
      responseHeaders["set-cookie"] = setCookies.join("\n");
      const host = hostOf(finalUrl);
      for (const c of setCookies) jar.store(c, host);
    }
    if (isCloudflareChallenge(response.status, responseHeaders, text)) throw new CloudflareError(url);
    return { status: response.status, url: finalUrl, headers: responseHeaders, body: text };
  }
  return {
    get: (url, options) => request("GET", url, options),
    post: (url, options) => request("POST", url, options),
  };
}

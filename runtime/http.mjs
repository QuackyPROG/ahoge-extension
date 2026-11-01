export class CloudflareError extends Error {
  constructor(url) {
    super(`Cloudflare challenge at ${url}`);
    this.name = "CloudflareError";
    this.url = url;
  }
}

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

export function createHttp({ userAgent, fetchImpl = fetch }) {
  async function request(method, url, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (!hasHeader(headers, "user-agent")) headers["User-Agent"] = userAgent;
    let body = options.body;
    if (body !== undefined && body !== null && typeof body === "object") {
      body = encodeForm(body);
      if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const response = await fetchImpl(url, { method, headers, body, redirect: "follow" });
    const text = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    if (isCloudflareChallenge(response.status, responseHeaders, text)) throw new CloudflareError(url);
    return { status: response.status, url: response.url || url, headers: responseHeaders, body: text };
  }
  return {
    get: (url, options) => request("GET", url, options),
    post: (url, options) => request("POST", url, options),
  };
}

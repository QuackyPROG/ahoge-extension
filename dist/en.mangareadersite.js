var source = null;
const META = {"id":"en.mangareadersite","name":"MangaReader.site","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://mangareader.site","template":"mangahub","upstream":"src/en/mangareadersite"};
// Helpers available to every source. Plain functions: no URL/fetch exist in the host.

function pathOf(url) {
  const match = String(url).match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]+([^?#]*)/i);
  if (!match) return String(url).replace(/[?#].*$/, "");
  return match[1] || "/";
}

function query(pairs) {
  return pairs.map(([k, v]) => k + "=" + encodeURIComponent(String(v))).join("&");
}

function parseStatus(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(?:not|in|un)\s*(?:completed?|finished)\b/.test(t)) return "ongoing";
  if (/\b(?:completed?|finished|concluded|ended|end)\b/.test(t)) return "completed";
  if (/\b(?:on.?going|publishing|releasing|en curso|em andamento)\b/.test(t)) return "ongoing";
  if (/\b(?:hiatus|on.?hold|paused)\b/.test(t)) return "hiatus";
  if (/\b(?:cancel(?:l?ed)?|dropped|discontinued)\b/.test(t)) return "cancelled";
  return "unknown";
}

const UNIT_MS = {
  second: 1000, sec: 1000, minute: 60000, min: 60000, hour: 3600000, hr: 3600000,
  day: 86400000, week: 604800000, month: 2592000000, year: 31536000000,
};

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// Midnight UTC for a calendar date, or null if the date does not exist (e.g. Feb 30).
function utcDate(year, month, day) {
  const ms = Date.UTC(year, month, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day ? ms : null;
}

// Relative ("2 days ago", "an hour ago", "yesterday") and absolute dates. Absolute formats are
// parsed explicitly (never via Date.parse on free text) so results match across engines:
// YYYY-MM-DD[Thh:mm[:ss[.fff]][Z|+hh:mm]], "Mon D, YYYY", "D Month YYYY", MM/DD/YYYY (US order).
// A time without an offset is treated as UTC.
function parseDate(text, now) {
  const t = String(text || "").trim().toLowerCase();
  const current = now === undefined ? Date.now() : now;
  if (!t) return null;
  if (t === "today" || t === "just now") return current;
  if (t === "yesterday") return current - UNIT_MS.day;
  const rel = t.match(/(\d+|an?)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s*ago/);
  if (rel) return current - (/^\d/.test(rel[1]) ? Number(rel[1]) : 1) * UNIT_MS[rel[2]];
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    if (m[4] === undefined) return utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    let zone = m[8] === undefined ? "Z" : m[8].toUpperCase();
    if (/^[+-]\d{4}$/.test(zone)) zone = zone.slice(0, 3) + ":" + zone.slice(3);
    const iso = m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + (m[6] || "00") + (m[7] || "") + zone;
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? null : parsed;
  }
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && m[1] in MONTHS) return utcDate(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  m = t.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/);
  if (m && m[2] in MONTHS) return utcDate(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return utcDate(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return null;
}

function chapterNumber(name) {
  const text = String(name || "");
  const tagged = text.match(/(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
  if (tagged) return Number(tagged[1]);
  const any = text.match(/\d+(?:\.\d+)?/);
  return any ? Number(any[0]) : -1;
}

function imageUrl(element) {
  if (!element) return "";
  for (const name of ["data-src", "data-lazy-src", "data-cfsrc", "src"]) {
    if (!element.attr(name).trim()) continue; // absUrl of an empty attribute is the base url
    const value = element.absUrl(name);
    if (value && !/^\s*data:/i.test(value)) return value.trim();
  }
  return "";
}

function unique(values) {
  const seen = new Set();
  return values.filter((v) => {
    const key = String(v).toLowerCase();
    if (!v || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureOk(response) {
  if (response.status >= 400) throw new Error("HTTP " + response.status + " for " + response.url);
  return response;
}

// MangaHub network (GraphQL at <site>/graphql). Port of keiyoushi lib-multisrc/mangahub (Apache-2.0).
// Manga urls are "/manga/<slug>", chapter urls "/<slug>/chapter-<number>".
function MangaHub(config) {
  const c = Object.assign({ mangaSource: "m01" }, config);
  const base = c.baseUrl.replace(/\/$/, "");
  const CDN = "https://imgx.mghcdn.com/";
  const THUMBS = "https://thumb.mghcdn.com/";
  const pageHeaders = { Referer: base + "/", "Accept-Language": "en-US,en;q=0.5" };

  // The API needs an access key, sent as both a cookie and a header. Any key answers listings;
  // chapter pages need one the site handed out on a chapter page.
  let apiKey = null;
  function randomKey() {
    let s = "";
    for (let i = 0; i < 32; i++) s += "0123456789abcdef".charAt(Math.floor(Math.random() * 16));
    return s;
  }
  const keyFrom = (res) => {
    const m = String(res.headers["set-cookie"] || "").match(/mhub_access=([^;\n]+)/);
    return m ? m[1] : null;
  };

  async function gql(q) {
    if (!apiKey) apiKey = randomKey();
    const res = ensureOk(
      await http.post(base + "/graphql", {
        headers: {
          Referer: base + "/",
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-mhub-access": apiKey,
          Cookie: "mhub_access=" + apiKey,
        },
        body: JSON.stringify({ query: q }),
      }),
    );
    const json = JSON.parse(res.body);
    if (json.errors && json.errors.length && !json.data) throw new Error(json.errors[0].message);
    return json;
  }

  const str = (s) => JSON.stringify(String(s));

  // A chapter page that answers 200 (not a redirect) sets a key that unlocks every chapter.
  async function refreshKey(chapterPath, slug) {
    const tryPage = async (path, refererSlug) => {
      const res = await http.get(base + "/chapter" + path, { headers: { Referer: base + "/manga/" + refererSlug } });
      return pathOf(res.url).indexOf("/chapter/") === 0 ? keyFrom(res) : null;
    };
    let key = await tryPage(chapterPath, slug);
    if (!key) {
      // Licensed titles redirect away from their chapter pages; borrow a key from another title.
      const rows = (await gql(searchQuery("", "all", "LATEST", 1))).data.search.rows;
      for (const row of rows.slice(0, 5)) {
        const m = (await gql("{ manga(x: " + c.mangaSource + ", slug: " + str(row.slug) + ") { chapters { number } } }")).data.manga;
        const chs = (m && m.chapters) || [];
        if (!chs.length) continue;
        key = await tryPage("/" + row.slug + "/chapter-" + chs[chs.length - 1].number, row.slug);
        if (key) break;
      }
    }
    if (key) apiKey = key;
    return Boolean(key);
  }

  function searchQuery(q, genre, order, page) {
    return (
      "{ search(x: " + c.mangaSource + ", q: " + str(q) + ", genre: " + str(genre) + ", mod: " + order +
      ", hideNSFW: false, hideYaoi: false, offset: " + (page - 1) * 30 + ") { rows { title, slug, image } } }"
    );
  }

  async function list(q, page, genre, order, hideNsfw, hideYaoi) {
    const query =
      "{ search(x: " + c.mangaSource + ", q: " + str(q || "") + ", genre: " + str(genre || "all") + ", mod: " + (order || "POPULAR") +
      ", hideNSFW: " + Boolean(hideNsfw) + ", hideYaoi: " + Boolean(hideYaoi) + ", offset: " + (page - 1) * 30 + ") { rows { title, slug, image } } }";
    const rows = ((await gql(query)).data.search || { rows: [] }).rows || [];
    return {
      manga: rows.map((r) => ({ url: "/manga/" + r.slug, title: r.title, cover: r.image ? THUMBS + r.image : "" })),
      hasNextPage: rows.length === 30,
    };
  }

  const ORDERS = [
    { value: "POPULAR", label: "Popular" },
    { value: "LATEST", label: "Updates" },
    { value: "ALPHABET", label: "A-Z" },
    { value: "NEW", label: "New" },
    { value: "COMPLETED", label: "Completed" },
  ];
  let genreOptions = null;
  async function filters() {
    if (!genreOptions) {
      try {
        const genres = (await gql("{ genres { title, slug } }")).data.genres || [];
        genres.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
        genreOptions = [{ value: "all", label: "All" }].concat(genres.map((g) => ({ value: g.slug, label: g.title })));
      } catch (e) {
        genreOptions = null;
      }
    }
    const out = [];
    if (genreOptions) out.push({ type: "select", key: "genre", name: "Genre", options: genreOptions });
    out.push(
      { type: "select", key: "order", name: "Order", options: ORDERS },
      { type: "checkbox", key: "hideNsfw", name: "Hide NSFW" },
      { type: "checkbox", key: "hideYaoi", name: "Hide Yaoi" },
    );
    return out;
  }

  const slugOf = (url) => pathOf(url).split("/").filter(Boolean)[1];

  async function manga(url) {
    const slug = slugOf(url);
    const q =
      "{ manga(x: " + c.mangaSource + ", slug: " + str(slug) +
      ") { title, slug, status, image, author, artist, genres, description, alternativeTitle, chapters { number, title, date } } }";
    const m = (await gql(q)).data.manga;
    if (!m) throw new Error("Manga not found: " + url);
    return m;
  }

  const trimNumber = (n) => String(n).replace(/\.0$/, "");

  return {
    popular: (page) => list("", page, "all", "POPULAR"),
    latest: (page) => list("", page, "all", "LATEST"),
    search: (q, page, f) => {
      const o = f || {};
      return list(q, page, o.genre, o.order, o.hideNsfw, o.hideYaoi);
    },
    filters,

    async details(url) {
      const m = await manga(url);
      let description = m.description || "";
      const alt = String(m.alternativeTitle || "").split(";").map((s) => s.trim()).filter(Boolean);
      if (alt.length) description = (description + "\n\nAlternative Names:\n" + alt.map((a) => "- " + a).join("\n")).trim();
      return {
        title: m.title,
        cover: m.image ? THUMBS + m.image : "",
        author: m.author || "",
        artist: m.artist || "",
        description,
        genres: unique(String(m.genres || "").split(",").map((g) => g.trim())),
        status: m.status === "ongoing" ? "ongoing" : m.status === "completed" ? "completed" : "unknown",
      };
    },

    async chapters(url) {
      const m = await manga(url);
      return (m.chapters || [])
        .map((ch) => {
          const number = trimNumber(ch.number);
          const title = String(ch.title || "").trim().replace(/\s+/g, " ");
          const name = title.indexOf(number) !== -1 ? title : title ? "Chapter " + number + " - " + title : "Chapter " + number;
          return { url: "/" + m.slug + "/chapter-" + ch.number, name, number: Number(ch.number), date: ch.date ? Date.parse(ch.date) || null : null, scanlator: null };
        })
        .reverse();
    },

    async pages(url) {
      const parts = pathOf(url).split("/").filter(Boolean);
      const slug = parts[0];
      const number = Number(parts[1].replace(/^chapter-/, ""));
      const q = "{ chapter(x: " + c.mangaSource + ", slug: " + str(slug) + ", number: " + number + ") { pages } }";
      let json = await gql(q);
      if (!json.data || !json.data.chapter) {
        await refreshKey("/" + slug + "/chapter-" + parts[1].replace(/^chapter-/, ""), slug);
        json = await gql(q);
      }
      if (!json.data || !json.data.chapter) throw new Error((json.errors && json.errors[0] && json.errors[0].message) || "Chapter not found");
      let pagesText = json.data.chapter.pages;
      if (String(pagesText).indexOf("enc:v1") === 0) {
        const res = ensureOk(await http.get(base + "/api/chapter-crypto", { headers: { Accept: "application/json", "x-mhub-access": apiKey, Cookie: "mhub_access=" + apiKey } }));
        pagesText = mangaHubDecrypt(pagesText, JSON.parse(res.body));
      }
      const data = JSON.parse(pagesText);
      let paths;
      if (Array.isArray(data)) paths = data;
      else if (data && data.i) paths = data.i.map((p) => (data.p || "") + p);
      else paths = Object.keys(data || {}).map((k) => data[k]);
      return paths.map((p) => ({ url: /^https?:\/\//.test(p) ? p : CDN + String(p).replace(/^\//, ""), headers: pageHeaders }));
    },
  };
}

// "enc:v1:<keyId>:<iv>:<tag>:<ciphertext>", base64url parts, AES-256-GCM. The tag is not verified.
function mangaHubDecrypt(text, crypto) {
  const parts = String(text).split(":");
  const keyId = parts[2];
  const keyData = (crypto.keys && crypto.keys[keyId]) || (!crypto.keyId || crypto.keyId === keyId ? crypto.key : null);
  if (!keyData) throw new Error("Page key not found for " + keyId);
  const bytes = (b64) => {
    let s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const plain = aesGcmCtr(bytes(keyData), bytes(parts[3]), bytes(parts[5]));
  return utf8Decode(plain);
}

function utf8Decode(b) {
  let s = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xf0) s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else {
      const cp = (((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f)) - 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

// GCM decryption without the tag check is AES-CTR starting at counter block IV || 0x00000002 (96-bit IV).
function aesGcmCtr(key, iv, data) {
  const sbox = [];

  // Build the AES S-box.
  let p = 1;
  let q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    sbox[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  sbox[0] = 0x63;
  const xtime = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;

  // Key expansion.
  const nk = key.length / 4;
  const nr = nk + 6;
  const w = [];
  for (let i = 0; i < nk; i++) w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
  let rcon = 1;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = w[i - 1].slice();
    if (i % nk === 0) {
      t = [sbox[t[1]] ^ rcon, sbox[t[2]], sbox[t[3]], sbox[t[0]]];
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      t = t.map((b) => sbox[b]);
    }
    w[i] = [w[i - nk][0] ^ t[0], w[i - nk][1] ^ t[1], w[i - nk][2] ^ t[2], w[i - nk][3] ^ t[3]];
  }

  function encryptBlock(input) {
    let s = input.slice();
    const addKey = (round) => {
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[4 * c + r] ^= w[round * 4 + c][r];
    };
    addKey(0);
    for (let round = 1; round <= nr; round++) {
      s = s.map((b) => sbox[b]);
      const t = s.slice();
      for (let c = 0; c < 4; c++) for (let r = 1; r < 4; r++) s[4 * c + r] = t[4 * ((c + r) % 4) + r];
      if (round !== nr) {
        for (let c = 0; c < 4; c++) {
          const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
          const all = a0 ^ a1 ^ a2 ^ a3;
          s[4 * c] ^= all ^ xtime(a0 ^ a1);
          s[4 * c + 1] ^= all ^ xtime(a1 ^ a2);
          s[4 * c + 2] ^= all ^ xtime(a2 ^ a3);
          s[4 * c + 3] ^= all ^ xtime(a3 ^ a0);
        }
      }
      addKey(round);
    }
    return s;
  }

  if (iv.length !== 12) throw new Error("Unsupported GCM IV length " + iv.length);
  const counter = iv.concat([0, 0, 0, 2]);
  const out = new Array(data.length);
  for (let off = 0; off < data.length; off += 16) {
    const ks = encryptBlock(counter);
    for (let j = 0; j < 16 && off + j < data.length; j++) out[off + j] = data[off + j] ^ ks[j];
    for (let k = 15; k >= 12; k--) {
      counter[k] = (counter[k] + 1) & 0xff;
      if (counter[k]) break;
    }
  }
  return out;
}

source = MangaHub({
  baseUrl: META.baseUrl,
  mangaSource: "mr01",
});

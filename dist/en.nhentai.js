var source = null;
const META = {"id":"en.nhentai","name":"nhentai","lang":"en","version":"1.1.0","nsfw":true,"baseUrl":"https://nhentai.net"};
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

// nhentai.net REST API v2 (https://nhentai.net/api/v2/docs). The v1 API (/api/galleries/...) now
// answers 403 "Use new API". Read endpoints work without an API key. Not in keiyoushi, so there is
// no upstream to track. Each gallery is one manga with a single chapter.
const API = META.baseUrl + "/api/v2";
// GET /api/v2/cdn lists i1-i4 and t1-t4; all serve every file, so pick one per gallery.
const IMAGE_SERVERS = ["https://i1.nhentai.net", "https://i2.nhentai.net", "https://i3.nhentai.net", "https://i4.nhentai.net"];
const THUMB_SERVERS = ["https://t1.nhentai.net", "https://t2.nhentai.net", "https://t3.nhentai.net", "https://t4.nhentai.net"];
// The API docs ask for a descriptive User-Agent.
const HEADERS = { Accept: "application/json", "User-Agent": "Ahoge/1.0 (+https://github.com/QuackyPROG/ahoge-extension)" };

const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "japanese", label: "Japanese" },
  { value: "chinese", label: "Chinese" },
  { value: "", label: "All" },
];
const SORTS = [
  { value: "popular", label: "Popular: all time" },
  { value: "popular-month", label: "Popular: this month" },
  { value: "popular-week", label: "Popular: this week" },
  { value: "popular-today", label: "Popular: today" },
  { value: "date", label: "Recent" },
];

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + (pairs ? "?" + query(pairs) : ""), { headers: HEADERS }));
  return JSON.parse(res.body);
}

function idOf(url) {
  const match = pathOf(url).match(/^\/g\/(\d+)/);
  if (!match) throw new Error("Not an nhentai gallery url: " + url);
  return match[1];
}

const server = (list, id) => list[Number(id) % list.length];
const file = (list, id, path) => (path ? server(list, id) + "/" + String(path).replace(/^\/+/, "") : "");

function stub(g) {
  return { url: "/g/" + g.id + "/", title: g.english_title || g.japanese_title || String(g.id), cover: file(THUMB_SERVERS, g.id, g.thumbnail) };
}

const tagsOf = (g, type) => (g.tags || []).filter((t) => t.type === type).map((t) => t.name);

// Search needs a non-empty query, so "pages:>0" stands in for "everything".
async function list(q, page, sort, language) {
  const terms = [String(q || "").trim()];
  if (language) terms.push("language:" + language);
  const text = terms.filter(Boolean).join(" ") || "pages:>0";
  const json = await api("/search", [["query", text], ["sort", sort], ["page", page]]);
  return { manga: (json.result || []).map(stub), hasNextPage: page < (json.num_pages || 0) };
}

const gallery = (url) => api("/galleries/" + idOf(url));

source = {
  popular: (page) => list("", page, "popular", "english"),
  latest: (page) => list("", page, "date", "english"),
  // The query is passed through, so nhentai syntax works: tag:"big breasts" -tag:yaoi artist:x pages:>20
  search: (q, page, f) => list(q, page, (f && f.sort) || "popular", f ? f.language : "english"),
  filters: () => [
    { type: "select", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "language", name: "Language", options: LANGUAGES },
  ],

  async details(url) {
    const g = await gallery(url);
    const t = g.title || {};
    const title = t.english || t.pretty || t.japanese || String(g.id);
    const artists = tagsOf(g, "artist");
    const groups = tagsOf(g, "group");
    const lines = [];
    if (t.japanese && t.japanese !== title) lines.push(t.japanese);
    for (const [type, label] of [["parody", "Parodies"], ["character", "Characters"], ["language", "Languages"], ["category", "Category"]]) {
      const names = tagsOf(g, type);
      if (names.length) lines.push(label + ": " + names.join(", "));
    }
    lines.push("Pages: " + (g.num_pages || 0));
    if (g.num_favorites) lines.push("Favorites: " + g.num_favorites);
    lines.push("#" + g.id);
    return {
      title,
      cover: file(THUMB_SERVERS, g.id, (g.cover && g.cover.path) || (g.thumbnail && g.thumbnail.path)),
      author: (groups.length ? groups : artists).join(", "),
      artist: artists.join(", "),
      description: lines.join("\n"),
      genres: tagsOf(g, "tag"),
      status: "completed",
    };
  },

  async chapters(url) {
    const g = await gallery(url);
    return [{
      url: "/g/" + g.id + "/",
      name: "Gallery" + (g.num_pages ? " (" + g.num_pages + " pages)" : ""),
      number: 1,
      date: g.upload_date ? g.upload_date * 1000 : null,
      scanlator: g.scanlator || null,
    }];
  },

  async pages(url) {
    const g = await gallery(url);
    return (g.pages || [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((p) => ({ url: file(IMAGE_SERVERS, g.id, p.path), headers: { Referer: META.baseUrl + "/" } }));
  },
};

var source = null;
const META = {"id":"en.asurascans","name":"Asura Scans","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://asurascans.com","upstream":"src/en/asurascans"};
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

// Asura Scans. Listing uses the site's JSON API; series and chapter pages embed their data as Astro island props.
// Port of keiyoushi src/en/asurascans (Apache-2.0). Premium (early access) chapters are left out.
const BASE = META.baseUrl;
const API = "https://api.asurascans.com/api";
const HEADERS = { Referer: BASE + "/" };
const LIMIT = 20;

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

// Astro serializes props as [type, value] pairs; unwrap them into plain JSON.
function unwrap(v) {
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === "number") return unwrap(v[1]);
    if (v.length === 1 && typeof v[0] === "number") return null;
    return v.map(unwrap);
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = unwrap(v[k]);
    return out;
  }
  return v;
}

function astroProp(doc, keys) {
  const el = doc.select("[props]").filter((e) => keys.every((k) => e.attr("props").indexOf('"' + k + '"') !== -1))[0];
  if (!el) throw new Error("Asura page data not found (" + keys.join(", ") + ")");
  return unwrap(JSON.parse(el.attr("props")));
}

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "latest", label: "Latest update" },
  { value: "rating", label: "Rating" },
  { value: "update", label: "Newest" },
  { value: "title", label: "A-Z" },
];
const STATUSES = [
  { value: "", label: "All" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
  { value: "dropped", label: "Dropped" },
];
const TYPES = [
  { value: "", label: "All" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "manga", label: "Manga" },
];

function filters() {
  return [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
  ];
}

async function series(q, page, f) {
  const opts = f || {};
  const sort = opts.sort || { value: "popular", ascending: false };
  const pairs = [["offset", (page - 1) * LIMIT], ["limit", LIMIT], ["sort", sort.value], ["order", sort.ascending ? "asc" : "desc"]];
  if (q) pairs.push(["search", q]);
  if (opts.status) pairs.push(["status", opts.status]);
  if (opts.type) pairs.push(["type", opts.type]);
  const res = ensureOk(await http.get(API + "/series?" + query(pairs), { headers: HEADERS }));
  const json = JSON.parse(res.body);
  return {
    manga: (json.data || []).map((s) => ({ url: s.public_url || "/comics/" + s.slug, title: s.title, cover: s.cover || s.coverUrl || "" })),
    hasNextPage: Boolean(json.meta && json.meta.has_more),
  };
}

const STATUS = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", dropped: "cancelled", axed: "cancelled" };

function isLocked(c, now) {
  if (c.is_premium || c.is_locked) return true;
  const until = c.early_access_until ? parseDate(c.early_access_until) : null;
  return until !== null && until > now;
}

source = {
  popular: (page) => series("", page, { sort: { value: "popular", ascending: false } }),
  latest: (page) => series("", page, { sort: { value: "latest", ascending: false } }),
  search: series,
  filters,

  async details(url) {
    const d = astroProp(await getDocument(BASE + url), ["title", "description"]);
    const description = d.description ? html.parse("<div>" + d.description + "</div>", BASE).text() : "";
    const genres = (d.genres || []).map((g) => g.name);
    if (d.type) genres.unshift(d.type.charAt(0).toUpperCase() + d.type.slice(1));
    return {
      title: d.title,
      cover: d.coverUrl || "",
      author: d.author || "",
      artist: d.artist || "",
      description,
      genres: unique(genres),
      status: STATUS[String(d.status || "").toLowerCase()] || "unknown",
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    const slug = pathOf(doc.selectFirst("link[rel=canonical]") ? doc.selectFirst("link[rel=canonical]").absUrl("href") : BASE + url)
      .split("/")
      .filter(Boolean)[1];
    const list = astroProp(doc, ["chapters"]).chapters || [];
    const now = Date.now();
    return list
      .filter((c) => !isLocked(c, now))
      .map((c) => {
        const n = String(c.number).replace(/\.0$/, "");
        return {
          url: "/comics/" + slug + "/chapter/" + n,
          name: "Chapter " + n + (c.title ? " - " + c.title : ""),
          number: Number(c.number),
          date: c.created_at ? parseDate(c.created_at) : null,
          scanlator: null,
        };
      });
  },

  async pages(url) {
    const data = astroProp(await getDocument(BASE + url), ["pages"]);
    const pages = data.pages || [];
    if (!pages.length) throw new Error("This chapter is premium on Asura Scans");
    if (pages.some((p) => p.tiles && p.tiles.length)) throw new Error("This chapter uses scrambled images, which Ahoge can't show yet");
    return pages.map((p) => ({ url: p.url, headers: HEADERS }));
  },
};

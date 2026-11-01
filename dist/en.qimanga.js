var source = null;
const META = {"id":"en.qimanga","name":"Qi Manga","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://qimanga.com"};
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

// Qi Manga (formerly Qi Scans) JSON API, the one the site's Angular app calls.
const API = "https://api.qimanga.com/api/v1";
const PER_PAGE = 30;
// The chapter list endpoint rejects perPage above 100.
const CHAPTERS_PER_PAGE = 100;

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + (pairs && pairs.length ? "?" + query(pairs) : "")));
  return JSON.parse(res.body);
}

// The catalogue also lists novels, which have no page images.
const readable = (item) => item.type !== "NOVEL";

function stub(item) {
  return { url: "/series/" + item.slug, title: String(item.title || "").trim(), cover: item.cover || "" };
}

function listing(json) {
  return {
    manga: (json.data || []).filter(readable).map(stub),
    hasNextPage: Boolean(json.next) && json.current < json.totalPages,
  };
}

// "/series/<slug>" and "/series/<slug>/<chapterSlug>".
function slugs(url) {
  const parts = pathOf(url).split("/").filter(Boolean);
  if (parts[0] !== "series" || !parts[1]) throw new Error("Not a Qi Manga url: " + url);
  return { series: parts[1], chapter: parts[2] || null };
}

const STATUS = {
  ONGOING: "ongoing",
  COMPLETED: "completed",
  MASS_RELEASED: "completed",
  HIATUS: "hiatus",
  CANCELLED: "cancelled",
  DROPPED: "cancelled",
};

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "latest", label: "Latest update" },
  { value: "newest", label: "Newly added" },
  { value: "alphabetical", label: "Title" },
];
const STATUSES = [
  { value: "", label: "Any" },
  { value: "ONGOING", label: "Ongoing" },
  { value: "COMPLETED", label: "Completed" },
  { value: "HIATUS", label: "Hiatus" },
  { value: "MASS_RELEASED", label: "Mass released" },
  { value: "COMING_SOON", label: "Coming soon" },
  { value: "DROPPED", label: "Dropped" },
  { value: "CANCELLED", label: "Cancelled" },
];
const TYPES = [
  { value: "", label: "Any" },
  { value: "MANHWA", label: "Manhwa" },
  { value: "MANHUA", label: "Manhua" },
  { value: "MANGA", label: "Manga" },
];
let genreFilters = null;

async function loadGenres() {
  if (genreFilters) return genreFilters;
  const genres = await api("/series/genres", []);
  genreFilters = genres
    .map((g) => ({ type: "checkbox", key: g.slug, name: String(g.name).trim() }))
    .filter((g) => g.key && g.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return genreFilters;
}

async function filters() {
  let genres = [];
  try {
    genres = await loadGenres();
  } catch (e) {
    // Sort, status and type still work without the genre list; the next call tries again.
  }
  return [
    { type: "header", name: "Filters are ignored when searching by title" },
    { type: "sort", key: "sort", name: "Sort by", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
    ...(genres.length ? [{ type: "group", key: "genres", name: "Genres (must have all)", filters: genres }] : []),
  ];
}

function browse(page, sort, order, extra) {
  return api("/series", [["page", page], ["perPage", PER_PAGE], ["sort", sort], ["order", order], ...(extra || [])]).then(listing);
}

async function search(q, page, f) {
  const text = String(q || "").trim();
  // The search endpoint takes only a title (2+ characters) and no filters.
  if (text.length >= 2) return listing(await api("/series/search", [["q", text], ["page", page], ["perPage", PER_PAGE]]));
  if (!f) return browse(page, "popular", "desc");
  const sort = f.sort || { value: "popular", ascending: false };
  const extra = [];
  if (f.status) extra.push(["status", f.status]);
  if (f.type) extra.push(["type", f.type]);
  const genres = Object.keys(f.genres || {}).filter((k) => f.genres[k] === true);
  if (genres.length) extra.push(["genres", genres.join(",")]);
  return browse(page, sort.value, sort.ascending ? "asc" : "desc", extra);
}

function chapterName(ch) {
  const title = String(ch.title || "").trim();
  const label = "Chapter " + ch.number;
  if (!title) return label;
  return /^(chapter|ch\.?|episode)\s*\d/i.test(title) ? title : label + " - " + title;
}

source = {
  popular: (page) => browse(page, "popular", "desc"),
  latest: (page) => browse(page, "latest", "desc"),
  search,
  filters,

  async details(url) {
    const m = await api("/series/" + slugs(url).series, []);
    const description = m.description ? html.parse(m.description, META.baseUrl).text() : "";
    return {
      title: String(m.title || "").trim(),
      cover: m.cover || "",
      author: String(m.author || "").trim(),
      artist: String(m.artist || "").trim(),
      description,
      genres: (m.genres || []).map((g) => String(g.name).trim()).filter(Boolean),
      status: STATUS[m.status] || "unknown",
    };
  },

  async chapters(url) {
    const series = slugs(url).series;
    const chapters = [];
    for (let page = 1; ; page++) {
      const json = await api("/series/" + series + "/chapters", [["page", page], ["perPage", CHAPTERS_PER_PAGE]]);
      for (const ch of json.data || []) {
        // Paid chapters come back with no images until they turn free.
        if (ch.requiresPurchase || ch.publishStatus !== "PUBLIC") continue;
        chapters.push({
          url: "/series/" + series + "/" + ch.slug,
          name: chapterName(ch),
          number: typeof ch.number === "number" ? ch.number : chapterNumber(ch.title),
          date: ch.createdAt ? parseDate(ch.createdAt) : null,
          scanlator: null,
        });
      }
      if (!json.next || page >= json.totalPages) break;
    }
    return chapters;
  },

  async pages(url) {
    const ids = slugs(url);
    if (!ids.chapter) throw new Error("Not a chapter url: " + url);
    const ch = await api("/series/" + ids.series + "/chapters/" + ids.chapter, []);
    if (ch.requiresPurchase) throw new Error("This chapter is paid on Qi Manga and not free yet.");
    return (ch.images || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((img) => ({ url: img.url, headers: {} }));
  },
};

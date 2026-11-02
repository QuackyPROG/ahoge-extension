var source = null;
const META = {"id":"en.manhwa18cc","name":"Manhwa18.cc","lang":"en","version":"1.0.0","nsfw":true,"baseUrl":"https://manhwa18.cc"};
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

// Manhwa18.cc (a different site from manhwa18.com). Server-rendered lists, Madara-style detail page.
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  const manga = doc
    .select("div.manga-item")
    .map((el) => {
      const link = el.selectFirst("h3 a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst(".thumb img")) };
    })
    .filter(Boolean);
  return { manga, hasNextPage: Boolean(doc.selectFirst("a.next, a[rel=next], li.next a")) };
}

const pageSuffix = (page) => (page > 1 ? "/" + page : "");

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "latest", label: "Latest update" },
  { value: "views", label: "Most views" },
  { value: "new", label: "Newest" },
  { value: "alphabet", label: "A-Z" },
  { value: "rating", label: "Rating" },
];

function filters() {
  return [
    { type: "header", name: "Sort is ignored when searching by text" },
    { type: "select", key: "sort", name: "Sort", options: SORTS },
  ];
}

function infoRow(doc, label) {
  const row = doc
    .select("div.post-content_item")
    .filter((r) => {
      const h = r.selectFirst(".summary-heading");
      return h && h.text().toLowerCase().indexOf(label) === 0;
    })[0];
  return row ? row.selectFirst(".summary-content") : null;
}

source = {
  popular: async (page) => listing(await getDocument(BASE + "/webtoons" + pageSuffix(page) + "?orderby=trending")),
  latest: async (page) => listing(await getDocument(BASE + "/webtoons" + pageSuffix(page) + "?orderby=latest")),
  filters,

  async search(q, page, f) {
    if (q) return listing(await getDocument(BASE + "/search?" + query([["q", q], ["page", page]])));
    const sort = (f && f.sort) || "trending";
    return listing(await getDocument(BASE + "/webtoons" + pageSuffix(page) + "?orderby=" + sort));
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("div.post-title h1");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const text = (label) => {
      const el = infoRow(doc, label);
      return el ? el.text() : "";
    };
    const links = (label) => {
      const el = infoRow(doc, label);
      return el ? el.select("a").map((a) => a.text()) : [];
    };
    const descEl = doc.selectFirst("div.panel-story-description .dsct");
    let description = descEl ? descEl.text() : "";
    const alt = text("alternative");
    if (alt) description += (description ? "\n\n" : "") + "Alternative names: " + alt;
    return {
      title: (titleEl.ownText() || titleEl.text()).replace(/^18\+\s*/, ""),
      cover: imageUrl(doc.selectFirst("div.summary_image img")),
      author: links("author").join(", "),
      artist: links("artist").join(", "),
      description,
      genres: unique(links("genre")),
      status: parseStatus(text("status")),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("li.a-h").map((li) => {
      const a = li.selectFirst("a.chapter-name");
      const time = li.selectFirst(".chapter-time");
      const name = a.text();
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: time ? parseDate(time.text()) : null, scanlator: null };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("div.read-content img")
      .map((img) => imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

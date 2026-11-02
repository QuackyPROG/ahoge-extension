var source = null;
const META = {"id":"en.mgeko","name":"Mgeko (Manga Geko)","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://www.mgeko.cc"};
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

// Mgeko (formerly MangaGeko). The browse page loads cards from /browse-comics/data/ as JSON-wrapped HTML.
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

const SORTS = [
  { value: "popular_all_time", label: "Popular (all time)" },
  { value: "popular_monthly", label: "Popular (month)" },
  { value: "popular_weekly", label: "Popular (week)" },
  { value: "popular_daily", label: "Popular (day)" },
  { value: "latest", label: "Latest update" },
  { value: "recently_added", label: "Recently added" },
  { value: "rating", label: "Rating" },
  { value: "az", label: "A - Z" },
  { value: "za", label: "Z - A" },
];
const STATUSES = [
  { value: "", label: "Any" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
];
const TYPES = [
  { value: "", label: "Any" },
  { value: "manga", label: "Manga" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "webtoon", label: "Webtoon" },
];

function filters() {
  return [
    { type: "select", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
  ];
}

async function browse(pairs, page) {
  const res = ensureOk(await http.get(BASE + "/browse-comics/data/?" + query(pairs.concat([["page", page]])), { headers: HEADERS }));
  const json = JSON.parse(res.body);
  const doc = html.parse("<div>" + (json.results_html || "") + "</div>", BASE + "/");
  const manga = doc
    .select("article.comic-card")
    .map((card) => {
      const link = card.selectFirst(".comic-card__title a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(card.selectFirst(".comic-card__cover img")) };
    })
    .filter(Boolean);
  return { manga, hasNextPage: Number(json.page) < Number(json.num_pages) };
}

// "Oct. 24, 2026, 11:42 p.m." -> the date part.
function chapterDate(text) {
  const m = String(text || "").match(/([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})/);
  return m ? parseDate(m[1] + " " + m[2] + ", " + m[3]) : null;
}

source = {
  popular: (page) => browse([["sort", "popular_all_time"]], page),
  latest: (page) => browse([["sort", "latest"]], page),
  filters,

  search(q, page, f) {
    const opts = f || {};
    const pairs = [];
    if (q) pairs.push(["q", q]);
    pairs.push(["sort", opts.sort || "popular_all_time"]);
    if (opts.status) pairs.push(["status", opts.status]);
    if (opts.type) pairs.push(["type", opts.type]);
    return browse(pairs, page);
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("h1.novel-title");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const authors = doc.select(".author [itemprop=author]").map((e) => e.text()).filter((t) => t && !/updating/i.test(t));
    const statusEl = doc.selectFirst("strong.ongoing, strong.completed, strong.hiatus");
    // The description starts with a boilerplate paragraph; the summary follows the first double <br>.
    const desc = doc.selectFirst("p.description");
    let description = "";
    if (desc) {
      const text = desc.text();
      const at = text.indexOf("The Summary is");
      description = (at === -1 ? text : text.slice(at + "The Summary is".length)).trim();
    }
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("figure.cover img")),
      author: authors.join(", "),
      artist: "",
      description,
      genres: unique(doc.select(".categories a.property-item, a.property-item[href*=genre_included]").map((a) => a.text())),
      status: parseStatus(statusEl ? statusEl.text() : ""),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url.replace(/\/?$/, "/") + "all-chapters/");
    return doc
      .select("li[data-orderno] > a[href*=/reader/]")
      .map((a) => {
        const titleEl = a.selectFirst(".chapter-title");
        const label = titleEl ? titleEl.text() : "";
        const timeEl = a.selectFirst("time");
        const number = chapterNumber("chapter " + label);
        return {
          url: pathOf(a.absUrl("href")),
          name: "Chapter " + label.replace(/-eng-li$/, ""),
          number,
          date: timeEl ? chapterDate(timeEl.attr("datetime")) : null,
          scanlator: null,
        };
      });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("img.mgr-page")
      .map((img) => imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

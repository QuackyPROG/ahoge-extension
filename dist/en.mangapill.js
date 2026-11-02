var source = null;
const META = {"id":"en.mangapill","name":"Mangapill","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://mangapill.com","upstream":"src/en/mangapill"};
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

// Mangapill. Port of keiyoushi src/en/mangapill (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function cards(doc, selector) {
  const seen = new Set();
  return doc
    .select(selector)
    .map((el) => {
      const link = el.selectFirst("a[href^=/manga/]");
      const titleEl = el.selectFirst("div.line-clamp-2");
      if (!link || !titleEl) return null;
      return { url: pathOf(link.absUrl("href")), title: titleEl.text(), cover: imageUrl(el.selectFirst("img")) };
    })
    .filter((m) => m && !seen.has(m.url) && seen.add(m.url));
}

const TYPES = [
  { value: "", label: "All" },
  { value: "manga", label: "Manga" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "one-shot", label: "One-shot" },
  { value: "doujinshi", label: "Doujinshi" },
  { value: "oel", label: "OEL" },
];
const STATUSES = [
  { value: "", label: "All" },
  { value: "publishing", label: "Publishing" },
  { value: "finished", label: "Finished" },
  { value: "on hiatus", label: "On hiatus" },
  { value: "discontinued", label: "Discontinued" },
  { value: "not yet published", label: "Not yet published" },
];
let genreFilters = null;

async function filters() {
  if (!genreFilters) {
    try {
      const doc = await getDocument(BASE + "/search");
      genreFilters = doc
        .select("input[name=genre]")
        .map((i) => i.attr("value"))
        .filter(Boolean)
        .map((g) => ({ type: "checkbox", key: g, name: g }));
    } catch (e) {
      // Genres are fetched again next time.
    }
  }
  const list = [
    { type: "select", key: "type", name: "Type", options: TYPES },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
  if (genreFilters && genreFilters.length) list.push({ type: "group", key: "genres", name: "Genres", filters: genreFilters });
  return list;
}

const STATUS_TEXT = { publishing: "ongoing", finished: "completed", "on hiatus": "hiatus", discontinued: "cancelled" };

source = {
  async popular() {
    const doc = await getDocument(BASE + "/");
    return { manga: cards(doc, "div:has(> h4:contains(Trending)) > .grid > div:not([class]), div:has(h4:contains(Trending)) > .grid > div:not([class])"), hasNextPage: false };
  },

  async latest() {
    const doc = await getDocument(BASE + "/chapters");
    return { manga: cards(doc, ".grid > div:not([class])"), hasNextPage: false };
  },

  filters,

  async search(q, page, f) {
    const opts = f || {};
    const pairs = [["page", page], ["q", q || ""]];
    for (const g of Object.keys(opts.genres || {})) if (opts.genres[g] === true) pairs.push(["genre", g]);
    if (opts.type) pairs.push(["type", opts.type]);
    if (opts.status) pairs.push(["status", opts.status]);
    const doc = await getDocument(BASE + "/search?" + query(pairs));
    return { manga: cards(doc, ".grid > div:not([class])"), hasNextPage: Boolean(doc.selectFirst("a.btn.btn-sm")) };
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("h1");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    // Labelled info cells: <div><label>Status</label><div>publishing</div></div>.
    const field = (name) => {
      const label = doc.select("label").filter((l) => l.text().toLowerCase() === name)[0];
      return label ? doc.select("div:has(> label:containsOwn(" + name + ")) > div").map((d) => d.text()).join(" ") : "";
    };
    const descEl = doc.selectFirst("div.container > div:first-child > div:last-child > div:nth-child(2) > p, p.text-sm.text--secondary");
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("div.container > div:first-child > div:first-child > img, div.container img")),
      author: "",
      artist: "",
      description: descEl ? descEl.text() : "",
      genres: unique(doc.select("a[href*=genre]").map((a) => a.text())),
      status: STATUS_TEXT[field("status").toLowerCase()] || parseStatus(field("status")),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("#chapters > div > a").map((a) => {
      const name = a.text();
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: null, scanlator: null };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("picture img, chapter-page img")
      .map((img) => imageUrl(img))
      .filter((u, i, all) => u && all.indexOf(u) === i)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

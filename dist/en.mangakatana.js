var source = null;
const META = {"id":"en.mangakatana","name":"MangaKatana","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://mangakatana.com","upstream":"src/en/mangakatana"};
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

// MangaKatana. Port of keiyoushi src/en/mangakatana (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function bookList(doc) {
  const manga = doc
    .select("div#book_list > div.item")
    .map((el) => {
      const link = el.selectFirst("div.text > h3 > a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.ownText() || link.text(), cover: imageUrl(el.selectFirst("img")) };
    })
    .filter(Boolean);
  return { manga, hasNextPage: Boolean(doc.selectFirst("a.next.page-numbers")) };
}

const SORTS = [
  { value: "latest", label: "Latest update" },
  { value: "new", label: "New manga" },
  { value: "az", label: "A-Z" },
  { value: "numc", label: "Number of chapters" },
];
const STATUSES = [
  { value: "", label: "All" },
  { value: "1", label: "Ongoing" },
  { value: "2", label: "Completed" },
  { value: "0", label: "Cancelled" },
];

function filters() {
  return [
    { type: "select", key: "order", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
}

// "Oct-30-2026"
function katanaDate(text) {
  const m = String(text || "").match(/([A-Za-z]{3})-(\d{1,2})-(\d{4})/);
  return m ? parseDate(m[1] + " " + m[2] + ", " + m[3]) : parseDate(text);
}

function detailsFrom(doc) {
  const titleEl = doc.selectFirst("h1.heading");
  if (!titleEl) return null;
  let description = doc.select(".summary > p").map((p) => p.text()).join("\n\n");
  const alt = doc.selectFirst(".alt_name");
  if (alt && alt.text()) description += "\n\nAlt name(s): " + alt.text();
  const statusEl = doc.selectFirst(".value.status");
  return {
    title: titleEl.text(),
    cover: imageUrl(doc.selectFirst("div.media div.cover img")),
    author: doc.select(".author").map((a) => a.text()).join(", "),
    artist: "",
    description: description.trim(),
    genres: unique(doc.select(".genres > a").map((a) => a.text())),
    status: parseStatus(statusEl ? statusEl.text() : ""),
  };
}

source = {
  popular: async (page) => bookList(await getDocument(BASE + "/manga/page/" + page + "?" + query([["filter", "1"], ["order", "numc"]]))),
  latest: async (page) => bookList(await getDocument(BASE + "/page/" + page)),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    if (q) {
      const doc = await getDocument(BASE + "/page/" + page + "?" + query([["search", q], ["search_by", "book_name"]]));
      // A single match redirects straight to the manga page.
      const single = detailsFrom(doc);
      if (single && !doc.selectFirst("div#book_list")) {
        const canonical = doc.selectFirst("link[rel=canonical]");
        const url = canonical ? pathOf(canonical.absUrl("href")) : "";
        return { manga: url ? [{ url, title: single.title, cover: single.cover }] : [], hasNextPage: false };
      }
      return bookList(doc);
    }
    const pairs = [["filter", "1"], ["order", opts.order || "latest"]];
    if (opts.status) pairs.push(["status", opts.status]);
    return bookList(await getDocument(BASE + "/manga/page/" + page + "?" + query(pairs)));
  },

  async details(url) {
    const details = detailsFrom(await getDocument(BASE + url));
    if (!details) throw new Error("Manga title not found on " + url);
    return details;
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("tr:has(.chapter)").map((row) => {
      const a = row.selectFirst("a");
      const time = row.selectFirst(".update_time");
      const name = a.text();
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: time ? katanaDate(time.text()) : null, scanlator: null };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    const script = doc.select("script").map((s) => s.data()).filter((d) => d.indexOf("data-src") !== -1)[0];
    if (!script) throw new Error("Page list not found on " + url);
    const name = (script.match(/data-src['"],\s*(\w+)/) || [])[1];
    const start = name ? script.indexOf("var " + name + "=[") : -1;
    const array = start === -1 ? null : [null, script.slice(start + name.length + 6, script.indexOf("]", start))];
    if (!array) throw new Error("Page list not found on " + url);
    const urls = [];
    array[1].replace(/'([^']*)'/g, (_, u) => urls.push(u));
    return urls.filter(Boolean).map((u) => ({ url: u, headers: HEADERS }));
  },
};

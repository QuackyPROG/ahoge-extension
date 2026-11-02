var source = null;
const META = {"id":"en.mangatown","name":"MangaTown","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://www.mangatown.com","upstream":"src/en/mangatown"};
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

// MangaTown. Port of keiyoushi src/en/mangatown (Apache-2.0).
// A phone user agent gets a different mobile layout, so pages are requested as a desktop browser.
const BASE = META.baseUrl;
const HEADERS = {
  Referer: BASE + "/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  const manga = doc
    .select("li:has(a.manga_cover)")
    .map((li) => {
      const link = li.selectFirst("p.title a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(li.selectFirst("img")) };
    })
    .filter(Boolean);
  const next = doc.selectFirst("div.next-page a.next:not([href^=javascript]), .page-nav a:contains(next):not([href^=javascript])");
  return { manga, hasNextPage: Boolean(next) };
}

// "Oct 30,2026", "Today", "Yesterday"
function townDate(text) {
  const t = String(text || "").trim();
  if (/today/i.test(t)) return Date.now();
  if (/yesterday/i.test(t)) return Date.now() - 86400000;
  const m = t.match(/([A-Za-z]{3,})\.?\s*(\d{1,2}),\s*(\d{4})/);
  return m ? parseDate(m[1] + " " + m[2] + ", " + m[3]) : null;
}

const viewerImage = (doc) => imageUrl(doc.selectFirst("div#viewer img"));

source = {
  popular: async (page) => listing(await getDocument(BASE + "/directory/0-0-0-0-0-0/" + page + ".htm")),
  latest: async (page) => listing(await getDocument(BASE + "/latest/" + page + ".htm")),
  search: async (q, page) => listing(await getDocument(BASE + "/search?" + query([["page", page], ["name", q]]))),

  async details(url) {
    const doc = await getDocument(BASE + url);
    const info = doc.selectFirst("div.article_content");
    const titleEl = info ? info.selectFirst("h1") : null;
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const names = (label) => info.select("li:has(b:containsOwn(" + label + ")) a").map((a) => a.text()).join(", ");
    const statusEl = info.selectFirst("li:has(b:containsOwn(status))");
    const desc = doc.selectFirst("span#show");
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("div.detail_info img")),
      author: names("author"),
      artist: names("artist"),
      description: desc ? desc.text().replace(/HIDE$/, "").trim() : "",
      genres: unique(info.select("li:has(b:containsOwn(genre)) a").map((a) => a.text())),
      status: parseStatus(statusEl ? statusEl.text().replace(/^[^:]*:/, "") : ""),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("ul.chapter_list li").map((li) => {
      const a = li.selectFirst("a");
      const extra = li.select("span:not(.time):not(.new)").map((s) => s.text()).join(" ");
      const name = (a.text() + " " + extra).trim();
      const time = li.selectFirst("span.time");
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(a.text()), date: time ? townDate(time.text()) : null, scanlator: null };
    });
  },

  // One HTML page per image; the page selector lists them all, so they are fetched in parallel.
  async pages(url) {
    const doc = await getDocument(BASE + url);
    const options = doc
      .select("select#top_chapter_list ~ div.page_select option")
      .filter((o) => !/featured/i.test(o.text()))
      .map((o) => o.absUrl("value"))
      .filter((u, i, all) => u && all.indexOf(u) === i);
    let urls;
    if (options.length) {
      urls = await Promise.all(
        options.map(async (pageUrl, i) => (i === 0 && pathOf(pageUrl) === pathOf(BASE + url) ? viewerImage(doc) : viewerImage(await getDocument(pageUrl)))),
      );
    } else {
      urls = doc.select("div#viewer img").map((img) => imageUrl(img));
    }
    return urls.filter(Boolean).map((u) => ({ url: u, headers: { Referer: BASE + "/" } }));
  },
};

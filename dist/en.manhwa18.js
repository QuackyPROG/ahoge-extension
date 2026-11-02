var source = null;
const META = {"id":"en.manhwa18","name":"Manhwa18","lang":"en","version":"1.0.0","nsfw":true,"baseUrl":"https://manhwa18.com","upstream":"src/en/manhwa18"};
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

// Manhwa18 (manhwa18.com). Port of keiyoushi src/en/manhwa18 (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

// Covers are CSS backgrounds: data-bg, or style="background-image: url('…')".
function bgUrl(el) {
  if (!el) return "";
  const bg = el.attr("data-bg");
  if (bg) return el.absUrl("data-bg");
  const m = el.attr("style").match(/url\(['"]?([^'")]+)['"]?\)/);
  return m ? m[1] : "";
}

async function listing(pairs) {
  const doc = await getDocument(BASE + "/tim-kiem?" + query(pairs));
  const manga = doc
    .select(".thumb-item-flow")
    .map((el) => {
      const link = el.selectFirst(".series-title a") || el.selectFirst("a[href]");
      if (!link || !link.attr("href")) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: bgUrl(el.selectFirst(".lazy-bg, .img-in-ratio")) };
    })
    .filter((m) => m && !/see-more/.test(m.url));
  return { manga, hasNextPage: Boolean(doc.selectFirst(".pagination_wrap a.next, .pagination a[rel=next]")) };
}

const SORTS = [
  { value: "update", label: "Latest update" },
  { value: "new", label: "New manhwa" },
  { value: "top", label: "Most view" },
  { value: "like", label: "Most like" },
  { value: "az", label: "A - Z" },
  { value: "za", label: "Z - A" },
];
const STATUSES = [
  { value: "0", label: "All" },
  { value: "1", label: "Ongoing" },
  { value: "2", label: "On hold" },
  { value: "3", label: "Completed" },
];
let genreFilters = null;

async function filters() {
  if (!genreFilters) {
    try {
      const doc = await getDocument(BASE + "/");
      const seen = new Set();
      genreFilters = doc
        .select("a.genres-item")
        .map((a) => {
          const m = a.attr("href").match(/genre\/([^/?#]+)/);
          return m ? { slug: m[1], name: a.text() } : null;
        })
        .filter((g) => g && g.name && !seen.has(g.slug) && seen.add(g.slug));
    } catch (e) {
      // Genres are fetched again next time.
    }
  }
  const list = [
    { type: "select", key: "sort", name: "Order", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
  if (genreFilters && genreFilters.length) {
    list.push({ type: "group", key: "genres", name: "Genres", filters: genreFilters.map((g) => ({ type: "checkbox", key: g.slug, name: g.name })) });
  }
  return list;
}

function parseDmy(text) {
  const m = String(text || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? utcDate(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : parseDate(text);
}

source = {
  popular: (page) => listing([["sort", "top"], ["page", page]]),
  latest: (page) => listing([["sort", "update"], ["page", page]]),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    const genres = Object.keys(opts.genres || {}).filter((k) => opts.genres[k] === true);
    if (!q && genres.length === 1) {
      // The search form takes numeric genre ids; the genre pages take slugs.
      const doc = await getDocument(BASE + "/genre/" + genres[0] + "?page=" + page);
      const manga = doc
        .select(".thumb-item-flow")
        .map((el) => {
          const link = el.selectFirst(".series-title a");
          return link ? { url: pathOf(link.absUrl("href")), title: link.text(), cover: bgUrl(el.selectFirst(".lazy-bg, .img-in-ratio")) } : null;
        })
        .filter(Boolean);
      return { manga, hasNextPage: Boolean(doc.selectFirst(".pagination_wrap a.next, .pagination a[rel=next]")) };
    }
    const pairs = [];
    if (q) pairs.push(["q", q]);
    pairs.push(["sort", opts.sort || "update"]);
    if (opts.status && opts.status !== "0") pairs.push(["status", opts.status]);
    pairs.push(["page", page]);
    return listing(pairs);
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst(".series-name a, .au-bento h1, .series-name");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const info = {};
    for (const item of doc.select(".series-information .info-item")) {
      const name = item.selectFirst(".info-name");
      const value = item.selectFirst(".info-value");
      if (name && value) info[name.text().toLowerCase()] = { el: item, text: value.text() };
    }
    const field = (word) => {
      const key = Object.keys(info).find((k) => k.indexOf(word) !== -1);
      return key ? info[key] : null;
    };
    const genre = field("genre");
    const author = field("author");
    const status = field("status");
    const summary = doc.selectFirst(".summary-content");
    return {
      title: titleEl.text(),
      cover: bgUrl(doc.selectFirst(".series-cover .img-in-ratio")),
      author: author ? author.text : "",
      artist: "",
      description: summary ? summary.text() : "",
      genres: genre ? unique(genre.el.select(".info-value a").map((a) => a.text())) : [],
      status: parseStatus(status ? status.text : ""),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("div.au-chgrid a.au-chtile, ul.list-chapters > a")
      .map((a) => {
        const href = a.absUrl("href");
        if (!href) return null;
        const name = a.attr("data-name") || a.attr("title") || a.text();
        const dateEl = a.selectFirst(".au-chtile-date, .chapter-time");
        const dateText = dateEl ? dateEl.text().replace(/^.*[·-]\s*/, "") : "";
        return { url: pathOf(href), name, number: chapterNumber(name), date: parseDmy(dateText), scanlator: null };
      })
      .filter(Boolean);
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("#chapter-content img")
      .map((img) => imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

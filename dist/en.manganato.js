var source = null;
const META = {"id":"en.manganato","name":"MangaNato","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://www.manganato.gg","upstream":"lib-multisrc/mangabox"};
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

// MangaNato (MangaBox family: Mangakakalot, NatoManga). Port of keiyoushi lib-multisrc/mangabox (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  const manga = doc
    .select("div.list-comic-item-wrap, div.list-truyen-item-wrap, .panel_story_list .story_item")
    .map((el) => {
      const link = el.selectFirst("h3 a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst("img")) };
    })
    .filter(Boolean);
  const next = doc.selectFirst("a.page_select + a:not(.page_last), a.page-select + a:not(.page-last), div.group-page a:not([href]) + a:not(:contains(Last))");
  return { manga, hasNextPage: Boolean(next) };
}

// Search takes the title as a path segment with punctuation folded to "_".
function searchSlug(q) {
  return String(q)
    .toLowerCase()
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
    .replace(/[èéẹẻẽêềếệểễ]/g, "e")
    .replace(/[ìíịỉĩ]/g, "i")
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
    .replace(/[ùúụủũưừứựửữ]/g, "u")
    .replace(/[ỳýỵỷỹ]/g, "y")
    .replace(/đ/g, "d")
    .replace(/[!@%^*()+=<>?/,.:;'" "&#[\]~\-$_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const SORTS = [
  { value: "topview", label: "Most views" },
  { value: "latest", label: "Latest update" },
  { value: "newest", label: "Newest" },
];
const STATUSES = [
  { value: "all", label: "All" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
];
const FILTER_ID = {
  "newest/all": "1", "newest/completed": "2", "newest/ongoing": "3",
  "latest/all": "4", "latest/completed": "5", "latest/ongoing": "6",
  "topview/all": "7", "topview/completed": "8", "topview/ongoing": "9",
};

function filters() {
  return [
    { type: "header", name: "Filters are ignored for a text search" },
    { type: "select", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
}

function slugOf(url) {
  return pathOf(url).split("/").filter(Boolean)[1];
}

source = {
  popular: async (page) => listing(await getDocument(BASE + "/manga-list/hot-manga?page=" + page)),
  latest: async (page) => listing(await getDocument(BASE + "/manga-list/latest-manga?page=" + page)),
  filters,

  async search(q, page, f) {
    if (q) return listing(await getDocument(BASE + "/search/story/" + encodeURIComponent(searchSlug(q)) + "?page=" + page));
    const opts = f || {};
    const id = FILTER_ID[(opts.sort || "topview") + "/" + (opts.status || "all")];
    return listing(await getDocument(BASE + "/genre/all?" + query([["filter", id], ["page", page]])));
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const info = doc.selectFirst("div.manga-info-top, div.panel-story-info");
    const titleEl = info ? info.selectFirst("h1, h2") : null;
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const line = (label) => {
      const li = info.select("li").filter((e) => e.text().toLowerCase().indexOf(label) === 0)[0];
      return li ? li.text().replace(/^[^:]*:\s*/, "") : "";
    };
    const descEl = doc.selectFirst("div#contentBox, div#noidungm, div#panel-story-info-description");
    const alt = doc.selectFirst(".story-alternative");
    let description = descEl ? descEl.ownText() : "";
    if (alt && alt.text()) description += (description ? "\n\n" : "") + "Alternative name: " + alt.text().replace(/^[^:]*:\s*/, "");
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("div.manga-info-pic img, span.info-image img")),
      author: line("author"),
      artist: "",
      description,
      genres: unique(info.select("li.genres a, td:containsOwn(genres) + td a").map((a) => a.text())),
      status: parseStatus(line("status")),
    };
  },

  async chapters(url) {
    const slug = slugOf(url);
    const res = ensureOk(
      await http.get(BASE + "/api/manga/" + slug + "/chapters?limit=-1", { headers: { Referer: BASE + url, "X-Requested-With": "XMLHttpRequest" } }),
    );
    const json = JSON.parse(res.body);
    if (!json.success) throw new Error("Chapter list unavailable for " + url);
    return ((json.data && json.data.chapters) || [])
      .filter((c) => c.chapter_slug)
      .map((c) => ({
        url: "/manga/" + slug + "/" + c.chapter_slug,
        name: c.chapter_name || "Chapter",
        number: c.chapter_num == null ? chapterNumber(c.chapter_name) : Number(c.chapter_num),
        date: c.updated_at ? parseDate(c.updated_at) : null,
        scanlator: null,
      }));
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    const script = doc.select("script").map((s) => s.data()).filter((d) => d.indexOf("cdns") !== -1).join("\n");
    const array = (name) => {
      const m = script.match(new RegExp(name + "\\s*=\\s*\\[([^\\]]*)\\]"));
      if (!m) return [];
      return m[1]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, "").replace(/\\\//g, "/").replace(/\/$/, ""))
        .filter(Boolean);
    };
    const cdns = array("cdns").concat(array("backupImage"));
    const images = array("chapterImages");
    let urls;
    if (images.length && cdns.length) urls = images.map((p) => cdns[0] + "/" + p.replace(/^\/+/, ""));
    else urls = doc.select("div.container-chapter-reader > img").map((img) => imageUrl(img));
    return urls.filter(Boolean).map((u) => ({ url: u, headers: HEADERS }));
  },
};

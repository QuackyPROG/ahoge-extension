var source = null;
const META = {"id":"en.weebcentral","name":"Weeb Central","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://weebcentral.com","upstream":"src/en/weebcentral"};
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

// Weeb Central (formerly MangaSee). Port of keiyoushi src/en/weebcentral (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };
const LIMIT = 32;

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function sourceImg(el) {
  const source = el.selectFirst("source");
  if (source && source.attr("srcset")) return source.absUrl("srcset").replace("small", "normal");
  return imageUrl(el.selectFirst("img"));
}

const option = (v) => ({ value: v, label: v });
const SORTS = ["Best Match", "Popularity", "Latest Updates", "Recently Added", "Subscribers", "Alphabet"].map(option);
const TRISTATE = ["Any", "True", "False"].map(option);
const STATUSES = ["Ongoing", "Complete", "Hiatus", "Canceled"];
const TYPES = ["Manga", "Manhwa", "Manhua", "OEL"];
const TAGS = [
  "Action", "Adult", "Adventure", "Comedy", "Doujinshi", "Drama", "Ecchi", "Fantasy", "Gender Bender", "Harem",
  "Hentai", "Historical", "Horror", "Isekai", "Josei", "Martial Arts", "Mature", "Mecha", "Mystery",
  "Psychological", "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo", "Shoujo Ai", "Shounen",
  "Shounen Ai", "Slice of Life", "Smut", "Sports", "Supernatural", "Tragedy", "Yaoi", "Yuri", "Other",
];

function filters() {
  return [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "official", name: "Official translation", options: TRISTATE },
    { type: "select", key: "anime", name: "Anime adaptation", options: TRISTATE },
    { type: "select", key: "adult", name: "Adult content", options: TRISTATE },
    { type: "text", key: "author", name: "Author (case-sensitive)" },
    { type: "group", key: "status", name: "Status", filters: STATUSES.map((s) => ({ type: "checkbox", key: s, name: s })) },
    { type: "group", key: "type", name: "Type", filters: TYPES.map((s) => ({ type: "checkbox", key: s, name: s })) },
    { type: "group", key: "tags", name: "Tags", filters: TAGS.map((s) => ({ type: "tristate", key: s, name: s })) },
  ];
}

async function searchData(text, page, f) {
  const opts = f || {};
  const sort = opts.sort || { value: "Best Match", ascending: false };
  const pairs = [
    ["text", String(text || "").replace(/[!#:(),-]/g, " ").trim()],
    ["sort", sort.value],
    ["order", sort.ascending ? "Ascending" : "Descending"],
    ["official", opts.official || "Any"],
    ["anime", opts.anime || "Any"],
    ["adult", opts.adult || "Any"],
  ];
  if (opts.author) pairs.push(["author", opts.author]);
  const groups = (g) => opts[g] || {};
  for (const s of Object.keys(groups("status"))) if (groups("status")[s] === true) pairs.push(["included_status", s]);
  for (const t of Object.keys(groups("type"))) if (groups("type")[t] === true) pairs.push(["included_type", t]);
  for (const t of Object.keys(groups("tags"))) {
    if (groups("tags")[t] === 1) pairs.push(["included_tag", t]);
    if (groups("tags")[t] === 2) pairs.push(["excluded_tag", t]);
  }
  pairs.push(["limit", LIMIT], ["offset", (page - 1) * LIMIT], ["display_mode", "Full Display"]);
  const doc = await getDocument(BASE + "/search/data?" + query(pairs));
  const manga = doc
    .select("article > section > a")
    .map((a) => {
      const titleEl = a.selectFirst("div:not([class]):last-child");
      return { url: pathOf(a.absUrl("href")), title: titleEl ? titleEl.text() : a.text(), cover: sourceImg(a) };
    })
    .filter((m) => m.url.indexOf("/series/") === 0);
  return { manga, hasNextPage: Boolean(doc.selectFirst("button")) };
}

const STATUS = { ongoing: "ongoing", complete: "completed", hiatus: "hiatus", canceled: "cancelled" };

source = {
  popular: (page) => searchData("", page, { sort: { value: "Popularity", ascending: false } }),
  latest: (page) => searchData("", page, { sort: { value: "Latest Updates", ascending: false } }),
  search: searchData,
  filters,

  async details(url) {
    const doc = await getDocument(BASE + url);
    const sections = doc.select("section[x-data] > section");
    if (sections.length < 2) throw new Error("Series page layout not recognised: " + url);
    const info = sections[0];
    const main = sections[1];
    const titleEl = main.selectFirst("h1");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const statusEl = info.selectFirst("ul > li:has(strong:contains(Status)) > a");
    const descEl = main.selectFirst("li:has(strong:contains(Description)) > p");
    const alt = main.select("li:has(strong:contains(Associated Name)) li").map((e) => e.text());
    let description = descEl ? descEl.text().replace("NOTE: ", "\n\nNOTE: ") : "";
    if (alt.length) description += "\n\nAssociated names:\n" + alt.map((n) => "- " + n).join("\n");
    return {
      title: titleEl.text(),
      cover: sourceImg(info),
      author: info.select("ul > li:has(strong:contains(Author)) > span > a").map((a) => a.text()).join(", "),
      artist: "",
      description: description.trim(),
      genres: unique(info.select("ul > li:has(strong:contains(Tag)) a, ul > li:has(strong:contains(Type)) a").map((a) => a.text())),
      status: STATUS[statusEl ? statusEl.text().toLowerCase() : ""] || "unknown",
    };
  },

  async chapters(url) {
    const id = pathOf(url).split("/").filter(Boolean)[1];
    const doc = await getDocument(BASE + "/series/" + id + "/full-chapter-list");
    const links = doc.select("div[x-data] > a");
    const seasonal = links.some((a) => {
      const n = a.selectFirst("span.flex > span");
      return n && /(season|s)\s*\d+/i.test(n.text());
    });
    return links.map((a, i) => {
      const nameEl = a.selectFirst("span.flex > span");
      const name = nameEl ? nameEl.text() : a.text();
      const time = a.selectFirst("time[datetime]");
      const official = a.select("img").some((img) => /official/i.test(img.attr("src")));
      return {
        url: pathOf(a.absUrl("href")),
        name,
        number: seasonal ? links.length - i : chapterNumber(name),
        date: time ? parseDate(time.attr("datetime")) : null,
        scanlator: official ? "Official" : null,
      };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url.replace(/\/$/, "") + "/images?is_prev=False&reading_style=long_strip");
    return doc
      .select("section#chapter-images > img, section[x-data~=scroll] > img")
      .map((img) => img.absUrl("src"))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

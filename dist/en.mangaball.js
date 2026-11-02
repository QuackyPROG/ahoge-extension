var source = null;
const META = {"id":"en.mangaball","name":"MangaBall","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://mangaball.com","upstream":"src/all/mangaball"};
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

// MangaBall JSON API (English chapters only). Port of keiyoushi src/all/mangaball (Apache-2.0).
const BASE = META.baseUrl;
const XHR = { Referer: BASE + "/", "X-Requested-With": "XMLHttpRequest" };
const COVERS = "https://bulbasaur.poke-black-and-white.net/covers/";
const LANGS = ["en", "en-us", "en-gb"];

async function api(path) {
  const res = ensureOk(await http.get(BASE + "/api/v1" + path, { headers: XHR }));
  return JSON.parse(res.body);
}

function coverOf(image) {
  if (!image) return "";
  const path = image.cover && image.cover.path ? String(image.cover.path).trim().split("\\").join("/") : "";
  if (path) return /^https?:/.test(path) ? path : COVERS + path;
  return image.file || image.cdn_mangadex || image.cdn_mangaupdate || image.cdn_mangaupdates || "";
}

// "/title-detail/<slug>"
const slugOf = (url) => pathOf(url).split("/").filter(Boolean)[1];
const stub = (m) => ({ url: "/title-detail/" + m.slug, title: m.name, cover: coverOf(m.image) });

const SORTS = [
  { value: "views", label: "Most views" },
  { value: "lastupdate", label: "Latest update" },
  { value: "createdAt", label: "Newly added" },
  { value: "name", label: "Title" },
];
const STATUSES = [
  { value: "", label: "Any" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
  { value: "cancelled", label: "Cancelled" },
];
const TYPES = [
  { value: "", label: "Any" },
  { value: "manga", label: "Manga" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
];
const ADULT = [
  { value: "all", label: "Show adult titles" },
  { value: "no_18", label: "Hide adult titles" },
];

function filters() {
  return [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
    { type: "select", key: "adult", name: "Adult content", options: ADULT },
  ];
}

async function searchAdvanced(q, page, f) {
  const opts = f || {};
  const sort = opts.sort || { value: q ? "" : "lastupdate", ascending: false };
  const pairs = [["page", page], ["limit", 24]];
  // The API orders by relevance only when sort_by is omitted.
  if (sort.value && !(q && !f)) pairs.push(["sort_by", sort.value], ["sort_order", sort.ascending ? "asc" : "desc"]);
  pairs.push(["tag_mode", "AND"], ["adult_mode", opts.adult || "all"]);
  if (q) pairs.push(["keyword", q.trim()]);
  if (opts.type) pairs.push(["type", opts.type]);
  if (opts.status) pairs.push(["status", opts.status]);
  const json = await api("/title/search-advanced?" + query(pairs));
  const p = json.pagination || {};
  return { manga: (json.data || []).map(stub), hasNextPage: p.page < p.total_pages };
}

const STATUS = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };
const trimNumber = (n) => String(n).replace(/\.0$/, "");

async function title(url) {
  return (await api("/title/detail/" + encodeURIComponent(slugOf(url)))).data;
}

source = {
  popular: (page) => searchAdvanced("", page, { sort: { value: "views", ascending: false } }),
  latest: (page) => searchAdvanced("", page, { sort: { value: "lastupdate", ascending: false } }),
  search: searchAdvanced,
  filters,

  async details(url) {
    const t = await title(url);
    let description = (t.description || []).join("\n\n");
    const alt = t.alternateName || [];
    if (alt.length) description += "\n\nAlternative names:\n" + alt.map((n) => "- " + n).join("\n");
    return {
      title: t.name,
      cover: coverOf(t.image),
      author: (t.author || []).map((a) => a.name).join(", "),
      artist: "",
      description: description.trim(),
      genres: unique((t.tags || []).map((g) => g.name)),
      status: STATUS[t.status] || "unknown",
    };
  },

  async chapters(url) {
    const t = await title(url);
    const res = ensureOk(
      await http.post(BASE + "/api/v1/chapter/chapter-listing-by-title-id", {
        headers: Object.assign({ "Content-Type": "application/json" }, XHR),
        body: JSON.stringify({ title_id: t.id }),
      }),
    );
    return (JSON.parse(res.body).data || [])
      .filter((c) => LANGS.indexOf(String(c.lang).toLowerCase()) !== -1)
      .map((c) => {
        const name = String(c.name || "").trim();
        const n = c.number == null ? null : trimNumber(c.number);
        let label = c.volume > 0 ? "Vol. " + trimNumber(c.volume) + " " : "";
        label += n !== null && name.indexOf(n) !== -1 ? name : "Ch. " + n + (name ? " " + name : "");
        return {
          url: "/chapter-detail/" + c.id,
          name: label,
          number: c.number == null ? chapterNumber(name) : Number(c.number),
          date: c.created_at ? parseDate(String(c.created_at).replace(/\.\d+$/, "") + "Z") : null,
          scanlator: c.group ? c.group.name : null,
        };
      });
  },

  async pages(url) {
    const id = pathOf(url).split("/").filter(Boolean)[1];
    const json = await api("/chapter-detail?chapter_id=" + encodeURIComponent(id));
    return ((json.data && json.data.chapter && json.data.chapter.pages) || []).map((u) => ({ url: u, headers: { Referer: BASE + "/" } }));
  },
};

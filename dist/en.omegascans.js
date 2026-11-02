var source = null;
const META = {"id":"en.omegascans","name":"Omega Scans","lang":"en","version":"1.0.0","nsfw":true,"baseUrl":"https://omegascans.org","upstream":"src/en/omegascans"};
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

// Omega Scans runs HeanCMS; the site's own app reads this JSON API. Port of keiyoushi lib-multisrc/heancms (Apache-2.0).
const API = "https://api.omegascans.org";
const PER_PAGE = 20;
const CHAPTERS_PER_PAGE = 100;

async function api(path) {
  const res = ensureOk(await http.get(API + path, { headers: { Accept: "application/json", Referer: META.baseUrl + "/" } }));
  return JSON.parse(res.body);
}

// "/series/<slug>" and "/series/<slug>/<chapterSlug>".
function slugs(url) {
  const parts = pathOf(url).split("/").filter(Boolean);
  if (parts[0] !== "series" || !parts[1]) throw new Error("Not an Omega Scans url: " + url);
  return { series: parts[1], chapter: parts[2] || null };
}

const hasNext = (meta) => Boolean(meta) && meta.current_page < meta.last_page;

const STATUSES = [
  { value: "All", label: "All" },
  { value: "Ongoing", label: "Ongoing" },
  { value: "Completed", label: "Completed" },
  { value: "Hiatus", label: "Hiatus" },
  { value: "Dropped", label: "Dropped" },
];
const SORTS = [
  { value: "total_views", label: "Popular" },
  { value: "latest", label: "Latest" },
  { value: "created_at", label: "Newly added" },
  { value: "title", label: "Title" },
];
let tagFilters = null;

async function filters() {
  if (!tagFilters) {
    try {
      const tags = await api("/tags");
      tagFilters = tags
        .map((t) => ({ type: "checkbox", key: String(t.id), name: String(t.name).trim() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      // Browse still works without tags; they are fetched again next time.
    }
  }
  const list = [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
  if (tagFilters && tagFilters.length) list.push({ type: "group", key: "tags", name: "Genres", filters: tagFilters });
  return list;
}

async function queryList(page, q, status, orderBy, order, tagIds) {
  const pairs = [
    ["query_string", q],
    ["status", status],
    ["order", order],
    ["orderBy", orderBy],
    ["series_type", "Comic"],
    ["page", page],
    ["perPage", PER_PAGE],
    ["tags_ids", "[" + tagIds.join(",") + "]"],
    ["adult", "true"],
  ];
  const json = await api("/query?" + query(pairs));
  return {
    manga: (json.data || []).map((s) => ({ url: "/series/" + s.series_slug, title: String(s.title || "").trim(), cover: s.thumbnail || "" })),
    hasNextPage: hasNext(json.meta),
  };
}

function descriptionText(htmlText) {
  if (!htmlText) return "";
  const doc = html.parse("<div>" + htmlText + "</div>", META.baseUrl);
  const paragraphs = doc.select("p").map((p) => p.text()).filter(Boolean);
  return paragraphs.length ? paragraphs.join("\n\n") : doc.text();
}

source = {
  popular: (page) => queryList(page, "", "All", "total_views", "desc", []),
  latest: (page) => queryList(page, "", "All", "latest", "desc", []),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    const sort = opts.sort || { value: "total_views", ascending: false };
    const tags = Object.keys(opts.tags || {}).filter((k) => opts.tags[k] === true);
    return queryList(page, q, opts.status || "All", sort.value, sort.ascending ? "asc" : "desc", tags);
  },

  async details(url) {
    const s = await api("/series/" + slugs(url).series);
    return {
      title: String(s.title || "").trim(),
      cover: s.thumbnail || "",
      author: s.author || "",
      artist: s.studio || "",
      description: descriptionText(s.description),
      genres: unique((s.tags || []).map((t) => t.name)),
      status: parseStatus(s.status),
    };
  },

  async chapters(url) {
    const slug = slugs(url).series;
    const s = await api("/series/" + slug);
    const now = Date.now();
    const out = [];
    for (let page = 1; ; page++) {
      const json = await api("/chapter/query?" + query([["page", page], ["perPage", CHAPTERS_PER_PAGE], ["series_id", s.id]]));
      for (const c of json.data || []) {
        // Paid (early access) chapters need an account; they turn free later.
        if (c.price) continue;
        const date = parseDate(c.created_at);
        if (date !== null && date > now) continue;
        const name = String(c.chapter_name || "").trim() + (c.chapter_title ? " - " + String(c.chapter_title).trim() : "");
        out.push({ url: "/series/" + slug + "/" + c.chapter_slug, name, number: chapterNumber(c.chapter_name), date, scanlator: null });
      }
      if (!hasNext(json.meta)) break;
    }
    return out;
  },

  async pages(url) {
    const s = slugs(url);
    const json = await api("/chapter/" + s.series + "/" + s.chapter);
    const images = (json.chapter && json.chapter.chapter_data && json.chapter.chapter_data.images) || [];
    if (!images.length && json.paywall) throw new Error("This chapter is paid on Omega Scans");
    return images.map((u) => ({ url: /^https?:\/\//.test(u) ? u : API + "/" + u.replace(/^\//, ""), headers: { Referer: META.baseUrl + "/" } }));
  },
};

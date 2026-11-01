var source = null;
const META = {"id":"en.mangadex","name":"MangaDex","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://mangadex.org","upstream":"src/all/mangadex"};
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

// MangaDex public API (https://api.mangadex.org/docs/). English, safe + suggestive ratings.
const API = "https://api.mangadex.org";
const LIMIT = 20;
// MangaDex redirects browser User-Agents to a bot challenge; the API wants a non-browser one.
const HEADERS = { "User-Agent": "Ahoge/2.0 (+https://github.com/QuackyPROG/ahoge-extension)" };
const RATINGS = [["contentRating[]", "safe"], ["contentRating[]", "suggestive"]];

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + "?" + query(pairs), { headers: HEADERS }));
  return JSON.parse(res.body);
}

function localized(map) {
  if (!map) return "";
  return map.en || Object.values(map)[0] || "";
}

function related(item, type) {
  return (item.relationships || []).filter((r) => r.type === type && r.attributes);
}

function coverOf(item) {
  const cover = related(item, "cover_art")[0];
  return cover ? "https://uploads.mangadex.org/covers/" + item.id + "/" + cover.attributes.fileName + ".512.jpg" : "";
}

function titleOf(item) {
  const a = item.attributes;
  const alt = (a.altTitles || []).find((t) => t.en);
  if (a.title && a.title.en) return a.title.en;
  if (alt) return alt.en;
  return Object.values(a.title || {})[0] || "";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function idOf(url) {
  const match = String(url).match(UUID);
  if (!match) throw new Error("Invalid MangaDex id in url: " + url);
  return match[0].toLowerCase();
}

async function list(page, extra) {
  const json = await api("/manga", [
    ["limit", LIMIT],
    ["offset", (page - 1) * LIMIT],
    ["includes[]", "cover_art"],
    ["availableTranslatedLanguage[]", "en"],
    ["hasAvailableChapters", "true"],
    ...RATINGS,
    ...extra,
  ]);
  return {
    manga: json.data.map((m) => ({ url: "/manga/" + m.id, title: titleOf(m), cover: coverOf(m) })),
    hasNextPage: json.offset + json.data.length < Math.min(json.total, 10000),
  };
}

source = {
  popular: (page) => list(page, [["order[followedCount]", "desc"]]),
  latest: (page) => list(page, [["order[latestUploadedChapter]", "desc"]]),
  search: (q, page) => list(page, [["title", q], ["order[relevance]", "desc"]]),

  async details(url) {
    const id = idOf(url);
    const json = await api("/manga/" + id, [["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]]);
    const m = json.data;
    const names = (type) => related(m, type).map((r) => r.attributes.name).join(", ");
    return {
      title: titleOf(m),
      cover: coverOf(m),
      author: names("author"),
      artist: names("artist"),
      description: localized(m.attributes.description),
      genres: (m.attributes.tags || []).map((t) => localized(t.attributes.name)).filter(Boolean),
      status: parseStatus(m.attributes.status),
    };
  },

  async chapters(url) {
    const id = idOf(url);
    const chapters = [];
    let offset = 0;
    for (;;) {
      const json = await api("/manga/" + id + "/feed", [
        ["translatedLanguage[]", "en"],
        ["order[volume]", "desc"],
        ["order[chapter]", "desc"],
        ["limit", 500],
        ["offset", offset],
        ["includes[]", "scanlation_group"],
        ...RATINGS,
        ["contentRating[]", "erotica"],
        ["contentRating[]", "pornographic"],
      ]);
      for (const ch of json.data) {
        const a = ch.attributes;
        if (a.externalUrl) continue;
        const label = [a.volume ? "Vol." + a.volume : "", a.chapter ? "Ch." + a.chapter : "Oneshot"].filter(Boolean).join(" ");
        const group = related(ch, "scanlation_group")[0];
        chapters.push({
          url: "/chapter/" + ch.id,
          name: a.title ? label + " - " + a.title : label,
          number: a.chapter && Number.isFinite(Number(a.chapter)) ? Number(a.chapter) : -1,
          date: a.publishAt ? Date.parse(a.publishAt) : null,
          scanlator: group ? group.attributes.name : null,
        });
      }
      offset = json.offset + json.data.length;
      if (offset >= json.total || json.data.length === 0) break;
    }
    return chapters;
  },

  async pages(url) {
    const id = idOf(url);
    const res = ensureOk(await http.get(API + "/at-home/server/" + id, { headers: HEADERS }));
    const json = JSON.parse(res.body);
    return json.chapter.data.map((file) => ({ url: json.baseUrl + "/data/" + json.chapter.hash + "/" + file, headers: {} }));
  },
};

var source = null;
const META = {"id":"en.webtoons","name":"WEBTOON","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://www.webtoons.com","upstream":"src/all/webtoons"};
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

// WEBTOON (official, free episodes; English). Port of keiyoushi src/all/webtoons (Apache-2.0).
// A phone user agent is redirected to m.webtoons.com, whose pages differ, so www pages are requested as desktop.
const BASE = META.baseUrl;
const MOBILE = "https://m.webtoons.com";
const LANG = "en";
const HEADERS = {
  Referer: BASE + "/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Cookie: "ageGatePass=true; locale=" + LANG + "; needGDPR=false",
};

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  return doc
    .select(".webtoon_list li a")
    .map((a) => {
      const titleEl = a.selectFirst(".title");
      const href = a.absUrl("href");
      if (!titleEl || !href) return null;
      return { url: pathOf(href) + href.replace(/^[^?]*/, ""), title: titleEl.text(), cover: imageUrl(a.selectFirst("img")) };
    })
    .filter(Boolean);
}

const RANKINGS = ["trending", "popular", "originals", "canvas"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function filters() {
  return [
    {
      type: "select",
      key: "type",
      name: "Search in",
      options: [
        { value: "", label: "All" },
        { value: "originals", label: "Originals" },
        { value: "canvas", label: "Canvas" },
      ],
    },
  ];
}

// Manga urls keep the query string: "/en/<genre>/<slug>/list?title_no=123".
function param(url, name) {
  const m = String(url).match(new RegExp("[?&]" + name + "=([^&#]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

// "Season 2 Ep. 14", "Episode 3", "Ch. 7"; mini/bonus/special episodes get no number.
function episodeNumber(title) {
  const t = String(title);
  if (/mini|bonus|special/i.test(t)) return -1;
  const m = t.match(/(?:e(?:p(?:isode)?)?|ch(?:apter)?)\s*\.?\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : -1;
}

source = {
  async popular(page) {
    const ranking = RANKINGS[page - 1];
    if (!ranking) return { manga: [], hasNextPage: false };
    const doc = await getDocument(BASE + "/" + LANG + "/ranking/" + ranking);
    return { manga: listing(doc), hasNextPage: page < RANKINGS.length };
  },

  // The originals released today, most recently updated first.
  async latest() {
    const day = DAYS[new Date().getUTCDay()];
    const doc = await getDocument(BASE + "/" + LANG + "/originals/" + day + "?sortOrder=UPDATE");
    return { manga: listing(doc), hasNextPage: false };
  },

  filters,

  async search(q, page, f) {
    const type = (f && f.type) || "";
    const pairs = [["keyword", q]];
    if (type && page > 1) pairs.push(["page", page]);
    const doc = await getDocument(BASE + "/" + LANG + "/search" + (type ? "/" + type : "") + "?" + query(pairs));
    return { manga: listing(doc), hasNextPage: Boolean(type) && Boolean(doc.selectFirst("a.pagination[aria-current=true] + a")) };
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("h1.subj, h3.subj");
    if (!titleEl) throw new Error("Series title not found on " + url);
    const detail = doc.selectFirst(".detail_header .info");
    const aside = doc.selectFirst("#_asideDetail");
    const authors = detail ? detail.select(".author").map((a) => a.ownText() || a.text()) : [];
    const area = detail ? detail.selectFirst(".author_area") : null;
    const author = authors[0] || (area ? area.ownText() : "");
    const day = aside && aside.selectFirst("p.day_info") ? aside.selectFirst("p.day_info").text() : "";
    const og = doc.selectFirst("head meta[property=og:image]");
    const summary = aside ? aside.selectFirst("p.summary") : null;
    return {
      title: titleEl.text(),
      cover: og ? og.attr("content") : "",
      author,
      artist: authors[1] || author,
      description: summary ? summary.text() : "",
      genres: detail ? unique(detail.select(".genre").map((g) => g.text())) : [],
      status: /UP|EVERY/.test(day) ? "ongoing" : /END|COMPLETED/.test(day) ? "completed" : "unknown",
    };
  },

  async chapters(url) {
    const titleNo = param(url, "title_no") || param(url, "titleNo");
    if (!titleNo) throw new Error("No title number in " + url);
    const type = /\/canvas\/|\/challenge\//.test(url) ? "canvas" : "webtoon";
    let api = MOBILE + "/api/v1/" + type + "/" + titleNo + "/episodes?pageSize=99999";
    if (type === "canvas") api += "&readingLanguageCode=" + LANG;
    const res = ensureOk(await http.get(api, { headers: { Referer: MOBILE + "/" } }));
    const episodes = (JSON.parse(res.body).result || {}).episodeList || [];
    const numbered = episodes.filter((e) => episodeNumber(e.episodeTitle) !== -1).length;
    // Unnumbered titles (or mostly unnumbered ones) fall back to their position.
    const sequential = numbered * 2 < episodes.length;
    return episodes
      .map((e, i) => {
        const title = html.parse("<p>" + e.episodeTitle + "</p>", BASE).text();
        return {
          url: e.viewerLink,
          name: title + (e.hasBgm ? " ♫" : ""),
          number: sequential ? i + 1 : episodeNumber(e.episodeTitle) === -1 ? -1 : episodeNumber(e.episodeTitle),
          date: e.exposureDateMillis || null,
          scanlator: null,
        };
      })
      .reverse();
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("div#_imageList > img")
      .map((img) => img.attr("data-url") || imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: { Referer: BASE + "/" } }));
  },
};

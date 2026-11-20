var source = null;
const META = {"id":"en.nyxscans","name":"Nyx Scans","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://nyxscans.com","template":"iken","upstream":"src/en/nyxscans"};
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

// Iken theme (JSON API at api.<host>). Port of keiyoushi lib-multisrc/iken (Apache-2.0).
// Manga urls are "/series/<slug>", chapter urls "/series/<slug>/<chapter slug>#<chapter id>".
function Iken(config) {
  const c = Object.assign(
    {
      apiUrl: null, // defaults to https://api.<host>
      perPage: 18,
      sortPagesByFilename: false,
      hideNovelsListedAsComics: false,
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const api = (c.apiUrl || base.replace("https://", "https://api.")) + "/api";
  const headers = { Referer: base + "/", Origin: base };

  async function getJson(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return JSON.parse(res.body);
  }

  const SORTS = [
    { value: "lastChapterAddedAt", label: "Last chapter" },
    { value: "totalViews", label: "Views" },
    { value: "createdAt", label: "Date added" },
    { value: "chaptersCount", label: "Chapter count" },
    { value: "postTitle", label: "Title" },
  ];
  const STATUSES = [
    { value: "", label: "All" },
    { value: "ONGOING", label: "Ongoing" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "DROPPED", label: "Dropped" },
    { value: "COMING_SOON", label: "Coming soon" },
    { value: "MASS_RELEASED", label: "Mass released" },
  ];
  const TYPES = [
    { value: "", label: "All" },
    { value: "MANGA", label: "Manga" },
    { value: "MANHUA", label: "Manhua" },
    { value: "MANHWA", label: "Manhwa" },
  ];

  const isNovel = (p) => Boolean(p.isNovel) || String(p.seriesType || "").toLowerCase() === "novel";
  const stub = (p) => ({ url: "/series/" + p.slug, title: p.postTitle, cover: p.featuredImage || "" });

  let novelIds = null;
  async function getNovelIds() {
    if (novelIds) return novelIds;
    const ids = new Set();
    for (let page = 1; page <= 20; page++) {
      const data = await getJson(api + "/posts?" + query([["page", page], ["perPage", 100]]));
      const posts = data.novelPosts || [];
      posts.forEach((p) => ids.add(p.id));
      if (!posts.length || ids.size >= (data.novelTotalCount || 0)) break;
    }
    novelIds = ids;
    return ids;
  }

  // The API pages hold novels too; skip pages that hold nothing else (at most a few).
  async function queryList(q, page, opts) {
    const pairs = [["perPage", c.perPage], ["searchTerm", String(q || "").trim()]];
    if (opts.status) pairs.push(["seriesStatus", opts.status]);
    if (opts.type) pairs.push(["seriesType", opts.type]);
    const sort = opts.sort || { value: "lastChapterAddedAt", ascending: false };
    pairs.push(["orderBy", sort.value], ["orderDirection", sort.ascending ? "asc" : "desc"]);
    const genres = opts.genres ? Object.keys(opts.genres).filter((k) => opts.genres[k]) : [];
    if (genres.length) pairs.push(["genreIds", genres.join(",")]);
    const novels = c.hideNovelsListedAsComics ? await getNovelIds() : new Set();
    let p = page;
    for (let tries = 0; tries < 5; tries++, p++) {
      const data = await getJson(api + "/query?" + query(pairs.concat([["page", p]])));
      const manga = (data.posts || []).filter((x) => !isNovel(x) && !novels.has(x.id)).map(stub);
      const hasNextPage = (data.totalCount || 0) > p * c.perPage;
      if (manga.length || !hasNextPage) return { manga, hasNextPage };
    }
    return { manga: [], hasNextPage: false };
  }

  let genreCache = null;
  async function filters() {
    if (!genreCache) {
      try {
        const list = await getJson(api + "/genres");
        genreCache = (Array.isArray(list) ? list : []).map((g) => ({ type: "checkbox", key: String(g.id), name: g.name }));
      } catch (e) {
        return baseFilters();
      }
    }
    const out = baseFilters();
    if (genreCache.length) out.push({ type: "group", key: "genres", name: "Genres", filters: genreCache });
    return out;
  }
  function baseFilters() {
    return [
      { type: "sort", key: "sort", name: "Sort", options: SORTS },
      { type: "select", key: "status", name: "Status", options: STATUSES },
      { type: "select", key: "type", name: "Type", options: TYPES },
    ];
  }

  const slugOf = (url) => pathOf(url).split("/").filter(Boolean)[1];

  async function post(url) {
    const data = await getJson(api + "/post?" + query([["postSlug", slugOf(url)]]));
    if (!data.post) throw new Error("Series not found: " + url);
    if (isNovel(data.post)) throw new Error("Novels are unsupported");
    return data;
  }

  function chapterOf(slug, ch) {
    const locked = ch.isLocked === true || ch.isTimeLocked === true || (ch.chapterPurchased === false && ch.price && ch.price !== 0);
    const title = ch.title && String(ch.title).trim() ? " - " + ch.title : "";
    const number = Number(ch.number);
    return {
      url: "/series/" + slug + "/" + ch.slug + "#" + ch.id,
      name: (locked ? "🔒 " : "") + "Chapter " + ch.number + title,
      number: Number.isNaN(number) ? -1 : number,
      date: ch.createdAt ? parseDate(String(ch.createdAt).replace(/\.\d+/, "")) : null,
      scanlator: null,
      locked,
    };
  }

  const STATUS = { ONGOING: "ongoing", COMING_SOON: "ongoing", MASS_RELEASED: "ongoing", COMPLETED: "completed", CANCELLED: "cancelled", DROPPED: "cancelled" };

  return {
    popular: (page) => queryList("", page, { sort: { value: "totalViews", ascending: false } }),
    latest: (page) => queryList("", page, { sort: { value: "lastChapterAddedAt", ascending: false } }),
    search: (q, page, f) => queryList(q, page, f || {}),
    filters,

    async details(url) {
      const p = (await post(url)).post;
      let description = p.postContent ? html.parse("<div>" + String(p.postContent).split("\n").join("<br>") + "</div>", base).text() : "";
      if (p.alternativeTitles) description = (description + "\n\nAlternative Names: " + p.alternativeTitles).trim();
      const type = { MANGA: "Manga", MANHUA: "Manhua", MANHWA: "Manhwa" }[p.seriesType];
      return {
        title: p.postTitle,
        cover: p.featuredImage || "",
        author: p.author || "",
        artist: p.artist || "",
        description,
        genres: unique([type].concat((p.genres || []).map((g) => g.name))),
        status: STATUS[p.seriesStatus] || "unknown",
      };
    },

    async chapters(url) {
      const data = await post(url);
      const slug = data.post.slug;
      let list = data.post.chapters || [];
      // The post endpoint can truncate long series; the chapters endpoint has them all.
      if (data.totalChapterCount && data.totalChapterCount > list.length) {
        try {
          const full = await getJson(api + "/chapters?" + query([["postId", data.post.id]]));
          const more = (full.post && full.post.chapters) || [];
          if (more.length > list.length) list = more;
        } catch (e) {}
      }
      return list
        .map((ch) => chapterOf(slug, ch))
        .filter((ch) => !ch.locked)
        .map((ch) => ({ url: ch.url, name: ch.name, number: ch.number, date: ch.date, scanlator: ch.scanlator }))
        .sort((a, b) => b.number - a.number);
    },

    async pages(url) {
      const id = String(url).split("#")[1];
      if (!id) throw new Error("Chapter id missing from " + url + "; refresh the chapter list");
      const data = (await getJson(api + "/chapter?" + query([["chapterId", id]]))).chapter;
      if (!data) throw new Error("Chapter not found: " + url);
      if (data.isShortLinkLocked || data.isLockedByCoins || data.isPermanentlyLocked) throw new Error("Chapter is locked");
      let images = (data.images || []).slice();
      const fileNumber = (u) => {
        const m = String(u).split("/").pop().match(/\d+/);
        return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
      };
      if (c.sortPagesByFilename) images.sort((a, b) => fileNumber(a.url) - fileNumber(b.url));
      else images.sort((a, b) => (a.order === undefined || a.order === null ? Infinity : a.order) - (b.order === undefined || b.order === null ? Infinity : b.order));
      return images.map((img) => ({ url: String(img.url).split(" ").join("%20"), headers: { Referer: base + "/" } }));
    },
  };
}

source = Iken({
  baseUrl: META.baseUrl,
  hideNovelsListedAsComics: true,
});

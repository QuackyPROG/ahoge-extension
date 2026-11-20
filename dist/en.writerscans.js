var source = null;
const META = {"id":"en.writerscans","name":"Writer Scans","lang":"en","version":"1.0.0","nsfw":false,"baseUrl":"https://writerscans.com","template":"keyoapp","upstream":"src/en/writerscans"};
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

// Keyoapp theme. Port of keiyoushi lib-multisrc/keyoapp (Apache-2.0).
// layout "v1": Keyoapp (home-page carousels, /series search, #pages > img[uid]).
// layout "v2": KeyoappV2 (?_ajax=search, ?_chapters_html=1, #strip-reader).
// layout "livewire": the Livewire redesign used by ArtLapsa-like sites (/search, immersiveReader x-data).
function Keyoapp(config) {
  const c = Object.assign(
    {
      layout: "v1",
      popularFromSearch: false, // v1: the full /series listing instead of the home-page carousel
      popularSelector: null,
      latestSelector: "div.grid > div.group",
      descriptionSelector: "#expand_content p",
      altNameSelector: "div.font-medium:containsOwn(Alternative titles) ~ div span",
      statusSelector: "div:has(span:containsOwn(Status)) ~ div",
      authorSelector: "div:has(span:containsOwn(Author)) ~ div",
      artistSelector: "div:has(span:containsOwn(Artist)) ~ div",
      genreSelector: "div:has(>h1) a[href*='genre=']",
      typeSelector: "div:has(span:containsOwn(Type)) ~ div",
      paidChapterSelector: "img[alt~=Coin]",
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const headers = { Referer: base + "/" };
  const xhr = { Referer: base + "/", "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
  const popularSelector =
    c.popularSelector ||
    ["Popular", "Popularie", "Trending"].map((t) => "div:contains(" + t + ") + div .group.overflow-hidden.grid").join(", ");

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return html.parse(res.body, res.url);
  }
  async function getJson(url) {
    const res = ensureOk(await http.get(url, { headers: xhr }));
    return JSON.parse(res.body);
  }

  const isNovel = (el) =>
    el.select('[data-type="novel"], [data-type="Novel"]').length > 0 ||
    el.select("span").some((s) => /^novel$/i.test(s.ownText()));

  // style="background-image: url('…')"
  function styleImage(el, selector) {
    const target = el.selectFirst(selector);
    if (!target) return "";
    const m = target.attr("style").match(/url\(['"]?([^'")]+)/);
    if (!m) return "";
    const url = m[1];
    return /[?&]w=/.test(url) ? url : url + (url.indexOf("?") === -1 ? "?" : "&") + "w=480";
  }

  function v1Card(el) {
    const link = el.selectFirst("a[href]");
    if (!link) return null;
    const cover = c.layout === "livewire" ? imageUrl(el.selectFirst("img[alt$=' cover'], img")) : styleImage(el, "*[style*=background-image]");
    return { url: pathOf(link.absUrl("href")), title: link.attr("title") || link.text(), cover };
  }
  const cards = (doc, selector) => unique(doc.select(selector).filter((el) => !isNovel(el)).map(v1Card).filter(Boolean).map((m) => JSON.stringify(m))).map((s) => JSON.parse(s));

  const SORTS_V2 = [
    { value: "latest", label: "Latest" },
    { value: "trending", label: "Trending" },
    { value: "popular", label: "Popular" },
    { value: "views", label: "Most viewed" },
    { value: "rating", label: "Top rated" },
    { value: "az", label: "A-Z" },
    { value: "za", label: "Z-A" },
  ];
  const TYPES = [
    { value: "", label: "All" },
    { value: "manhwa", label: "Manhwa" },
    { value: "manhua", label: "Manhua" },
    { value: "manga", label: "Manga" },
    { value: "mangatoon", label: "Mangatoon" },
  ];
  const STATUSES = [
    { value: "", label: "All" },
    { value: "ongoing", label: "Ongoing" },
    { value: "completed", label: "Completed" },
  ];

  // ---- v2 ----
  async function v2List(page, q, opts) {
    const pairs = [["_ajax", "search"]];
    if (q && q.trim()) pairs.push(["q", q.trim()]);
    if (opts.sort) pairs.push(["sort", opts.sort]);
    if (opts.type) pairs.push(["type", opts.type]);
    if (opts.status) pairs.push(["status", opts.status]);
    pairs.push(["offset", (page - 1) * 20]);
    const data = await getJson(base + "/?" + query(pairs));
    const doc = html.parse(data.html || "", base + "/");
    const manga = doc
      .select("a.group[href]")
      .filter((el) => !isNovel(el))
      .map((el) => {
        const h2 = el.selectFirst("h2");
        const img = el.selectFirst("img");
        return { url: pathOf(el.absUrl("href")), title: h2 ? h2.text() : el.attr("title"), cover: img ? img.attr("data-src") || imageUrl(img) : "" };
      });
    return { manga, hasNextPage: Boolean(data.has_more) };
  }

  // ---- livewire ----
  async function livewireList(page, pairs) {
    const all = pairs.concat(page > 1 ? [["page", page]] : []);
    const doc = await getDocument(base + "/search" + (all.length ? "?" + query(all) : ""));
    const manga = cards(doc, "main#main-content [wire\\:key*='serie']");
    return { manga, hasNextPage: manga.length >= 20 };
  }

  // ---- v1 ----
  async function v1Search(q, opts) {
    const pairs = [];
    if (q && q.trim()) pairs.push(["q", q.trim()]);
    const doc = await getDocument(base + "/series/" + (pairs.length ? "?" + query(pairs) : ""));
    const needle = String(q || "").trim().toLowerCase();
    const manga = doc
      .select("#searched_series_page > button")
      .filter((el) => !isNovel(el))
      .filter((el) => !needle || el.attr("title").toLowerCase().indexOf(needle) !== -1)
      .filter((el) => !opts.type || el.attr("data-type").toLowerCase() === opts.type)
      .filter((el) => !opts.status || el.attr("data-status").toLowerCase() === opts.status)
      .map(v1Card)
      .filter(Boolean);
    return { manga, hasNextPage: false };
  }

  function keyoDate(text) {
    const t = String(text || "").trim();
    const m = t.match(/(a|an|one|\d+)\s*(\w+)\s+ago/i);
    if (m) {
      const n = /^\d/.test(m[1]) ? Number(m[1]) : 1;
      const u = m[2].toLowerCase();
      const unit = /^mo/.test(u) ? "month" : /^m/.test(u) ? "minute" : /^h/.test(u) ? "hour" : /^d/.test(u) ? "day" : /^w/.test(u) ? "week" : /^y/.test(u) ? "year" : null;
      return unit ? parseDate(n + " " + unit + " ago") : null;
    }
    return parseDate(t.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
  }

  function filters() {
    if (c.layout === "v2") {
      return [
        { type: "select", key: "sort", name: "Sort", options: SORTS_V2 },
        { type: "select", key: "type", name: "Type", options: TYPES },
        { type: "select", key: "status", name: "Status", options: STATUSES },
      ];
    }
    if (c.layout === "livewire") return [];
    return [
      { type: "select", key: "type", name: "Type", options: TYPES },
      { type: "select", key: "status", name: "Status", options: STATUSES },
    ];
  }

  const textOf = (doc, sel) => {
    const el = doc.selectFirst(sel);
    return el ? el.text().trim() : "";
  };
  const STATUS = { ongoing: "ongoing", dropped: "cancelled", paused: "hiatus", hiatus: "hiatus", completed: "completed" };

  function v1Details(doc) {
    const titleEl = doc.selectFirst("div.grid > h1") || doc.selectFirst("h1");
    if (!titleEl) throw new Error("Series title not found");
    let cover = c.layout === "livewire" ? imageUrl(doc.selectFirst("img[alt$=' cover']")) : styleImage(doc, "div[class*=photoURL], div[style*=photoURL]");
    if (!cover) {
      const og = doc.selectFirst("meta[property=og:image]");
      cover = og ? og.attr("content") : "";
    }
    const type = textOf(doc, c.typeSelector);
    const genres = doc.select(c.genreSelector).map((a) => a.text().replace(/^[,\s]+|[,\s]+$/g, ""));
    const alt = doc.select(c.altNameSelector).map((e) => e.text()).filter((t) => t && t !== "No alternative titles.");
    let description = textOf(doc, c.descriptionSelector);
    if (alt.length) description = (description + "\n\nAlternative names:\n" + alt.map((a) => "- " + a).join("\n")).trim();
    return {
      title: titleEl.text(),
      cover,
      author: textOf(doc, c.authorSelector),
      artist: textOf(doc, c.artistSelector),
      description,
      genres: unique([type ? type.charAt(0).toUpperCase() + type.slice(1) : ""].concat(genres)),
      status: STATUS[textOf(doc, c.statusSelector).toLowerCase()] || "unknown",
    };
  }

  function v2Details(doc) {
    const titleEl = doc.selectFirst("h1");
    if (!titleEl) throw new Error("Series title not found");
    const desc = doc.selectFirst("#series-desc");
    const og = doc.selectFirst("meta[property=og:image]");
    let author = "";
    let artist = "";
    const by = doc.selectFirst("p.l2-by");
    if (by) {
      const parts = by.text().replace(/^By\s+/, "").split(",");
      author = parts[0].trim();
      artist = parts.slice(1).join(",").trim();
    }
    const statusEl = doc.selectFirst("div.text-xs:containsOwn(Status) + div span.text-sm");
    let status = STATUS[statusEl ? statusEl.text().trim().toLowerCase() : ""] || "unknown";
    const kicker = doc.selectFirst("p.l2-kicker") || doc.selectFirst("div.l2-meta span");
    if (status === "unknown" && kicker) status = parseStatus(kicker.text());
    return {
      title: titleEl.text(),
      cover: og ? og.attr("content") : "",
      author,
      artist,
      description: desc ? desc.text() : "",
      genres: unique(doc.select('a[href*="?browse&tag"]').map((a) => a.text())),
      status,
    };
  }

  function v1Chapters(doc) {
    return doc
      .select("#chapters > a, #chapters > div")
      .filter((el) => !el.select(".text-sm span").some((s) => /Upcoming/.test(s.text())))
      .filter((el) => el.select(c.paidChapterSelector).length === 0)
      .map((el) => {
        const a = el.tagName() === "a" ? el : el.selectFirst("a[href]");
        if (!a) return null;
        const nameEl = el.selectFirst(".text-sm");
        const name = nameEl ? nameEl.text() : a.text();
        const dateEl = el.selectFirst(".text-xs");
        return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: dateEl ? keyoDate(dateEl.text()) : null, scanlator: null };
      })
      .filter(Boolean);
  }

  async function v2Chapters(url) {
    const slug = pathOf(url).split("/").filter(Boolean)[0];
    const data = await getJson(base + "/?" + query([["_chapters_html", "1"], ["series_slug", slug]]));
    const doc = html.parse(data.rows_html || "", base + "/");
    return doc
      .select("a.chapter-row[href]")
      .filter((el) => el.attr("data-ch-locked") !== "1")
      .map((el) => {
        const name = el.attr("data-ch-label") || el.text();
        const dateEl = el.selectFirst(".ch-date-row span:last-child");
        return { url: pathOf(el.absUrl("href")), name, number: chapterNumber(name), date: dateEl ? keyoDate(dateEl.text()) : null, scanlator: null };
      });
  }

  function v1Pages(doc) {
    const imgHeaders = { Referer: base + "/" };
    if (c.layout === "livewire") {
      const holder = doc.selectFirst("[x-data^=immersiveReader]");
      const xData = holder ? holder.attr("x-data") : "";
      const start = xData.indexOf("JSON.parse('");
      if (start === -1) throw new Error("This chapter must be purchased on the site");
      const raw = xData.slice(start + 12, xData.indexOf("')", start));
      const decoded = JSON.parse('"' + raw.replace(/"/g, '\\"') + '"');
      return JSON.parse(decoded).map((p) => ({ url: p.path, headers: imgHeaders }));
    }
    const script = doc.select("script").map((s) => s.data()).filter((d) => /realUrl\s*=\s*`/.test(d))[0];
    let cdn = null;
    if (script) {
      const m = script.match(/realUrl\s*=\s*`[^`]+\/\/([^/]+)/);
      if (m) cdn = "https://" + m[1].replace(/\$\{[^}]*\}/g, "") + "/uploads";
    }
    const uids = doc.select("#pages > img").map((img) => img.attr("uid")).filter(Boolean);
    if (uids.length) {
      if (!cdn) throw new Error("Page image host not found");
      return uids.map((uid) => ({ url: cdn + "/" + uid, headers: imgHeaders }));
    }
    return doc
      .select("#pages > img")
      .map((img) => imageUrl(img))
      .filter((u) => /^(https?:)?\/\/cdn\d*\.keyoapp\.com/.test(u))
      .map((u) => ({ url: u, headers: imgHeaders }));
  }

  return {
    async popular(page) {
      if (c.layout === "v2") return v2List(page, "", { sort: "popular" });
      if (c.layout === "livewire") return livewireList(page, [["sort", "popular"]]);
      if (c.popularFromSearch) return v1Search("", {});
      return { manga: cards(await getDocument(base + "/"), popularSelector), hasNextPage: false };
    },
    async latest(page) {
      if (c.layout === "v2") return v2List(page, "", { sort: "latest" });
      if (c.layout === "livewire") {
        const doc = await getDocument(base + "/latest" + (page > 1 ? "?page=" + page : ""));
        return { manga: cards(doc, c.latestSelector), hasNextPage: Boolean(doc.selectFirst("a[href*='?page=" + (page + 1) + "']")) };
      }
      return { manga: cards(await getDocument(base + "/latest/"), c.latestSelector), hasNextPage: false };
    },
    async search(q, page, f) {
      const opts = f || {};
      if (c.layout === "v2") return v2List(page, q, opts);
      if (c.layout === "livewire") return livewireList(page, q && q.trim() ? [["title", q.trim()]] : []);
      if (page > 1) return { manga: [], hasNextPage: false };
      return v1Search(q, opts);
    },
    filters,

    async details(url) {
      const doc = await getDocument(base + url);
      return c.layout === "v2" ? v2Details(doc) : v1Details(doc);
    },

    async chapters(url) {
      if (c.layout === "v2") return v2Chapters(url);
      return v1Chapters(await getDocument(base + url));
    },

    async pages(url) {
      const doc = await getDocument(base + url);
      if (c.layout === "v2") {
        return doc.select("#strip-reader img.reader-page").map((img) => ({ url: imageUrl(img), headers: { Referer: base + "/" } }));
      }
      return v1Pages(doc);
    },
  };
}

source = Keyoapp({
  baseUrl: META.baseUrl,
  popularSelector: "div:contains(Trending) + div .group.overflow-hidden",
});

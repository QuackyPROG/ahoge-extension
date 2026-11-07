var source = null;
const META = {"id":"en.paritehaber","name":"Paritehaber","lang":"en","version":"1.0.0","nsfw":true,"baseUrl":"https://www.paritehaber.com","template":"madara","upstream":"src/en/paritehaber"};
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

// Madara (WordPress "WP Manga" theme). Port of keiyoushi lib-multisrc/madara (Apache-2.0).
function Madara(config) {
  const c = Object.assign(
    {
      pageSize: 25,
      filterNonMangaItems: true,
      chapterMode: "mangaAjax", // "mangaPage" | "adminAjax" | "mangaAjax"
      archiveSelector: "div.page-item-detail, .manga__item, .c-tabs-item__content",
      archiveUrlSelector: ".post-title a",
      titleSelector: "div.post-title h3, div.post-title h1, #manga-title > h1",
      authorSelector: "div.author-content > a, div.manga-authors > a",
      artistSelector: "div.artist-content > a",
      statusSelector: "div.summary-content, div.summary-heading:contains(Status) + div",
      descriptionSelector:
        "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt",
      thumbnailSelector: "div.summary_image img",
      genreSelector: "div.genres-content a, div.tags-content a",
      chapterSelector: "li.wp-manga-chapter",
      chapterDateSelector: "span.chapter-release-date",
      pageSelector: "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item))",
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const referer = { Referer: base + "/" };
  const xhr = { "X-Requested-With": "XMLHttpRequest", Referer: base + "/" };

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers: referer }));
    return html.parse(res.body, res.url);
  }

  async function postDocument(url, body) {
    const res = ensureOk(await http.post(url, { headers: xhr, body }));
    return html.parse(res.body, res.url);
  }

  function dedupeBy(items, keyOf) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseArchive(doc) {
    const items = doc
      .select(c.archiveSelector)
      .map((el) => {
        const link = el.selectFirst(c.archiveUrlSelector) || el.selectFirst("h3 a, h5 a") || el.selectFirst("a[href]");
        const href = link ? link.absUrl("href") : "";
        if (!href) return null;
        return { url: pathOf(href), title: link.text(), cover: imageUrl(el.selectFirst("img")) };
      })
      .filter(Boolean);
    return dedupeBy(items, (m) => m.url);
  }

  async function loadMore(page, vars) {
    const body = {
      action: "madara_load_more",
      page: String(page - 1),
      template: "madara-core/content/content-archive",
      "vars[paged]": "1",
      "vars[template]": "archive",
      "vars[posts_per_page]": String(c.pageSize),
      "vars[post_type]": "wp-manga",
      "vars[post_status]": "publish",
      "vars[manga_archives_item_layout]": "big_thumbnail",
    };
    if (c.filterNonMangaItems) {
      body["vars[meta_query][0][key]"] = "_wp_manga_chapter_type";
      body["vars[meta_query][0][value]"] = "manga";
    }
    Object.assign(body, vars);
    const doc = await postDocument(base + "/wp-admin/admin-ajax.php", body);
    const manga = parseArchive(doc);
    return { manga, hasNextPage: manga.length > 0 && !doc.selectFirst(".no-posts") };
  }

  const sortBy = (key) => ({ "vars[orderby]": "meta_value_num", "vars[meta_key]": key, "vars[order]": "DESC" });

  function parseChapters(doc) {
    return doc
      .select(c.chapterSelector)
      .map((el) => {
        const link = el.selectFirst("a");
        const href = link ? link.absUrl("href") : "";
        if (!href) return null;
        const imgAlt = el.selectFirst("img:not(.thumb)");
        const titled = el.selectFirst("span a");
        const dated = el.selectFirst(c.chapterDateSelector);
        const candidates = [imgAlt && imgAlt.attr("alt"), titled && titled.attr("title"), dated && dated.text()];
        let date = null;
        for (const candidate of candidates) {
          if (!candidate) continue;
          const parsed = parseDate(candidate);
          if (parsed !== null) {
            date = parsed;
            break;
          }
        }
        const name = link.ownText() || link.text();
        return { url: pathOf(href), name, number: chapterNumber(name), date, scanlator: null };
      })
      .filter(Boolean);
  }

  // Filters mirror the theme's advanced search form; genres and statuses are read from the site's own form.
  const ORDER = [
    { value: "", label: "Relevance" },
    { value: "latest", label: "Latest" },
    { value: "alphabet", label: "A-Z" },
    { value: "rating", label: "Rating" },
    { value: "trending", label: "Trending" },
    { value: "views", label: "Most views" },
    { value: "new-manga", label: "New" },
  ];
  const STATUSES = [
    { value: "on-going", label: "Ongoing" },
    { value: "end", label: "Completed" },
    { value: "canceled", label: "Cancelled" },
    { value: "on-hold", label: "On hold" },
  ];
  let filterCache = null;

  function formOptions(doc, name) {
    return doc
      .select("input")
      .filter((input) => input.attr("name") === name && input.attr("value"))
      .map((input) => {
        const id = input.attr("id");
        const label = id ? doc.selectFirst('label[for="' + id + '"]') : null;
        return { value: input.attr("value"), label: (label && label.text()) || input.attr("value") };
      });
  }

  async function filters() {
    if (filterCache) return filterCache;
    let genres = [];
    let statuses = STATUSES;
    let loaded = false;
    try {
      const doc = await getDocument(base + "/?s=&post_type=wp-manga");
      genres = dedupeBy(formOptions(doc, "genre[]"), (o) => o.value);
      const found = formOptions(doc, "status[]");
      if (found.length) statuses = found;
      loaded = true;
    } catch (e) {
      // Browse still works with the fixed filters; the genre list is fetched again next time.
    }
    const list = [
      { type: "select", key: "orderby", name: "Order by", options: ORDER },
      { type: "group", key: "status", name: "Status", filters: statuses.map((o) => ({ type: "checkbox", key: o.value, name: o.label })) },
      { type: "text", key: "author", name: "Author" },
      { type: "text", key: "artist", name: "Artist" },
      { type: "text", key: "year", name: "Year of release" },
      {
        type: "select",
        key: "adult",
        name: "Adult content",
        options: [{ value: "", label: "All" }, { value: "0", label: "None" }, { value: "1", label: "Only" }],
      },
    ];
    if (genres.length) {
      list.push(
        { type: "group", key: "genres", name: "Genres", filters: genres.map((o) => ({ type: "checkbox", key: o.value, name: o.label })) },
        {
          type: "select",
          key: "genreMode",
          name: "Genres condition",
          options: [{ value: "", label: "Any selected genre (OR)" }, { value: "1", label: "All selected genres (AND)" }],
        },
      );
    }
    if (loaded) filterCache = list;
    return list;
  }

  const checked = (group) => Object.keys(group || {}).filter((k) => group[k] === true);

  // The advanced search page, used once any filter differs from its default.
  function searchPairs(q, f) {
    const pairs = [["s", q], ["post_type", "wp-manga"]];
    for (const g of checked(f.genres)) pairs.push(["genre[]", g]);
    if (f.genreMode) pairs.push(["op", f.genreMode]);
    if (f.author) pairs.push(["author", f.author]);
    if (f.artist) pairs.push(["artist", f.artist]);
    if (f.year) pairs.push(["release", f.year]);
    if (f.adult) pairs.push(["adult", f.adult]);
    for (const s of checked(f.status)) pairs.push(["status[]", s]);
    if (f.orderby) pairs.push(["m_orderby", f.orderby]);
    return pairs;
  }

  function hasFilters(f) {
    return Boolean(
      f && (checked(f.genres).length || checked(f.status).length || f.author || f.artist || f.year || f.adult || f.orderby),
    );
  }

  const hasNextLink = (doc) => Boolean(doc.selectFirst("a.nextpostslink, .nav-previous a, a.next.page-numbers"));

  async function search(q, page, f) {
    if (!c.archivePath && !hasFilters(f)) return loadMore(page, { "vars[s]": q });
    const path = page > 1 ? "/page/" + page + "/" : "/";
    const doc = await getDocument(base + path + "?" + query(searchPairs(q, f || {})));
    const manga = parseArchive(doc);
    return { manga, hasNextPage: manga.length > 0 && hasNextLink(doc) };
  }

  // Paged archive (/<archivePath>/page/N/?m_orderby=…), for sites whose admin-ajax is challenged.
  async function archivePage(page, order) {
    const path = "/" + c.archivePath + "/" + (page > 1 ? "page/" + page + "/" : "");
    const doc = await getDocument(base + path + "?m_orderby=" + order);
    const manga = parseArchive(doc);
    return { manga, hasNextPage: manga.length > 0 && hasNextLink(doc) };
  }

  return {
    popular: (page) => (c.archivePath ? archivePage(page, "views") : loadMore(page, sortBy("_wp_manga_views"))),
    latest: (page) => (c.archivePath ? archivePage(page, "latest") : loadMore(page, sortBy("_latest_update"))),
    search,
    filters,

    async details(url) {
      const doc = await getDocument(base + url);
      const titleEl = doc.selectFirst(c.titleSelector);
      if (!titleEl) throw new Error("Manga title not found on " + url);
      const names = (sel) =>
        doc.select(sel).map((e) => e.text()).filter((t) => t && !/updating|atualizando/i.test(t)).join(", ");
      const descEl = doc.selectFirst(c.descriptionSelector);
      let description = "";
      if (descEl) {
        const paragraphs = descEl.select("p");
        description = paragraphs.length ? paragraphs.map((p) => p.text()).join("\n\n") : descEl.text();
      }
      const statusEls = doc.select(c.statusSelector);
      return {
        title: titleEl.ownText() || titleEl.text(),
        cover: imageUrl(doc.selectFirst(c.thumbnailSelector)),
        author: names(c.authorSelector),
        artist: names(c.artistSelector),
        description,
        genres: unique(doc.select(c.genreSelector).map((e) => e.text())),
        status: parseStatus(statusEls.length ? statusEls[statusEls.length - 1].text() : ""),
      };
    },

    async chapters(url) {
      if (c.chapterMode === "mangaPage") return parseChapters(await getDocument(base + url));
      if (c.chapterMode === "adminAjax") {
        const page = await getDocument(base + url);
        const holder = page.selectFirst("#manga-chapters-holder[data-id]");
        const id = holder ? holder.attr("data-id") : (page.selectFirst("[data-post-id]") || { attr: () => "" }).attr("data-post-id");
        if (!id) throw new Error("Madara post id not found on " + url);
        return parseChapters(await postDocument(base + "/wp-admin/admin-ajax.php", { action: "manga_get_chapters", manga: id }));
      }
      return parseChapters(await postDocument(base + url.replace(/\/$/, "") + "/ajax/chapters/", {}));
    },

    async pages(url) {
      let doc = await getDocument(base + url);
      if (doc.selectFirst("#single-pager")) {
        let listUrl;
        if (/[?&]style=/.test(url)) listUrl = url.replace(/([?&]style=)[^&#]*/, "$1list");
        else listUrl = url + (url.includes("?") ? "&" : "?") + "style=list";
        if (listUrl !== url) doc = await getDocument(base + listUrl);
      }
      if (doc.selectFirst("#chapter-protector-data")) throw new Error("This chapter is protected (chapter-protector) and is not supported yet");
      const urls = doc
        .select(c.pageSelector)
        .map((el) => imageUrl(el.selectFirst("img")))
        .filter(Boolean);
      // Some sites still print http:// image links; iOS blocks plain http, and the https copy is the same file.
      const secure = /^https:/i.test(base) ? urls.map((u) => u.replace(/^http:\/\//i, "https://")) : urls;
      return dedupeBy(secure, (u) => u).map((u) => ({ url: u, headers: { Referer: base + "/" } }));
    },
  };
}

source = Madara({
  baseUrl: META.baseUrl,
  filterNonMangaItems: false,
});

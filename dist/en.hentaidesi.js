var source = null;
const META = {"id":"en.hentaidesi","name":"Hentai Desi","lang":"en","version":"1.0.0","nsfw":true,"baseUrl":"https://hentaidesi.com","template":"mangathemesia","upstream":"src/en/hentaidesi"};
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

// MangaThemesia (WordPress theme, formerly WPMangaStream/WPMangaReader). Port of keiyoushi
// lib-multisrc/mangathemesia (Apache-2.0).
function MangaThemesia(config) {
  const c = Object.assign(
    {
      mangaUrlDirectory: "/manga",
      listSelector: ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx",
      nextPageSelector: "div.pagination .next, div.hpage .r",
      detailsSelector: "div.bigcontent, div.animefull, div.main-info, div.postbody",
      titleSelector: ".entry-title, .ts-breadcrumb li:last-child span",
      descriptionSelector: ".desc, .entry-content[itemprop=description]",
      thumbnailSelector: ".infomanga > div[itemprop=image] img, .thumb img",
      genreSelector: "div.gnr a, .mgen a, .seriestugenre a, span:contains(genre)",
      chapterSelector: "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)",
      pageSelector: "div#readerarea img",
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const dir = c.mangaUrlDirectory.replace(/^\/|\/$/g, "");
  const headers = { Referer: base + "/" };
  const labelled = (labels, tpl) => labels.map((l) => tpl.split("%s").join(l)).join(", ");
  const INFO = ".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span, span:contains(%s)";
  const artistSelector = c.artistSelector || labelled(["artist", "Artiste", "Artista"], INFO);
  const authorSelector = c.authorSelector || labelled(["Author", "Auteur", "autor", "Mangaka"], INFO);
  const statusSelector =
    c.statusSelector ||
    labelled(["status", "Statut", "Estado"], ".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span span:contains(%s)");
  const typeSelector =
    labelled(["type"], ".infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .tsinfo .imptdt:contains(%s) a, .fmed b:contains(%s)+span, span:contains(%s) a") +
    ", a[href*=type\\=]";

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return html.parse(res.body, res.url);
  }

  const clean = (s) => {
    const t = String(s || "").trim();
    return !t || t === "-" || /^(n\/a|unknown)$/i.test(t) ? "" : t;
  };

  const ORDERS = [
    { value: "", label: "Default" },
    { value: "popular", label: "Popular" },
    { value: "update", label: "Latest update" },
    { value: "latest", label: "Latest added" },
    { value: "title", label: "A-Z" },
    { value: "titlereverse", label: "Z-A" },
  ];
  const STATUSES = [
    { value: "", label: "All" },
    { value: "ongoing", label: "Ongoing" },
    { value: "completed", label: "Completed" },
    { value: "hiatus", label: "Hiatus" },
    { value: "dropped", label: "Dropped" },
  ];
  const TYPES = [
    { value: "", label: "All" },
    { value: "Manga", label: "Manga" },
    { value: "Manhwa", label: "Manhwa" },
    { value: "Manhua", label: "Manhua" },
    { value: "Comic", label: "Comic" },
  ];
  let genres = null;

  async function list(page, q, f) {
    const pairs = [];
    if (q) pairs.push(["title", q]);
    pairs.push(["page", page]);
    if (f.status) pairs.push(["status", f.status]);
    if (f.type) pairs.push(["type", f.type]);
    if (f.order) pairs.push(["order", f.order]);
    for (const [value, state] of Object.entries(f.genres || {})) {
      if (state === 1) pairs.push(["genre[]", value]);
      if (state === 2) pairs.push(["genre[]", "-" + value]);
    }
    if (f.author) pairs.push(["author", f.author]);
    if (f.year) pairs.push(["yearx", f.year]);
    const doc = await getDocument(base + "/" + dir + "/?" + query(pairs));
    const manga = doc
      .select(c.listSelector)
      .map((el) => {
        const link = el.selectFirst("a");
        if (!link || !link.absUrl("href")) return null;
        const title = link.attr("title") || (el.selectFirst(".tt, .bigor .tt") || link).text();
        return { url: pathOf(link.absUrl("href")), title: title.trim(), cover: imageUrl(el.selectFirst("img")) };
      })
      .filter(Boolean);
    return { manga, hasNextPage: Boolean(doc.selectFirst(c.nextPageSelector)) };
  }

  return {
    popular: (page) => list(page, "", { order: "popular" }),
    latest: (page) => list(page, "", { order: "update" }),
    search: (q, page, f) => list(page, q, f || {}),

    async filters() {
      if (!genres) {
        try {
          const doc = await getDocument(base + "/" + dir + "/");
          genres = doc
            .select("ul.genrez li")
            .map((li) => {
              const label = li.selectFirst("label");
              const input = li.selectFirst("input[type=checkbox]");
              return label && input && input.attr("value") ? { type: "tristate", key: input.attr("value"), name: label.text() } : null;
            })
            .filter(Boolean);
        } catch (e) {
          // Browse still works without genres; they are fetched again next time.
        }
      }
      const out = [
        { type: "select", key: "order", name: "Order by", options: ORDERS },
        { type: "select", key: "status", name: "Status", options: STATUSES },
        { type: "select", key: "type", name: "Type", options: TYPES },
        { type: "text", key: "author", name: "Author" },
        { type: "text", key: "year", name: "Year" },
      ];
      if (genres && genres.length) out.push({ type: "group", key: "genres", name: "Genres", filters: genres });
      return out;
    },

    async details(url) {
      const doc = await getDocument(base + url);
      const d = doc.selectFirst(c.detailsSelector) || doc;
      const own = (sel) => {
        const el = d.selectFirst(sel);
        return el ? clean(el.ownText()) : "";
      };
      const titleEl = d.selectFirst(c.titleSelector);
      const descEl = d.selectFirst(c.descriptionSelector);
      const statusEl = d.selectFirst(statusSelector);
      const genreList = d.select(c.genreSelector).map((e) => e.text().trim());
      const type = own(typeSelector);
      if (type) genreList.push(type);
      return {
        title: titleEl ? titleEl.text() : "",
        cover: imageUrl(d.selectFirst(c.thumbnailSelector)),
        author: own(authorSelector),
        artist: own(artistSelector),
        description: descEl ? descEl.text() : "",
        genres: unique(genreList.map((g) => g.charAt(0).toUpperCase() + g.slice(1).toLowerCase())),
        status: parseStatus(statusEl ? statusEl.text() : ""),
      };
    },

    async chapters(url) {
      const doc = await getDocument(base + url);
      return doc
        .select(c.chapterSelector)
        .map((el) => {
          const link = el.selectFirst("a");
          if (!link || !link.absUrl("href")) return null;
          const name = el.select(".lch a, .chapternum").map((e) => e.text()).join(" ").trim() || link.text();
          const dateEl = el.selectFirst(".chapterdate");
          return { url: pathOf(link.absUrl("href")), name, number: chapterNumber(name), date: dateEl ? parseDate(dateEl.text()) : null, scanlator: null };
        })
        .filter(Boolean);
    },

    async pages(url) {
      const doc = await getDocument(base + url);
      let urls = doc.select(c.pageSelector).map(imageUrl).filter(Boolean);
      if (!urls.length) {
        // Some sites build the reader in script: ts_reader.run({... "images": [...] }), sometimes base64 in a data: src.
        let text = doc.data();
        const encoded = doc.selectFirst("script[src^=data:text/javascript;base64,dHNfcmVhZGVyLnJ1bih7]");
        if (encoded) {
          try {
            text = atob(encoded.attr("src").split("base64,")[1]) + text;
          } catch (e) {
            // Fall back to the inline scripts.
          }
        }
        const match = text.match(/["']?(?:images|imageUrls)["']?\s*[:=]\s*(\[.*?\])/);
        if (match) {
          try {
            urls = JSON.parse(match[1]).map((u) => (String(u).charAt(0) === "/" ? base + u : String(u)));
          } catch (e) {
            urls = [];
          }
        }
      }
      return unique(urls).map((u) => ({ url: u, headers: { Referer: base + "/" } }));
    },
  };
}

source = MangaThemesia({
  baseUrl: META.baseUrl,
});

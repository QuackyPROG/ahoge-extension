// Manhwa18 (manhwa18.com). Port of keiyoushi src/en/manhwa18 (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

// Covers are CSS backgrounds: data-bg, or style="background-image: url('…')".
function bgUrl(el) {
  if (!el) return "";
  const bg = el.attr("data-bg");
  if (bg) return el.absUrl("data-bg");
  const m = el.attr("style").match(/url\(['"]?([^'")]+)['"]?\)/);
  return m ? m[1] : "";
}

async function listing(pairs) {
  const doc = await getDocument(BASE + "/tim-kiem?" + query(pairs));
  const manga = doc
    .select(".thumb-item-flow")
    .map((el) => {
      const link = el.selectFirst(".series-title a") || el.selectFirst("a[href]");
      if (!link || !link.attr("href")) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: bgUrl(el.selectFirst(".lazy-bg, .img-in-ratio")) };
    })
    .filter((m) => m && !/see-more/.test(m.url));
  return { manga, hasNextPage: Boolean(doc.selectFirst(".pagination_wrap a.next, .pagination a[rel=next]")) };
}

const SORTS = [
  { value: "update", label: "Latest update" },
  { value: "new", label: "New manhwa" },
  { value: "top", label: "Most view" },
  { value: "like", label: "Most like" },
  { value: "az", label: "A - Z" },
  { value: "za", label: "Z - A" },
];
const STATUSES = [
  { value: "0", label: "All" },
  { value: "1", label: "Ongoing" },
  { value: "2", label: "On hold" },
  { value: "3", label: "Completed" },
];
let genreFilters = null;

async function filters() {
  if (!genreFilters) {
    try {
      const doc = await getDocument(BASE + "/");
      const seen = new Set();
      genreFilters = doc
        .select("a.genres-item")
        .map((a) => {
          const m = a.attr("href").match(/genre\/([^/?#]+)/);
          return m ? { slug: m[1], name: a.text() } : null;
        })
        .filter((g) => g && g.name && !seen.has(g.slug) && seen.add(g.slug));
    } catch (e) {
      // Genres are fetched again next time.
    }
  }
  const list = [
    { type: "select", key: "sort", name: "Order", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
  if (genreFilters && genreFilters.length) {
    list.push({ type: "group", key: "genres", name: "Genres", filters: genreFilters.map((g) => ({ type: "checkbox", key: g.slug, name: g.name })) });
  }
  return list;
}

function parseDmy(text) {
  const m = String(text || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? utcDate(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : parseDate(text);
}

source = {
  popular: (page) => listing([["sort", "top"], ["page", page]]),
  latest: (page) => listing([["sort", "update"], ["page", page]]),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    const genres = Object.keys(opts.genres || {}).filter((k) => opts.genres[k] === true);
    if (!q && genres.length === 1) {
      // The search form takes numeric genre ids; the genre pages take slugs.
      const doc = await getDocument(BASE + "/genre/" + genres[0] + "?page=" + page);
      const manga = doc
        .select(".thumb-item-flow")
        .map((el) => {
          const link = el.selectFirst(".series-title a");
          return link ? { url: pathOf(link.absUrl("href")), title: link.text(), cover: bgUrl(el.selectFirst(".lazy-bg, .img-in-ratio")) } : null;
        })
        .filter(Boolean);
      return { manga, hasNextPage: Boolean(doc.selectFirst(".pagination_wrap a.next, .pagination a[rel=next]")) };
    }
    const pairs = [];
    if (q) pairs.push(["q", q]);
    pairs.push(["sort", opts.sort || "update"]);
    if (opts.status && opts.status !== "0") pairs.push(["status", opts.status]);
    pairs.push(["page", page]);
    return listing(pairs);
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst(".series-name a, .au-bento h1, .series-name");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const info = {};
    for (const item of doc.select(".series-information .info-item")) {
      const name = item.selectFirst(".info-name");
      const value = item.selectFirst(".info-value");
      if (name && value) info[name.text().toLowerCase()] = { el: item, text: value.text() };
    }
    const field = (word) => {
      const key = Object.keys(info).find((k) => k.indexOf(word) !== -1);
      return key ? info[key] : null;
    };
    const genre = field("genre");
    const author = field("author");
    const status = field("status");
    const summary = doc.selectFirst(".summary-content");
    return {
      title: titleEl.text(),
      cover: bgUrl(doc.selectFirst(".series-cover .img-in-ratio")),
      author: author ? author.text : "",
      artist: "",
      description: summary ? summary.text() : "",
      genres: genre ? unique(genre.el.select(".info-value a").map((a) => a.text())) : [],
      status: parseStatus(status ? status.text : ""),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("div.au-chgrid a.au-chtile, ul.list-chapters > a")
      .map((a) => {
        const href = a.absUrl("href");
        if (!href) return null;
        const name = a.attr("data-name") || a.attr("title") || a.text();
        const dateEl = a.selectFirst(".au-chtile-date, .chapter-time");
        const dateText = dateEl ? dateEl.text().replace(/^.*[·-]\s*/, "") : "";
        return { url: pathOf(href), name, number: chapterNumber(name), date: parseDmy(dateText), scanlator: null };
      })
      .filter(Boolean);
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("#chapter-content img")
      .map((img) => imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

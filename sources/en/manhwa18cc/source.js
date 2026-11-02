// Manhwa18.cc (a different site from manhwa18.com). Server-rendered lists, Madara-style detail page.
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  const manga = doc
    .select("div.manga-item")
    .map((el) => {
      const link = el.selectFirst("h3 a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst(".thumb img")) };
    })
    .filter(Boolean);
  return { manga, hasNextPage: Boolean(doc.selectFirst("a.next, a[rel=next], li.next a")) };
}

const pageSuffix = (page) => (page > 1 ? "/" + page : "");

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "latest", label: "Latest update" },
  { value: "views", label: "Most views" },
  { value: "new", label: "Newest" },
  { value: "alphabet", label: "A-Z" },
  { value: "rating", label: "Rating" },
];

function filters() {
  return [
    { type: "header", name: "Sort is ignored when searching by text" },
    { type: "select", key: "sort", name: "Sort", options: SORTS },
  ];
}

function infoRow(doc, label) {
  const row = doc
    .select("div.post-content_item")
    .filter((r) => {
      const h = r.selectFirst(".summary-heading");
      return h && h.text().toLowerCase().indexOf(label) === 0;
    })[0];
  return row ? row.selectFirst(".summary-content") : null;
}

source = {
  popular: async (page) => listing(await getDocument(BASE + "/webtoons" + pageSuffix(page) + "?orderby=trending")),
  latest: async (page) => listing(await getDocument(BASE + "/webtoons" + pageSuffix(page) + "?orderby=latest")),
  filters,

  async search(q, page, f) {
    if (q) return listing(await getDocument(BASE + "/search?" + query([["q", q], ["page", page]])));
    const sort = (f && f.sort) || "trending";
    return listing(await getDocument(BASE + "/webtoons" + pageSuffix(page) + "?orderby=" + sort));
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("div.post-title h1");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const text = (label) => {
      const el = infoRow(doc, label);
      return el ? el.text() : "";
    };
    const links = (label) => {
      const el = infoRow(doc, label);
      return el ? el.select("a").map((a) => a.text()) : [];
    };
    const descEl = doc.selectFirst("div.panel-story-description .dsct");
    let description = descEl ? descEl.text() : "";
    const alt = text("alternative");
    if (alt) description += (description ? "\n\n" : "") + "Alternative names: " + alt;
    return {
      title: (titleEl.ownText() || titleEl.text()).replace(/^18\+\s*/, ""),
      cover: imageUrl(doc.selectFirst("div.summary_image img")),
      author: links("author").join(", "),
      artist: links("artist").join(", "),
      description,
      genres: unique(links("genre")),
      status: parseStatus(text("status")),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("li.a-h").map((li) => {
      const a = li.selectFirst("a.chapter-name");
      const time = li.selectFirst(".chapter-time");
      const name = a.text();
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: time ? parseDate(time.text()) : null, scanlator: null };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("div.read-content img")
      .map((img) => imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

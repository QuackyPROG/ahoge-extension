// Mangapill. Port of keiyoushi src/en/mangapill (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function cards(doc, selector) {
  const seen = new Set();
  return doc
    .select(selector)
    .map((el) => {
      const link = el.selectFirst("a[href^=/manga/]");
      const titleEl = el.selectFirst("div.line-clamp-2");
      if (!link || !titleEl) return null;
      return { url: pathOf(link.absUrl("href")), title: titleEl.text(), cover: imageUrl(el.selectFirst("img")) };
    })
    .filter((m) => m && !seen.has(m.url) && seen.add(m.url));
}

const TYPES = [
  { value: "", label: "All" },
  { value: "manga", label: "Manga" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "one-shot", label: "One-shot" },
  { value: "doujinshi", label: "Doujinshi" },
  { value: "oel", label: "OEL" },
];
const STATUSES = [
  { value: "", label: "All" },
  { value: "publishing", label: "Publishing" },
  { value: "finished", label: "Finished" },
  { value: "on hiatus", label: "On hiatus" },
  { value: "discontinued", label: "Discontinued" },
  { value: "not yet published", label: "Not yet published" },
];
let genreFilters = null;

async function filters() {
  if (!genreFilters) {
    try {
      const doc = await getDocument(BASE + "/search");
      genreFilters = doc
        .select("input[name=genre]")
        .map((i) => i.attr("value"))
        .filter(Boolean)
        .map((g) => ({ type: "checkbox", key: g, name: g }));
    } catch (e) {
      // Genres are fetched again next time.
    }
  }
  const list = [
    { type: "select", key: "type", name: "Type", options: TYPES },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
  if (genreFilters && genreFilters.length) list.push({ type: "group", key: "genres", name: "Genres", filters: genreFilters });
  return list;
}

const STATUS_TEXT = { publishing: "ongoing", finished: "completed", "on hiatus": "hiatus", discontinued: "cancelled" };

source = {
  async popular() {
    const doc = await getDocument(BASE + "/");
    return { manga: cards(doc, "div:has(> h4:contains(Trending)) > .grid > div:not([class]), div:has(h4:contains(Trending)) > .grid > div:not([class])"), hasNextPage: false };
  },

  async latest() {
    const doc = await getDocument(BASE + "/chapters");
    return { manga: cards(doc, ".grid > div:not([class])"), hasNextPage: false };
  },

  filters,

  async search(q, page, f) {
    const opts = f || {};
    const pairs = [["page", page], ["q", q || ""]];
    for (const g of Object.keys(opts.genres || {})) if (opts.genres[g] === true) pairs.push(["genre", g]);
    if (opts.type) pairs.push(["type", opts.type]);
    if (opts.status) pairs.push(["status", opts.status]);
    const doc = await getDocument(BASE + "/search?" + query(pairs));
    return { manga: cards(doc, ".grid > div:not([class])"), hasNextPage: Boolean(doc.selectFirst("a.btn.btn-sm")) };
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("h1");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    // Labelled info cells: <div><label>Status</label><div>publishing</div></div>.
    const field = (name) => {
      const label = doc.select("label").filter((l) => l.text().toLowerCase() === name)[0];
      return label ? doc.select("div:has(> label:containsOwn(" + name + ")) > div").map((d) => d.text()).join(" ") : "";
    };
    const descEl = doc.selectFirst("div.container > div:first-child > div:last-child > div:nth-child(2) > p, p.text-sm.text--secondary");
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("div.container > div:first-child > div:first-child > img, div.container img")),
      author: "",
      artist: "",
      description: descEl ? descEl.text() : "",
      genres: unique(doc.select("a[href*=genre]").map((a) => a.text())),
      status: STATUS_TEXT[field("status").toLowerCase()] || parseStatus(field("status")),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("#chapters > div > a").map((a) => {
      const name = a.text();
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: null, scanlator: null };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("picture img, chapter-page img")
      .map((img) => imageUrl(img))
      .filter((u, i, all) => u && all.indexOf(u) === i)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

// Mgeko (formerly MangaGeko). The browse page loads cards from /browse-comics/data/ as JSON-wrapped HTML.
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

const SORTS = [
  { value: "popular_all_time", label: "Popular (all time)" },
  { value: "popular_monthly", label: "Popular (month)" },
  { value: "popular_weekly", label: "Popular (week)" },
  { value: "popular_daily", label: "Popular (day)" },
  { value: "latest", label: "Latest update" },
  { value: "recently_added", label: "Recently added" },
  { value: "rating", label: "Rating" },
  { value: "az", label: "A - Z" },
  { value: "za", label: "Z - A" },
];
const STATUSES = [
  { value: "", label: "Any" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
];
const TYPES = [
  { value: "", label: "Any" },
  { value: "manga", label: "Manga" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "webtoon", label: "Webtoon" },
];

function filters() {
  return [
    { type: "select", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
  ];
}

async function browse(pairs, page) {
  const res = ensureOk(await http.get(BASE + "/browse-comics/data/?" + query(pairs.concat([["page", page]])), { headers: HEADERS }));
  const json = JSON.parse(res.body);
  const doc = html.parse("<div>" + (json.results_html || "") + "</div>", BASE + "/");
  const manga = doc
    .select("article.comic-card")
    .map((card) => {
      const link = card.selectFirst(".comic-card__title a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(card.selectFirst(".comic-card__cover img")) };
    })
    .filter(Boolean);
  return { manga, hasNextPage: Number(json.page) < Number(json.num_pages) };
}

// "Oct. 24, 2026, 11:42 p.m." -> the date part.
function chapterDate(text) {
  const m = String(text || "").match(/([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})/);
  return m ? parseDate(m[1] + " " + m[2] + ", " + m[3]) : null;
}

source = {
  popular: (page) => browse([["sort", "popular_all_time"]], page),
  latest: (page) => browse([["sort", "latest"]], page),
  filters,

  search(q, page, f) {
    const opts = f || {};
    const pairs = [];
    if (q) pairs.push(["q", q]);
    pairs.push(["sort", opts.sort || "popular_all_time"]);
    if (opts.status) pairs.push(["status", opts.status]);
    if (opts.type) pairs.push(["type", opts.type]);
    return browse(pairs, page);
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("h1.novel-title");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const authors = doc.select(".author [itemprop=author]").map((e) => e.text()).filter((t) => t && !/updating/i.test(t));
    const statusEl = doc.selectFirst("strong.ongoing, strong.completed, strong.hiatus");
    // The description starts with a boilerplate paragraph; the summary follows the first double <br>.
    const desc = doc.selectFirst("p.description");
    let description = "";
    if (desc) {
      const text = desc.text();
      const at = text.indexOf("The Summary is");
      description = (at === -1 ? text : text.slice(at + "The Summary is".length)).trim();
    }
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("figure.cover img")),
      author: authors.join(", "),
      artist: "",
      description,
      genres: unique(doc.select(".categories a.property-item, a.property-item[href*=genre_included]").map((a) => a.text())),
      status: parseStatus(statusEl ? statusEl.text() : ""),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url.replace(/\/?$/, "/") + "all-chapters/");
    return doc
      .select("li[data-orderno] > a[href*=/reader/]")
      .map((a) => {
        const titleEl = a.selectFirst(".chapter-title");
        const label = titleEl ? titleEl.text() : "";
        const timeEl = a.selectFirst("time");
        const number = chapterNumber("chapter " + label);
        return {
          url: pathOf(a.absUrl("href")),
          name: "Chapter " + label.replace(/-eng-li$/, ""),
          number,
          date: timeEl ? chapterDate(timeEl.attr("datetime")) : null,
          scanlator: null,
        };
      });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("img.mgr-page")
      .map((img) => imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

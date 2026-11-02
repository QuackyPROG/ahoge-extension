// Weeb Central (formerly MangaSee). Port of keiyoushi src/en/weebcentral (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };
const LIMIT = 32;

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function sourceImg(el) {
  const source = el.selectFirst("source");
  if (source && source.attr("srcset")) return source.absUrl("srcset").replace("small", "normal");
  return imageUrl(el.selectFirst("img"));
}

const option = (v) => ({ value: v, label: v });
const SORTS = ["Best Match", "Popularity", "Latest Updates", "Recently Added", "Subscribers", "Alphabet"].map(option);
const TRISTATE = ["Any", "True", "False"].map(option);
const STATUSES = ["Ongoing", "Complete", "Hiatus", "Canceled"];
const TYPES = ["Manga", "Manhwa", "Manhua", "OEL"];
const TAGS = [
  "Action", "Adult", "Adventure", "Comedy", "Doujinshi", "Drama", "Ecchi", "Fantasy", "Gender Bender", "Harem",
  "Hentai", "Historical", "Horror", "Isekai", "Josei", "Martial Arts", "Mature", "Mecha", "Mystery",
  "Psychological", "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo", "Shoujo Ai", "Shounen",
  "Shounen Ai", "Slice of Life", "Smut", "Sports", "Supernatural", "Tragedy", "Yaoi", "Yuri", "Other",
];

function filters() {
  return [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "official", name: "Official translation", options: TRISTATE },
    { type: "select", key: "anime", name: "Anime adaptation", options: TRISTATE },
    { type: "select", key: "adult", name: "Adult content", options: TRISTATE },
    { type: "text", key: "author", name: "Author (case-sensitive)" },
    { type: "group", key: "status", name: "Status", filters: STATUSES.map((s) => ({ type: "checkbox", key: s, name: s })) },
    { type: "group", key: "type", name: "Type", filters: TYPES.map((s) => ({ type: "checkbox", key: s, name: s })) },
    { type: "group", key: "tags", name: "Tags", filters: TAGS.map((s) => ({ type: "tristate", key: s, name: s })) },
  ];
}

async function searchData(text, page, f) {
  const opts = f || {};
  const sort = opts.sort || { value: "Best Match", ascending: false };
  const pairs = [
    ["text", String(text || "").replace(/[!#:(),-]/g, " ").trim()],
    ["sort", sort.value],
    ["order", sort.ascending ? "Ascending" : "Descending"],
    ["official", opts.official || "Any"],
    ["anime", opts.anime || "Any"],
    ["adult", opts.adult || "Any"],
  ];
  if (opts.author) pairs.push(["author", opts.author]);
  const groups = (g) => opts[g] || {};
  for (const s of Object.keys(groups("status"))) if (groups("status")[s] === true) pairs.push(["included_status", s]);
  for (const t of Object.keys(groups("type"))) if (groups("type")[t] === true) pairs.push(["included_type", t]);
  for (const t of Object.keys(groups("tags"))) {
    if (groups("tags")[t] === 1) pairs.push(["included_tag", t]);
    if (groups("tags")[t] === 2) pairs.push(["excluded_tag", t]);
  }
  pairs.push(["limit", LIMIT], ["offset", (page - 1) * LIMIT], ["display_mode", "Full Display"]);
  const doc = await getDocument(BASE + "/search/data?" + query(pairs));
  const manga = doc
    .select("article > section > a")
    .map((a) => {
      const titleEl = a.selectFirst("div:not([class]):last-child");
      return { url: pathOf(a.absUrl("href")), title: titleEl ? titleEl.text() : a.text(), cover: sourceImg(a) };
    })
    .filter((m) => m.url.indexOf("/series/") === 0);
  return { manga, hasNextPage: Boolean(doc.selectFirst("button")) };
}

const STATUS = { ongoing: "ongoing", complete: "completed", hiatus: "hiatus", canceled: "cancelled" };

source = {
  popular: (page) => searchData("", page, { sort: { value: "Popularity", ascending: false } }),
  latest: (page) => searchData("", page, { sort: { value: "Latest Updates", ascending: false } }),
  search: searchData,
  filters,

  async details(url) {
    const doc = await getDocument(BASE + url);
    const sections = doc.select("section[x-data] > section");
    if (sections.length < 2) throw new Error("Series page layout not recognised: " + url);
    const info = sections[0];
    const main = sections[1];
    const titleEl = main.selectFirst("h1");
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const statusEl = info.selectFirst("ul > li:has(strong:contains(Status)) > a");
    const descEl = main.selectFirst("li:has(strong:contains(Description)) > p");
    const alt = main.select("li:has(strong:contains(Associated Name)) li").map((e) => e.text());
    let description = descEl ? descEl.text().replace("NOTE: ", "\n\nNOTE: ") : "";
    if (alt.length) description += "\n\nAssociated names:\n" + alt.map((n) => "- " + n).join("\n");
    return {
      title: titleEl.text(),
      cover: sourceImg(info),
      author: info.select("ul > li:has(strong:contains(Author)) > span > a").map((a) => a.text()).join(", "),
      artist: "",
      description: description.trim(),
      genres: unique(info.select("ul > li:has(strong:contains(Tag)) a, ul > li:has(strong:contains(Type)) a").map((a) => a.text())),
      status: STATUS[statusEl ? statusEl.text().toLowerCase() : ""] || "unknown",
    };
  },

  async chapters(url) {
    const id = pathOf(url).split("/").filter(Boolean)[1];
    const doc = await getDocument(BASE + "/series/" + id + "/full-chapter-list");
    const links = doc.select("div[x-data] > a");
    const seasonal = links.some((a) => {
      const n = a.selectFirst("span.flex > span");
      return n && /(season|s)\s*\d+/i.test(n.text());
    });
    return links.map((a, i) => {
      const nameEl = a.selectFirst("span.flex > span");
      const name = nameEl ? nameEl.text() : a.text();
      const time = a.selectFirst("time[datetime]");
      const official = a.select("img").some((img) => /official/i.test(img.attr("src")));
      return {
        url: pathOf(a.absUrl("href")),
        name,
        number: seasonal ? links.length - i : chapterNumber(name),
        date: time ? parseDate(time.attr("datetime")) : null,
        scanlator: official ? "Official" : null,
      };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url.replace(/\/$/, "") + "/images?is_prev=False&reading_style=long_strip");
    return doc
      .select("section#chapter-images > img, section[x-data~=scroll] > img")
      .map((img) => img.absUrl("src"))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: HEADERS }));
  },
};

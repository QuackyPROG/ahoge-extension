// MangaNato (MangaBox family: Mangakakalot, NatoManga). Port of keiyoushi lib-multisrc/mangabox (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  const manga = doc
    .select("div.list-comic-item-wrap, div.list-truyen-item-wrap, .panel_story_list .story_item")
    .map((el) => {
      const link = el.selectFirst("h3 a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst("img")) };
    })
    .filter(Boolean);
  const next = doc.selectFirst("a.page_select + a:not(.page_last), a.page-select + a:not(.page-last), div.group-page a:not([href]) + a:not(:contains(Last))");
  return { manga, hasNextPage: Boolean(next) };
}

// Search takes the title as a path segment with punctuation folded to "_".
function searchSlug(q) {
  return String(q)
    .toLowerCase()
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
    .replace(/[èéẹẻẽêềếệểễ]/g, "e")
    .replace(/[ìíịỉĩ]/g, "i")
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
    .replace(/[ùúụủũưừứựửữ]/g, "u")
    .replace(/[ỳýỵỷỹ]/g, "y")
    .replace(/đ/g, "d")
    .replace(/[!@%^*()+=<>?/,.:;'" "&#[\]~\-$_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const SORTS = [
  { value: "topview", label: "Most views" },
  { value: "latest", label: "Latest update" },
  { value: "newest", label: "Newest" },
];
const STATUSES = [
  { value: "all", label: "All" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
];
const FILTER_ID = {
  "newest/all": "1", "newest/completed": "2", "newest/ongoing": "3",
  "latest/all": "4", "latest/completed": "5", "latest/ongoing": "6",
  "topview/all": "7", "topview/completed": "8", "topview/ongoing": "9",
};

function filters() {
  return [
    { type: "header", name: "Filters are ignored for a text search" },
    { type: "select", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
}

function slugOf(url) {
  return pathOf(url).split("/").filter(Boolean)[1];
}

source = {
  popular: async (page) => listing(await getDocument(BASE + "/manga-list/hot-manga?page=" + page)),
  latest: async (page) => listing(await getDocument(BASE + "/manga-list/latest-manga?page=" + page)),
  filters,

  async search(q, page, f) {
    if (q) return listing(await getDocument(BASE + "/search/story/" + encodeURIComponent(searchSlug(q)) + "?page=" + page));
    const opts = f || {};
    const id = FILTER_ID[(opts.sort || "topview") + "/" + (opts.status || "all")];
    return listing(await getDocument(BASE + "/genre/all?" + query([["filter", id], ["page", page]])));
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const info = doc.selectFirst("div.manga-info-top, div.panel-story-info");
    const titleEl = info ? info.selectFirst("h1, h2") : null;
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const line = (label) => {
      const li = info.select("li").filter((e) => e.text().toLowerCase().indexOf(label) === 0)[0];
      return li ? li.text().replace(/^[^:]*:\s*/, "") : "";
    };
    const descEl = doc.selectFirst("div#contentBox, div#noidungm, div#panel-story-info-description");
    const alt = doc.selectFirst(".story-alternative");
    let description = descEl ? descEl.ownText() : "";
    if (alt && alt.text()) description += (description ? "\n\n" : "") + "Alternative name: " + alt.text().replace(/^[^:]*:\s*/, "");
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("div.manga-info-pic img, span.info-image img")),
      author: line("author"),
      artist: "",
      description,
      genres: unique(info.select("li.genres a, td:containsOwn(genres) + td a").map((a) => a.text())),
      status: parseStatus(line("status")),
    };
  },

  async chapters(url) {
    const slug = slugOf(url);
    const res = ensureOk(
      await http.get(BASE + "/api/manga/" + slug + "/chapters?limit=-1", { headers: { Referer: BASE + url, "X-Requested-With": "XMLHttpRequest" } }),
    );
    const json = JSON.parse(res.body);
    if (!json.success) throw new Error("Chapter list unavailable for " + url);
    return ((json.data && json.data.chapters) || [])
      .filter((c) => c.chapter_slug)
      .map((c) => ({
        url: "/manga/" + slug + "/" + c.chapter_slug,
        name: c.chapter_name || "Chapter",
        number: c.chapter_num == null ? chapterNumber(c.chapter_name) : Number(c.chapter_num),
        date: c.updated_at ? parseDate(c.updated_at) : null,
        scanlator: null,
      }));
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    const script = doc.select("script").map((s) => s.data()).filter((d) => d.indexOf("cdns") !== -1).join("\n");
    const array = (name) => {
      const m = script.match(new RegExp(name + "\\s*=\\s*\\[([^\\]]*)\\]"));
      if (!m) return [];
      return m[1]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, "").replace(/\\\//g, "/").replace(/\/$/, ""))
        .filter(Boolean);
    };
    const cdns = array("cdns").concat(array("backupImage"));
    const images = array("chapterImages");
    let urls;
    if (images.length && cdns.length) urls = images.map((p) => cdns[0] + "/" + p.replace(/^\/+/, ""));
    else urls = doc.select("div.container-chapter-reader > img").map((img) => imageUrl(img));
    return urls.filter(Boolean).map((u) => ({ url: u, headers: HEADERS }));
  },
};

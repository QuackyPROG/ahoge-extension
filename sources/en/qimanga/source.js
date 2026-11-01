// Qi Manga (formerly Qi Scans) JSON API, the one the site's Angular app calls.
const API = "https://api.qimanga.com/api/v1";
const PER_PAGE = 30;
// The chapter list endpoint rejects perPage above 100.
const CHAPTERS_PER_PAGE = 100;

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + (pairs && pairs.length ? "?" + query(pairs) : "")));
  return JSON.parse(res.body);
}

// The catalogue also lists novels, which have no page images.
const readable = (item) => item.type !== "NOVEL";

function stub(item) {
  return { url: "/series/" + item.slug, title: String(item.title || "").trim(), cover: item.cover || "" };
}

function listing(json) {
  return {
    manga: (json.data || []).filter(readable).map(stub),
    hasNextPage: Boolean(json.next) && json.current < json.totalPages,
  };
}

// "/series/<slug>" and "/series/<slug>/<chapterSlug>".
function slugs(url) {
  const parts = pathOf(url).split("/").filter(Boolean);
  if (parts[0] !== "series" || !parts[1]) throw new Error("Not a Qi Manga url: " + url);
  return { series: parts[1], chapter: parts[2] || null };
}

const STATUS = {
  ONGOING: "ongoing",
  COMPLETED: "completed",
  MASS_RELEASED: "completed",
  HIATUS: "hiatus",
  CANCELLED: "cancelled",
  DROPPED: "cancelled",
};

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "latest", label: "Latest update" },
  { value: "newest", label: "Newly added" },
  { value: "alphabetical", label: "Title" },
];
const STATUSES = [
  { value: "", label: "Any" },
  { value: "ONGOING", label: "Ongoing" },
  { value: "COMPLETED", label: "Completed" },
  { value: "HIATUS", label: "Hiatus" },
  { value: "MASS_RELEASED", label: "Mass released" },
  { value: "COMING_SOON", label: "Coming soon" },
  { value: "DROPPED", label: "Dropped" },
  { value: "CANCELLED", label: "Cancelled" },
];
const TYPES = [
  { value: "", label: "Any" },
  { value: "MANHWA", label: "Manhwa" },
  { value: "MANHUA", label: "Manhua" },
  { value: "MANGA", label: "Manga" },
];
let genreFilters = null;

async function loadGenres() {
  if (genreFilters) return genreFilters;
  const genres = await api("/series/genres", []);
  genreFilters = genres
    .map((g) => ({ type: "checkbox", key: g.slug, name: String(g.name).trim() }))
    .filter((g) => g.key && g.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return genreFilters;
}

async function filters() {
  let genres = [];
  try {
    genres = await loadGenres();
  } catch (e) {
    // Sort, status and type still work without the genre list; the next call tries again.
  }
  return [
    { type: "header", name: "Filters are ignored when searching by title" },
    { type: "sort", key: "sort", name: "Sort by", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
    ...(genres.length ? [{ type: "group", key: "genres", name: "Genres (must have all)", filters: genres }] : []),
  ];
}

function browse(page, sort, order, extra) {
  return api("/series", [["page", page], ["perPage", PER_PAGE], ["sort", sort], ["order", order], ...(extra || [])]).then(listing);
}

async function search(q, page, f) {
  const text = String(q || "").trim();
  // The search endpoint takes only a title (2+ characters) and no filters.
  if (text.length >= 2) return listing(await api("/series/search", [["q", text], ["page", page], ["perPage", PER_PAGE]]));
  if (!f) return browse(page, "popular", "desc");
  const sort = f.sort || { value: "popular", ascending: false };
  const extra = [];
  if (f.status) extra.push(["status", f.status]);
  if (f.type) extra.push(["type", f.type]);
  const genres = Object.keys(f.genres || {}).filter((k) => f.genres[k] === true);
  if (genres.length) extra.push(["genres", genres.join(",")]);
  return browse(page, sort.value, sort.ascending ? "asc" : "desc", extra);
}

function chapterName(ch) {
  const title = String(ch.title || "").trim();
  const label = "Chapter " + ch.number;
  if (!title) return label;
  return /^(chapter|ch\.?|episode)\s*\d/i.test(title) ? title : label + " - " + title;
}

source = {
  popular: (page) => browse(page, "popular", "desc"),
  latest: (page) => browse(page, "latest", "desc"),
  search,
  filters,

  async details(url) {
    const m = await api("/series/" + slugs(url).series, []);
    const description = m.description ? html.parse(m.description, META.baseUrl).text() : "";
    return {
      title: String(m.title || "").trim(),
      cover: m.cover || "",
      author: String(m.author || "").trim(),
      artist: String(m.artist || "").trim(),
      description,
      genres: (m.genres || []).map((g) => String(g.name).trim()).filter(Boolean),
      status: STATUS[m.status] || "unknown",
    };
  },

  async chapters(url) {
    const series = slugs(url).series;
    const chapters = [];
    for (let page = 1; ; page++) {
      const json = await api("/series/" + series + "/chapters", [["page", page], ["perPage", CHAPTERS_PER_PAGE]]);
      for (const ch of json.data || []) {
        // Paid chapters come back with no images until they turn free.
        if (ch.requiresPurchase || ch.publishStatus !== "PUBLIC") continue;
        chapters.push({
          url: "/series/" + series + "/" + ch.slug,
          name: chapterName(ch),
          number: typeof ch.number === "number" ? ch.number : chapterNumber(ch.title),
          date: ch.createdAt ? parseDate(ch.createdAt) : null,
          scanlator: null,
        });
      }
      if (!json.next || page >= json.totalPages) break;
    }
    return chapters;
  },

  async pages(url) {
    const ids = slugs(url);
    if (!ids.chapter) throw new Error("Not a chapter url: " + url);
    const ch = await api("/series/" + ids.series + "/chapters/" + ids.chapter, []);
    if (ch.requiresPurchase) throw new Error("This chapter is paid on Qi Manga and not free yet.");
    return (ch.images || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((img) => ({ url: img.url, headers: {} }));
  },
};

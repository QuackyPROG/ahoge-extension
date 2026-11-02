// Atsumaru (atsu.moe) JSON API, the one its web app calls. Port of keiyoushi src/en/atsumaru (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };
const LIMIT = 24;
const TYPES = "&types=Manga,Manwha,Manhua,OEL&mediums=Comic";

async function api(path) {
  const res = ensureOk(await http.get(BASE + path, { headers: HEADERS }));
  return JSON.parse(res.body);
}

// Images are served from the cdn subdomain; the main host answers 410 for them.
function staticUrl(path) {
  if (!path) return "";
  const p = String(path);
  let url;
  if (/^https?:/.test(p)) url = p;
  else if (p.indexOf("//") === 0) url = "https:" + p;
  else url = BASE + "/static/" + p.replace(/^\//, "").replace(/^static\//, "");
  return url.replace(/^https?:\/\/(?:www\.)?atsu\.moe\//, "https://cdn.atsu.moe/");
}

function cover(m) {
  const image = (v) => (v && typeof v === "object" ? v.largeImage || v.image : v);
  return staticUrl(m.largeImage || image(m.imagePath) || image(m.poster) || m.image);
}

// "/manga/<id>"
const idOf = (url) => pathOf(url).split("/").filter(Boolean)[1];
const stub = (m) => ({ url: "/manga/" + m.id, title: m.title || m.englishTitle || "", cover: cover(m) });

async function browse(path, page) {
  const json = await api(path + "?offset=" + (page - 1) * LIMIT + "&limit=" + LIMIT + TYPES);
  const items = json.items || [];
  return { manga: items.map(stub), hasNextPage: items.length >= LIMIT };
}

const SORTS = [
  { value: "", label: "Relevance" },
  { value: "views:desc", label: "Most views" },
  { value: "mbRating:desc", label: "Rating" },
  { value: "dateAdded:desc", label: "Newly added" },
  { value: "title:asc", label: "Title" },
];

function filters() {
  return [{ type: "select", key: "sort", name: "Sort", options: SORTS }];
}

const names = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === "string" ? x : x && x.name)).filter(Boolean) : []);
const STATUS = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", canceled: "cancelled", cancelled: "cancelled" };

source = {
  popular: (page) => browse("/api/home2/popular", page).then((r) => r),
  latest: (page) => browse("/api/home2/recentlyUpdated", page),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    const pairs = [
      ["q", q || "*"],
      ["filter_by", "hidden:!=true && medium:!=[`Novel`] && views:>0"],
    ];
    if (opts.sort) pairs.push(["sort_by", opts.sort]);
    if (q) pairs.push(["query_by", "title,englishTitle,otherNames,authors"], ["query_by_weights", "4,3,2,1"], ["num_typos", "4,3,2,1"]);
    pairs.push(["page", page], ["per_page", 40]);
    const json = await api("/collections/manga/documents/search?" + query(pairs));
    const hits = json.hits || [];
    const perPage = (json.request_params && json.request_params.per_page) || 40;
    return { manga: hits.map((h) => stub(h.document)), hasNextPage: json.page * perPage < json.found };
  },

  async details(url) {
    const m = (await api("/api/manga/page?id=" + encodeURIComponent(idOf(url)))).mangaPage;
    const people = Array.isArray(m.authors) ? m.authors : [];
    const byType = (type) =>
      unique(people.filter((a) => typeof a === "object" && a.type === type).map((a) => a.name)).join(", ");
    let description = m.synopsis || "";
    const alt = (m.otherNames || []).filter(Boolean);
    if (alt.length) description += (description ? "\n\n" : "") + "Alternative names:\n" + alt.map((n) => "- " + n).join("\n");
    const genres = names(m.genres);
    if (m.type) genres.unshift(m.type === "Manwha" ? "Manhwa" : m.type);
    return {
      title: m.title,
      cover: cover(m),
      author: byType("Author") || unique(names(people)).join(", "),
      artist: byType("Artist"),
      description,
      genres: unique(genres),
      status: STATUS[String(m.status || "").toLowerCase().trim()] || "unknown",
    };
  },

  async chapters(url) {
    const id = idOf(url);
    const page = (await api("/api/manga/page?id=" + encodeURIComponent(id))).mangaPage;
    const all = (await api("/api/manga/allChapters?mangaId=" + encodeURIComponent(id))).chapters || [];
    const groups = {};
    const scores = {};
    for (const s of page.scanlators || []) {
      groups[s.id] = s.name;
      scores[s.id] = s.score;
    }
    // Several groups often upload the same chapter; keep the best-voted upload of each number.
    const best = {};
    for (const c of all) {
      const key = String(c.number);
      const prev = best[key];
      const score = (c2) => (scores[c2.scanlationMangaId] === undefined ? -1e9 : scores[c2.scanlationMangaId]);
      if (!prev || score(c) > score(prev) || (score(c) === score(prev) && (c.createdAt || 0) > (prev.createdAt || 0))) best[key] = c;
    }
    return Object.keys(best)
      .map((k) => best[k])
      .sort((a, b) => b.number - a.number)
      .map((c) => ({
        url: "/read/" + id + "/" + c.id,
        name: c.title || "Chapter " + c.number,
        number: Number(c.number),
        date: typeof c.createdAt === "number" ? c.createdAt : parseDate(c.createdAt),
        scanlator: groups[c.scanlationMangaId] || null,
      }));
  },

  async pages(url) {
    const parts = pathOf(url).split("/").filter(Boolean);
    const json = await api("/api/read/chapter?" + query([["mangaId", parts[1]], ["chapterId", parts[2]]]));
    return ((json.readChapter && json.readChapter.pages) || []).map((p) => ({ url: staticUrl(p.image), headers: HEADERS }));
  },
};

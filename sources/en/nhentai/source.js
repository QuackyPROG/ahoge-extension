// nhentai.net REST API v2 (https://nhentai.net/api/v2/docs). The v1 API (/api/galleries/...) now
// answers 403 "Use new API". Read endpoints work without an API key. Not in keiyoushi, so there is
// no upstream to track. Each gallery is one manga with a single chapter.
const API = META.baseUrl + "/api/v2";
// GET /api/v2/cdn lists i1-i4 and t1-t4; all serve every file, so pick one per gallery.
const IMAGE_SERVERS = ["https://i1.nhentai.net", "https://i2.nhentai.net", "https://i3.nhentai.net", "https://i4.nhentai.net"];
const THUMB_SERVERS = ["https://t1.nhentai.net", "https://t2.nhentai.net", "https://t3.nhentai.net", "https://t4.nhentai.net"];
// The API docs ask for a descriptive User-Agent.
const HEADERS = { Accept: "application/json", "User-Agent": "Ahoge/1.0 (+https://github.com/QuackyPROG/ahoge-extension)" };

const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "japanese", label: "Japanese" },
  { value: "chinese", label: "Chinese" },
  { value: "", label: "All" },
];
const SORTS = [
  { value: "popular", label: "Popular: all time" },
  { value: "popular-month", label: "Popular: this month" },
  { value: "popular-week", label: "Popular: this week" },
  { value: "popular-today", label: "Popular: today" },
  { value: "date", label: "Recent" },
];

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + (pairs ? "?" + query(pairs) : ""), { headers: HEADERS }));
  return JSON.parse(res.body);
}

function idOf(url) {
  const match = pathOf(url).match(/^\/g\/(\d+)/);
  if (!match) throw new Error("Not an nhentai gallery url: " + url);
  return match[1];
}

const server = (list, id) => list[Number(id) % list.length];
const file = (list, id, path) => (path ? server(list, id) + "/" + String(path).replace(/^\/+/, "") : "");

function stub(g) {
  return { url: "/g/" + g.id + "/", title: g.english_title || g.japanese_title || String(g.id), cover: file(THUMB_SERVERS, g.id, g.thumbnail) };
}

const tagsOf = (g, type) => (g.tags || []).filter((t) => t.type === type).map((t) => t.name);

// Search needs a non-empty query, so "pages:>0" stands in for "everything".
async function list(q, page, sort, language) {
  const terms = [String(q || "").trim()];
  if (language) terms.push("language:" + language);
  const text = terms.filter(Boolean).join(" ") || "pages:>0";
  const json = await api("/search", [["query", text], ["sort", sort], ["page", page]]);
  return { manga: (json.result || []).map(stub), hasNextPage: page < (json.num_pages || 0) };
}

const gallery = (url) => api("/galleries/" + idOf(url));

source = {
  popular: (page) => list("", page, "popular", "english"),
  latest: (page) => list("", page, "date", "english"),
  // The query is passed through, so nhentai syntax works: tag:"big breasts" -tag:yaoi artist:x pages:>20
  search: (q, page, f) => list(q, page, (f && f.sort) || "popular", f ? f.language : "english"),
  filters: () => [
    { type: "select", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "language", name: "Language", options: LANGUAGES },
  ],

  async details(url) {
    const g = await gallery(url);
    const t = g.title || {};
    const title = t.english || t.pretty || t.japanese || String(g.id);
    const artists = tagsOf(g, "artist");
    const groups = tagsOf(g, "group");
    const lines = [];
    if (t.japanese && t.japanese !== title) lines.push(t.japanese);
    for (const [type, label] of [["parody", "Parodies"], ["character", "Characters"], ["language", "Languages"], ["category", "Category"]]) {
      const names = tagsOf(g, type);
      if (names.length) lines.push(label + ": " + names.join(", "));
    }
    lines.push("Pages: " + (g.num_pages || 0));
    if (g.num_favorites) lines.push("Favorites: " + g.num_favorites);
    lines.push("#" + g.id);
    return {
      title,
      cover: file(THUMB_SERVERS, g.id, (g.cover && g.cover.path) || (g.thumbnail && g.thumbnail.path)),
      author: (groups.length ? groups : artists).join(", "),
      artist: artists.join(", "),
      description: lines.join("\n"),
      genres: tagsOf(g, "tag"),
      status: "completed",
    };
  },

  async chapters(url) {
    const g = await gallery(url);
    return [{
      url: "/g/" + g.id + "/",
      name: "Gallery" + (g.num_pages ? " (" + g.num_pages + " pages)" : ""),
      number: 1,
      date: g.upload_date ? g.upload_date * 1000 : null,
      scanlator: g.scanlator || null,
    }];
  },

  async pages(url) {
    const g = await gallery(url);
    return (g.pages || [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((p) => ({ url: file(IMAGE_SERVERS, g.id, p.path), headers: { Referer: META.baseUrl + "/" } }));
  },
};

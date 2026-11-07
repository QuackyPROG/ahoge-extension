// nhentai.net public JSON API (the endpoints the site's own reader uses). Not in keiyoushi, so
// there is no upstream to track. Each gallery is one manga with a single chapter.
const API = META.baseUrl + "/api";
const IMAGES = "https://i.nhentai.net/galleries/";
const THUMBS = "https://t.nhentai.net/galleries/";
const HEADERS = { Accept: "application/json", Referer: META.baseUrl + "/" };
const EXT = { j: "jpg", p: "png", g: "gif", w: "webp" };

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

const ext = (image) => EXT[image && image.t] || "jpg";

function titleOf(g) {
  const t = g.title || {};
  return t.english || t.pretty || t.japanese || String(g.id);
}

function stub(g) {
  return { url: "/g/" + g.id + "/", title: titleOf(g), cover: THUMBS + g.media_id + "/thumb." + ext(g.images && g.images.thumbnail) };
}

const tagsOf = (g, type) => (g.tags || []).filter((t) => t.type === type).map((t) => t.name);

// The search endpoint needs a non-empty query, so a language term doubles as "everything".
async function list(q, page, sort, language) {
  const terms = [String(q || "").trim()];
  if (language) terms.push("language:" + language);
  const text = terms.filter(Boolean).join(" ") || "pages:>0";
  const json = await api("/galleries/search", [["query", text], ["page", page], ["sort", sort]]);
  return { manga: (json.result || []).map(stub), hasNextPage: page < (json.num_pages || 0) };
}

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
    const g = await api("/gallery/" + idOf(url));
    const artists = tagsOf(g, "artist");
    const groups = tagsOf(g, "group");
    const lines = [];
    const alt = g.title && g.title.japanese;
    if (alt && alt !== titleOf(g)) lines.push(alt);
    for (const [type, label] of [["parody", "Parodies"], ["character", "Characters"], ["language", "Languages"], ["category", "Category"]]) {
      const names = tagsOf(g, type);
      if (names.length) lines.push(label + ": " + names.join(", "));
    }
    lines.push("Pages: " + (g.num_pages || 0));
    if (g.num_favorites) lines.push("Favorites: " + g.num_favorites);
    lines.push("#" + g.id);
    return {
      title: titleOf(g),
      cover: THUMBS + g.media_id + "/cover." + ext(g.images && g.images.cover),
      author: (groups.length ? groups : artists).join(", "),
      artist: artists.join(", "),
      description: lines.join("\n"),
      genres: tagsOf(g, "tag"),
      status: "completed",
    };
  },

  async chapters(url) {
    const g = await api("/gallery/" + idOf(url));
    return [{
      url: "/g/" + g.id + "/",
      name: "Gallery" + (g.num_pages ? " (" + g.num_pages + " pages)" : ""),
      number: 1,
      date: g.upload_date ? g.upload_date * 1000 : null,
      scanlator: g.scanlator || null,
    }];
  },

  async pages(url) {
    const g = await api("/gallery/" + idOf(url));
    return ((g.images && g.images.pages) || []).map((p, i) => ({
      url: IMAGES + g.media_id + "/" + (i + 1) + "." + ext(p),
      headers: { Referer: META.baseUrl + "/" },
    }));
  },
};

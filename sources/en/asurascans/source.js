// Asura Scans. Listing, details, chapters and pages use the site's JSON API; the site pages sit behind a Cloudflare challenge.
// Port of keiyoushi src/en/asurascans (Apache-2.0). Premium (early access) chapters are left out.
const BASE = META.baseUrl;
const API = "https://api.asurascans.com/api";
const HEADERS = { Referer: BASE + "/" };
const LIMIT = 20;

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "latest", label: "Latest update" },
  { value: "rating", label: "Rating" },
  { value: "update", label: "Newest" },
  { value: "title", label: "A-Z" },
];
const STATUSES = [
  { value: "", label: "All" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
  { value: "dropped", label: "Dropped" },
];
const TYPES = [
  { value: "", label: "All" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
  { value: "manga", label: "Manga" },
];

function filters() {
  return [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
  ];
}

async function series(q, page, f) {
  const opts = f || {};
  const sort = opts.sort || { value: "popular", ascending: false };
  const pairs = [["offset", (page - 1) * LIMIT], ["limit", LIMIT], ["sort", sort.value], ["order", sort.ascending ? "asc" : "desc"]];
  if (q) pairs.push(["search", q]);
  if (opts.status) pairs.push(["status", opts.status]);
  if (opts.type) pairs.push(["type", opts.type]);
  const res = ensureOk(await http.get(API + "/series?" + query(pairs), { headers: HEADERS }));
  const json = JSON.parse(res.body);
  return {
    manga: (json.data || []).map((s) => ({ url: s.public_url || "/comics/" + s.slug, title: s.title, cover: s.cover || s.coverUrl || "" })),
    hasNextPage: Boolean(json.meta && json.meta.has_more),
  };
}

const STATUS = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", dropped: "cancelled", axed: "cancelled" };

function isLocked(c, now) {
  if (c.is_premium || c.is_locked) return true;
  const until = c.early_access_until ? parseDate(c.early_access_until) : null;
  return until !== null && until > now;
}

// "/comics/overgeared-7ba78ec7" or "/comics/overgeared-7ba78ec7/chapter/12" -> "overgeared-7ba78ec7"
function slugOf(url) {
  return url.split("/").filter(Boolean)[1];
}

async function api(path) {
  const res = ensureOk(await http.get(API + path, { headers: HEADERS }));
  return JSON.parse(res.body);
}

source = {
  popular: (page) => series("", page, { sort: { value: "popular", ascending: false } }),
  latest: (page) => series("", page, { sort: { value: "latest", ascending: false } }),
  search: series,
  filters,

  async details(url) {
    const d = (await api("/series/" + slugOf(url))).series;
    const description = d.description ? html.parse("<div>" + d.description + "</div>", BASE).text() : "";
    const genres = (d.genres || []).map((g) => g.name);
    if (d.type) genres.unshift(d.type.charAt(0).toUpperCase() + d.type.slice(1));
    return {
      title: d.title,
      cover: d.cover || "",
      author: d.author || "",
      artist: d.artist || "",
      description,
      genres: unique(genres),
      status: STATUS[String(d.status || "").toLowerCase()] || "unknown",
    };
  },

  async chapters(url) {
    const slug = slugOf(url);
    const list = (await api("/series/" + slug + "/chapters")).data || [];
    const now = Date.now();
    return list
      .filter((c) => !isLocked(c, now))
      .map((c) => {
        const n = String(c.number).replace(/\.0$/, "");
        return {
          url: "/comics/" + slug + "/chapter/" + n,
          name: "Chapter " + n + (c.title ? " - " + c.title : ""),
          number: Number(c.number),
          date: c.created_at ? parseDate(c.created_at) : null,
          scanlator: null,
        };
      });
  },

  async pages(url) {
    const parts = url.split("/").filter(Boolean);
    const data = (await api("/series/" + parts[1] + "/chapters/" + parts[3])).data || {};
    const pages = (data && data.chapter && data.chapter.pages) || [];
    if (data.is_locked || pages.length === 0) throw new Error("This chapter is premium on Asura Scans");
    if (pages.some((p) => p.tiles && p.tiles.length)) throw new Error("This chapter uses scrambled images, which Ahoge can't show yet");
    return pages.map((p) => ({ url: p.url, headers: HEADERS }));
  },
};

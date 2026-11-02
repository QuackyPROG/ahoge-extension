// MangaBall JSON API (English chapters only). Port of keiyoushi src/all/mangaball (Apache-2.0).
const BASE = META.baseUrl;
const XHR = { Referer: BASE + "/", "X-Requested-With": "XMLHttpRequest" };
const COVERS = "https://bulbasaur.poke-black-and-white.net/covers/";
const LANGS = ["en", "en-us", "en-gb"];

async function api(path) {
  const res = ensureOk(await http.get(BASE + "/api/v1" + path, { headers: XHR }));
  return JSON.parse(res.body);
}

function coverOf(image) {
  if (!image) return "";
  const path = image.cover && image.cover.path ? String(image.cover.path).trim().split("\\").join("/") : "";
  if (path) return /^https?:/.test(path) ? path : COVERS + path;
  return image.file || image.cdn_mangadex || image.cdn_mangaupdate || image.cdn_mangaupdates || "";
}

// "/title-detail/<slug>"
const slugOf = (url) => pathOf(url).split("/").filter(Boolean)[1];
const stub = (m) => ({ url: "/title-detail/" + m.slug, title: m.name, cover: coverOf(m.image) });

const SORTS = [
  { value: "views", label: "Most views" },
  { value: "lastupdate", label: "Latest update" },
  { value: "createdAt", label: "Newly added" },
  { value: "name", label: "Title" },
];
const STATUSES = [
  { value: "", label: "Any" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
  { value: "cancelled", label: "Cancelled" },
];
const TYPES = [
  { value: "", label: "Any" },
  { value: "manga", label: "Manga" },
  { value: "manhwa", label: "Manhwa" },
  { value: "manhua", label: "Manhua" },
];
const ADULT = [
  { value: "all", label: "Show adult titles" },
  { value: "no_18", label: "Hide adult titles" },
];

function filters() {
  return [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
    { type: "select", key: "type", name: "Type", options: TYPES },
    { type: "select", key: "adult", name: "Adult content", options: ADULT },
  ];
}

async function searchAdvanced(q, page, f) {
  const opts = f || {};
  const sort = opts.sort || { value: q ? "" : "lastupdate", ascending: false };
  const pairs = [["page", page], ["limit", 24]];
  // The API orders by relevance only when sort_by is omitted.
  if (sort.value && !(q && !f)) pairs.push(["sort_by", sort.value], ["sort_order", sort.ascending ? "asc" : "desc"]);
  pairs.push(["tag_mode", "AND"], ["adult_mode", opts.adult || "all"]);
  if (q) pairs.push(["keyword", q.trim()]);
  if (opts.type) pairs.push(["type", opts.type]);
  if (opts.status) pairs.push(["status", opts.status]);
  const json = await api("/title/search-advanced?" + query(pairs));
  const p = json.pagination || {};
  return { manga: (json.data || []).map(stub), hasNextPage: p.page < p.total_pages };
}

const STATUS = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };
const trimNumber = (n) => String(n).replace(/\.0$/, "");

async function title(url) {
  return (await api("/title/detail/" + encodeURIComponent(slugOf(url)))).data;
}

source = {
  popular: (page) => searchAdvanced("", page, { sort: { value: "views", ascending: false } }),
  latest: (page) => searchAdvanced("", page, { sort: { value: "lastupdate", ascending: false } }),
  search: searchAdvanced,
  filters,

  async details(url) {
    const t = await title(url);
    let description = (t.description || []).join("\n\n");
    const alt = t.alternateName || [];
    if (alt.length) description += "\n\nAlternative names:\n" + alt.map((n) => "- " + n).join("\n");
    return {
      title: t.name,
      cover: coverOf(t.image),
      author: (t.author || []).map((a) => a.name).join(", "),
      artist: "",
      description: description.trim(),
      genres: unique((t.tags || []).map((g) => g.name)),
      status: STATUS[t.status] || "unknown",
    };
  },

  async chapters(url) {
    const t = await title(url);
    const res = ensureOk(
      await http.post(BASE + "/api/v1/chapter/chapter-listing-by-title-id", {
        headers: Object.assign({ "Content-Type": "application/json" }, XHR),
        body: JSON.stringify({ title_id: t.id }),
      }),
    );
    return (JSON.parse(res.body).data || [])
      .filter((c) => LANGS.indexOf(String(c.lang).toLowerCase()) !== -1)
      .map((c) => {
        const name = String(c.name || "").trim();
        const n = c.number == null ? null : trimNumber(c.number);
        let label = c.volume > 0 ? "Vol. " + trimNumber(c.volume) + " " : "";
        label += n !== null && name.indexOf(n) !== -1 ? name : "Ch. " + n + (name ? " " + name : "");
        return {
          url: "/chapter-detail/" + c.id,
          name: label,
          number: c.number == null ? chapterNumber(name) : Number(c.number),
          date: c.created_at ? parseDate(String(c.created_at).replace(/\.\d+$/, "") + "Z") : null,
          scanlator: c.group ? c.group.name : null,
        };
      });
  },

  async pages(url) {
    const id = pathOf(url).split("/").filter(Boolean)[1];
    const json = await api("/chapter-detail?chapter_id=" + encodeURIComponent(id));
    return ((json.data && json.data.chapter && json.data.chapter.pages) || []).map((u) => ({ url: u, headers: { Referer: BASE + "/" } }));
  },
};

// Omega Scans runs HeanCMS; the site's own app reads this JSON API. Port of keiyoushi lib-multisrc/heancms (Apache-2.0).
const API = "https://api.omegascans.org";
const PER_PAGE = 20;
const CHAPTERS_PER_PAGE = 100;

async function api(path) {
  const res = ensureOk(await http.get(API + path, { headers: { Accept: "application/json", Referer: META.baseUrl + "/" } }));
  return JSON.parse(res.body);
}

// "/series/<slug>" and "/series/<slug>/<chapterSlug>".
function slugs(url) {
  const parts = pathOf(url).split("/").filter(Boolean);
  if (parts[0] !== "series" || !parts[1]) throw new Error("Not an Omega Scans url: " + url);
  return { series: parts[1], chapter: parts[2] || null };
}

const hasNext = (meta) => Boolean(meta) && meta.current_page < meta.last_page;

const STATUSES = [
  { value: "All", label: "All" },
  { value: "Ongoing", label: "Ongoing" },
  { value: "Completed", label: "Completed" },
  { value: "Hiatus", label: "Hiatus" },
  { value: "Dropped", label: "Dropped" },
];
const SORTS = [
  { value: "total_views", label: "Popular" },
  { value: "latest", label: "Latest" },
  { value: "created_at", label: "Newly added" },
  { value: "title", label: "Title" },
];
let tagFilters = null;

async function filters() {
  if (!tagFilters) {
    try {
      const tags = await api("/tags");
      tagFilters = tags
        .map((t) => ({ type: "checkbox", key: String(t.id), name: String(t.name).trim() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      // Browse still works without tags; they are fetched again next time.
    }
  }
  const list = [
    { type: "sort", key: "sort", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
  if (tagFilters && tagFilters.length) list.push({ type: "group", key: "tags", name: "Genres", filters: tagFilters });
  return list;
}

async function queryList(page, q, status, orderBy, order, tagIds) {
  const pairs = [
    ["query_string", q],
    ["status", status],
    ["order", order],
    ["orderBy", orderBy],
    ["series_type", "Comic"],
    ["page", page],
    ["perPage", PER_PAGE],
    ["tags_ids", "[" + tagIds.join(",") + "]"],
    ["adult", "true"],
  ];
  const json = await api("/query?" + query(pairs));
  return {
    manga: (json.data || []).map((s) => ({ url: "/series/" + s.series_slug, title: String(s.title || "").trim(), cover: s.thumbnail || "" })),
    hasNextPage: hasNext(json.meta),
  };
}

function descriptionText(htmlText) {
  if (!htmlText) return "";
  const doc = html.parse("<div>" + htmlText + "</div>", META.baseUrl);
  const paragraphs = doc.select("p").map((p) => p.text()).filter(Boolean);
  return paragraphs.length ? paragraphs.join("\n\n") : doc.text();
}

source = {
  popular: (page) => queryList(page, "", "All", "total_views", "desc", []),
  latest: (page) => queryList(page, "", "All", "latest", "desc", []),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    const sort = opts.sort || { value: "total_views", ascending: false };
    const tags = Object.keys(opts.tags || {}).filter((k) => opts.tags[k] === true);
    return queryList(page, q, opts.status || "All", sort.value, sort.ascending ? "asc" : "desc", tags);
  },

  async details(url) {
    const s = await api("/series/" + slugs(url).series);
    return {
      title: String(s.title || "").trim(),
      cover: s.thumbnail || "",
      author: s.author || "",
      artist: s.studio || "",
      description: descriptionText(s.description),
      genres: unique((s.tags || []).map((t) => t.name)),
      status: parseStatus(s.status),
    };
  },

  async chapters(url) {
    const slug = slugs(url).series;
    const s = await api("/series/" + slug);
    const now = Date.now();
    const out = [];
    for (let page = 1; ; page++) {
      const json = await api("/chapter/query?" + query([["page", page], ["perPage", CHAPTERS_PER_PAGE], ["series_id", s.id]]));
      for (const c of json.data || []) {
        // Paid (early access) chapters need an account; they turn free later.
        if (c.price) continue;
        const date = parseDate(c.created_at);
        if (date !== null && date > now) continue;
        const name = String(c.chapter_name || "").trim() + (c.chapter_title ? " - " + String(c.chapter_title).trim() : "");
        out.push({ url: "/series/" + slug + "/" + c.chapter_slug, name, number: chapterNumber(c.chapter_name), date, scanlator: null });
      }
      if (!hasNext(json.meta)) break;
    }
    return out;
  },

  async pages(url) {
    const s = slugs(url);
    const json = await api("/chapter/" + s.series + "/" + s.chapter);
    const images = (json.chapter && json.chapter.chapter_data && json.chapter.chapter_data.images) || [];
    if (!images.length && json.paywall) throw new Error("This chapter is paid on Omega Scans");
    return images.map((u) => ({ url: /^https?:\/\//.test(u) ? u : API + "/" + u.replace(/^\//, ""), headers: { Referer: META.baseUrl + "/" } }));
  },
};

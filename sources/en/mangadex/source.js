// MangaDex public API (https://api.mangadex.org/docs/). English, safe + suggestive ratings.
const API = "https://api.mangadex.org";
const LIMIT = 20;
// MangaDex redirects browser User-Agents to a bot challenge; the API wants a non-browser one.
const HEADERS = { "User-Agent": "Ahoge/2.0 (+https://github.com/QuackyPROG/ahoge-extension)" };
const RATINGS = [["contentRating[]", "safe"], ["contentRating[]", "suggestive"]];

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + "?" + query(pairs), { headers: HEADERS }));
  return JSON.parse(res.body);
}

function localized(map) {
  if (!map) return "";
  return map.en || Object.values(map)[0] || "";
}

function related(item, type) {
  return (item.relationships || []).filter((r) => r.type === type && r.attributes);
}

function coverOf(item) {
  const cover = related(item, "cover_art")[0];
  return cover ? "https://uploads.mangadex.org/covers/" + item.id + "/" + cover.attributes.fileName + ".512.jpg" : "";
}

function titleOf(item) {
  const a = item.attributes;
  const alt = (a.altTitles || []).find((t) => t.en);
  if (a.title && a.title.en) return a.title.en;
  if (alt) return alt.en;
  return Object.values(a.title || {})[0] || "";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function idOf(url) {
  const match = String(url).match(UUID);
  if (!match) throw new Error("Invalid MangaDex id in url: " + url);
  return match[0].toLowerCase();
}

async function list(page, extra, base = [["availableTranslatedLanguage[]", "en"], ["hasAvailableChapters", "true"], ...RATINGS]) {
  const json = await api("/manga", [["limit", LIMIT], ["offset", (page - 1) * LIMIT], ["includes[]", "cover_art"], ...base, ...extra]);
  return {
    manga: json.data.map((m) => ({ url: "/manga/" + m.id, title: titleOf(m), cover: coverOf(m) })),
    hasNextPage: json.offset + json.data.length < Math.min(json.total, 10000),
  };
}

// Filters follow the MangaDex search page (https://mangadex.org/titles). Tag filters are named exactly
// like the genres details() returns, so tapping a genre in the app selects its tag.
const SORTS = [
  { value: "relevance", label: "Best match" },
  { value: "latestUploadedChapter", label: "Latest upload" },
  { value: "followedCount", label: "Follows" },
  { value: "rating", label: "Rating" },
  { value: "createdAt", label: "Recently added" },
  { value: "updatedAt", label: "Recently updated" },
  { value: "title", label: "Title" },
  { value: "year", label: "Year" },
];
const TAG_GROUPS = [["genre", "Genres"], ["theme", "Themes"], ["format", "Formats"], ["content", "Content warnings"]];
const checkboxes = (pairs, defaults = []) =>
  pairs.map(([key, name]) => ({ type: "checkbox", key, name, default: defaults.includes(key) || undefined }));
let tagGroups = null;

async function loadTagGroups() {
  if (tagGroups) return tagGroups;
  const json = await api("/manga/tag", []);
  const tags = json.data
    .map((t) => ({ id: t.id, name: localized(t.attributes.name), group: t.attributes.group }))
    .filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  tagGroups = TAG_GROUPS.map(([group, name]) => ({
    type: "group",
    key: "tags_" + group,
    name,
    filters: tags.filter((t) => t.group === group).map((t) => ({ type: "tristate", key: t.id, name: t.name })),
  })).filter((g) => g.filters.length);
  return tagGroups;
}

async function filters() {
  let tags = [];
  try {
    tags = await loadTagGroups();
  } catch (e) {
    // Without the tag list the other filters still work; the next call tries again.
  }
  return [
    { type: "sort", key: "sort", name: "Sort by", options: SORTS },
    { type: "checkbox", key: "hasChapters", name: "Has English chapters", default: true },
    { type: "group", key: "type", name: "Type", filters: checkboxes([["ja", "Manga (Japanese)"], ["ko", "Manhwa (Korean)"], ["zh", "Manhua (Chinese)"]]) },
    { type: "group", key: "status", name: "Status", filters: checkboxes([["ongoing", "Ongoing"], ["completed", "Completed"], ["hiatus", "Hiatus"], ["cancelled", "Cancelled"]]) },
    {
      type: "group",
      key: "demographic",
      name: "Demographic",
      filters: checkboxes([["shounen", "Shounen"], ["shoujo", "Shoujo"], ["seinen", "Seinen"], ["josei", "Josei"], ["none", "None"]]),
    },
    {
      type: "group",
      key: "rating",
      name: "Content rating",
      filters: checkboxes([["safe", "Safe"], ["suggestive", "Suggestive"], ["erotica", "Erotica"], ["pornographic", "Pornographic"]], ["safe", "suggestive"]),
    },
    { type: "text", key: "author", name: "Author" },
    { type: "text", key: "artist", name: "Artist" },
    { type: "text", key: "year", name: "Year" },
    ...(tags.length ? [{ type: "header", name: "Tags" }] : []),
    ...tags,
    {
      type: "select",
      key: "includeMode",
      name: "Included tags",
      options: [{ value: "AND", label: "Must have all (AND)" }, { value: "OR", label: "Any of them (OR)" }],
    },
    {
      type: "select",
      key: "excludeMode",
      name: "Excluded tags",
      options: [{ value: "OR", label: "Any of them (OR)" }, { value: "AND", label: "All of them (AND)" }],
    },
  ];
}

const checked = (group) => Object.keys(group || {}).filter((k) => group[k] === true);

// Author and artist are filtered by id; a name with no match means no results.
async function creatorIds(name) {
  const json = await api("/author", [["name", name], ["limit", 10]]);
  return json.data.map((a) => a.id);
}

async function search(q, page, f) {
  if (!f) return list(page, [["title", q], ["order[relevance]", "desc"]]);
  const pairs = [];
  if (q) pairs.push(["title", q]);
  const sort = f.sort || { value: "relevance", ascending: false };
  const field = sort.value === "relevance" && !q ? "followedCount" : sort.value;
  pairs.push(["order[" + field + "]", sort.ascending ? "asc" : "desc"]);
  for (const lang of checked(f.type)) {
    pairs.push(["originalLanguage[]", lang]);
    if (lang === "zh") pairs.push(["originalLanguage[]", "zh-hk"]);
  }
  for (const status of checked(f.status)) pairs.push(["status[]", status]);
  for (const demo of checked(f.demographic)) pairs.push(["publicationDemographic[]", demo]);
  for (const [key, param] of [["author", "authors[]"], ["artist", "artists[]"]]) {
    const name = String(f[key] || "").trim();
    if (!name) continue;
    const ids = await creatorIds(name);
    if (!ids.length) return { manga: [], hasNextPage: false };
    for (const id of ids) pairs.push([param, id]);
  }
  if (/^\d{4}$/.test(String(f.year || "").trim())) pairs.push(["year", String(f.year).trim()]);
  for (const [key, value] of Object.entries(f)) {
    if (!key.startsWith("tags_") || !value) continue;
    for (const [id, state] of Object.entries(value)) {
      if (state === 1) pairs.push(["includedTags[]", id]);
      if (state === 2) pairs.push(["excludedTags[]", id]);
    }
  }
  if (f.includeMode) pairs.push(["includedTagsMode", f.includeMode]);
  if (f.excludeMode) pairs.push(["excludedTagsMode", f.excludeMode]);
  const ratings = checked(f.rating);
  const base = f.hasChapters === false ? [] : [["availableTranslatedLanguage[]", "en"], ["hasAvailableChapters", "true"]];
  base.push(...(ratings.length ? ratings.map((r) => ["contentRating[]", r]) : RATINGS));
  return list(page, pairs, base);
}

source = {
  popular: (page) => list(page, [["order[followedCount]", "desc"]]),
  latest: (page) => list(page, [["order[latestUploadedChapter]", "desc"]]),
  search,
  filters,

  async details(url) {
    const id = idOf(url);
    const json = await api("/manga/" + id, [["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]]);
    const m = json.data;
    const names = (type) => related(m, type).map((r) => r.attributes.name).join(", ");
    return {
      title: titleOf(m),
      cover: coverOf(m),
      author: names("author"),
      artist: names("artist"),
      description: localized(m.attributes.description),
      genres: (m.attributes.tags || []).map((t) => localized(t.attributes.name)).filter(Boolean),
      status: parseStatus(m.attributes.status),
    };
  },

  async chapters(url) {
    const id = idOf(url);
    const chapters = [];
    let offset = 0;
    for (;;) {
      const json = await api("/manga/" + id + "/feed", [
        ["translatedLanguage[]", "en"],
        ["order[volume]", "desc"],
        ["order[chapter]", "desc"],
        ["limit", 500],
        ["offset", offset],
        ["includes[]", "scanlation_group"],
        ...RATINGS,
        ["contentRating[]", "erotica"],
        ["contentRating[]", "pornographic"],
      ]);
      for (const ch of json.data) {
        const a = ch.attributes;
        if (a.externalUrl) continue;
        const label = [a.volume ? "Vol." + a.volume : "", a.chapter ? "Ch." + a.chapter : "Oneshot"].filter(Boolean).join(" ");
        const group = related(ch, "scanlation_group")[0];
        chapters.push({
          url: "/chapter/" + ch.id,
          name: a.title ? label + " - " + a.title : label,
          number: a.chapter && Number.isFinite(Number(a.chapter)) ? Number(a.chapter) : -1,
          date: a.publishAt ? Date.parse(a.publishAt) : null,
          scanlator: group ? group.attributes.name : null,
        });
      }
      offset = json.offset + json.data.length;
      if (offset >= json.total || json.data.length === 0) break;
    }
    return chapters;
  },

  async pages(url) {
    const id = idOf(url);
    const res = ensureOk(await http.get(API + "/at-home/server/" + id, { headers: HEADERS }));
    const json = JSON.parse(res.body);
    return json.chapter.data.map((file) => ({ url: json.baseUrl + "/data/" + json.chapter.hash + "/" + file, headers: {} }));
  },
};

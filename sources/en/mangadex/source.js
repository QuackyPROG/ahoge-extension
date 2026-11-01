// MangaDex public API (https://api.mangadex.org/docs/). English, safe + suggestive ratings.
const API = "https://api.mangadex.org";
const LIMIT = 20;
const RATINGS = [["contentRating[]", "safe"], ["contentRating[]", "suggestive"]];

async function api(path, pairs) {
  const res = ensureOk(await http.get(API + path + "?" + query(pairs)));
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
  return localized(a.title) || (alt ? alt.en : "");
}

async function list(page, extra) {
  const json = await api("/manga", [
    ["limit", LIMIT],
    ["offset", (page - 1) * LIMIT],
    ["includes[]", "cover_art"],
    ["availableTranslatedLanguage[]", "en"],
    ["hasAvailableChapters", "true"],
    ...RATINGS,
    ...extra,
  ]);
  return {
    manga: json.data.map((m) => ({ url: "/manga/" + m.id, title: titleOf(m), cover: coverOf(m) })),
    hasNextPage: json.offset + json.limit < json.total,
  };
}

source = {
  popular: (page) => list(page, [["order[followedCount]", "desc"]]),
  latest: (page) => list(page, [["order[latestUploadedChapter]", "desc"]]),
  search: (q, page) => list(page, [["title", q], ["order[relevance]", "desc"]]),

  async details(url) {
    const id = url.split("/").pop();
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
    const id = url.split("/").pop();
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
          number: a.chapter ? Number(a.chapter) : -1,
          date: a.publishAt ? Date.parse(a.publishAt) : null,
          scanlator: group ? group.attributes.name : null,
        });
      }
      offset = json.offset + json.limit;
      if (offset >= json.total || json.data.length === 0) break;
    }
    return chapters;
  },

  async pages(url) {
    const id = url.split("/").pop();
    const res = ensureOk(await http.get(API + "/at-home/server/" + id));
    const json = JSON.parse(res.body);
    return json.chapter.data.map((file) => ({ url: json.baseUrl + "/data/" + json.chapter.hash + "/" + file, headers: {} }));
  },
};

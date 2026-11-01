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
    hasNextPage: json.offset + json.data.length < Math.min(json.total, 10000),
  };
}

source = {
  popular: (page) => list(page, [["order[followedCount]", "desc"]]),
  latest: (page) => list(page, [["order[latestUploadedChapter]", "desc"]]),
  search: (q, page) => list(page, [["title", q], ["order[relevance]", "desc"]]),

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

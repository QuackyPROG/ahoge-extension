// Iken theme (JSON API at api.<host>). Port of keiyoushi lib-multisrc/iken (Apache-2.0).
// Manga urls are "/series/<slug>", chapter urls "/series/<slug>/<chapter slug>#<chapter id>".
function Iken(config) {
  const c = Object.assign(
    {
      apiUrl: null, // defaults to https://api.<host>
      perPage: 18,
      sortPagesByFilename: false,
      hideNovelsListedAsComics: false,
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const api = (c.apiUrl || base.replace("https://", "https://api.")) + "/api";
  const headers = { Referer: base + "/", Origin: base };

  async function getJson(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return JSON.parse(res.body);
  }

  const SORTS = [
    { value: "lastChapterAddedAt", label: "Last chapter" },
    { value: "totalViews", label: "Views" },
    { value: "createdAt", label: "Date added" },
    { value: "chaptersCount", label: "Chapter count" },
    { value: "postTitle", label: "Title" },
  ];
  const STATUSES = [
    { value: "", label: "All" },
    { value: "ONGOING", label: "Ongoing" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "DROPPED", label: "Dropped" },
    { value: "COMING_SOON", label: "Coming soon" },
    { value: "MASS_RELEASED", label: "Mass released" },
  ];
  const TYPES = [
    { value: "", label: "All" },
    { value: "MANGA", label: "Manga" },
    { value: "MANHUA", label: "Manhua" },
    { value: "MANHWA", label: "Manhwa" },
  ];

  const isNovel = (p) => Boolean(p.isNovel) || String(p.seriesType || "").toLowerCase() === "novel";
  const stub = (p) => ({ url: "/series/" + p.slug, title: p.postTitle, cover: p.featuredImage || "" });

  let novelIds = null;
  async function getNovelIds() {
    if (novelIds) return novelIds;
    const ids = new Set();
    for (let page = 1; page <= 20; page++) {
      const data = await getJson(api + "/posts?" + query([["page", page], ["perPage", 100]]));
      const posts = data.novelPosts || [];
      posts.forEach((p) => ids.add(p.id));
      if (!posts.length || ids.size >= (data.novelTotalCount || 0)) break;
    }
    novelIds = ids;
    return ids;
  }

  // The API pages hold novels too; skip pages that hold nothing else (at most a few).
  async function queryList(q, page, opts) {
    const pairs = [["perPage", c.perPage], ["searchTerm", String(q || "").trim()]];
    if (opts.status) pairs.push(["seriesStatus", opts.status]);
    if (opts.type) pairs.push(["seriesType", opts.type]);
    const sort = opts.sort || { value: "lastChapterAddedAt", ascending: false };
    pairs.push(["orderBy", sort.value], ["orderDirection", sort.ascending ? "asc" : "desc"]);
    const genres = opts.genres ? Object.keys(opts.genres).filter((k) => opts.genres[k]) : [];
    if (genres.length) pairs.push(["genreIds", genres.join(",")]);
    const novels = c.hideNovelsListedAsComics ? await getNovelIds() : new Set();
    let p = page;
    for (let tries = 0; tries < 5; tries++, p++) {
      const data = await getJson(api + "/query?" + query(pairs.concat([["page", p]])));
      const manga = (data.posts || []).filter((x) => !isNovel(x) && !novels.has(x.id)).map(stub);
      const hasNextPage = (data.totalCount || 0) > p * c.perPage;
      if (manga.length || !hasNextPage) return { manga, hasNextPage };
    }
    return { manga: [], hasNextPage: false };
  }

  let genreCache = null;
  async function filters() {
    if (!genreCache) {
      try {
        const list = await getJson(api + "/genres");
        genreCache = (Array.isArray(list) ? list : []).map((g) => ({ type: "checkbox", key: String(g.id), name: g.name }));
      } catch (e) {
        return baseFilters();
      }
    }
    const out = baseFilters();
    if (genreCache.length) out.push({ type: "group", key: "genres", name: "Genres", filters: genreCache });
    return out;
  }
  function baseFilters() {
    return [
      { type: "sort", key: "sort", name: "Sort", options: SORTS },
      { type: "select", key: "status", name: "Status", options: STATUSES },
      { type: "select", key: "type", name: "Type", options: TYPES },
    ];
  }

  const slugOf = (url) => pathOf(url).split("/").filter(Boolean)[1];

  async function post(url) {
    const data = await getJson(api + "/post?" + query([["postSlug", slugOf(url)]]));
    if (!data.post) throw new Error("Series not found: " + url);
    if (isNovel(data.post)) throw new Error("Novels are unsupported");
    return data;
  }

  function chapterOf(slug, ch) {
    const locked = ch.isLocked === true || ch.isTimeLocked === true || (ch.chapterPurchased === false && ch.price && ch.price !== 0);
    const title = ch.title && String(ch.title).trim() ? " - " + ch.title : "";
    const number = Number(ch.number);
    return {
      url: "/series/" + slug + "/" + ch.slug + "#" + ch.id,
      name: (locked ? "🔒 " : "") + "Chapter " + ch.number + title,
      number: Number.isNaN(number) ? -1 : number,
      date: ch.createdAt ? parseDate(String(ch.createdAt).replace(/\.\d+/, "")) : null,
      scanlator: null,
      locked,
    };
  }

  const STATUS = { ONGOING: "ongoing", COMING_SOON: "ongoing", MASS_RELEASED: "ongoing", COMPLETED: "completed", CANCELLED: "cancelled", DROPPED: "cancelled" };

  return {
    popular: (page) => queryList("", page, { sort: { value: "totalViews", ascending: false } }),
    latest: (page) => queryList("", page, { sort: { value: "lastChapterAddedAt", ascending: false } }),
    search: (q, page, f) => queryList(q, page, f || {}),
    filters,

    async details(url) {
      const p = (await post(url)).post;
      let description = p.postContent ? html.parse("<div>" + String(p.postContent).split("\n").join("<br>") + "</div>", base).text() : "";
      if (p.alternativeTitles) description = (description + "\n\nAlternative Names: " + p.alternativeTitles).trim();
      const type = { MANGA: "Manga", MANHUA: "Manhua", MANHWA: "Manhwa" }[p.seriesType];
      return {
        title: p.postTitle,
        cover: p.featuredImage || "",
        author: p.author || "",
        artist: p.artist || "",
        description,
        genres: unique([type].concat((p.genres || []).map((g) => g.name))),
        status: STATUS[p.seriesStatus] || "unknown",
      };
    },

    async chapters(url) {
      const data = await post(url);
      const slug = data.post.slug;
      let list = data.post.chapters || [];
      // The post endpoint can truncate long series; the chapters endpoint has them all.
      if (data.totalChapterCount && data.totalChapterCount > list.length) {
        try {
          const full = await getJson(api + "/chapters?" + query([["postId", data.post.id]]));
          const more = (full.post && full.post.chapters) || [];
          if (more.length > list.length) list = more;
        } catch (e) {}
      }
      return list
        .map((ch) => chapterOf(slug, ch))
        .filter((ch) => !ch.locked)
        .map((ch) => ({ url: ch.url, name: ch.name, number: ch.number, date: ch.date, scanlator: ch.scanlator }))
        .sort((a, b) => b.number - a.number);
    },

    async pages(url) {
      const id = String(url).split("#")[1];
      if (!id) throw new Error("Chapter id missing from " + url + "; refresh the chapter list");
      const data = (await getJson(api + "/chapter?" + query([["chapterId", id]]))).chapter;
      if (!data) throw new Error("Chapter not found: " + url);
      if (data.isShortLinkLocked || data.isLockedByCoins || data.isPermanentlyLocked) throw new Error("Chapter is locked");
      let images = (data.images || []).slice();
      const fileNumber = (u) => {
        const m = String(u).split("/").pop().match(/\d+/);
        return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
      };
      if (c.sortPagesByFilename) images.sort((a, b) => fileNumber(a.url) - fileNumber(b.url));
      else images.sort((a, b) => (a.order === undefined || a.order === null ? Infinity : a.order) - (b.order === undefined || b.order === null ? Infinity : b.order));
      return images.map((img) => ({ url: String(img.url).split(" ").join("%20"), headers: { Referer: base + "/" } }));
    },
  };
}

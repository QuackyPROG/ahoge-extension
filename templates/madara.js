// Madara (WordPress "WP Manga" theme). Port of keiyoushi lib-multisrc/madara (Apache-2.0).
function Madara(config) {
  const c = Object.assign(
    {
      pageSize: 25,
      filterNonMangaItems: true,
      chapterMode: "mangaAjax", // "mangaPage" | "adminAjax" | "mangaAjax"
      archiveSelector: "div.page-item-detail, .manga__item, .c-tabs-item__content",
      archiveUrlSelector: ".post-title a",
      titleSelector: "div.post-title h3, div.post-title h1, #manga-title > h1",
      authorSelector: "div.author-content > a, div.manga-authors > a",
      artistSelector: "div.artist-content > a",
      statusSelector: "div.summary-content, div.summary-heading:contains(Status) + div",
      descriptionSelector:
        "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt",
      thumbnailSelector: "div.summary_image img",
      genreSelector: "div.genres-content a, div.tags-content a",
      chapterSelector: "li.wp-manga-chapter",
      chapterDateSelector: "span.chapter-release-date",
      pageSelector: "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item))",
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const referer = { Referer: base + "/" };
  const xhr = { "X-Requested-With": "XMLHttpRequest", Referer: base + "/" };

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers: referer }));
    return html.parse(res.body, res.url);
  }

  async function postDocument(url, body) {
    const res = ensureOk(await http.post(url, { headers: xhr, body }));
    return html.parse(res.body, res.url);
  }

  function parseArchive(doc) {
    return doc
      .select(c.archiveSelector)
      .map((el) => {
        const link = el.selectFirst(c.archiveUrlSelector);
        const href = link ? link.absUrl("href") : "";
        if (!href) return null;
        return { url: pathOf(href), title: link.text(), cover: imageUrl(el.selectFirst("img")) };
      })
      .filter(Boolean);
  }

  async function loadMore(page, vars) {
    const body = {
      action: "madara_load_more",
      page: String(page - 1),
      template: "madara-core/content/content-archive",
      "vars[paged]": "1",
      "vars[template]": "archive",
      "vars[posts_per_page]": String(c.pageSize),
      "vars[post_type]": "wp-manga",
      "vars[post_status]": "publish",
      "vars[manga_archives_item_layout]": "big_thumbnail",
    };
    if (c.filterNonMangaItems) {
      body["vars[meta_query][0][key]"] = "_wp_manga_chapter_type";
      body["vars[meta_query][0][value]"] = "manga";
    }
    Object.assign(body, vars);
    const manga = parseArchive(await postDocument(base + "/wp-admin/admin-ajax.php", body));
    return { manga, hasNextPage: manga.length === c.pageSize };
  }

  const sortBy = (key) => ({ "vars[orderby]": "meta_value_num", "vars[meta_key]": key, "vars[order]": "DESC" });

  function parseChapters(doc) {
    return doc
      .select(c.chapterSelector)
      .map((el) => {
        const link = el.selectFirst("a");
        const href = link ? link.absUrl("href") : "";
        if (!href) return null;
        const imgAlt = el.selectFirst("img:not(.thumb)");
        const titled = el.selectFirst("span a");
        const dated = el.selectFirst(c.chapterDateSelector);
        const dateText = (imgAlt && imgAlt.attr("alt")) || (titled && titled.attr("title")) || (dated && dated.text()) || "";
        const name = link.text();
        return { url: pathOf(href), name, number: chapterNumber(name), date: parseDate(dateText), scanlator: null };
      })
      .filter(Boolean);
  }

  return {
    popular: (page) => loadMore(page, sortBy("_wp_manga_views")),
    latest: (page) => loadMore(page, sortBy("_latest_update")),
    search: (q, page) => loadMore(page, { "vars[s]": q }),

    async details(url) {
      const doc = await getDocument(base + url);
      const titleEl = doc.selectFirst(c.titleSelector);
      if (!titleEl) throw new Error("Manga title not found on " + url);
      const names = (sel) =>
        doc.select(sel).map((e) => e.text()).filter((t) => t && !/updating|atualizando/i.test(t)).join(", ");
      const descEl = doc.selectFirst(c.descriptionSelector);
      let description = "";
      if (descEl) {
        const paragraphs = descEl.select("p");
        description = paragraphs.length ? paragraphs.map((p) => p.text()).join("\n\n") : descEl.text();
      }
      const statusEls = doc.select(c.statusSelector);
      return {
        title: titleEl.ownText() || titleEl.text(),
        cover: imageUrl(doc.selectFirst(c.thumbnailSelector)),
        author: names(c.authorSelector),
        artist: names(c.artistSelector),
        description,
        genres: unique(doc.select(c.genreSelector).map((e) => e.text())),
        status: parseStatus(statusEls.length ? statusEls[statusEls.length - 1].text() : ""),
      };
    },

    async chapters(url) {
      if (c.chapterMode === "mangaPage") return parseChapters(await getDocument(base + url));
      if (c.chapterMode === "adminAjax") {
        const page = await getDocument(base + url);
        const holder = page.selectFirst("[data-post-id], #manga-chapters-holder[data-id]");
        const id = holder ? holder.attr("data-post-id") || holder.attr("data-id") : "";
        if (!id) throw new Error("Madara post id not found on " + url);
        return parseChapters(await postDocument(base + "/wp-admin/admin-ajax.php", { action: "manga_get_chapters", manga: id }));
      }
      return parseChapters(await postDocument(base + url.replace(/\/$/, "") + "/ajax/chapters/", {}));
    },

    async pages(url) {
      let doc = await getDocument(base + url);
      if (doc.selectFirst("#single-pager")) doc = await getDocument(base + url + (url.includes("?") ? "&" : "?") + "style=list");
      if (doc.selectFirst("#chapter-protector-data")) throw new Error("This chapter is protected (chapter-protector) and is not supported yet");
      return doc
        .select(c.pageSelector)
        .map((el) => imageUrl(el.tagName() === "img" ? el : el.selectFirst("img")))
        .filter(Boolean)
        .map((u) => ({ url: u, headers: { Referer: base + "/" } }));
    },
  };
}

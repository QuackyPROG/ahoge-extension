// Yiimanga theme (ManhwaBuddy, Hentai20). Port of keiyoushi lib-multisrc/yiimanga (Apache-2.0).
function Yiimanga(config) {
  const c = Object.assign(
    {
      searchParam: "s",
      popularPath: null, // catalogue route the site sorts with ?order=views; null falls back to latest
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const headers = { Referer: base + "/" };

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return html.parse(res.body, res.url);
  }

  function listing(doc) {
    const manga = doc
      .select(".latest-list .latest-item, .list .list-item")
      .map((el) => {
        const link = el.selectFirst(".latest-right a:has(h3), .latest-right a:has(h4), .item-title a");
        if (!link) return null;
        return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst(".latest-left img, .item-img img")) };
      })
      .filter(Boolean);
    return { manga, hasNextPage: Boolean(doc.selectFirst("#pagination li.next a")) };
  }

  const latest = async (page) => listing(await getDocument(base + "/page/" + page + "/"));

  // "06 Oct 2026", "12 Oct 26", or "Oct 26" (month and two-digit year).
  function yiiDate(text) {
    const m = String(text || "").trim().match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?\s+(\d{2,4})$/);
    if (!m) return parseDate(text);
    const year = m[3].length === 2 ? "20" + m[3] : m[3];
    return parseDate((m[1] || "1") + " " + m[2] + " " + year);
  }

  // Info rows: <li><h5>Author(s)</h5><a>…</a></li> and the Madara-like variants.
  function info(doc, labels) {
    for (const row of doc.select(".main-info-list li, .post-content_item, .info-item")) {
      const heading = row.selectFirst("h5, .summary-heading, span.sh");
      if (!heading) continue;
      const label = heading.text().replace(/\s*[:-]\s*$/, "");
      if (labels.indexOf(label) === -1) continue;
      const links = row.select("a").map((a) => a.ownText() || a.text()).filter(Boolean);
      const text = row.text().slice(heading.text().length).replace(/^\s*[:-]?\s*/, "");
      return { links, text };
    }
    return null;
  }
  const names = (row) => (row ? (row.links.length ? row.links.join(", ") : row.text) : "");

  let genreCache = null;
  async function filters() {
    if (!genreCache) {
      try {
        const doc = await getDocument(base + "/");
        const seen = new Set();
        genreCache = doc
          .select(".genre-list a, a.item-nav[href*=/genre/], a.item-nav-mb[href*=/genre/]")
          .map((a) => {
            const m = a.absUrl("href").match(/\/genre\/([^/?#]+)/);
            return m ? { value: m[1], label: a.text() } : null;
          })
          .filter((g) => g && g.label && !seen.has(g.value) && seen.add(g.value))
          .sort((x, y) => x.label.localeCompare(y.label));
      } catch (e) {
        // Genres are fetched again next time.
      }
    }
    if (!genreCache || !genreCache.length) return [];
    return [
      { type: "header", name: "Ignored when searching by text" },
      { type: "select", key: "genre", name: "Genre", options: [{ value: "", label: "All" }].concat(genreCache) },
    ];
  }

  return {
    async popular(page) {
      if (!c.popularPath) return latest(page);
      return listing(await getDocument(base + "/" + c.popularPath + "/page/" + page + "/?order=views"));
    },
    latest,
    filters,

    async search(q, page, f) {
      if (q) return listing(await getDocument(base + "/search/?" + query([[c.searchParam, q], ["page", page]])));
      const genre = f && f.genre;
      if (!genre) return latest(page);
      return listing(await getDocument(base + "/genre/" + genre + "/page/" + page + "/"));
    },

    async details(url) {
      const doc = await getDocument(base + url);
      const titleEl = doc.selectFirst("h1.main-info-title, .post-title h1, .manga-detail .info h1");
      if (!titleEl) throw new Error("Manga title not found on " + url);
      const block = doc.selectFirst(".short-desc-content, .dsct, .description-summary");
      let description = "";
      if (block) {
        const parts = block.select("p, li").map((e) => e.text()).filter(Boolean);
        description = parts.length ? parts.join("\n\n") : block.text();
      }
      const alt = info(doc, ["Alternative"]);
      if (alt && alt.text) description += (description ? "\n\n" : "") + "Alternative names: " + alt.text;
      const status = info(doc, ["Status", "Estado"]);
      const genres = info(doc, ["Genres", "Genre(s)", "Géneros"]);
      return {
        title: titleEl.text(),
        cover: imageUrl(doc.selectFirst("img.img-cover, .summary_image img, .manga-detail .poster img")),
        author: names(info(doc, ["Author(s)", "Author", "Autores"])),
        artist: names(info(doc, ["Artist(s)", "Artist", "Artistas"])),
        description,
        genres: genres ? unique(genres.links.length ? genres.links : genres.text.split(",").map((s) => s.trim())) : [],
        status: parseStatus(status ? status.text : ""),
      };
    },

    async chapters(url) {
      const doc = await getDocument(base + url);
      return doc
        .select("ul.chapter-list li, ul.row-content-chapter li, .list-items li.item")
        .map((li) => {
          const a = li.selectFirst("a[href]");
          if (!a) return null;
          const nameEl = li.selectFirst(".chapter-name, .item a > span:first-child");
          const timeEl = li.selectFirst(".ct-update, .chapter-time, .item a > span:nth-child(2)");
          const name = nameEl ? nameEl.text() : a.text();
          return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: timeEl ? yiiDate(timeEl.text()) : null, scanlator: null };
        })
        .filter(Boolean);
    },

    async pages(url) {
      const doc = await getDocument(base + url);
      return doc
        .select(".reading-content img, .read-content img")
        .map((img) => imageUrl(img))
        .filter(Boolean)
        .map((u) => ({ url: u, headers }));
    },
  };
}

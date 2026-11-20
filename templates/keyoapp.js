// Keyoapp theme. Port of keiyoushi lib-multisrc/keyoapp (Apache-2.0).
// layout "v1": Keyoapp (home-page carousels, /series search, #pages > img[uid]).
// layout "v2": KeyoappV2 (?_ajax=search, ?_chapters_html=1, #strip-reader).
// layout "livewire": the Livewire redesign used by ArtLapsa-like sites (/search, immersiveReader x-data).
function Keyoapp(config) {
  const c = Object.assign(
    {
      layout: "v1",
      popularFromSearch: false, // v1: the full /series listing instead of the home-page carousel
      popularSelector: null,
      latestSelector: "div.grid > div.group",
      descriptionSelector: "#expand_content p",
      altNameSelector: "div.font-medium:containsOwn(Alternative titles) ~ div span",
      statusSelector: "div:has(span:containsOwn(Status)) ~ div",
      authorSelector: "div:has(span:containsOwn(Author)) ~ div",
      artistSelector: "div:has(span:containsOwn(Artist)) ~ div",
      genreSelector: "div:has(>h1) a[href*='genre=']",
      typeSelector: "div:has(span:containsOwn(Type)) ~ div",
      paidChapterSelector: "img[alt~=Coin]",
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const headers = { Referer: base + "/" };
  const xhr = { Referer: base + "/", "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };
  const popularSelector =
    c.popularSelector ||
    ["Popular", "Popularie", "Trending"].map((t) => "div:contains(" + t + ") + div .group.overflow-hidden.grid").join(", ");

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return html.parse(res.body, res.url);
  }
  async function getJson(url) {
    const res = ensureOk(await http.get(url, { headers: xhr }));
    return JSON.parse(res.body);
  }

  const isNovel = (el) =>
    el.select('[data-type="novel"], [data-type="Novel"]').length > 0 ||
    el.select("span").some((s) => /^novel$/i.test(s.ownText()));

  // style="background-image: url('…')"
  function styleImage(el, selector) {
    const target = el.selectFirst(selector);
    if (!target) return "";
    const m = target.attr("style").match(/url\(['"]?([^'")]+)/);
    if (!m) return "";
    const url = m[1];
    return /[?&]w=/.test(url) ? url : url + (url.indexOf("?") === -1 ? "?" : "&") + "w=480";
  }

  function v1Card(el) {
    const link = el.selectFirst("a[href]");
    if (!link) return null;
    const cover = c.layout === "livewire" ? imageUrl(el.selectFirst("img[alt$=' cover'], img")) : styleImage(el, "*[style*=background-image]");
    return { url: pathOf(link.absUrl("href")), title: link.attr("title") || link.text(), cover };
  }
  const cards = (doc, selector) => unique(doc.select(selector).filter((el) => !isNovel(el)).map(v1Card).filter(Boolean).map((m) => JSON.stringify(m))).map((s) => JSON.parse(s));

  const SORTS_V2 = [
    { value: "latest", label: "Latest" },
    { value: "trending", label: "Trending" },
    { value: "popular", label: "Popular" },
    { value: "views", label: "Most viewed" },
    { value: "rating", label: "Top rated" },
    { value: "az", label: "A-Z" },
    { value: "za", label: "Z-A" },
  ];
  const TYPES = [
    { value: "", label: "All" },
    { value: "manhwa", label: "Manhwa" },
    { value: "manhua", label: "Manhua" },
    { value: "manga", label: "Manga" },
    { value: "mangatoon", label: "Mangatoon" },
  ];
  const STATUSES = [
    { value: "", label: "All" },
    { value: "ongoing", label: "Ongoing" },
    { value: "completed", label: "Completed" },
  ];

  // ---- v2 ----
  async function v2List(page, q, opts) {
    const pairs = [["_ajax", "search"]];
    if (q && q.trim()) pairs.push(["q", q.trim()]);
    if (opts.sort) pairs.push(["sort", opts.sort]);
    if (opts.type) pairs.push(["type", opts.type]);
    if (opts.status) pairs.push(["status", opts.status]);
    pairs.push(["offset", (page - 1) * 20]);
    const data = await getJson(base + "/?" + query(pairs));
    const doc = html.parse(data.html || "", base + "/");
    const manga = doc
      .select("a.group[href]")
      .filter((el) => !isNovel(el))
      .map((el) => {
        const h2 = el.selectFirst("h2");
        const img = el.selectFirst("img");
        return { url: pathOf(el.absUrl("href")), title: h2 ? h2.text() : el.attr("title"), cover: img ? img.attr("data-src") || imageUrl(img) : "" };
      });
    return { manga, hasNextPage: Boolean(data.has_more) };
  }

  // ---- livewire ----
  async function livewireList(page, pairs) {
    const all = pairs.concat(page > 1 ? [["page", page]] : []);
    const doc = await getDocument(base + "/search" + (all.length ? "?" + query(all) : ""));
    const manga = cards(doc, "main#main-content [wire\\:key*='serie']");
    return { manga, hasNextPage: manga.length >= 20 };
  }

  // ---- v1 ----
  async function v1Search(q, opts) {
    const pairs = [];
    if (q && q.trim()) pairs.push(["q", q.trim()]);
    const doc = await getDocument(base + "/series/" + (pairs.length ? "?" + query(pairs) : ""));
    const needle = String(q || "").trim().toLowerCase();
    const manga = doc
      .select("#searched_series_page > button")
      .filter((el) => !isNovel(el))
      .filter((el) => !needle || el.attr("title").toLowerCase().indexOf(needle) !== -1)
      .filter((el) => !opts.type || el.attr("data-type").toLowerCase() === opts.type)
      .filter((el) => !opts.status || el.attr("data-status").toLowerCase() === opts.status)
      .map(v1Card)
      .filter(Boolean);
    return { manga, hasNextPage: false };
  }

  function keyoDate(text) {
    const t = String(text || "").trim();
    const m = t.match(/(a|an|one|\d+)\s*(\w+)\s+ago/i);
    if (m) {
      const n = /^\d/.test(m[1]) ? Number(m[1]) : 1;
      const u = m[2].toLowerCase();
      const unit = /^mo/.test(u) ? "month" : /^m/.test(u) ? "minute" : /^h/.test(u) ? "hour" : /^d/.test(u) ? "day" : /^w/.test(u) ? "week" : /^y/.test(u) ? "year" : null;
      return unit ? parseDate(n + " " + unit + " ago") : null;
    }
    return parseDate(t.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
  }

  function filters() {
    if (c.layout === "v2") {
      return [
        { type: "select", key: "sort", name: "Sort", options: SORTS_V2 },
        { type: "select", key: "type", name: "Type", options: TYPES },
        { type: "select", key: "status", name: "Status", options: STATUSES },
      ];
    }
    if (c.layout === "livewire") return [];
    return [
      { type: "select", key: "type", name: "Type", options: TYPES },
      { type: "select", key: "status", name: "Status", options: STATUSES },
    ];
  }

  const textOf = (doc, sel) => {
    const el = doc.selectFirst(sel);
    return el ? el.text().trim() : "";
  };
  const STATUS = { ongoing: "ongoing", dropped: "cancelled", paused: "hiatus", hiatus: "hiatus", completed: "completed" };

  function v1Details(doc) {
    const titleEl = doc.selectFirst("div.grid > h1") || doc.selectFirst("h1");
    if (!titleEl) throw new Error("Series title not found");
    let cover = c.layout === "livewire" ? imageUrl(doc.selectFirst("img[alt$=' cover']")) : styleImage(doc, "div[class*=photoURL], div[style*=photoURL]");
    if (!cover) {
      const og = doc.selectFirst("meta[property=og:image]");
      cover = og ? og.attr("content") : "";
    }
    const type = textOf(doc, c.typeSelector);
    const genres = doc.select(c.genreSelector).map((a) => a.text().replace(/^[,\s]+|[,\s]+$/g, ""));
    const alt = doc.select(c.altNameSelector).map((e) => e.text()).filter((t) => t && t !== "No alternative titles.");
    let description = textOf(doc, c.descriptionSelector);
    if (alt.length) description = (description + "\n\nAlternative names:\n" + alt.map((a) => "- " + a).join("\n")).trim();
    return {
      title: titleEl.text(),
      cover,
      author: textOf(doc, c.authorSelector),
      artist: textOf(doc, c.artistSelector),
      description,
      genres: unique([type ? type.charAt(0).toUpperCase() + type.slice(1) : ""].concat(genres)),
      status: STATUS[textOf(doc, c.statusSelector).toLowerCase()] || "unknown",
    };
  }

  function v2Details(doc) {
    const titleEl = doc.selectFirst("h1");
    if (!titleEl) throw new Error("Series title not found");
    const desc = doc.selectFirst("#series-desc");
    const og = doc.selectFirst("meta[property=og:image]");
    let author = "";
    let artist = "";
    const by = doc.selectFirst("p.l2-by");
    if (by) {
      const parts = by.text().replace(/^By\s+/, "").split(",");
      author = parts[0].trim();
      artist = parts.slice(1).join(",").trim();
    }
    const statusEl = doc.selectFirst("div.text-xs:containsOwn(Status) + div span.text-sm");
    let status = STATUS[statusEl ? statusEl.text().trim().toLowerCase() : ""] || "unknown";
    const kicker = doc.selectFirst("p.l2-kicker") || doc.selectFirst("div.l2-meta span");
    if (status === "unknown" && kicker) status = parseStatus(kicker.text());
    return {
      title: titleEl.text(),
      cover: og ? og.attr("content") : "",
      author,
      artist,
      description: desc ? desc.text() : "",
      genres: unique(doc.select('a[href*="?browse&tag"]').map((a) => a.text())),
      status,
    };
  }

  function v1Chapters(doc) {
    return doc
      .select("#chapters > a, #chapters > div")
      .filter((el) => !el.select(".text-sm span").some((s) => /Upcoming/.test(s.text())))
      .filter((el) => el.select(c.paidChapterSelector).length === 0)
      .map((el) => {
        const a = el.tagName() === "a" ? el : el.selectFirst("a[href]");
        if (!a) return null;
        const nameEl = el.selectFirst(".text-sm");
        const name = nameEl ? nameEl.text() : a.text();
        const dateEl = el.selectFirst(".text-xs");
        return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: dateEl ? keyoDate(dateEl.text()) : null, scanlator: null };
      })
      .filter(Boolean);
  }

  async function v2Chapters(url) {
    const slug = pathOf(url).split("/").filter(Boolean)[0];
    const data = await getJson(base + "/?" + query([["_chapters_html", "1"], ["series_slug", slug]]));
    const doc = html.parse(data.rows_html || "", base + "/");
    return doc
      .select("a.chapter-row[href]")
      .filter((el) => el.attr("data-ch-locked") !== "1")
      .map((el) => {
        const name = el.attr("data-ch-label") || el.text();
        const dateEl = el.selectFirst(".ch-date-row span:last-child");
        return { url: pathOf(el.absUrl("href")), name, number: chapterNumber(name), date: dateEl ? keyoDate(dateEl.text()) : null, scanlator: null };
      });
  }

  function v1Pages(doc) {
    const imgHeaders = { Referer: base + "/" };
    if (c.layout === "livewire") {
      const holder = doc.selectFirst("[x-data^=immersiveReader]");
      const xData = holder ? holder.attr("x-data") : "";
      const start = xData.indexOf("JSON.parse('");
      if (start === -1) throw new Error("This chapter must be purchased on the site");
      const raw = xData.slice(start + 12, xData.indexOf("')", start));
      const decoded = JSON.parse('"' + raw.replace(/"/g, '\\"') + '"');
      return JSON.parse(decoded).map((p) => ({ url: p.path, headers: imgHeaders }));
    }
    const script = doc.select("script").map((s) => s.data()).filter((d) => /realUrl\s*=\s*`/.test(d))[0];
    let cdn = null;
    if (script) {
      const m = script.match(/realUrl\s*=\s*`[^`]+\/\/([^/]+)/);
      if (m) cdn = "https://" + m[1].replace(/\$\{[^}]*\}/g, "") + "/uploads";
    }
    const uids = doc.select("#pages > img").map((img) => img.attr("uid")).filter(Boolean);
    if (uids.length) {
      if (!cdn) throw new Error("Page image host not found");
      return uids.map((uid) => ({ url: cdn + "/" + uid, headers: imgHeaders }));
    }
    return doc
      .select("#pages > img")
      .map((img) => imageUrl(img))
      .filter((u) => /^(https?:)?\/\/cdn\d*\.keyoapp\.com/.test(u))
      .map((u) => ({ url: u, headers: imgHeaders }));
  }

  return {
    async popular(page) {
      if (c.layout === "v2") return v2List(page, "", { sort: "popular" });
      if (c.layout === "livewire") return livewireList(page, [["sort", "popular"]]);
      if (c.popularFromSearch) return v1Search("", {});
      return { manga: cards(await getDocument(base + "/"), popularSelector), hasNextPage: false };
    },
    async latest(page) {
      if (c.layout === "v2") return v2List(page, "", { sort: "latest" });
      if (c.layout === "livewire") {
        const doc = await getDocument(base + "/latest" + (page > 1 ? "?page=" + page : ""));
        return { manga: cards(doc, c.latestSelector), hasNextPage: Boolean(doc.selectFirst("a[href*='?page=" + (page + 1) + "']")) };
      }
      return { manga: cards(await getDocument(base + "/latest/"), c.latestSelector), hasNextPage: false };
    },
    async search(q, page, f) {
      const opts = f || {};
      if (c.layout === "v2") return v2List(page, q, opts);
      if (c.layout === "livewire") return livewireList(page, q && q.trim() ? [["title", q.trim()]] : []);
      if (page > 1) return { manga: [], hasNextPage: false };
      return v1Search(q, opts);
    },
    filters,

    async details(url) {
      const doc = await getDocument(base + url);
      return c.layout === "v2" ? v2Details(doc) : v1Details(doc);
    },

    async chapters(url) {
      if (c.layout === "v2") return v2Chapters(url);
      return v1Chapters(await getDocument(base + url));
    },

    async pages(url) {
      const doc = await getDocument(base + url);
      if (c.layout === "v2") {
        return doc.select("#strip-reader img.reader-page").map((img) => ({ url: imageUrl(img), headers: { Referer: base + "/" } }));
      }
      return v1Pages(doc);
    },
  };
}

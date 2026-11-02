// MangaTown. Port of keiyoushi src/en/mangatown (Apache-2.0).
// A phone user agent gets a different mobile layout, so pages are requested as a desktop browser.
const BASE = META.baseUrl;
const HEADERS = {
  Referer: BASE + "/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  const manga = doc
    .select("li:has(a.manga_cover)")
    .map((li) => {
      const link = li.selectFirst("p.title a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(li.selectFirst("img")) };
    })
    .filter(Boolean);
  const next = doc.selectFirst("div.next-page a.next:not([href^=javascript]), .page-nav a:contains(next):not([href^=javascript])");
  return { manga, hasNextPage: Boolean(next) };
}

// "Oct 30,2026", "Today", "Yesterday"
function townDate(text) {
  const t = String(text || "").trim();
  if (/today/i.test(t)) return Date.now();
  if (/yesterday/i.test(t)) return Date.now() - 86400000;
  const m = t.match(/([A-Za-z]{3,})\.?\s*(\d{1,2}),\s*(\d{4})/);
  return m ? parseDate(m[1] + " " + m[2] + ", " + m[3]) : null;
}

const viewerImage = (doc) => imageUrl(doc.selectFirst("div#viewer img"));

source = {
  popular: async (page) => listing(await getDocument(BASE + "/directory/0-0-0-0-0-0/" + page + ".htm")),
  latest: async (page) => listing(await getDocument(BASE + "/latest/" + page + ".htm")),
  search: async (q, page) => listing(await getDocument(BASE + "/search?" + query([["page", page], ["name", q]]))),

  async details(url) {
    const doc = await getDocument(BASE + url);
    const info = doc.selectFirst("div.article_content");
    const titleEl = info ? info.selectFirst("h1") : null;
    if (!titleEl) throw new Error("Manga title not found on " + url);
    const names = (label) => info.select("li:has(b:containsOwn(" + label + ")) a").map((a) => a.text()).join(", ");
    const statusEl = info.selectFirst("li:has(b:containsOwn(status))");
    const desc = doc.selectFirst("span#show");
    return {
      title: titleEl.text(),
      cover: imageUrl(doc.selectFirst("div.detail_info img")),
      author: names("author"),
      artist: names("artist"),
      description: desc ? desc.text().replace(/HIDE$/, "").trim() : "",
      genres: unique(info.select("li:has(b:containsOwn(genre)) a").map((a) => a.text())),
      status: parseStatus(statusEl ? statusEl.text().replace(/^[^:]*:/, "") : ""),
    };
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("ul.chapter_list li").map((li) => {
      const a = li.selectFirst("a");
      const extra = li.select("span:not(.time):not(.new)").map((s) => s.text()).join(" ");
      const name = (a.text() + " " + extra).trim();
      const time = li.selectFirst("span.time");
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(a.text()), date: time ? townDate(time.text()) : null, scanlator: null };
    });
  },

  // One HTML page per image; the page selector lists them all, so they are fetched in parallel.
  async pages(url) {
    const doc = await getDocument(BASE + url);
    const options = doc
      .select("select#top_chapter_list ~ div.page_select option")
      .filter((o) => !/featured/i.test(o.text()))
      .map((o) => o.absUrl("value"))
      .filter((u, i, all) => u && all.indexOf(u) === i);
    let urls;
    if (options.length) {
      urls = await Promise.all(
        options.map(async (pageUrl, i) => (i === 0 && pathOf(pageUrl) === pathOf(BASE + url) ? viewerImage(doc) : viewerImage(await getDocument(pageUrl)))),
      );
    } else {
      urls = doc.select("div#viewer img").map((img) => imageUrl(img));
    }
    return urls.filter(Boolean).map((u) => ({ url: u, headers: { Referer: BASE + "/" } }));
  },
};

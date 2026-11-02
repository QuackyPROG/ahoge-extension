// MangaKatana. Port of keiyoushi src/en/mangakatana (Apache-2.0).
const BASE = META.baseUrl;
const HEADERS = { Referer: BASE + "/" };

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function bookList(doc) {
  const manga = doc
    .select("div#book_list > div.item")
    .map((el) => {
      const link = el.selectFirst("div.text > h3 > a");
      if (!link) return null;
      return { url: pathOf(link.absUrl("href")), title: link.ownText() || link.text(), cover: imageUrl(el.selectFirst("img")) };
    })
    .filter(Boolean);
  return { manga, hasNextPage: Boolean(doc.selectFirst("a.next.page-numbers")) };
}

const SORTS = [
  { value: "latest", label: "Latest update" },
  { value: "new", label: "New manga" },
  { value: "az", label: "A-Z" },
  { value: "numc", label: "Number of chapters" },
];
const STATUSES = [
  { value: "", label: "All" },
  { value: "1", label: "Ongoing" },
  { value: "2", label: "Completed" },
  { value: "0", label: "Cancelled" },
];

function filters() {
  return [
    { type: "select", key: "order", name: "Sort", options: SORTS },
    { type: "select", key: "status", name: "Status", options: STATUSES },
  ];
}

// "Oct-30-2026"
function katanaDate(text) {
  const m = String(text || "").match(/([A-Za-z]{3})-(\d{1,2})-(\d{4})/);
  return m ? parseDate(m[1] + " " + m[2] + ", " + m[3]) : parseDate(text);
}

function detailsFrom(doc) {
  const titleEl = doc.selectFirst("h1.heading");
  if (!titleEl) return null;
  let description = doc.select(".summary > p").map((p) => p.text()).join("\n\n");
  const alt = doc.selectFirst(".alt_name");
  if (alt && alt.text()) description += "\n\nAlt name(s): " + alt.text();
  const statusEl = doc.selectFirst(".value.status");
  return {
    title: titleEl.text(),
    cover: imageUrl(doc.selectFirst("div.media div.cover img")),
    author: doc.select(".author").map((a) => a.text()).join(", "),
    artist: "",
    description: description.trim(),
    genres: unique(doc.select(".genres > a").map((a) => a.text())),
    status: parseStatus(statusEl ? statusEl.text() : ""),
  };
}

source = {
  popular: async (page) => bookList(await getDocument(BASE + "/manga/page/" + page + "?" + query([["filter", "1"], ["order", "numc"]]))),
  latest: async (page) => bookList(await getDocument(BASE + "/page/" + page)),
  filters,

  async search(q, page, f) {
    const opts = f || {};
    if (q) {
      const doc = await getDocument(BASE + "/page/" + page + "?" + query([["search", q], ["search_by", "book_name"]]));
      // A single match redirects straight to the manga page.
      const single = detailsFrom(doc);
      if (single && !doc.selectFirst("div#book_list")) {
        const canonical = doc.selectFirst("link[rel=canonical]");
        const url = canonical ? pathOf(canonical.absUrl("href")) : "";
        return { manga: url ? [{ url, title: single.title, cover: single.cover }] : [], hasNextPage: false };
      }
      return bookList(doc);
    }
    const pairs = [["filter", "1"], ["order", opts.order || "latest"]];
    if (opts.status) pairs.push(["status", opts.status]);
    return bookList(await getDocument(BASE + "/manga/page/" + page + "?" + query(pairs)));
  },

  async details(url) {
    const details = detailsFrom(await getDocument(BASE + url));
    if (!details) throw new Error("Manga title not found on " + url);
    return details;
  },

  async chapters(url) {
    const doc = await getDocument(BASE + url);
    return doc.select("tr:has(.chapter)").map((row) => {
      const a = row.selectFirst("a");
      const time = row.selectFirst(".update_time");
      const name = a.text();
      return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: time ? katanaDate(time.text()) : null, scanlator: null };
    });
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    const script = doc.select("script").map((s) => s.data()).filter((d) => d.indexOf("data-src") !== -1)[0];
    if (!script) throw new Error("Page list not found on " + url);
    const name = (script.match(/data-src['"],\s*(\w+)/) || [])[1];
    const start = name ? script.indexOf("var " + name + "=[") : -1;
    const array = start === -1 ? null : [null, script.slice(start + name.length + 6, script.indexOf("]", start))];
    if (!array) throw new Error("Page list not found on " + url);
    const urls = [];
    array[1].replace(/'([^']*)'/g, (_, u) => urls.push(u));
    return urls.filter(Boolean).map((u) => ({ url: u, headers: HEADERS }));
  },
};

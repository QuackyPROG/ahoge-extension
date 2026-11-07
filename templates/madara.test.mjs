import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "../runtime/host.mjs";
import { validateFilters, defaultFilterValues } from "../runtime/filters.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

function makeSource(config, routes, calls = []) {
  const script = [
    "var source = null;",
    read("./_common.js"),
    read("./madara.js"),
    `source = Madara(${JSON.stringify(config)});`,
  ].join("\n");
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body == null ? "" : typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body) });
    const hit = Object.entries(routes).find(([k]) => url === k);
    if (!hit) return new Response("missing " + url, { status: 404 });
    return new Response(hit[1], { status: 200, headers: { "content-type": "text/html" } });
  };
  return loadSource(script, { fetchImpl });
}

const BASE = "https://madara.test";
const ARCHIVE = `
<div class="page-item-detail manga"><div class="item-thumb" data-post-id="1">
  <a href="${BASE}/manga/alpha/"><img data-src="${BASE}/wp-content/a.jpg" src="data:image/gif;base64,R0"></a></div>
  <div class="post-title"><h3><a href="${BASE}/manga/alpha/">Alpha</a></h3></div></div>
<div class="page-item-detail manga"><div class="item-thumb" data-post-id="2">
  <a href="${BASE}/manga/beta/"><img src="${BASE}/wp-content/b.jpg"></a></div>
  <div class="post-title"><h3><a href="${BASE}/manga/beta/">Beta</a></h3></div></div>`;

const DETAILS = `
<div class="post-title"><h1>Alpha <span class="manga-title-badges hot">HOT</span></h1></div>
<div class="summary_image"><img data-src="${BASE}/wp-content/a-full.jpg"></div>
<div class="author-content"><a>Author A</a></div>
<div class="artist-content"><a>Updating</a></div>
<div class="genres-content"><a href="${BASE}/manga-genre/action/">Action</a><a href="${BASE}/manga-genre/drama/">Drama</a></div>
<div class="post-content_item"><div class="summary-heading">Status</div><div class="summary-content">OnGoing</div></div>
<div class="description-summary"><div class="summary__content"><p>First.</p><p>Second.</p></div></div>
<div id="manga-chapters-holder" data-id="1"></div>`;

const CHAPTERS = `
<ul><li class="wp-manga-chapter"><a href="${BASE}/manga/alpha/chapter-2/">Chapter 2</a><span class="chapter-release-date"><i>January 5, 2024</i></span></li>
<li class="wp-manga-chapter"><a href="${BASE}/manga/alpha/chapter-1/">Chapter 1</a><span class="chapter-release-date"><i>January 1, 2024</i></span></li></ul>`;

const READER = `<div class="reading-content">
  <div class="page-break"><img data-src=" ${BASE}/wp-content/p1.jpg "></div>
  <div class="page-break"><img src="${BASE}/wp-content/p2.jpg"></div></div>`;

test("popular posts madara_load_more sorted by views", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/wp-admin/admin-ajax.php`]: ARCHIVE }, calls);
  const result = await src.popular(1);
  assert.deepEqual(result.manga, [
    { url: "/manga/alpha/", title: "Alpha", cover: `${BASE}/wp-content/a.jpg` },
    { url: "/manga/beta/", title: "Beta", cover: `${BASE}/wp-content/b.jpg` },
  ]);
  assert.equal(result.hasNextPage, true);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].body, /action=madara_load_more/);
  assert.match(calls[0].body, /page=0/);
  assert.match(calls[0].body, /vars%5Bmeta_key%5D=_wp_manga_views/);
  assert.match(calls[0].body, /_wp_manga_chapter_type/);
});

test("latest sorts by _latest_update and respects filterNonMangaItems=false", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE, filterNonMangaItems: false }, { [`${BASE}/wp-admin/admin-ajax.php`]: ARCHIVE }, calls);
  await src.latest(3);
  assert.match(calls[0].body, /page=2/);
  assert.match(calls[0].body, /_latest_update/);
  assert.doesNotMatch(calls[0].body, /_wp_manga_chapter_type/);
});

test("search sends vars[s]", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/wp-admin/admin-ajax.php`]: ARCHIVE }, calls);
  await src.search("one piece", 1);
  assert.match(calls[0].body, /vars%5Bs%5D=one%20piece/);
});

test("details parses metadata", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/`]: DETAILS });
  assert.deepEqual(await src.details("/manga/alpha/"), {
    title: "Alpha",
    cover: `${BASE}/wp-content/a-full.jpg`,
    author: "Author A",
    artist: "",
    description: "First.\n\nSecond.",
    genres: ["Action", "Drama"],
    status: "ongoing",
  });
});

test("chapters via mangaAjax", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/ajax/chapters/`]: CHAPTERS });
  const chapters = await src.chapters("/manga/alpha/");
  assert.deepEqual(chapters, [
    { url: "/manga/alpha/chapter-2/", name: "Chapter 2", number: 2, date: Date.UTC(2024, 0, 5), scanlator: null },
    { url: "/manga/alpha/chapter-1/", name: "Chapter 1", number: 1, date: Date.UTC(2024, 0, 1), scanlator: null },
  ]);
});

test("chapters via mangaPage", async () => {
  const src = makeSource({ baseUrl: BASE, chapterMode: "mangaPage" }, { [`${BASE}/manga/alpha/`]: DETAILS + CHAPTERS });
  assert.equal((await src.chapters("/manga/alpha/")).length, 2);
});

test("pages default selector with referer", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/chapter-1/`]: READER });
  assert.deepEqual(await src.pages("/manga/alpha/chapter-1/"), [
    { url: `${BASE}/wp-content/p1.jpg`, headers: { Referer: `${BASE}/` } },
    { url: `${BASE}/wp-content/p2.jpg`, headers: { Referer: `${BASE}/` } },
  ]);
});

test("pages custom selector matching img directly", async () => {
  const html = `<div class="read-container"><img src="${BASE}/a.jpg"><img src="${BASE}/b.jpg"></div>`;
  const src = makeSource({ baseUrl: BASE, pageSelector: ".read-container img" }, { [`${BASE}/c/1/`]: html });
  assert.equal((await src.pages("/c/1/")).length, 2);
});

test("protected chapters raise a clear error", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/c/1/`]: `<script id="chapter-protector-data">x</script>` });
  await assert.rejects(src.pages("/c/1/"), /protected/i);
});

const AJAX = `${BASE}/wp-admin/admin-ajax.php`;

test("hasNextPage is true for a full page even when the count differs from pageSize", async () => {
  const cards = Array.from(
    { length: 30 },
    (_, i) => `<div class="page-item-detail"><div class="post-title"><h3><a href="${BASE}/manga/m${i}/">M${i}</a></h3></div></div>`,
  ).join("");
  const src = makeSource({ baseUrl: BASE }, { [AJAX]: cards });
  const result = await src.popular(1);
  assert.equal(result.manga.length, 30);
  assert.equal(result.hasNextPage, true);
});

test("hasNextPage is false for an empty result or a .no-posts marker", async () => {
  const empty = makeSource({ baseUrl: BASE }, { [AJAX]: "" });
  assert.equal((await empty.popular(1)).hasNextPage, false);
  const marked = makeSource({ baseUrl: BASE }, { [AJAX]: ARCHIVE + `<div class="no-posts">No more</div>` });
  const result = await marked.popular(1);
  assert.equal(result.manga.length, 2);
  assert.equal(result.hasNextPage, false);
});

test("archive link falls back to h3 a, h5 a, then any a[href]", async () => {
  const html =
    `<div class="page-item-detail"><h3><a href="${BASE}/manga/x/">X</a></h3></div>` +
    `<div class="page-item-detail"><h5><a href="${BASE}/manga/y/">Y</a></h5></div>` +
    `<div class="page-item-detail"><span><a href="${BASE}/manga/z/">Z</a></span></div>`;
  const src = makeSource({ baseUrl: BASE }, { [AJAX]: html });
  const result = await src.popular(1);
  assert.deepEqual(
    result.manga.map((m) => [m.url, m.title]),
    [["/manga/x/", "X"], ["/manga/y/", "Y"], ["/manga/z/", "Z"]],
  );
});

test("archive results are deduped by url in order when cards are nested", async () => {
  const html =
    `<div class="c-tabs-item__content"><div class="page-item-detail"><div class="post-title"><h3><a href="${BASE}/manga/a/">A</a></h3></div></div></div>` +
    `<div class="page-item-detail"><div class="post-title"><h3><a href="${BASE}/manga/b/">B</a></h3></div></div>`;
  const src = makeSource({ baseUrl: BASE }, { [AJAX]: html });
  const result = await src.popular(1);
  assert.deepEqual(result.manga.map((m) => m.url), ["/manga/a/", "/manga/b/"]);
});

test("chapter date skips a non-date img alt and uses the next candidate", async () => {
  const html = `<ul><li class="wp-manga-chapter"><a href="${BASE}/manga/alpha/chapter-3/">Chapter 3</a><img alt="New"><span class="chapter-release-date"><a title="3 hours ago">3 hours ago</a></span></li></ul>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/ajax/chapters/`]: html });
  const before = Date.now();
  const [chapter] = await src.chapters("/manga/alpha/");
  assert.notEqual(chapter.date, null);
  assert.ok(Math.abs(chapter.date - (before - 3 * 3600000)) < 60000);
});

test("chapter date falls back to the chapterDateSelector text", async () => {
  const html = `<ul><li class="wp-manga-chapter"><a href="${BASE}/manga/alpha/chapter-3/">Chapter 3</a><img alt="New"><span class="chapter-release-date"><i>January 5, 2024</i></span></li></ul>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/ajax/chapters/`]: html });
  const [chapter] = await src.chapters("/manga/alpha/");
  assert.equal(chapter.date, Date.UTC(2024, 0, 5));
});

test("chapter name ignores badge spans inside the link", async () => {
  const html = `<ul><li class="wp-manga-chapter"><a href="${BASE}/manga/alpha/chapter-3/">Chapter 3 <span class="badge">NEW</span></a></li></ul>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/ajax/chapters/`]: html });
  const [chapter] = await src.chapters("/manga/alpha/");
  assert.equal(chapter.name, "Chapter 3");
  assert.equal(chapter.number, 3);
});

test("adminAjax prefers the #manga-chapters-holder id over a decoy data-post-id", async () => {
  const calls = [];
  const page = `<div class="item-thumb" data-post-id="999"></div><div id="manga-chapters-holder" data-id="42"></div>`;
  const src = makeSource({ baseUrl: BASE, chapterMode: "adminAjax" }, { [`${BASE}/manga/alpha/`]: page, [AJAX]: CHAPTERS }, calls);
  assert.equal((await src.chapters("/manga/alpha/")).length, 2);
  const post = calls.find((c) => c.method === "POST");
  assert.match(post.body, /manga=42(&|$)/);
  assert.doesNotMatch(post.body, /999/);
});

test("adminAjax falls back to [data-post-id]", async () => {
  const calls = [];
  const src = makeSource(
    { baseUrl: BASE, chapterMode: "adminAjax" },
    { [`${BASE}/manga/alpha/`]: `<div data-post-id="7"></div>`, [AJAX]: CHAPTERS },
    calls,
  );
  await src.chapters("/manga/alpha/");
  assert.match(calls.find((c) => c.method === "POST").body, /manga=7(&|$)/);
});

test("pages are deduped by url in order when selectors match nested elements", async () => {
  const html = `<div class="reading-content"><div class="text-left"><div class="page-break"><img src="${BASE}/p1.jpg"></div><div class="page-break"><img src="${BASE}/p2.jpg"></div></div></div>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/c/1/`]: html });
  assert.deepEqual((await src.pages("/c/1/")).map((p) => p.url), [`${BASE}/p1.jpg`, `${BASE}/p2.jpg`]);
  const direct = makeSource({ baseUrl: BASE, pageSelector: ".text-left > .page-break > img" }, { [`${BASE}/c/1/`]: html });
  assert.deepEqual((await direct.pages("/c/1/")).map((p) => p.url), [`${BASE}/p1.jpg`, `${BASE}/p2.jpg`]);
});

test("single-pager reload does not append a second style= parameter", async () => {
  const calls = [];
  const src = makeSource(
    { baseUrl: BASE },
    {
      [`${BASE}/c/1/?style=paged`]: `<div id="single-pager"></div>`,
      [`${BASE}/c/1/?style=list`]: READER,
      [`${BASE}/c/1/`]: `<div id="single-pager"></div>`,
    },
    calls,
  );
  assert.equal((await src.pages("/c/1/?style=paged")).length, 2);
  assert.ok(calls.every((c) => (c.url.match(/style=/g) || []).length <= 1));
  assert.equal((await src.pages("/c/1/")).length, 2);
  assert.equal(calls[calls.length - 1].url, `${BASE}/c/1/?style=list`);
});

const SEARCH_FORM = `
<div class="checkbox"><input id="action" value="action" name="genre[]" type="checkbox" /><label for="action"> Action </label></div>
<div class="checkbox"><input id="drama" value="drama" name="genre[]" type="checkbox" /><label for="drama"> Drama </label></div>
<div class="checkbox-inline"><input id="on-going" type="checkbox" name="status[]" value="on-going" /><label for="on-going">OnGoing</label></div>
<div class="checkbox-inline"><input id="end" type="checkbox" name="status[]" value="end" /><label for="end">Completed</label></div>`;

test("filters read genres and statuses from the search form", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/?s=&post_type=wp-manga`]: SEARCH_FORM }, calls);
  const list = await src.filters();
  await src.filters();
  assert.equal(calls.length, 1, "cached after the first load");
  assert.deepEqual(list.find((f) => f.key === "genres").filters, [
    { type: "checkbox", key: "action", name: "Action" },
    { type: "checkbox", key: "drama", name: "Drama" },
  ]);
  assert.deepEqual(list.find((f) => f.key === "status").filters.map((f) => f.name), ["OnGoing", "Completed"]);
  assert.deepEqual(validateFilters(list), []);
});

test("filters fall back to fixed statuses and no genres when the form fails", async () => {
  const src = makeSource({ baseUrl: BASE }, {});
  const list = await src.filters();
  assert.equal(list.find((f) => f.key === "genres"), undefined);
  assert.deepEqual(list.find((f) => f.key === "status").filters.map((f) => f.key), ["on-going", "end", "canceled", "on-hold"]);
  assert.deepEqual(validateFilters(list), []);
});

test("default filters keep the admin-ajax search", async () => {
  const calls = [];
  const routes = { [`${BASE}/?s=&post_type=wp-manga`]: SEARCH_FORM, [`${BASE}/wp-admin/admin-ajax.php`]: ARCHIVE };
  const src = makeSource({ baseUrl: BASE }, routes, calls);
  await src.search("one", 1, defaultFilterValues(await src.filters()));
  assert.equal(calls.at(-1).method, "POST");
  assert.match(calls.at(-1).body, /vars%5Bs%5D=one/);
});

test("filtered search uses the advanced search page", async () => {
  const calls = [];
  const url =
    `${BASE}/page/2/?s=&post_type=wp-manga&genre[]=action&genre[]=drama&op=1&author=Kim&release=2020&adult=0` +
    "&status[]=end&m_orderby=views";
  const src = makeSource({ baseUrl: BASE }, { [url]: ARCHIVE + `<a class="nextpostslink" href="${BASE}/page/3/">next</a>` }, calls);
  const result = await src.search("", 2, {
    genres: { action: true, drama: true },
    genreMode: "1",
    author: "Kim",
    artist: "",
    year: "2020",
    adult: "0",
    status: { "on-going": false, end: true },
    orderby: "views",
  });
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].method, "GET");
  assert.deepEqual(result.manga.map((m) => m.title), ["Alpha", "Beta"]);
  assert.equal(result.hasNextPage, true);
});

test("archivePath lists popular and latest from the paged archive instead of admin-ajax", async () => {
  const calls = [];
  const src = makeSource(
    { baseUrl: BASE, archivePath: "serie" },
    {
      [`${BASE}/serie/?m_orderby=views`]: ARCHIVE + `<a class="nextpostslink" href="${BASE}/serie/page/2/">next</a>`,
      [`${BASE}/serie/page/2/?m_orderby=latest`]: ARCHIVE,
    },
    calls,
  );
  const popular = await src.popular(1);
  assert.deepEqual(popular.manga.map((m) => m.url), ["/manga/alpha/", "/manga/beta/"]);
  assert.equal(popular.hasNextPage, true);
  const latest = await src.latest(2);
  assert.equal(latest.hasNextPage, false);
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET"]);
});

test("archivePath sends a plain text search to the search page", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE, archivePath: "serie" }, { [`${BASE}/?s=alpha&post_type=wp-manga`]: ARCHIVE }, calls);
  const result = await src.search("alpha", 1);
  assert.equal(calls[0].method, "GET");
  assert.deepEqual(result.manga.map((m) => m.title), ["Alpha", "Beta"]);
});

test("pages upgrade http image links to https on an https site", async () => {
  const reader = `<div class="reading-content"><div class="page-break"><img src="http://cdn.madara.test/p1.jpg"></div></div>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/chapter-1/`]: reader });
  assert.deepEqual((await src.pages("/manga/alpha/chapter-1/")).map((p) => p.url), ["https://cdn.madara.test/p1.jpg"]);
});

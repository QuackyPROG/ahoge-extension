import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "../runtime/host.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

function makeSource(config, routes, calls = []) {
  const script = [
    "var source = null;",
    read("./_common.js"),
    read("./madara.js"),
    `source = Madara(${JSON.stringify(config)});`,
  ].join("\n");
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ?? "" });
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
  assert.equal(result.hasNextPage, false);
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "../runtime/host.mjs";
import { validateFilters } from "../runtime/filters.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

function makeSource(config, routes, calls = []) {
  const script = ["var source = null;", read("./_common.js"), read("./yiimanga.js"), `source = Yiimanga(${JSON.stringify(config)});`].join("\n");
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    if (!(url in routes)) return new Response("missing " + url, { status: 404 });
    return new Response(routes[url], { status: 200, headers: { "content-type": "text/html" } });
  };
  return loadSource(script, { fetchImpl });
}

const BASE = "https://yii.test";
const LIST = `
<div class="latest-list">
  <div class="latest-item"><div class="latest-left"><img src="/uploads/a.jpg"></div>
    <div class="latest-right"><a href="/manhwa/alpha/"><h4>Alpha</h4></a></div></div>
  <div class="latest-item"><div class="latest-left"><img src="/uploads/b.jpg"></div>
    <div class="latest-right"><a href="/manhwa/beta/"><h3>Beta</h3></a></div></div>
</div>
<ul id="pagination"><li class="next"><a href="/page/2/">Next</a></li></ul>`;

const DETAILS = `
<h1 class="main-info-title">Alpha</h1>
<img class="img-cover" src="/uploads/a-full.jpg">
<ul class="main-info-list">
  <li><h5>Alternative</h5><h4>Alpha Alt</h4></li>
  <li><h5>Author(s)</h5><a href="/author/x">Writer</a></li>
  <li><h5>Artist(s)</h5><a href="/artist/y">Drawer</a></li>
  <li><h5>Genres</h5><a href="/genre/action/">Action</a><a href="/genre/drama/">Drama</a></li>
  <li><h5>Status</h5><span>Ongoing</span></li>
</ul>
<div class="short-desc-content"><p>First.</p><p>Second.</p></div>
<ul class="chapter-list">
  <li><a href="/manhwa/alpha/chapter-2/"><span class="chapter-name">Chapter 2</span></a><span class="ct-update">06 Oct 2026</span></li>
  <li><a href="/manhwa/alpha/chapter-1/"><span class="chapter-name">Chapter 1</span></a><span class="ct-update">Sep 26</span></li>
</ul>`;

test("latest parses list cards and the next page link", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/page/1/`]: LIST });
  const result = await src.latest(1);
  assert.deepEqual(result.manga, [
    { url: "/manhwa/alpha/", title: "Alpha", cover: `${BASE}/uploads/a.jpg` },
    { url: "/manhwa/beta/", title: "Beta", cover: `${BASE}/uploads/b.jpg` },
  ]);
  assert.equal(result.hasNextPage, true);
});

test("popular sorts the catalogue by views when popularPath is set, else falls back to latest", async () => {
  const calls = [];
  const sorted = makeSource({ baseUrl: BASE, popularPath: "manga-lists" }, { [`${BASE}/manga-lists/page/2/?order=views`]: LIST }, calls);
  assert.equal((await sorted.popular(2)).manga.length, 2);
  const plain = makeSource({ baseUrl: BASE }, { [`${BASE}/page/1/`]: LIST }, calls);
  assert.equal((await plain.popular(1)).manga.length, 2);
  assert.deepEqual(calls.map((c) => c.url), [`${BASE}/manga-lists/page/2/?order=views`, `${BASE}/page/1/`]);
});

test("text search uses /search/ and a genre browse uses /genre/", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/search/?s=alpha&page=1`]: LIST, [`${BASE}/genre/action/page/2/`]: LIST }, calls);
  await src.search("alpha", 1, { genre: "" });
  await src.search("", 2, { genre: "action" });
  assert.deepEqual(calls.map((c) => c.url), [`${BASE}/search/?s=alpha&page=1`, `${BASE}/genre/action/page/2/`]);
});

test("details reads the labelled info rows", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manhwa/alpha/`]: DETAILS });
  assert.deepEqual(await src.details("/manhwa/alpha/"), {
    title: "Alpha",
    cover: `${BASE}/uploads/a-full.jpg`,
    author: "Writer",
    artist: "Drawer",
    description: "First.\n\nSecond.\n\nAlternative names: Alpha Alt",
    genres: ["Action", "Drama"],
    status: "ongoing",
  });
});

test("chapters parse full and month-year dates", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manhwa/alpha/`]: DETAILS });
  assert.deepEqual(await src.chapters("/manhwa/alpha/"), [
    { url: "/manhwa/alpha/chapter-2/", name: "Chapter 2", number: 2, date: Date.UTC(2026, 9, 6), scanlator: null },
    { url: "/manhwa/alpha/chapter-1/", name: "Chapter 1", number: 1, date: Date.UTC(2026, 8, 1), scanlator: null },
  ]);
});

test("pages read the reader images with a referer", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manhwa/alpha/chapter-1/`]: `<div class="reading-content"><img src="/c/1.jpg"><img data-src="/c/2.jpg"></div>` });
  assert.deepEqual(await src.pages("/manhwa/alpha/chapter-1/"), [
    { url: `${BASE}/c/1.jpg`, headers: { Referer: `${BASE}/` } },
    { url: `${BASE}/c/2.jpg`, headers: { Referer: `${BASE}/` } },
  ]);
});

test("filters list the genres from the homepage navigation", async () => {
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/`]: `<div class="genre-list"><a href="/genre/drama/">Drama</a><a href="/genre/action/">Action</a></div>` });
  const list = await src.filters();
  assert.deepEqual(validateFilters(list), []);
  assert.deepEqual(list[1].options.map((o) => o.value), ["", "action", "drama"]);
});

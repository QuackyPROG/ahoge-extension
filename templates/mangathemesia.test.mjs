import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "../runtime/host.mjs";
import { validateFilters, defaultFilterValues } from "../runtime/filters.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

function makeSource(config, routes, calls = []) {
  const script = ["var source = null;", read("./_common.js"), read("./mangathemesia.js"), `source = MangaThemesia(${JSON.stringify(config)});`].join("\n");
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (!(url in routes)) return new Response("missing " + url, { status: 404 });
    return new Response(routes[url], { status: 200, headers: { "content-type": "text/html" } });
  };
  return loadSource(script, { fetchImpl });
}

const BASE = "https://mt.test";
const LIST = `
<div class="listupd">
  <div class="bs"><div class="bsx"><a href="${BASE}/manga/alpha/" title="Alpha"><img src="${BASE}/a.jpg"><div class="tt">Alpha</div></a></div></div>
  <div class="bs"><div class="bsx"><a href="${BASE}/manga/beta/" title="Beta"><img data-src="${BASE}/b.jpg" src="data:image/gif;base64,R0"></a></div></div>
</div>
<div class="hpage"><a class="r" href="?page=2">Next</a></div>
<ul class="genrez"><li><input type="checkbox" value="action"><label>Action</label></li><li><input type="checkbox" value="drama"><label>Drama</label></li></ul>`;

const DETAILS = `
<div class="bigcontent">
  <div class="thumb"><img src="${BASE}/a-full.jpg"></div>
  <h1 class="entry-title">Alpha</h1>
  <div class="tsinfo">
    <div class="imptdt">Status <i>Ongoing</i></div>
    <div class="imptdt">Type <a href="/manga/?type=manhwa">Manhwa</a></div>
    <div class="imptdt">Author <i>Writer</i></div>
    <div class="imptdt">Artist <i>-</i></div>
  </div>
  <div class="mgen"><a href="/genres/action/">action</a><a href="/genres/drama/">Drama</a></div>
  <div class="entry-content entry-content-single" itemprop="description"><p>A story.</p></div>
</div>
<div id="chapterlist"><ul>
  <li><a href="${BASE}/alpha-chapter-2/"><span class="chapternum">Chapter 2</span><span class="chapterdate">January 5, 2024</span></a></li>
  <li><a href="${BASE}/alpha-chapter-1/"><span class="chapternum">Chapter 1</span><span class="chapterdate">December 31, 2023</span></a></li>
</ul></div>`;

test("popular and latest use the manga directory with order", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/?page=1&order=popular`]: LIST, [`${BASE}/manga/?page=2&order=update`]: LIST }, calls);
  assert.deepEqual(await src.popular(1), {
    manga: [
      { url: "/manga/alpha/", title: "Alpha", cover: `${BASE}/a.jpg` },
      { url: "/manga/beta/", title: "Beta", cover: `${BASE}/b.jpg` },
    ],
    hasNextPage: true,
  });
  assert.equal((await src.latest(2)).manga.length, 2);
});

test("search builds the query from filters", async () => {
  const calls = [];
  const src = makeSource({ baseUrl: BASE, mangaUrlDirectory: "/series" }, { [`${BASE}/series/`]: LIST }, calls);
  const filters = await src.filters();
  assert.deepEqual(validateFilters(filters), []);
  const f = defaultFilterValues(filters);
  f.genres.action = 1;
  f.genres.drama = 2;
  f.status = "ongoing";
  await src.search("one piece", 1, f).catch(() => null);
  assert.equal(calls[1], `${BASE}/series/?title=one%20piece&page=1&status=ongoing&genre[]=action&genre[]=-drama`);
});

test("details, chapters and pages", async () => {
  const reader = `<div id="readerarea"><img src="${BASE}/p1.jpg"><img data-src="${BASE}/p2.jpg" src="data:image/gif;base64,R0"></div>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/manga/alpha/`]: DETAILS, [`${BASE}/alpha-chapter-2/`]: reader });
  assert.deepEqual(await src.details("/manga/alpha/"), {
    title: "Alpha",
    cover: `${BASE}/a-full.jpg`,
    author: "Writer",
    artist: "",
    description: "A story.",
    genres: ["Action", "Drama", "Manhwa"],
    status: "ongoing",
  });
  const chapters = await src.chapters("/manga/alpha/");
  assert.deepEqual(chapters[0], { url: "/alpha-chapter-2/", name: "Chapter 2", number: 2, date: Date.UTC(2024, 0, 5), scanlator: null });
  assert.deepEqual((await src.pages("/alpha-chapter-2/")).map((p) => p.url), [`${BASE}/p1.jpg`, `${BASE}/p2.jpg`]);
});

test("pages fall back to the ts_reader image list in script", async () => {
  const reader = `<div id="readerarea"></div><script>ts_reader.run({"sources":[{"source":"Server 1","images":["${BASE}/s1.jpg","/s2.jpg"]}]});</script>`;
  const src = makeSource({ baseUrl: BASE }, { [`${BASE}/alpha-chapter-1/`]: reader });
  assert.deepEqual((await src.pages("/alpha-chapter-1/")).map((p) => p.url), [`${BASE}/s1.jpg`, `${BASE}/s2.jpg`]);
});

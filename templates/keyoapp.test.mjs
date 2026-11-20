import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "../runtime/host.mjs";
import { validateFilters } from "../runtime/filters.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const BASE = "https://keyo.test";

function makeSource(config, routes) {
  const script = ["var source = null;", read("./_common.js"), read("./keyoapp.js"), `source = Keyoapp(${JSON.stringify(Object.assign({ baseUrl: BASE }, config))});`].join("\n");
  const fetchImpl = async (url) => {
    if (!(url in routes)) return new Response("missing " + url, { status: 404 });
    const body = routes[url];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };
  return loadSource(script, { fetchImpl });
}

test("v1: home carousel, details, chapters without paid ones, uid pages on the script's CDN", async () => {
  const src = makeSource({}, {
    [BASE + "/"]: `<div><div>Trending</div><div>
      <div class="group overflow-hidden grid"><a href="/series/alpha/" title="Alpha"></a><div style="background-image: url('https://cdn.test/a.jpg')"></div></div>
      <div class="group overflow-hidden grid"><a href="/series/novel/" title="Nov"></a><span>Novel</span></div>
    </div></div>`,
    [BASE + "/series/alpha/"]: `<div class="grid"><h1>Alpha</h1></div>
      <div style="background-image:url(https://cdn.test/cover.jpg);" class="photoURL"></div>
      <div><span>Status</span></div><div>Ongoing</div>
      <div id="expand_content"><p>Synopsis.</p></div>
      <div id="chapters">
        <a href="/chapter/alpha-2/"><div class="text-sm">Chapter 2</div><img alt="Coin"></a>
        <a href="/chapter/alpha-1/"><div class="text-sm">Chapter 1</div><div class="text-xs">Jan 5, 2026</div></a>
      </div>`,
    [BASE + "/chapter/alpha-1/"]: `<script>let realUrl = \`https://\${host}cdn.test/x\`;</script><div id="pages"><img uid="u1"><img uid="u2"></div>`,
  });
  assert.deepEqual(await src.popular(1), { manga: [{ url: "/series/alpha/", title: "Alpha", cover: "https://cdn.test/a.jpg?w=480" }], hasNextPage: false });
  const d = await src.details("/series/alpha/");
  assert.deepEqual([d.title, d.status, d.description, d.cover], ["Alpha", "ongoing", "Synopsis.", "https://cdn.test/cover.jpg?w=480"]);
  const ch = await src.chapters("/series/alpha/");
  assert.deepEqual(ch.map((c) => [c.url, c.number, c.date]), [["/chapter/alpha-1/", 1, Date.UTC(2026, 0, 5)]]);
  const pages = await src.pages("/chapter/alpha-1/");
  assert.deepEqual(pages.map((p) => p.url), ["https://cdn.test/uploads/u1", "https://cdn.test/uploads/u2"]);
  assert.deepEqual(validateFilters(await src.filters()), []);
});

test("v2: ajax search, chapters html and strip reader", async () => {
  const src = makeSource({ layout: "v2" }, {
    [BASE + "/?_ajax=search&sort=popular&offset=0"]: { html: '<a class="group" href="/alpha"><img data-src="https://c/a.jpg"><h2>Alpha</h2></a>', has_more: true },
    [BASE + "/?_chapters_html=1&series_slug=alpha"]: {
      rows_html: '<a class="chapter-row" href="/alpha/chapter-2" data-ch-label="Chapter 2" data-ch-locked="1"></a><a class="chapter-row" href="/alpha/chapter-1" data-ch-label="Chapter 1"><div class="ch-date-row"><span>x</span><span>2 days ago</span></div></a>',
    },
    [BASE + "/alpha/chapter-1"]: '<div id="strip-reader"><img class="reader-page" src="https://c/1.webp"></div>',
  });
  assert.deepEqual(await src.popular(1), { manga: [{ url: "/alpha", title: "Alpha", cover: "https://c/a.jpg" }], hasNextPage: true });
  const ch = await src.chapters("/alpha");
  assert.deepEqual(ch.map((c) => c.url), ["/alpha/chapter-1"]);
  assert.ok(ch[0].date < Date.now() - 86400000);
  assert.deepEqual((await src.pages("/alpha/chapter-1")).map((p) => p.url), ["https://c/1.webp"]);
});

test("livewire: search listing and immersiveReader pages", async () => {
  const pagesJson = JSON.stringify([{ path: "https://c/p1.jpg" }, { path: "https://c/p2.jpg" }]).replace(/"/g, "\\u0022");
  const src = makeSource({ layout: "livewire" }, {
    [BASE + "/search?sort=popular"]: `<main id="main-content"><div wire:key="serie-1"><a href="/series/alpha" title="Alpha"><img alt="Alpha cover" src="https://c/a.jpg"></a></div></main>`,
    [BASE + "/chapter/1"]: `<div x-data="immersiveReader({pages: JSON.parse('${pagesJson}')})"></div>`,
  });
  assert.deepEqual(await src.popular(1), { manga: [{ url: "/series/alpha", title: "Alpha", cover: "https://c/a.jpg" }], hasNextPage: false });
  assert.deepEqual((await src.pages("/chapter/1")).map((p) => p.url), ["https://c/p1.jpg", "https://c/p2.jpg"]);
});

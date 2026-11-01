import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleSource } from "../../../scripts/lib/bundle.mjs";
import { loadSource } from "../../../runtime/host.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

function makeSource(handler) {
  const { script } = bundleSource(root, here);
  const calls = [];
  const headersSeen = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    headersSeen.push(init.headers);
    const body = handler(url);
    return new Response(JSON.stringify(body ?? { result: "error" }), { status: body ? 200 : 404 });
  };
  return { src: loadSource(script, { fetchImpl }), calls, headersSeen };
}

const M1 = "11111111-1111-4111-8111-111111111111";
const C1 = "c0000001-0000-4000-8000-000000000001";
const C2 = "c0000002-0000-4000-8000-000000000002";
const CX = "c00000ff-0000-4000-8000-0000000000ff";

const manga = (id, title, fileName) => ({
  id,
  attributes: { title: { en: title }, altTitles: [], description: { en: "Desc " + id }, status: "ongoing", tags: [{ attributes: { name: { en: "Action" } } }] },
  relationships: [
    { type: "cover_art", attributes: { fileName } },
    { type: "author", attributes: { name: "Writer" } },
    { type: "artist", attributes: { name: "Drawer" } },
  ],
});

test("popular orders by followedCount and maps covers", async () => {
  const { src, calls } = makeSource(() => ({ result: "ok", data: [manga(M1, "One", "c1.jpg")], limit: 20, offset: 0, total: 45 }));
  const result = await src.popular(1);
  assert.deepEqual(result, {
    manga: [{ url: `/manga/${M1}`, title: "One", cover: `https://uploads.mangadex.org/covers/${M1}/c1.jpg.512.jpg` }],
    hasNextPage: true,
  });
  assert.match(calls[0], /^https:\/\/api\.mangadex\.org\/manga\?/);
  assert.match(calls[0], /order\[followedCount\]=desc/);
  assert.match(calls[0], /offset=0/);
});

test("search uses title and page offset", async () => {
  const { src, calls } = makeSource(() => ({ result: "ok", data: [], limit: 20, offset: 20, total: 20 }));
  const result = await src.search("one piece", 2);
  assert.equal(result.hasNextPage, false);
  assert.match(calls[0], /title=one%20piece/);
  assert.match(calls[0], /offset=20/);
});

test("details maps attributes and relationships", async () => {
  const { src } = makeSource((url) => (url.includes(`/manga/${M1}?`) ? { result: "ok", data: manga(M1, "One", "c1.jpg") } : null));
  assert.deepEqual(await src.details(`/manga/${M1}`), {
    title: "One",
    cover: `https://uploads.mangadex.org/covers/${M1}/c1.jpg.512.jpg`,
    author: "Writer",
    artist: "Drawer",
    description: `Desc ${M1}`,
    genres: ["Action"],
    status: "ongoing",
  });
});

test("chapters paginate the feed and skip external chapters", async () => {
  const chapter = (id, num, external = null) => ({
    id,
    attributes: { volume: "1", chapter: num, title: num === "2" ? "Finale" : "", publishAt: "2024-01-05T00:00:00+00:00", externalUrl: external },
    relationships: [{ type: "scanlation_group", attributes: { name: "Group" } }],
  });
  const { src, calls } = makeSource((url) => {
    if (url.includes("offset=0")) return { result: "ok", data: [chapter(C2, "2"), chapter(CX, "1.5", "https://ext")], limit: 2, offset: 0, total: 3 };
    if (url.includes("offset=2")) return { result: "ok", data: [chapter(C1, "1")], limit: 2, offset: 2, total: 3 };
    return null;
  });
  const chapters = await src.chapters(`/manga/${M1}`);
  assert.equal(calls.length, 2);
  assert.deepEqual(chapters, [
    { url: `/chapter/${C2}`, name: "Vol.1 Ch.2 - Finale", number: 2, date: Date.parse("2024-01-05T00:00:00+00:00"), scanlator: "Group" },
    { url: `/chapter/${C1}`, name: "Vol.1 Ch.1", number: 1, date: Date.parse("2024-01-05T00:00:00+00:00"), scanlator: "Group" },
  ]);
});

test("pages come from at-home server", async () => {
  const { src } = makeSource((url) =>
    url.endsWith(`/at-home/server/${C1}`) ? { result: "ok", baseUrl: "https://node.test", chapter: { hash: "h", data: ["1.png", "2.png"] } } : null,
  );
  assert.deepEqual(await src.pages(`/chapter/${C1}`), [
    { url: "https://node.test/data/h/1.png", headers: {} },
    { url: "https://node.test/data/h/2.png", headers: {} },
  ]);
});

test("requests use a non-browser User-Agent (MangaDex bot-challenges browser UAs)", async () => {
  const { src, headersSeen } = makeSource((url) =>
    url.endsWith(`/at-home/server/${C1}`) ? { result: "ok", baseUrl: "https://n.test", chapter: { hash: "h", data: [] } } : { result: "ok", data: [], limit: 20, offset: 0, total: 0 },
  );
  await src.popular(1);
  await src.pages(`/chapter/${C1}`);
  assert.equal(headersSeen.length, 2);
  for (const h of headersSeen) {
    assert.match(h["User-Agent"], /^Ahoge\//);
    assert.doesNotMatch(h["User-Agent"], /Mozilla/);
  }
});

test("title prefers title.en, then an English alt title, then the first title value", async () => {
  const withTitle = (attributes) => ({ ...manga(M1, "x", "c.jpg"), attributes: { ...manga(M1, "x", "c.jpg").attributes, ...attributes } });
  const titleFor = async (attributes) => {
    const { src } = makeSource(() => ({ result: "ok", data: [withTitle(attributes)], limit: 20, offset: 0, total: 1 }));
    return (await src.popular(1)).manga[0].title;
  };
  assert.equal(await titleFor({ title: { en: "Direct", ja: "J" }, altTitles: [{ en: "Alt" }] }), "Direct");
  assert.equal(await titleFor({ title: { ja: "Nihon" }, altTitles: [{ fr: "Fr" }, { en: "Alt" }] }), "Alt");
  assert.equal(await titleFor({ title: { ja: "Nihon" }, altTitles: [{ fr: "Fr" }] }), "Nihon");
});

test("chapter number is -1 when the chapter label is not numeric", async () => {
  const chapter = (id, num) => ({ id, attributes: { volume: null, chapter: num, title: "", publishAt: null, externalUrl: null }, relationships: [] });
  const { src } = makeSource(() => ({ result: "ok", data: [chapter(C2, "Extra"), chapter(C1, "3")], limit: 500, offset: 0, total: 2 }));
  const chapters = await src.chapters(`/manga/${M1}`);
  assert.deepEqual(chapters.map((c) => c.number), [-1, 3]);
});

test("feed pagination advances by the number of items returned, not the reported limit", async () => {
  const chapter = (id, num) => ({ id, attributes: { volume: null, chapter: num, title: "", publishAt: null, externalUrl: null }, relationships: [] });
  const { src, calls } = makeSource((url) => {
    if (url.includes("offset=0")) return { result: "ok", data: [chapter(C2, "2"), chapter(CX, "1.5")], limit: 500, offset: 0, total: 3 };
    if (url.includes("offset=2")) return { result: "ok", data: [chapter(C1, "1")], limit: 500, offset: 2, total: 3 };
    return null;
  });
  const chapters = await src.chapters(`/manga/${M1}`);
  assert.equal(calls.length, 2);
  assert.deepEqual(chapters.map((c) => c.number), [2, 1.5, 1]);
});

test("list hasNextPage is capped at the API's 10000 offset window", async () => {
  const items = (n) => Array.from({ length: n }, () => manga(M1, "One", "c.jpg"));
  const a = makeSource(() => ({ result: "ok", data: items(20), limit: 20, offset: 9980, total: 20000 }));
  assert.equal((await a.src.popular(500)).hasNextPage, false);
  const b = makeSource(() => ({ result: "ok", data: items(20), limit: 20, offset: 9960, total: 20000 }));
  assert.equal((await b.src.popular(499)).hasNextPage, true);
  const c = makeSource(() => ({ result: "ok", data: items(10), limit: 20, offset: 0, total: 25 }));
  assert.equal((await c.src.popular(1)).hasNextPage, true);
});

test("ids are extracted by uuid regex and invalid ones throw a clear error", async () => {
  const { src, calls } = makeSource(() => ({ result: "ok", data: [], limit: 500, offset: 0, total: 0 }));
  await src.chapters(`/manga/${M1}/`);
  assert.match(calls[0], new RegExp(`/manga/${M1}/feed\?`));
  await assert.rejects(src.details("/manga/not-an-id"), /invalid MangaDex id/i);
  await assert.rejects(src.chapters("/manga/"), /invalid MangaDex id/i);
  await assert.rejects(src.pages("/chapter/zzz"), /invalid MangaDex id/i);
});

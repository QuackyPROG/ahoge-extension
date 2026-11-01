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
  const { src, calls } = makeSource(() => ({ result: "ok", data: [manga("m1", "One", "c1.jpg")], limit: 20, offset: 0, total: 45 }));
  const result = await src.popular(1);
  assert.deepEqual(result, {
    manga: [{ url: "/manga/m1", title: "One", cover: "https://uploads.mangadex.org/covers/m1/c1.jpg.512.jpg" }],
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
  const { src } = makeSource((url) => (url.includes("/manga/m1?") ? { result: "ok", data: manga("m1", "One", "c1.jpg") } : null));
  assert.deepEqual(await src.details("/manga/m1"), {
    title: "One",
    cover: "https://uploads.mangadex.org/covers/m1/c1.jpg.512.jpg",
    author: "Writer",
    artist: "Drawer",
    description: "Desc m1",
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
    if (url.includes("offset=0")) return { result: "ok", data: [chapter("c2", "2"), chapter("cx", "1.5", "https://ext")], limit: 2, offset: 0, total: 3 };
    if (url.includes("offset=2")) return { result: "ok", data: [chapter("c1", "1")], limit: 2, offset: 2, total: 3 };
    return null;
  });
  const chapters = await src.chapters("/manga/m1");
  assert.equal(calls.length, 2);
  assert.deepEqual(chapters, [
    { url: "/chapter/c2", name: "Vol.1 Ch.2 - Finale", number: 2, date: Date.parse("2024-01-05T00:00:00+00:00"), scanlator: "Group" },
    { url: "/chapter/c1", name: "Vol.1 Ch.1", number: 1, date: Date.parse("2024-01-05T00:00:00+00:00"), scanlator: "Group" },
  ]);
});

test("pages come from at-home server", async () => {
  const { src } = makeSource((url) =>
    url.endsWith("/at-home/server/c1") ? { result: "ok", baseUrl: "https://node.test", chapter: { hash: "h", data: ["1.png", "2.png"] } } : null,
  );
  assert.deepEqual(await src.pages("/chapter/c1"), [
    { url: "https://node.test/data/h/1.png", headers: {} },
    { url: "https://node.test/data/h/2.png", headers: {} },
  ]);
});

test("requests use a non-browser User-Agent (MangaDex bot-challenges browser UAs)", async () => {
  const { src, headersSeen } = makeSource((url) =>
    url.endsWith("/at-home/server/c1") ? { result: "ok", baseUrl: "https://n.test", chapter: { hash: "h", data: [] } } : { result: "ok", data: [], limit: 20, offset: 0, total: 0 },
  );
  await src.popular(1);
  await src.pages("/chapter/c1");
  assert.equal(headersSeen.length, 2);
  for (const h of headersSeen) {
    assert.match(h["User-Agent"], /^Ahoge\//);
    assert.doesNotMatch(h["User-Agent"], /Mozilla/);
  }
});

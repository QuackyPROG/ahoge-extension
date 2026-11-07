import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleSource } from "../../../scripts/lib/bundle.mjs";
import { loadSource } from "../../../runtime/host.mjs";
import { validateFilters, defaultFilterValues } from "../../../runtime/filters.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

function makeSource(handler) {
  const { script } = bundleSource(root, here);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = handler(url);
    return new Response(JSON.stringify(body ?? { error: "does not exist" }), { status: body ? 200 : 404 });
  };
  return { src: loadSource(script, { fetchImpl }), calls };
}

const gallery = {
  id: 177013,
  media_id: "987560",
  title: { english: "English Title", japanese: "日本語", pretty: "Pretty" },
  images: { pages: [{ t: "j" }, { t: "p" }, { t: "w" }], cover: { t: "p" }, thumbnail: { t: "j" } },
  scanlator: "",
  upload_date: 1476793729,
  tags: [
    { type: "tag", name: "full color" },
    { type: "tag", name: "sole female" },
    { type: "artist", name: "artist a" },
    { type: "group", name: "circle b" },
    { type: "parody", name: "original" },
    { type: "language", name: "english" },
    { type: "language", name: "translated" },
  ],
  num_pages: 3,
  num_favorites: 42,
};

test("popular searches English by popularity and builds thumbnails", async () => {
  const { src, calls } = makeSource(() => ({ result: [gallery], num_pages: 5, per_page: 25 }));
  assert.deepEqual(await src.popular(1), {
    manga: [{ url: "/g/177013/", title: "English Title", cover: "https://t.nhentai.net/galleries/987560/thumb.jpg" }],
    hasNextPage: true,
  });
  assert.equal(calls[0], "https://nhentai.net/api/galleries/search?query=language%3Aenglish&page=1&sort=popular");
});

test("latest sorts by date; last page has no next", async () => {
  const { src, calls } = makeSource(() => ({ result: [], num_pages: 2 }));
  assert.equal((await src.latest(2)).hasNextPage, false);
  assert.match(calls[0], /sort=date/);
});

test("search passes the query through and applies filters", async () => {
  const list = await makeSource(() => null).src.filters();
  assert.deepEqual(validateFilters(list), []);
  const defaults = defaultFilterValues(list);
  assert.deepEqual(defaults, { sort: "popular", language: "english" });
  const { src, calls } = makeSource(() => ({ result: [], num_pages: 0 }));
  await src.search('tag:"full color"', 1, { ...defaults, sort: "popular-week" });
  assert.match(calls[0], /query=tag%3A%22full%20color%22%20language%3Aenglish/);
  assert.match(calls[0], /sort=popular-week/);
  await src.search("", 1, { sort: "date", language: "" });
  assert.match(calls[1], /query=pages%3A%3E0&/);
});

test("details maps tags", async () => {
  const { src, calls } = makeSource((url) => (url.endsWith("/api/gallery/177013") ? gallery : null));
  const d = await src.details("/g/177013/");
  assert.equal(calls[0], "https://nhentai.net/api/gallery/177013");
  assert.equal(d.title, "English Title");
  assert.equal(d.cover, "https://t.nhentai.net/galleries/987560/cover.png");
  assert.equal(d.author, "circle b");
  assert.equal(d.artist, "artist a");
  assert.deepEqual(d.genres, ["full color", "sole female"]);
  assert.equal(d.status, "completed");
  assert.match(d.description, /Parodies: original/);
  assert.match(d.description, /Languages: english, translated/);
});

test("chapters is the gallery itself", async () => {
  const { src } = makeSource(() => gallery);
  assert.deepEqual(await src.chapters("https://nhentai.net/g/177013/"), [
    { url: "/g/177013/", name: "Gallery (3 pages)", number: 1, date: 1476793729000, scanlator: null },
  ]);
});

test("pages use the image type of each page", async () => {
  const { src } = makeSource(() => gallery);
  const pages = await src.pages("/g/177013/");
  assert.deepEqual(pages.map((p) => p.url), [
    "https://i.nhentai.net/galleries/987560/1.jpg",
    "https://i.nhentai.net/galleries/987560/2.png",
    "https://i.nhentai.net/galleries/987560/3.webp",
  ]);
  assert.equal(pages[0].headers.Referer, "https://nhentai.net/");
});

test("rejects urls that are not galleries", async () => {
  const { src } = makeSource(() => gallery);
  await assert.rejects(src.details("/tag/foo/"), /Not an nhentai gallery url/);
});

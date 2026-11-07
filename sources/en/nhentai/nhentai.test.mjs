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

const listItem = { id: 227910, media_id: "1200622", english_title: "English Title", japanese_title: "日本語", thumbnail: "galleries/1200622/thumb.png", num_pages: 3 };

const gallery = {
  id: 227910,
  media_id: "1200622",
  title: { english: "English Title", japanese: "日本語", pretty: "Pretty" },
  cover: { path: "galleries/1200622/cover.png" },
  thumbnail: { path: "galleries/1200622/thumb.png" },
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
  pages: [
    { number: 2, path: "galleries/1200622/2.png" },
    { number: 1, path: "galleries/1200622/1.jpg" },
    { number: 3, path: "galleries/1200622/3.webp" },
  ],
};

test("popular searches English by popularity and builds thumbnails", async () => {
  const { src, calls } = makeSource(() => ({ result: [listItem], num_pages: 5, per_page: 25 }));
  assert.deepEqual(await src.popular(1), {
    manga: [{ url: "/g/227910/", title: "English Title", cover: "https://t3.nhentai.net/galleries/1200622/thumb.png" }],
    hasNextPage: true,
  });
  assert.equal(calls[0], "https://nhentai.net/api/v2/search?query=language%3Aenglish&sort=popular&page=1");
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
  const { src, calls } = makeSource((url) => (url.endsWith("/api/v2/galleries/227910") ? gallery : null));
  const d = await src.details("/g/227910/");
  assert.equal(calls[0], "https://nhentai.net/api/v2/galleries/227910");
  assert.equal(d.title, "English Title");
  assert.equal(d.cover, "https://t3.nhentai.net/galleries/1200622/cover.png");
  assert.equal(d.author, "circle b");
  assert.equal(d.artist, "artist a");
  assert.deepEqual(d.genres, ["full color", "sole female"]);
  assert.equal(d.status, "completed");
  assert.match(d.description, /Parodies: original/);
  assert.match(d.description, /Languages: english, translated/);
});

test("chapters is the gallery itself", async () => {
  const { src } = makeSource(() => gallery);
  assert.deepEqual(await src.chapters("https://nhentai.net/g/227910/"), [
    { url: "/g/227910/", name: "Gallery (3 pages)", number: 1, date: 1476793729000, scanlator: null },
  ]);
});

test("pages come from the API in page order", async () => {
  const { src } = makeSource(() => gallery);
  const pages = await src.pages("/g/227910/");
  assert.deepEqual(pages.map((p) => p.url), [
    "https://i3.nhentai.net/galleries/1200622/1.jpg",
    "https://i3.nhentai.net/galleries/1200622/2.png",
    "https://i3.nhentai.net/galleries/1200622/3.webp",
  ]);
  assert.equal(pages[0].headers.Referer, "https://nhentai.net/");
});

test("rejects urls that are not galleries", async () => {
  const { src } = makeSource(() => gallery);
  await assert.rejects(src.details("/tag/foo/"), /Not an nhentai gallery url/);
});

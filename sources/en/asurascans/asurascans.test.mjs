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
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = handler(url);
    return new Response(JSON.stringify(body ?? { result: "error" }), { status: body ? 200 : 404 });
  };
  return { src: loadSource(script, { fetchImpl }), calls };
}

function assertNoSiteCalls(calls) {
  assert.equal(
    calls.some((u) => u.startsWith("https://asurascans.com")),
    false,
    "no request may go to the Cloudflare-protected site pages",
  );
}

const seriesBody = (status) => ({
  series: {
    slug: "overgeared",
    title: "Overgeared",
    description: "<p>Shin Youngwoo is a player.</p>",
    cover: "https://cdn.asurascans.com/asura-images/covers/overgeared.905990.webp",
    status,
    type: "manhwa",
    author: "LEE Dong Wook/ PARK Saenal",
    artist: "REDICE Studio",
    public_url: "/comics/overgeared-7ba78ec7",
    genres: [
      { id: 1, name: "Action", slug: "action" },
      { id: 4, name: "Adventure", slug: "adventure" },
    ],
  },
});

const chaptersBody = [
  {
    id: 265020,
    series_id: 2165,
    number: 349,
    title: "Trauma",
    slug: "chapter-349",
    is_premium: false,
    early_access_until: "2020-01-01T00:00:00Z",
    published_at: "2026-11-21T04:14:32.215031Z",
    created_at: "2026-11-21T04:14:33.222666Z",
    series_slug: "overgeared",
  },
  { id: 3, number: 348, title: "Locked", is_premium: true, early_access_until: null, created_at: "2026-11-20T00:00:00Z" },
  { id: 4, number: 350, is_premium: false, early_access_until: "2999-01-01T00:00:00Z", created_at: "2026-11-22T00:00:00Z" },
  {
    id: 1,
    number: 1,
    is_premium: false,
    early_access_until: null,
    created_at: "2025-01-01T00:00:00Z",
    series_slug: "overgeared",
  },
];

const pageBody = {
  access_gate: "",
  is_locked: false,
  unlock_time: null,
  chapter: {
    id: 1,
    number: 1,
    pages: [{ url: "https://cdn.asurascans.com/asura-images/chapters/overgeared/1/001.webp?v=1791877385", width: 1238, height: 800 }],
  },
};

test("details reads the series from the JSON API and maps it", async () => {
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7" ? seriesBody("ongoing") : null));
  const result = await src.details("/comics/overgeared-7ba78ec7");
  assert.deepEqual(calls, ["https://api.asurascans.com/api/series/overgeared-7ba78ec7"]);
  assert.deepEqual(result, {
    title: "Overgeared",
    cover: "https://cdn.asurascans.com/asura-images/covers/overgeared.905990.webp",
    author: "LEE Dong Wook/ PARK Saenal",
    artist: "REDICE Studio",
    description: "Shin Youngwoo is a player.",
    genres: ["Manhwa", "Action", "Adventure"],
    status: "ongoing",
  });
  assertNoSiteCalls(calls);
});

test("details maps dropped status to cancelled", async () => {
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7" ? seriesBody("dropped") : null));
  const result = await src.details("/comics/overgeared-7ba78ec7");
  assert.equal(result.status, "cancelled");
  assertNoSiteCalls(calls);
});

test("details reads a series wrapped in data", async () => {
  const wrapped = {
    data: {
      recommended_series: [],
      series: {
        slug: "the-roguish-guard-in-a-medieval-fantasy",
        title: "The Roguish Guard in a Medieval Fantasy",
        description: "<p>A guard.</p>",
        cover: "https://cdn.asurascans.com/asura-images/covers/roguish.webp",
        status: "ongoing",
        type: "manhwa",
        author: "A",
        artist: "B",
        genres: [{ id: 1, name: "Action", slug: "action" }],
      },
    },
  };
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/the-roguish-guard-in-a-medieval-fantasy-7ba78ec7" ? wrapped : null));
  const result = await src.details("/comics/the-roguish-guard-in-a-medieval-fantasy-7ba78ec7");
  assert.deepEqual(result, {
    title: "The Roguish Guard in a Medieval Fantasy",
    cover: "https://cdn.asurascans.com/asura-images/covers/roguish.webp",
    author: "A",
    artist: "B",
    description: "A guard.",
    genres: ["Manhwa", "Action"],
    status: "ongoing",
  });
  assertNoSiteCalls(calls);
});

test("details throws a clear error when the series is missing", async () => {
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/the-roguish-guard-in-a-medieval-fantasy-7ba78ec7" ? { data: { recommended_series: [] } } : null));
  await assert.rejects(src.details("/comics/the-roguish-guard-in-a-medieval-fantasy-7ba78ec7"), /Asura series data not found/);
  assertNoSiteCalls(calls);
});

test("chapters reads the list from the JSON API and leaves out premium and early-access chapters", async () => {
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters" ? { data: chaptersBody } : null));
  const result = await src.chapters("/comics/overgeared-7ba78ec7");
  assert.deepEqual(calls, ["https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters"]);
  assert.deepEqual(result, [
    {
      url: "/comics/overgeared-7ba78ec7/chapter/349",
      name: "Chapter 349 - Trauma",
      number: 349,
      date: Date.parse("2026-11-21T04:14:33.222666Z"),
      scanlator: null,
    },
    {
      url: "/comics/overgeared-7ba78ec7/chapter/1",
      name: "Chapter 1",
      number: 1,
      date: Date.parse("2025-01-01T00:00:00Z"),
      scanlator: null,
    },
  ]);
  assertNoSiteCalls(calls);
});

function sameDayChapters(firstCreatedAt = "2026-11-22T02:01:17.206751Z") {
  const created = [
    firstCreatedAt,
    "2026-11-22T02:01:30Z",
    "2026-11-22T02:02:06.707586Z",
    "2026-11-22T02:02:40Z",
    "2026-11-22T02:03:07.808277Z",
  ];
  return created.map((createdAt, i) => ({
    id: 100 + i,
    number: i + 1,
    is_premium: false,
    early_access_until: null,
    created_at: createdAt,
  }));
}

test("chapters gives no dates when every chapter is dated the same day", async () => {
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters" ? { data: sameDayChapters() } : null));
  const result = await src.chapters("/comics/overgeared-7ba78ec7");
  assert.equal(result.length, 5);
  assert.deepEqual(
    result.map((c) => c.date),
    [null, null, null, null, null],
  );
  assert.deepEqual(
    result.map((c) => c.url),
    [1, 2, 3, 4, 5].map((n) => "/comics/overgeared-7ba78ec7/chapter/" + n),
  );
  assert.deepEqual(
    result.map((c) => c.name),
    ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Chapter 5"],
  );
  assertNoSiteCalls(calls);
});

test("chapters keeps dates when they span more than one day", async () => {
  const { src, calls } = makeSource((url) =>
    url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters"
      ? { data: sameDayChapters("2022-08-21T16:47:06Z") }
      : null,
  );
  const result = await src.chapters("/comics/overgeared-7ba78ec7");
  assert.equal(result.length, 5);
  assert.equal(result[0].date, Date.parse("2022-08-21T16:47:06Z"));
  assert.equal(result[4].date, Date.parse("2026-11-22T02:03:07.808277Z"));
  assertNoSiteCalls(calls);
});

test("chapters keeps dates for a series with fewer than 5 chapters", async () => {
  const fourChapters = sameDayChapters().slice(0, 4);
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters" ? { data: fourChapters } : null));
  const result = await src.chapters("/comics/overgeared-7ba78ec7");
  assert.equal(result.length, 4);
  assert.deepEqual(
    result.map((c) => c.date),
    fourChapters.map((c) => Date.parse(c.created_at)),
  );
  for (const c of result) assert.notEqual(c.date, null);
  assertNoSiteCalls(calls);
});

test("pages reads the chapter from the JSON API and returns its images", async () => {
  const { src, calls } = makeSource((url) => (url === "https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters/1" ? { data: pageBody } : null));
  const result = await src.pages("/comics/overgeared-7ba78ec7/chapter/1");
  assert.deepEqual(calls, ["https://api.asurascans.com/api/series/overgeared-7ba78ec7/chapters/1"]);
  assert.deepEqual(result, [
    {
      url: "https://cdn.asurascans.com/asura-images/chapters/overgeared/1/001.webp?v=1791877385",
      headers: { Referer: "https://asurascans.com/" },
    },
  ]);
  assertNoSiteCalls(calls);
});

test("pages throws the premium message when the API marks the chapter locked or has no pages", async () => {
  const locked = makeSource(() => ({ data: { ...pageBody, is_locked: true } }));
  await assert.rejects(locked.src.pages("/comics/overgeared-7ba78ec7/chapter/348"), /This chapter is premium on Asura Scans/);
  assertNoSiteCalls(locked.calls);

  const empty = makeSource(() => ({ data: { ...pageBody, chapter: { id: 1, number: 1, pages: [] } } }));
  await assert.rejects(empty.src.pages("/comics/overgeared-7ba78ec7/chapter/1"), /This chapter is premium on Asura Scans/);
  assertNoSiteCalls(empty.calls);
});

test("pages throws the scrambled message when a page comes back as tiles", async () => {
  const scrambled = makeSource(() => ({
    data: {
      ...pageBody,
      chapter: {
        id: 1,
        number: 1,
        pages: [{ url: "https://cdn.asurascans.com/asura-images/chapters/overgeared/1/001.webp", width: 1238, height: 800, tiles: [{ x: 0, y: 0 }], tile_cols: 2, tile_rows: 2 }],
      },
    },
  }));
  await assert.rejects(scrambled.src.pages("/comics/overgeared-7ba78ec7/chapter/1"), /This chapter uses scrambled images/);
  assertNoSiteCalls(scrambled.calls);
});

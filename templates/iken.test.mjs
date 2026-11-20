import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSource } from "../runtime/host.mjs";
import { validateFilters, defaultFilterValues } from "../runtime/filters.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const BASE = "https://iken.test";
const API = "https://api.iken.test/api";

function makeSource(config, routes, calls = []) {
  const script = ["var source = null;", read("./_common.js"), read("./iken.js"), `source = Iken(${JSON.stringify(Object.assign({ baseUrl: BASE }, config))});`].join("\n");
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!(url in routes)) return new Response("missing " + url, { status: 404 });
    return new Response(JSON.stringify(routes[url]), { status: 200, headers: { "content-type": "application/json" } });
  };
  return loadSource(script, { fetchImpl });
}

const POST = {
  totalChapterCount: 3,
  post: {
    id: 7, slug: "alpha", postTitle: "Alpha", postContent: "<p>Line one</p>\nLine two", featuredImage: "https://cdn.test/a.jpg",
    alternativeTitles: "Alfa", author: "Au", artist: "", seriesType: "MANHWA", seriesStatus: "MASS_RELEASED",
    genres: [{ id: 1, name: "Action" }],
    chapters: [
      { id: 11, slug: "chapter-1", number: 1, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 12, slug: "chapter-2", number: 2, title: "Two", createdAt: "2026-01-02T00:00:00.000Z", isLocked: true },
    ],
  },
};

test("popular queries the API by views and drops novels", async () => {
  const calls = [];
  const src = makeSource({}, {
    [API + "/query?perPage=18&searchTerm=&orderBy=totalViews&orderDirection=desc&page=1"]: {
      posts: [{ id: 1, slug: "a", postTitle: "A", featuredImage: "https://c/a.jpg" }, { id: 2, slug: "n", postTitle: "N", seriesType: "NOVEL" }],
      totalCount: 40,
    },
  }, calls);
  assert.deepEqual(await src.popular(1), { manga: [{ url: "/series/a", title: "A", cover: "https://c/a.jpg" }], hasNextPage: true });
});

test("details, chapters (full list when truncated, locked hidden) and pages", async () => {
  const src = makeSource({ sortPagesByFilename: true }, {
    [API + "/post?postSlug=alpha"]: POST,
    [API + "/chapters?postId=7"]: { post: { chapters: POST.post.chapters.concat([{ id: 13, slug: "chapter-3", number: 3, createdAt: "2026-01-03T00:00:00.000Z" }]) } },
    [API + "/chapter?chapterId=13"]: { chapter: { images: [{ url: "https://cdn.test/p 10.jpg" }, { url: "https://cdn.test/p 2.jpg" }] } },
  });
  const d = await src.details("/series/alpha");
  assert.equal(d.status, "ongoing");
  assert.deepEqual(d.genres, ["Manhwa", "Action"]);
  assert.equal(d.description, "Line one Line two\n\nAlternative Names: Alfa");
  const ch = await src.chapters("/series/alpha");
  assert.deepEqual(ch.map((c) => [c.url, c.name]), [["/series/alpha/chapter-3#13", "Chapter 3"], ["/series/alpha/chapter-1#11", "Chapter 1"]]);
  assert.equal(ch[1].date, Date.UTC(2026, 0, 1));
  const pages = await src.pages("/series/alpha/chapter-3#13");
  assert.deepEqual(pages.map((p) => p.url), ["https://cdn.test/p%202.jpg", "https://cdn.test/p%2010.jpg"]);
});

test("filters validate and the default search uses them", async () => {
  const src = makeSource({}, {
    [API + "/genres"]: [{ id: 3, name: "Drama" }],
    [API + "/query?perPage=18&searchTerm=x&orderBy=lastChapterAddedAt&orderDirection=desc&page=1"]: { posts: [], totalCount: 0 },
  });
  const f = await src.filters();
  assert.deepEqual(validateFilters(f), []);
  assert.deepEqual(await src.search("x", 1, defaultFilterValues(f)), { manga: [], hasNextPage: false });
});

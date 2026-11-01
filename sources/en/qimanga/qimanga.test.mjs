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
    return new Response(JSON.stringify(body ?? { statusCode: 404 }), { status: body ? 200 : 404 });
  };
  return { src: loadSource(script, { fetchImpl }), calls };
}

const page = (data, current, totalPages) => ({ data, totalItems: data.length, totalPages, current, next: current < totalPages ? current + 1 : null });
const series = (slug, type = "MANHWA") => ({ slug, title: " " + slug + " ", cover: "https://media.qimanga.com/" + slug + ".webp", type });

test("popular sorts by popularity, drops novels and pages on next", async () => {
  const { src, calls } = makeSource(() => page([series("a"), series("n", "NOVEL")], 1, 3));
  assert.deepEqual(await src.popular(1), {
    manga: [{ url: "/series/a", title: "a", cover: "https://media.qimanga.com/a.webp" }],
    hasNextPage: true,
  });
  assert.equal(calls[0], "https://api.qimanga.com/api/v1/series?page=1&perPage=30&sort=popular&order=desc");
});

test("a title search uses the search endpoint; filters build a browse query", async () => {
  const { src, calls } = makeSource((url) => (url.includes("/series/genres") ? [{ name: " Fantasy ", slug: "fantasy" }] : page([], 1, 1)));
  const list = await src.filters();
  assert.deepEqual(validateFilters(list), []);
  await src.search("nano", 1, defaultFilterValues(list));
  assert.match(calls.at(-1), /\/series\/search\?q=nano&page=1&perPage=30$/);
  await src.search("", 2, { sort: { value: "alphabetical", ascending: true }, status: "COMPLETED", type: "", genres: { fantasy: true } });
  assert.equal(calls.at(-1), "https://api.qimanga.com/api/v1/series?page=2&perPage=30&sort=alphabetical&order=asc&status=COMPLETED&genres=fantasy");
});

test("chapters page through the list and skip paid ones", async () => {
  const ch = (n, extra) => ({ slug: "chapter-" + n, number: n, title: null, publishStatus: "PUBLIC", requiresPurchase: false, createdAt: "2026-10-01T00:00:00.000Z", ...extra });
  const { src, calls } = makeSource((url) =>
    url.includes("page=1&") ? page([ch(3, { requiresPurchase: true }), ch(2, { title: "Chapter 2. Start" })], 1, 2) : page([ch(1, { title: "Prologue" })], 2, 2)
  );
  const list = await src.chapters("/series/foo");
  assert.deepEqual(list.map((c) => [c.url, c.name, c.number]), [
    ["/series/foo/chapter-2", "Chapter 2. Start", 2],
    ["/series/foo/chapter-1", "Chapter 1 - Prologue", 1],
  ]);
  assert.equal(list[0].date, Date.UTC(2026, 9, 1));
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/series\/foo\/chapters\?page=1&perPage=100$/);
});

test("pages come back in image order", async () => {
  const { src, calls } = makeSource(() => ({ requiresPurchase: false, images: [{ url: "https://m/2.webp", order: 1 }, { url: "https://m/1.webp", order: 0 }] }));
  assert.deepEqual(await src.pages("/series/foo/chapter-1"), [
    { url: "https://m/1.webp", headers: {} },
    { url: "https://m/2.webp", headers: {} },
  ]);
  assert.equal(calls[0], "https://api.qimanga.com/api/v1/series/foo/chapters/chapter-1");
});

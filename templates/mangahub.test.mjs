import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { loadSource } from "../runtime/host.mjs";
import { validateFilters } from "../runtime/filters.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const BASE = "https://hub.test";

function encrypt(plain, key, keyId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const b = (x) => x.toString("base64url");
  return ["enc", "v1", keyId, b(iv), b(cipher.getAuthTag()), b(ct)].join(":");
}

function makeSource(handler, calls = []) {
  const script = ["var source = null;", read("./_common.js"), read("./mangahub.js"), `source = MangaHub({ baseUrl: "${BASE}", mangaSource: "mf01" });`].join("\n");
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? Buffer.from(init.body).toString() : "", headers: init.headers });
    const r = handler(url, init && init.body ? JSON.parse(Buffer.from(init.body).toString() || "{}") : null, init);
    return new Response(r.body, { status: r.status || 200, headers: r.headers || { "content-type": "application/json" } });
  };
  return loadSource(script, { fetchImpl });
}

test("aes-256-gcm pages decrypt, including multi-block and non-ASCII text", async () => {
  const key = randomBytes(32);
  const plain = JSON.stringify({ p: "títle/12/", i: Array.from({ length: 40 }, (_, i) => i + 1 + ".jpg") });
  const enc = encrypt(plain, key, "k1");
  const calls = [];
  const src = makeSource((url, body) => {
    if (url === BASE + "/graphql") return { body: JSON.stringify({ data: { chapter: { pages: enc } } }) };
    if (url === BASE + "/api/chapter-crypto") return { body: JSON.stringify({ keyId: "k1", key: key.toString("base64url") }) };
    return { status: 404, body: "" };
  }, calls);
  const pages = await src.pages("/some-slug/chapter-12");
  assert.equal(pages.length, 40);
  assert.equal(pages[0].url, "https://imgx.mghcdn.com/títle/12/1.jpg");
  assert.equal(pages[39].url, "https://imgx.mghcdn.com/títle/12/40.jpg");
  const q = JSON.parse(calls[0].body).query;
  assert.match(q, /chapter\(x: mf01, slug: "some-slug", number: 12\)/);
});

test("a missing chapter refreshes the access key from the chapter page", async () => {
  let key = null;
  const src = makeSource((url, body, init) => {
    if (url === BASE + "/graphql") {
      const sent = new Headers(init.headers).get("x-mhub-access");
      if (/chapter\(/.test(body.query) && sent !== "good") return { body: JSON.stringify({ errors: [{ message: "Chapter encryption unavailable" }], data: { chapter: null } }) };
      return { body: JSON.stringify({ data: { chapter: { pages: JSON.stringify(["a/1.png"]) } } }) };
    }
    if (url === BASE + "/chapter/s/chapter-3") return { body: "<html></html>", headers: { "content-type": "text/html", "set-cookie": "mhub_access=good; Max-Age=86400; Path=/" } };
    return { status: 404, body: "" };
  });
  const pages = await src.pages("/s/chapter-3");
  assert.deepEqual(pages.map((p) => p.url), ["https://imgx.mghcdn.com/a/1.png"]);
});

test("listing, details and chapters map the API", async () => {
  const src = makeSource((url, body) => {
    const q = body.query;
    if (/search\(/.test(q)) return { body: JSON.stringify({ data: { search: { rows: [{ title: "A", slug: "a", image: "mf/a.jpg" }] } } }) };
    if (/manga\(/.test(q))
      return {
        body: JSON.stringify({
          data: {
            manga: {
              title: "A", slug: "a", status: "ongoing", image: "mf/a.jpg", author: "X", artist: "", genres: "Action, Drama",
              description: "Desc", alternativeTitle: "B; C",
              chapters: [{ number: 1, title: "Ch.1", date: "2026-01-01T00:00:00.000Z" }, { number: 2.5, title: "", date: "2026-01-02T00:00:00.000Z" }],
            },
          },
        }),
      };
    if (/genres/.test(q)) return { body: JSON.stringify({ data: { genres: [{ title: "Drama", slug: "drama" }, { title: "Action", slug: "action" }] } }) };
    return { status: 404, body: "" };
  });
  const list = await src.popular(1);
  assert.deepEqual(list, { manga: [{ url: "/manga/a", title: "A", cover: "https://thumb.mghcdn.com/mf/a.jpg" }], hasNextPage: false });
  const d = await src.details("/manga/a");
  assert.equal(d.status, "ongoing");
  assert.deepEqual(d.genres, ["Action", "Drama"]);
  assert.match(d.description, /- B\n- C$/);
  const ch = await src.chapters("/manga/a");
  assert.deepEqual(ch.map((c) => [c.url, c.name, c.number]), [["/a/chapter-2.5", "Chapter 2.5", 2.5], ["/a/chapter-1", "Ch.1", 1]]);
  const f = await src.filters();
  assert.deepEqual(validateFilters(f), []);
  assert.deepEqual(f[0].options.slice(0, 2), [{ value: "all", label: "All" }, { value: "action", label: "Action" }]);
});

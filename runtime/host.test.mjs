import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSource, RUNTIME_VERSION } from "./host.mjs";
import { CloudflareError } from "./http.mjs";

const fakeFetch = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  const [status, body, headers = {}] = hit ? hit[1] : [404, "missing"];
  return new Response(body, { status, headers });
};

test("runtime version is 1", () => assert.equal(RUNTIME_VERSION, 1));

test("calls async source methods and returns plain data", async () => {
  const script = `
    var source = null;
    source = {
      async popular(page) {
        const res = await http.get("https://s.test/list?page=" + page);
        const doc = html.parse(res.body, res.url);
        return { manga: doc.select("a").map(a => ({ url: a.attr("href"), title: a.text(), cover: "" })), hasNextPage: false };
      }
    };`;
  const src = loadSource(script, { fetchImpl: fakeFetch({ "/list?page=2": [200, "<a href='/m/1'>One</a>"] }) });
  const result = await src.popular(2);
  assert.deepEqual(result, { manga: [{ url: "/m/1", title: "One", cover: "" }], hasNextPage: false });
});

test("no URL or fetch globals exist (parity with JavaScriptCore)", async () => {
  const src = loadSource(`var source = { async popular() { return { manga: [], hasNextPage: typeof URL === "undefined" && typeof fetch === "undefined" }; } };`);
  assert.equal((await src.popular(1)).hasNextPage, true);
});

test("CloudflareError thrown by http is instanceof inside and outside the script", async () => {
  const script = `var source = { async popular() {
    try { await http.get("https://s.test/cf"); } catch (e) { if (e instanceof CloudflareError) throw e; }
    return null; } };`;
  const src = loadSource(script, { fetchImpl: fakeFetch({ "/cf": [503, "<title>Just a moment...</title>"] }) });
  await assert.rejects(src.popular(1), (e) => e instanceof CloudflareError);
});

test("missing method rejects with a clear message", async () => {
  const src = loadSource(`var source = {};`);
  await assert.rejects(src.latest(1), /does not implement latest/);
});

test("script that does not assign source throws", () => {
  assert.throws(() => loadSource(`var x = 1;`), /did not assign `source`/);
});

test("atob and btoa exist", async () => {
  const src = loadSource(`var source = { async popular() { return { manga: [], hasNextPage: atob(btoa("hi")) === "hi" }; } };`);
  assert.equal((await src.popular(1)).hasNextPage, true);
});

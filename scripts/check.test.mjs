import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSource, applyHealth, selectEntries, checkEntries } from "./check.mjs";
import { CloudflareError } from "../runtime/http.mjs";

const working = {
  popular: async () => ({ manga: [{ url: "/m/1", title: "One", cover: "" }], hasNextPage: false }),
  details: async () => ({ title: "One" }),
  chapters: async () => [{ url: "/c/1", name: "Ch 1" }],
  pages: async () => [{ url: "https://img/1.jpg", headers: {} }],
};

const many = (n) => ({ manga: Array.from({ length: n }, (_, i) => ({ url: `/m/${i + 1}`, title: `M${i + 1}`, cover: "" })), hasNextPage: false });

test("ok when every step yields data", async () => {
  assert.deepEqual(await checkSource(working, { timeoutMs: 1000 }), { status: "ok", step: null, error: null });
});

test("broken with the failing step", async () => {
  const empty = { ...working, chapters: async () => [] };
  assert.deepEqual(await checkSource(empty, { timeoutMs: 1000 }), { status: "broken", step: "chapters", error: "no chapters returned for first 1 manga" });
});

test("thrown errors are reported", async () => {
  const failing = { ...working, popular: async () => { throw new Error("HTTP 500"); } };
  assert.deepEqual(await checkSource(failing, { timeoutMs: 1000 }), { status: "broken", step: "popular", error: "HTTP 500" });
});

test("timeouts are reported", async () => {
  const slow = { ...working, pages: () => new Promise(() => {}) };
  const result = await checkSource(slow, { timeoutMs: 20 });
  assert.equal(result.step, "pages");
  assert.match(result.error, /timed out/);
});

test("skips a manga with zero chapters and uses the next", async () => {
  const pagesFor = [];
  const source = {
    ...working,
    popular: async () => many(3),
    chapters: async (url) => (url === "/m/1" ? [] : [{ url: `/c${url}`, name: "Ch" }]),
    pages: async (url) => { pagesFor.push(url); return [{ url: "https://img/1.jpg" }]; },
  };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "ok", step: null, error: null });
  assert.deepEqual(pagesFor, ["/c/m/2"]);
});

test("skips a manga whose chapters throw", async () => {
  const source = {
    ...working,
    popular: async () => many(2),
    chapters: async (url) => {
      if (url === "/m/1") throw new Error("HTTP 404");
      return [{ url: "/c/2", name: "Ch" }];
    },
  };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "ok", step: null, error: null });
});

test("only the first 5 manga are tried", async () => {
  let calls = 0;
  const source = {
    ...working,
    popular: async () => many(8),
    chapters: async () => { calls++; return []; },
  };
  const result = await checkSource(source, { timeoutMs: 1000 });
  assert.equal(calls, 5);
  assert.deepEqual(result, { status: "broken", step: "chapters", error: "no chapters returned for first 5 manga" });
});

test("all five throwing reports the last error", async () => {
  const source = {
    ...working,
    popular: async () => many(5),
    chapters: async (url) => { throw new Error(`boom ${url}`); },
  };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "broken", step: "chapters", error: "boom /m/5" });
});

test("a pages failure stays fatal", async () => {
  const source = { ...working, popular: async () => many(3), pages: async () => [] };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "broken", step: "pages", error: "no pages returned" });
});

test("applyHealth writes status and time", () => {
  const index = { sources: [{ id: "a", health: { status: "unknown", checkedAt: null } }, { id: "b", health: { status: "ok", checkedAt: "x" } }] };
  const out = applyHealth(index, { a: { status: "broken" } }, "2026-11-01T06:00:00.000Z");
  assert.deepEqual(out.sources[0].health, { status: "broken", checkedAt: "2026-11-01T06:00:00.000Z" });
  assert.deepEqual(out.sources[1].health, { status: "ok", checkedAt: "x" });
});

test("reports chapters when some candidates reached chapters and others failed in details", async () => {
  const source = {
    ...working,
    popular: async () => many(3),
    details: async (url) => { if (url === "/m/3") throw new Error("HTTP 403"); return { title: "T" }; },
    chapters: async () => [],
  };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "broken", step: "chapters", error: "no chapters returned for first 3 manga" });
});

test("reports the last failing step when no candidate reached chapters", async () => {
  const source = {
    ...working,
    popular: async () => many(3),
    details: async (url) => { if (url === "/m/3") throw new Error("HTTP 403"); return {}; },
  };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "broken", step: "details", error: "HTTP 403" });
});

test("a details failure after a chapters failure still reports chapters with its error", async () => {
  const source = {
    ...working,
    popular: async () => many(2),
    details: async (url) => { if (url === "/m/2") throw new Error("HTTP 500"); return { title: "T" }; },
    chapters: async () => { throw new Error("HTTP 404"); },
  };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "broken", step: "chapters", error: "HTTP 404" });
});

test("selectEntries rejects an unknown id", () => {
  const index = { sources: [{ id: "a" }, { id: "b" }] };
  assert.deepEqual(selectEntries(index, "b"), [{ id: "b" }]);
  assert.deepEqual(selectEntries(index, null), index.sources);
  assert.throws(() => selectEntries(index, "zzz"), /unknown source id: zzz/);
});

test("a load failure is recorded and the run continues", async () => {
  const entries = [{ id: "a" }, { id: "b" }];
  const logs = [];
  const results = await checkEntries(entries, {
    load: (e) => { if (e.id === "a") throw new Error("syntax error"); return working; },
    check: async () => ({ status: "ok", step: null, error: null }),
    log: (l) => logs.push(l),
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(results).map(([id, { checkedAt, sha256, ...r }]) => [id, r])),
    {
      a: { status: "broken", step: "load", error: "syntax error" },
      b: { status: "ok", step: null, error: null },
    },
  );
  assert.equal(logs.length, 2);
});

test("applyHealth from a saved report ignores ids missing from the index", () => {
  const index = { sources: [{ id: "a", health: { status: "unknown", checkedAt: null } }] };
  const out = applyHealth(index, { a: { status: "ok" }, gone: { status: "broken" } }, "t");
  assert.deepEqual(out.sources, [{ id: "a", health: { status: "ok", checkedAt: "t" } }]);
});

test("the chapters message reports how many manga were actually tried", async () => {
  const source = { ...working, popular: async () => many(2), chapters: async () => [] };
  assert.deepEqual(await checkSource(source, { timeoutMs: 1000 }), { status: "broken", step: "chapters", error: "no chapters returned for first 2 manga" });
});

test("checkEntries records sha256 and checkedAt per result", async () => {
  const results = await checkEntries([{ id: "a", sha256: "h1" }, { id: "b", sha256: "h2" }], {
    load: () => working,
    check: async () => ({ status: "ok", step: null, error: null }),
  });
  for (const [id, sha] of [["a", "h1"], ["b", "h2"]]) {
    assert.equal(results[id].sha256, sha);
    assert.ok(!Number.isNaN(Date.parse(results[id].checkedAt)));
  }
  const failed = await checkEntries([{ id: "c", sha256: "h3" }], { load: () => { throw new Error("x"); } });
  assert.equal(failed.c.sha256, "h3");
  assert.ok(failed.c.checkedAt);
});

test("applyHealth skips results for a different script version", () => {
  const index = { sources: [{ id: "a", sha256: "new", health: { status: "unknown", checkedAt: null } }] };
  const out = applyHealth(index, { a: { status: "broken", sha256: "old", checkedAt: "c" } }, "t");
  assert.deepEqual(out.sources[0].health, { status: "unknown", checkedAt: null });
});

test("applyHealth applies matching or legacy results and prefers result.checkedAt", () => {
  const index = { sources: [{ id: "a", sha256: "h", health: {} }, { id: "b", sha256: "h", health: {} }] };
  const out = applyHealth(index, { a: { status: "ok", sha256: "h", checkedAt: "c" }, b: { status: "ok" } }, "t");
  assert.deepEqual(out.sources[0].health, { status: "ok", checkedAt: "c" });
  assert.deepEqual(out.sources[1].health, { status: "ok", checkedAt: "t" });
});

const blocked = (url) => async () => {
  throw new CloudflareError(url);
};

test("Cloudflare on popular is unverified, not broken", async () => {
  const result = await checkSource({ ...working, popular: blocked("https://s.test/ajax") }, { timeoutMs: 1000 });
  assert.deepEqual(result, { status: "unverified", step: "popular", error: "Cloudflare challenge at https://s.test/ajax" });
});

test("Cloudflare on pages is unverified", async () => {
  const result = await checkSource({ ...working, pages: blocked("https://s.test/c/1") }, { timeoutMs: 1000 });
  assert.equal(result.status, "unverified");
  assert.equal(result.step, "pages");
});

test("Cloudflare on every candidate's details is unverified", async () => {
  const result = await checkSource({ ...working, details: blocked("https://s.test/m/1") }, { timeoutMs: 1000 });
  assert.equal(result.status, "unverified");
  assert.equal(result.step, "details");
});

test("a real failure on chapters stays broken even if another candidate hit Cloudflare", async () => {
  const two = { ...working, popular: async () => ({ manga: [{ url: "/m/1" }, { url: "/m/2" }], hasNextPage: false }) };
  let calls = 0;
  two.details = async (url) => {
    calls++;
    if (url === "/m/1") throw new CloudflareError("https://s.test/m/1");
    return { title: "Two" };
  };
  two.chapters = async () => [];
  const result = await checkSource(two, { timeoutMs: 1000 });
  assert.equal(calls, 2);
  assert.equal(result.status, "broken");
  assert.equal(result.step, "chapters");
});

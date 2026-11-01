import { test } from "node:test";
import assert from "node:assert/strict";
import { watchedPaths, diffUpstream } from "./upstream-watch.mjs";

test("watched paths include sources and their templates", () => {
  const metas = [
    { id: "en.a", upstream: "src/en/a", template: "madara" },
    { id: "en.b", upstream: "src/en/b" },
    { id: "en.c" },
  ];
  assert.deepEqual(watchedPaths(metas), {
    "src/en/a": ["en.a"],
    "lib-multisrc/madara": ["en.a"],
    "src/en/b": ["en.b"],
  });
});

test("first sighting records without reporting", () => {
  const { changes, nextLock } = diffUpstream({}, { "src/en/a": "s1" });
  assert.deepEqual(changes, []);
  assert.deepEqual(nextLock, { "src/en/a": "s1" });
});

test("changed sha is reported", () => {
  const { changes, nextLock } = diffUpstream({ "src/en/a": "s1", "src/en/b": "t1" }, { "src/en/a": "s2", "src/en/b": "t1" });
  assert.deepEqual(changes, [{ path: "src/en/a", from: "s1", to: "s2" }]);
  assert.deepEqual(nextLock, { "src/en/a": "s2", "src/en/b": "t1" });
});

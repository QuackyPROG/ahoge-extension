import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedIds } from "./changed-ids.mjs";

const sources = [
  { id: "en.a", dir: "sources/en/a", template: "madara" },
  { id: "en.b", dir: "sources/en/b", template: "mangathemesia" },
  { id: "en.ab", dir: "sources/en/ab" },
];

test("a source dir change affects only that source", () => {
  assert.deepEqual(affectedIds(["sources/en/a/source.js", "sources/en/a/a.test.mjs"], sources), ["en.a"]);
  assert.deepEqual(affectedIds(["sources/en/ab/meta.json"], sources), ["en.ab"]);
});

test("a template change affects its sources; common and runtime affect all", () => {
  assert.deepEqual(affectedIds(["templates/mangathemesia.js"], sources), ["en.b"]);
  assert.deepEqual(affectedIds(["templates/madara.test.mjs"], sources), []);
  assert.deepEqual(affectedIds(["templates/_common.js"], sources), ["en.a", "en.ab", "en.b"]);
  assert.deepEqual(affectedIds(["runtime/html.mjs"], sources), ["en.a", "en.ab", "en.b"]);
});

test("other files affect nothing", () => {
  assert.deepEqual(affectedIds(["README.md", ".github/workflows/x.yml", ""], sources), []);
});

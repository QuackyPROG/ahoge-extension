import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./build.mjs";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "ahoge-build-"));
  mkdirSync(join(root, "templates"));
  writeFileSync(join(root, "templates", "_common.js"), "// common\n");
  const dir = join(root, "sources", "en", "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: "en.demo", name: "Demo", lang: "en", version: "1.0.0", nsfw: false, baseUrl: "https://demo.test" }));
  writeFileSync(join(dir, "source.js"), "source = { async popular() { return { manga: [], hasNextPage: false }; } };\n");
  writeFileSync(join(dir, "icon.png"), "PNG");
  return { root, dir, out: join(root, "out") };
}

test("writes index, dist and icons", () => {
  const { root, out } = repo();
  const index = build({ root, outDir: out, previousIndex: null });
  assert.equal(index.schema, 1);
  assert.equal(index.sources.length, 1);
  const s = index.sources[0];
  assert.equal(s.id, "en.demo");
  assert.equal(s.runtime, 1);
  assert.equal(s.script, "dist/en.demo.js");
  assert.equal(s.icon, "icons/en.demo.png");
  assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(s.health, { status: "unknown", checkedAt: null });
  assert.ok(existsSync(join(out, "dist", "en.demo.js")));
  assert.ok(existsSync(join(out, "icons", "en.demo.png")));
  assert.deepEqual(JSON.parse(readFileSync(join(out, "index.json"), "utf8")), index);
});

test("keeps previous health when the script is unchanged", () => {
  const { root, out } = repo();
  const first = build({ root, outDir: out, previousIndex: null });
  first.sources[0].health = { status: "ok", checkedAt: "2026-11-01T00:00:00Z" };
  const second = build({ root, outDir: out, previousIndex: first });
  assert.deepEqual(second.sources[0].health, { status: "ok", checkedAt: "2026-11-01T00:00:00Z" });
});

test("resets health when the script changes", () => {
  const { root, dir, out } = repo();
  const first = build({ root, outDir: out, previousIndex: null });
  first.sources[0].health = { status: "broken", checkedAt: "2026-11-01T00:00:00Z" };
  writeFileSync(join(dir, "source.js"), "source = { async popular() { return { manga: [], hasNextPage: true }; } };\n");
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: "en.demo", name: "Demo", lang: "en", version: "1.0.1", nsfw: false, baseUrl: "https://demo.test" }));
  const second = build({ root, outDir: out, previousIndex: first });
  assert.deepEqual(second.sources[0].health, { status: "unknown", checkedAt: null });
});

test("changed script without version bump fails", () => {
  const { root, dir, out } = repo();
  const first = build({ root, outDir: out, previousIndex: null });
  writeFileSync(join(dir, "source.js"), "source = { async popular() { return null; } };\n");
  assert.throws(() => build({ root, outDir: out, previousIndex: first }), /en\.demo changed but version 1\.0\.0 was not bumped/);
});

test("duplicate ids fail", () => {
  const { root, dir, out } = repo();
  cpSync(dir, join(root, "sources", "en", "demo2"), { recursive: true });
  assert.throws(() => build({ root, outDir: out, previousIndex: null }), /duplicate id en\.demo/);
});

test("stale dist files are removed", () => {
  const { root, out } = repo();
  build({ root, outDir: out, previousIndex: null });
  writeFileSync(join(out, "dist", "en.gone.js"), "old");
  build({ root, outDir: out, previousIndex: null });
  assert.ok(!existsSync(join(out, "dist", "en.gone.js")));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleSource } from "./bundle.mjs";
import { loadSource } from "../../runtime/host.mjs";

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "ahoge-bundle-"));
  mkdirSync(join(root, "templates"));
  writeFileSync(join(root, "templates", "_common.js"), "function helper() { return 'h'; }\n");
  writeFileSync(join(root, "templates", "demo.js"), "function Demo(c) { return { async popular() { return { manga: [{ url: '/x', title: c.baseUrl + helper(), cover: '' }], hasNextPage: false }; } }; }\n");
  const dir = join(root, "sources", "en", "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: "en.demo", name: "Demo", lang: "en", version: "1.0.0", nsfw: false, baseUrl: "https://demo.test", template: "demo" }));
  writeFileSync(join(dir, "source.js"), "source = Demo({ baseUrl: META.baseUrl });\n");
  return { root, dir };
}

test("bundle inlines META, common, template and source", async () => {
  const { root, dir } = fixtureRepo();
  const { meta, script } = bundleSource(root, dir);
  assert.equal(meta.id, "en.demo");
  assert.ok(script.startsWith("var source = null;\nconst META = "));
  const result = await loadSource(script).popular(1);
  assert.equal(result.manga[0].title, "https://demo.testh");
});

// Prints the source ids a set of changed files affects, comma-separated (empty when none).
// Usage: git diff --name-only <base> | node scripts/changed-ids.mjs
// A source dir changes that source; templates/<t>.js changes every source on template t;
// templates/_common.js or runtime/ changes every source.
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listSourceDirs } from "./lib/bundle.mjs";

export function affectedIds(files, sources) {
  const ids = new Set();
  for (const raw of files) {
    const f = raw.trim().replace(/\\/g, "/");
    if (!f) continue;
    if (f === "templates/_common.js" || f.startsWith("runtime/")) return sources.map((s) => s.id).sort();
    const tpl = f.match(/^templates\/([^/_][^/]*)\.js$/);
    if (tpl) for (const s of sources) if (s.template === tpl[1]) ids.add(s.id);
    for (const s of sources) if (f.startsWith(s.dir + "/") && !f.endsWith(".test.mjs")) ids.add(s.id);
  }
  return [...ids].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..");
  const sources = listSourceDirs(root).map((d) => ({ ...JSON.parse(readFileSync(join(d, "meta.json"), "utf8")), dir: relative(root, d).replace(/\\/g, "/") }));
  const files = readFileSync(0, "utf8").split("\n");
  process.stdout.write(affectedIds(files, sources).join(","));
}

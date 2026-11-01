import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateMeta } from "./meta.mjs";

export function listTemplates(root) {
  return readdirSync(join(root, "templates"))
    .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
    .map((f) => f.slice(0, -3));
}

export function bundleSource(root, sourceDir) {
  const meta = JSON.parse(readFileSync(join(sourceDir, "meta.json"), "utf8"));
  const errors = validateMeta(meta, listTemplates(root));
  if (errors.length) throw new Error(`${sourceDir}: ${errors.join("; ")}`);
  const parts = [
    "var source = null;",
    `const META = ${JSON.stringify(meta)};`,
    readFileSync(join(root, "templates", "_common.js"), "utf8"),
  ];
  if (meta.template) parts.push(readFileSync(join(root, "templates", `${meta.template}.js`), "utf8"));
  parts.push(readFileSync(join(sourceDir, "source.js"), "utf8"));
  return { meta, script: parts.join("\n") };
}

export function listSourceDirs(root) {
  const base = join(root, "sources");
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((lang) =>
      readdirSync(join(base, lang.name), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(base, lang.name, d.name)),
    )
    .sort();
}

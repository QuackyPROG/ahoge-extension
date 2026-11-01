import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSource, listSourceDirs } from "./lib/bundle.mjs";
import { RUNTIME_VERSION } from "../runtime/host.mjs";

const UNKNOWN_HEALTH = { status: "unknown", checkedAt: null };

export function build({ root, outDir, previousIndex }) {
  const previous = new Map((previousIndex?.sources ?? []).map((s) => [s.id, s]));
  const seen = new Set();
  const built = listSourceDirs(root).map((dir) => {
    const { meta, script } = bundleSource(root, dir);
    if (seen.has(meta.id)) throw new Error(`duplicate id ${meta.id}`);
    seen.add(meta.id);

    const sha256 = createHash("sha256").update(script).digest("hex");
    const prior = previous.get(meta.id);
    if (prior && prior.sha256 !== sha256 && prior.version === meta.version) {
      throw new Error(`${meta.id} changed but version ${meta.version} was not bumped`);
    }

    const iconPath = join(dir, "icon.png");
    const hasIcon = existsSync(iconPath);
    const icon = hasIcon ? `icons/${meta.id}.png` : null;

    return {
      files: { id: meta.id, script, iconPath: hasIcon ? iconPath : null },
      entry: {
        id: meta.id,
        name: meta.name,
        lang: meta.lang,
        version: meta.version,
        runtime: RUNTIME_VERSION,
        nsfw: meta.nsfw,
        baseUrl: meta.baseUrl,
        icon,
        script: `dist/${meta.id}.js`,
        sha256,
        health: (prior && prior.sha256 === sha256 && prior.health) || { ...UNKNOWN_HEALTH },
      },
    };
  });

  // Everything validated in memory; only now touch the output directory.
  for (const sub of ["dist", "icons"]) {
    rmSync(join(outDir, sub), { recursive: true, force: true });
    mkdirSync(join(outDir, sub), { recursive: true });
  }
  for (const { files } of built) {
    writeFileSync(join(outDir, "dist", `${files.id}.js`), files.script);
    if (files.iconPath) copyFileSync(files.iconPath, join(outDir, "icons", `${files.id}.png`));
  }

  const sources = built.map((b) => b.entry);
  const index = { schema: 1, name: "Ahoge Extensions", sources };
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..");
  const outDir = resolve(arg("--out") ?? "out");
  const previousPath = arg("--previous");
  const previousIndex = previousPath && existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, "utf8")) : null;
  const index = build({ root, outDir, previousIndex });
  console.log(`built ${index.sources.length} sources into ${outDir}`);
}

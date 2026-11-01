import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../runtime/host.mjs";

const MAX_CANDIDATES = 5;

function withTimeout(promise, ms, step) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${step} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function checkSource(source, { timeoutMs = 30000 } = {}) {
  let step = "popular";
  const run = (name, fn) => {
    step = name;
    return withTimeout(Promise.resolve().then(fn), timeoutMs, name);
  };
  try {
    const list = await run("popular", () => source.popular(1));
    if (!list?.manga?.length) return { status: "broken", step, error: "no manga returned" };

    // The most popular titles can be licensed and have no readable chapters, so try a few.
    let chosen = null;
    let failure = { step: "chapters", error: `no chapters returned for first ${MAX_CANDIDATES} manga` };
    for (const manga of list.manga.slice(0, MAX_CANDIDATES)) {
      try {
        const details = await run("details", () => source.details(manga.url));
        if (!details?.title) {
          failure = { step: "details", error: "details missing title" };
          continue;
        }
        const chapters = await run("chapters", () => source.chapters(manga.url));
        if (!chapters?.length) {
          failure = { step: "chapters", error: `no chapters returned for first ${MAX_CANDIDATES} manga` };
          continue;
        }
        chosen = chapters[0];
        break;
      } catch (e) {
        failure = { step, error: String(e?.message ?? e) };
      }
    }
    if (!chosen) return { status: "broken", ...failure };

    const pages = await run("pages", () => source.pages(chosen.url));
    if (!pages?.length || !pages[0].url) return { status: "broken", step, error: "no pages returned" };
    return { status: "ok", step: null, error: null };
  } catch (e) {
    return { status: "broken", step, error: String(e?.message ?? e) };
  }
}

export function applyHealth(index, results, checkedAt) {
  return {
    ...index,
    sources: index.sources.map((s) => (results[s.id] ? { ...s, health: { status: results[s.id].status, checkedAt } } : s)),
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(arg("--dir") ?? "out");
  const only = arg("--only");
  const reportPath = arg("--report") ?? "health-report.json";
  const indexPath = join(dir, "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const results = {};
  for (const entry of index.sources.filter((s) => !only || s.id === only)) {
    const source = loadSource(readFileSync(join(dir, entry.script), "utf8"));
    results[entry.id] = await checkSource(source);
    const r = results[entry.id];
    console.log(`${r.status === "ok" ? "OK    " : "BROKEN"} ${entry.id}${r.step ? `  [${r.step}] ${r.error}` : ""}`);
  }
  writeFileSync(reportPath, JSON.stringify(results, null, 2) + "\n");
  if (process.argv.includes("--write")) {
    writeFileSync(indexPath, JSON.stringify(applyHealth(index, results, new Date().toISOString()), null, 2) + "\n");
  }
}

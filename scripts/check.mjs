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

// Tries one manga end to end up to chapters. The step is local so candidates never share state.
async function tryCandidate(source, manga, timeoutMs) {
  let step = "details";
  const run = (name, fn) => {
    step = name;
    return withTimeout(Promise.resolve().then(fn), timeoutMs, name);
  };
  try {
    const details = await run("details", () => source.details(manga.url));
    if (!details?.title) return { failure: { step: "details", error: "details missing title" } };
    const chapters = await run("chapters", () => source.chapters(manga.url));
    if (!chapters?.length) {
      return { failure: { step: "chapters", error: `no chapters returned for first ${MAX_CANDIDATES} manga` } };
    }
    return { chapter: chapters[0] };
  } catch (e) {
    return { failure: { step, error: String(e?.message ?? e) } };
  }
}

export async function checkSource(source, { timeoutMs = 30000 } = {}) {
  let step = "popular";
  try {
    const list = await withTimeout(Promise.resolve().then(() => source.popular(1)), timeoutMs, "popular");
    if (!list?.manga?.length) return { status: "broken", step, error: "no manga returned" };

    // The most popular titles can be licensed and have no readable chapters, so try a few.
    let chosen = null;
    let lastFailure = null;
    let chaptersFailure = null;
    for (const manga of list.manga.slice(0, MAX_CANDIDATES)) {
      const { chapter, failure } = await tryCandidate(source, manga, timeoutMs);
      if (chapter) {
        chosen = chapter;
        break;
      }
      lastFailure = failure;
      if (failure.step === "chapters") chaptersFailure = failure;
    }
    // Reaching chapters at all means details worked, so chapters is the most telling step.
    if (!chosen) return { status: "broken", ...(chaptersFailure ?? lastFailure) };

    step = "pages";
    const pages = await withTimeout(Promise.resolve().then(() => source.pages(chosen.url)), timeoutMs, "pages");
    if (!pages?.length || !pages[0].url) return { status: "broken", step, error: "no pages returned" };
    return { status: "ok", step: null, error: null };
  } catch (e) {
    return { status: "broken", step, error: String(e?.message ?? e) };
  }
}

export function selectEntries(index, only) {
  if (!only) return index.sources;
  const entries = index.sources.filter((s) => s.id === only);
  if (!entries.length) throw new Error(`unknown source id: ${only}`);
  return entries;
}

// A source that fails to load is recorded as broken instead of aborting the run.
export async function checkEntries(entries, { load, check = checkSource, log = () => {} }) {
  const results = {};
  for (const entry of entries) {
    try {
      results[entry.id] = await check(load(entry));
    } catch (e) {
      results[entry.id] = { status: "broken", step: "load", error: String(e?.message ?? e) };
    }
    const r = results[entry.id];
    log(`${r.status === "ok" ? "OK    " : "BROKEN"} ${entry.id}${r.step ? `  [${r.step}] ${r.error}` : ""}`);
  }
  return results;
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
  const reportPath = arg("--report") ?? "health-report.json";
  const applyPath = arg("--apply-report");
  const indexPath = join(dir, "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (applyPath) {
    // Re-apply a saved report to the current index without re-checking.
    const results = JSON.parse(readFileSync(applyPath, "utf8"));
    writeFileSync(indexPath, JSON.stringify(applyHealth(index, results, new Date().toISOString()), null, 2) + "\n");
  } else {
    let entries;
    try {
      entries = selectEntries(index, arg("--only"));
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
    const results = await checkEntries(entries, {
      load: (entry) => loadSource(readFileSync(join(dir, entry.script), "utf8")),
      log: console.log,
    });
    writeFileSync(reportPath, JSON.stringify(results, null, 2) + "\n");
    if (process.argv.includes("--write")) {
      writeFileSync(indexPath, JSON.stringify(applyHealth(index, results, new Date().toISOString()), null, 2) + "\n");
    }
  }
}

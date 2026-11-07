import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../runtime/host.mjs";
import { CloudflareError } from "../runtime/http.mjs";
import { validateFilters, defaultFilterValues } from "../runtime/filters.mjs";

const MAX_CANDIDATES = 5;

// GitHub's runners are datacenter IPs that Cloudflare challenges even when the site works on a phone,
// so a challenge means "could not verify from CI", not "broken".
const failureOf = (step, e) => ({ step, error: String(e?.message ?? e), cloudflare: e instanceof CloudflareError });
const result = ({ cloudflare, ...failure }) => ({ status: cloudflare ? "unverified" : "broken", ...failure });

function withTimeout(promise, ms, step) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${step} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Tries one manga end to end up to chapters. The step is local so candidates never share state.
async function tryCandidate(source, manga, timeoutMs, tried) {
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
      return { failure: { step: "chapters", error: `no chapters returned for first ${tried} manga` } };
    }
    return { chapter: chapters[0] };
  } catch (e) {
    return { failure: failureOf(step, e) };
  }
}

export async function checkSource(source, { timeoutMs = 30000 } = {}) {
  let step = "popular";
  try {
    const list = await withTimeout(Promise.resolve().then(() => source.popular(1)), timeoutMs, "popular");
    if (!list?.manga?.length) return { status: "broken", step, error: "no manga returned" };

    if (typeof source.filters === "function") {
      step = "filters";
      const filters = await withTimeout(Promise.resolve().then(() => source.filters()), timeoutMs, "filters");
      const errors = validateFilters(filters);
      if (errors.length) return { status: "broken", step, error: errors.join("; ") };
      if (filters.length) {
        step = "search";
        const filtered = await withTimeout(Promise.resolve().then(() => source.search("", 1, defaultFilterValues(filters))), timeoutMs, "search");
        if (!Array.isArray(filtered?.manga)) return { status: "broken", step, error: "filtered search returned no manga list" };
      }
    }

    // The most popular titles can be licensed and have no readable chapters, so try a few.
    let chosen = null;
    let lastFailure = null;
    let chaptersFailure = null;
    const candidates = list.manga.slice(0, MAX_CANDIDATES);
    for (const manga of candidates) {
      const { chapter, failure } = await tryCandidate(source, manga, timeoutMs, candidates.length);
      if (chapter) {
        chosen = chapter;
        break;
      }
      lastFailure = failure;
      if (failure.step === "chapters") chaptersFailure = failure;
    }
    // Reaching chapters at all means details worked, so chapters is the most telling step.
    if (!chosen) return result(chaptersFailure ?? lastFailure);

    step = "pages";
    const pages = await withTimeout(Promise.resolve().then(() => source.pages(chosen.url)), timeoutMs, "pages");
    if (!pages?.length || !pages[0].url) return { status: "broken", step, error: "no pages returned" };
    return { status: "ok", step: null, error: null };
  } catch (e) {
    return result(failureOf(step, e));
  }
}

// `only` is one id or a comma-separated list.
export function selectEntries(index, only) {
  if (!only) return index.sources;
  const ids = String(only).split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !index.sources.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown source id: ${unknown.join(", ")}`);
  return index.sources.filter((s) => ids.includes(s.id));
}

// A source that fails to load is recorded as broken instead of aborting the run.
export async function checkEntries(entries, { load, check = checkSource, log = () => {} }) {
  const results = {};
  for (const entry of entries) {
    const checkedAt = new Date().toISOString();
    let result;
    try {
      result = await check(load(entry));
    } catch (e) {
      result = { status: "broken", step: "load", error: String(e?.message ?? e) };
    }
    results[entry.id] = { ...result, sha256: entry.sha256, checkedAt };
    const r = results[entry.id];
    log(`${r.status.toUpperCase().padEnd(10)} ${entry.id}${r.step ? `  [${r.step}] ${r.error}` : ""}`);
  }
  return results;
}

export function applyHealth(index, results, checkedAt) {
  return {
    ...index,
    sources: index.sources.map((s) => {
      const r = results[s.id];
      // A result for a different script version (rebuilt since the check) must not be applied.
      if (!r || (r.sha256 !== undefined && r.sha256 !== s.sha256)) return s;
      return { ...s, health: { status: r.status, checkedAt: r.checkedAt ?? checkedAt } };
    }),
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
    // Cloudflare challenges GitHub's runners, so only "broken" fails a gate; "unverified" passes.
    if (process.argv.includes("--fail-on-broken") && Object.values(results).some((r) => r.status === "broken")) process.exitCode = 1;
    if (process.argv.includes("--write")) {
      writeFileSync(indexPath, JSON.stringify(applyHealth(index, results, new Date().toISOString()), null, 2) + "\n");
    }
  }
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { listSourceDirs } from "./lib/bundle.mjs";

const UPSTREAM_REPO = "keiyoushi/extensions-source";
const TEMPLATE_PATHS = { madara: "lib-multisrc/madara" };

export function watchedPaths(metas) {
  const paths = {};
  const add = (path, id) => (paths[path] ??= []).push(id);
  for (const m of metas) {
    if (!m.upstream) continue;
    add(m.upstream, m.id);
    if (m.template && TEMPLATE_PATHS[m.template]) add(TEMPLATE_PATHS[m.template], m.id);
  }
  return paths;
}

export function diffUpstream(lock, latest) {
  const changes = [];
  for (const [path, sha] of Object.entries(latest)) {
    if (lock[path] && lock[path] !== sha) changes.push({ path, from: lock[path], to: sha });
  }
  return { changes, nextLock: { ...lock, ...latest } };
}

export function pruneLock(lock, watched) {
  const keep = new Set(watched);
  return Object.fromEntries(Object.entries(lock).filter(([path]) => keep.has(path)));
}

export const upstreamTitle = (path) => `[upstream] ${path} changed`;

export function newChanges(changes, openTitles) {
  const existing = new Set(openTitles);
  return changes.filter((c) => !existing.has(upstreamTitle(c.path)));
}

async function latestSha(path) {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/commits?path=${encodeURIComponent(path)}&per_page=1`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  const [commit] = await res.json();
  return commit?.sha ?? null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..");
  const lockPath = join(root, "upstream.lock.json");
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
  const metas = listSourceDirs(root).map((d) => JSON.parse(readFileSync(join(d, "meta.json"), "utf8")));
  const paths = watchedPaths(metas);
  const latest = {};
  let failed = 0;
  for (const path of Object.keys(paths)) {
    try {
      const sha = await latestSha(path);
      if (sha) latest[path] = sha;
    } catch (e) {
      failed++;
      console.warn(`skipping ${path}: ${e.message}`);
    }
  }
  const diff = diffUpstream(lock, latest);
  const nextLock = pruneLock(diff.nextLock, Object.keys(paths));
  const openIssues = process.argv.includes("--open-issues");
  let toReport = diff.changes;
  if (openIssues) {
    try {
      const out = execFileSync("gh", ["issue", "list", "--label", "upstream", "--state", "open", "--json", "title", "--limit", "500"], { encoding: "utf8" });
      toReport = newChanges(diff.changes, JSON.parse(out).map((i) => i.title));
    } catch (e) {
      failed++;
      console.warn(`could not list open issues, not opening any: ${e.message}`);
      toReport = [];
    }
  }
  for (const change of diff.changes) {
    const title = upstreamTitle(change.path);
    console.log(title);
    if (!openIssues || !toReport.includes(change)) continue;
    const ids = paths[change.path].join(", ");
    const body = `keiyoushi changed \`${change.path}\`, used by: ${ids}.\n\nDiff: https://github.com/${UPSTREAM_REPO}/compare/${change.from}...${change.to}\n\nPort the relevant changes and bump each affected source's version.`;
    try {
      execFileSync("gh", ["issue", "create", "--title", title, "--body", body, "--label", "upstream"], { stdio: "inherit" });
    } catch (e) {
      // Keep the old sha so the change is reported again on the next run.
      failed++;
      console.warn(`could not open issue for ${change.path}: ${e.message}`);
      nextLock[change.path] = change.from;
    }
  }
  writeFileSync(lockPath, JSON.stringify(nextLock, null, 2) + "\n");
  console.log(`${diff.changes.length} upstream change(s), ${failed} failure(s)`);
  if (failed) process.exitCode = 1;
}

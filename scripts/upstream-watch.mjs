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
  for (const path of Object.keys(paths)) {
    const sha = await latestSha(path);
    if (sha) latest[path] = sha;
  }
  const { changes, nextLock } = diffUpstream(lock, latest);
  for (const change of changes) {
    const ids = paths[change.path].join(", ");
    const title = `[upstream] ${change.path} changed`;
    const body = `keiyoushi changed \`${change.path}\`, used by: ${ids}.\n\nDiff: https://github.com/${UPSTREAM_REPO}/compare/${change.from}...${change.to}\n\nPort the relevant changes and bump each affected source's version.`;
    console.log(title);
    if (process.argv.includes("--open-issues")) {
      execFileSync("gh", ["issue", "create", "--title", title, "--body", body, "--label", "upstream"], { stdio: "inherit" });
    }
  }
  writeFileSync(lockPath, JSON.stringify(nextLock, null, 2) + "\n");
  console.log(`${changes.length} upstream change(s)`);
}

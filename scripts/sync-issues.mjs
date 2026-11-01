import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PREFIX = "[broken] ";

// Keeps error text from closing the fenced block in the issue body.
const escapeFence = (text) => String(text ?? "").replaceAll("```", "ʼʼʼ");

export function planIssues(report, openIssues) {
  const openById = new Map(openIssues.filter((i) => i.title.startsWith(PREFIX)).map((i) => [i.title.slice(PREFIX.length), i]));
  const create = [];
  const close = [];
  for (const [id, r] of Object.entries(report)) {
    const existing = openById.get(id);
    if (r.status === "broken" && !existing) {
      create.push({ id, title: PREFIX + id, body: `Health check failed at \`${r.step}\`:\n\n\`\`\`\n${escapeFence(r.error)}\n\`\`\`` });
    } else if (r.status === "ok" && existing) {
      close.push({ number: existing.number, id });
    } else if (r.status === "unverified" && existing) {
      close.push({ number: existing.number, id, unverified: true });
    }
  }
  for (const [id, existing] of openById) {
    if (!(id in report)) close.push({ number: existing.number, id, removed: true });
  }
  return { create, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(readFileSync(process.argv[2] ?? "health-report.json", "utf8"));
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  gh(["label", "create", "broken-source", "--color", "d73a4a", "--force"]);
  const open = JSON.parse(gh(["issue", "list", "--label", "broken-source", "--state", "open", "--json", "number,title", "--limit", "500"]));
  const { create, close } = planIssues(report, open);
  let failed = 0;
  const attempt = (what, fn) => {
    try {
      fn();
    } catch (e) {
      failed++;
      console.error(`failed to ${what}: ${e.message}`);
    }
  };
  for (const issue of create) {
    attempt(`create "${issue.title}"`, () => gh(["issue", "create", "--title", issue.title, "--body", issue.body, "--label", "broken-source"]));
  }
  for (const issue of close) {
    const comment = issue.removed
      ? `${issue.id} is no longer in the source list, so this issue is closed.`
      : issue.unverified
        ? `${issue.id} is behind a Cloudflare challenge for GitHub's servers, so it can't be verified from CI. It is marked "unverified", not broken; check it on a device.`
        : `${issue.id} passes the health check again.`;
    attempt(`close #${issue.number}`, () => gh(["issue", "close", String(issue.number), "--comment", comment]));
  }
  console.log(`planned ${create.length} opened, ${close.length} closed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

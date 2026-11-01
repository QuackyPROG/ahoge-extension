import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PREFIX = "[broken] ";

export function planIssues(report, openIssues) {
  const openById = new Map(openIssues.filter((i) => i.title.startsWith(PREFIX)).map((i) => [i.title.slice(PREFIX.length), i]));
  const create = [];
  const close = [];
  for (const [id, r] of Object.entries(report)) {
    const existing = openById.get(id);
    if (r.status === "broken" && !existing) {
      create.push({ id, title: PREFIX + id, body: `Health check failed at \`${r.step}\`:\n\n\`\`\`\n${r.error}\n\`\`\`` });
    } else if (r.status === "ok" && existing) {
      close.push({ number: existing.number, id });
    }
  }
  return { create, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(readFileSync(process.argv[2] ?? "health-report.json", "utf8"));
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  gh(["label", "create", "broken-source", "--color", "d73a4a", "--force"]);
  const open = JSON.parse(gh(["issue", "list", "--label", "broken-source", "--state", "open", "--json", "number,title", "--limit", "500"]));
  const { create, close } = planIssues(report, open);
  for (const issue of create) gh(["issue", "create", "--title", issue.title, "--body", issue.body, "--label", "broken-source"]);
  for (const issue of close) gh(["issue", "close", String(issue.number), "--comment", `${issue.id} passes the health check again.`]);
  console.log(`opened ${create.length}, closed ${close.length}`);
}

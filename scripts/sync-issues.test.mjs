import { test } from "node:test";
import assert from "node:assert/strict";
import { planIssues } from "./sync-issues.mjs";

test("opens issues for newly broken and closes recovered", () => {
  const report = {
    "en.a": { status: "broken", step: "pages", error: "HTTP 500" },
    "en.b": { status: "ok", step: null, error: null },
    "en.c": { status: "broken", step: "popular", error: "x" },
  };
  const open = [{ number: 7, title: "[broken] en.b" }, { number: 8, title: "[broken] en.c" }];
  assert.deepEqual(planIssues(report, open), {
    create: [{ id: "en.a", title: "[broken] en.a", body: "Health check failed at `pages`:\n\n```\nHTTP 500\n```" }],
    close: [{ number: 7, id: "en.b" }],
  });
});

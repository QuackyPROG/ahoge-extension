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

test("closes open broken issues whose source is no longer in the report", () => {
  const report = { "en.a": { status: "broken", step: "pages", error: "x" } };
  const open = [{ number: 3, title: "[broken] en.a" }, { number: 4, title: "[broken] en.gone" }, { number: 5, title: "unrelated" }];
  assert.deepEqual(planIssues(report, open), {
    create: [],
    close: [{ number: 4, id: "en.gone", removed: true }],
  });
});

test("triple backticks in the error cannot break the fence", () => {
  const report = { "en.a": { status: "broken", step: "popular", error: "bad ```html``` body" } };
  const [issue] = planIssues(report, []).create;
  assert.equal(issue.body, "Health check failed at `popular`:\n\n```\nbad ʼʼʼhtmlʼʼʼ body\n```");
});

test("unverified sources never open issues and close an existing broken issue", () => {
  const report = {
    "en.a": { status: "unverified", step: "popular", error: "Cloudflare challenge at https://a/ajax" },
    "en.b": { status: "unverified", step: "popular", error: "Cloudflare challenge at https://b/ajax" },
  };
  const open = [{ number: 26, title: "[broken] en.a" }];
  assert.deepEqual(planIssues(report, open), {
    create: [],
    close: [{ number: 26, id: "en.a", unverified: true }],
  });
});

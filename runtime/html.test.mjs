import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "./html.mjs";

const conformance = JSON.parse(readFileSync(new URL("./host-api-conformance.json", import.meta.url), "utf8"));

export function runCase(doc, c) {
  switch (c.op) {
    case "count": return doc.select(c.select).length;
    case "firstIsNull": return doc.selectFirst(c.select) === null;
    case "selfSelectCount": return doc.selectFirst(c.select).select(c.arg).length;
    case "attr": return doc.selectFirst(c.select).attr(c.arg);
    case "absUrl": return doc.selectFirst(c.select).absUrl(c.arg);
    default: return doc.selectFirst(c.select)[c.op]();
  }
}

for (const c of conformance.cases) {
  test(`conformance: ${c.name}`, () => {
    const doc = parse(c.html, conformance.baseUrl);
    assert.equal(runCase(doc, c), c.expected);
  });
}

test("document root tagName", () => {
  assert.equal(parse("<p>x</p>", "https://e.com/").tagName(), "#root");
});

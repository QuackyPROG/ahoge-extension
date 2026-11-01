import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, assertSupportedSelector } from "./html.mjs";

const conformance = JSON.parse(readFileSync(new URL("./host-api-conformance.json", import.meta.url), "utf8"));

export function runCase(doc, c) {
  if (c.op === "count") return doc.select(c.select).length;
  if (c.op === "firstIsNull") return doc.selectFirst(c.select) === null;
  if (c.op === "throws") {
    try {
      doc.select(c.select);
    } catch (e) {
      return e instanceof Error && e.message.startsWith("Unsupported selector: ");
    }
    return false;
  }
  const target = c.root ? doc : doc.selectFirst(c.select);
  assert.ok(target, `selector matched nothing: ${c.select}`);
  switch (c.op) {
    case "selfSelectCount": return target.select(c.arg).length;
    case "attr": return target.attr(c.arg);
    case "absUrl": return target.absUrl(c.arg);
    default: return target[c.op]();
  }
}

test("every conformance op is documented in ops", () => {
  for (const c of conformance.cases) assert.ok(c.op in conformance.ops, `undocumented op ${c.op}`);
});

for (const c of conformance.cases) {
  test(`conformance: ${c.name}`, () => {
    const doc = parse(c.html, c.baseUrl ?? conformance.baseUrl);
    assert.equal(runCase(doc, c), c.expected);
  });
}

test("selectFirst also rejects unsupported selectors", () => {
  assert.throws(() => parse("<p>x</p>", "https://e.com/").selectFirst("p:eq(0)"), /^Error: Unsupported selector: /);
});

test("assertSupportedSelector accepts supported selectors", () => {
  for (const css of ["li:first-child", "li:last-of-type", "a[href^=http]", "div.a > p:not(.b)", "p:contains(x y)", "p:containsOwn(x)", "li:nth-child(2n+1)", "p:has(a)"]) {
    assert.doesNotThrow(() => assertSupportedSelector(css), css);
  }
});

test("assertSupportedSelector error text names the feature", () => {
  assert.throws(() => assertSupportedSelector("li:eq(1)"), { message: /^Unsupported selector: :eq\(/ });
  assert.throws(() => assertSupportedSelector("li:odd"), { message: /^Unsupported selector: :odd/ });
  assert.throws(() => assertSupportedSelector(":matchesOwn(a)"), { message: /^Unsupported selector: :matchesOwn\(/ });
  assert.throws(() => assertSupportedSelector(':contains("a")'), { message: /^Unsupported selector: .*quoted/ });
});

test("noscript is parsed with scripting disabled", () => {
  const doc = parse("<div><noscript><img src='/a.jpg'></noscript></div>", "https://e.com/");
  assert.equal(doc.select("noscript > img").length, 1);
});

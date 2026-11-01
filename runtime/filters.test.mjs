import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFilters, defaultFilterValues } from "./filters.mjs";

const list = [
  { type: "header", name: "Basics" },
  { type: "separator" },
  { type: "text", key: "author", name: "Author" },
  { type: "checkbox", key: "chapters", name: "Has chapters", default: true },
  { type: "tristate", key: "color", name: "Full color" },
  { type: "select", key: "mode", name: "Mode", options: [{ value: "and", label: "AND" }, { value: "or", label: "OR" }], default: "or" },
  { type: "sort", key: "sort", name: "Sort", options: [{ value: "follows", label: "Follows" }] },
  { type: "group", key: "tags", name: "Tags", filters: [{ type: "tristate", key: "action", name: "Action" }] },
];

test("a well-formed list has no errors", () => {
  assert.deepEqual(validateFilters(list), []);
});

test("malformed entries are reported", () => {
  const errors = validateFilters([
    { type: "slider", key: "a", name: "A" },
    { type: "text", name: "No key" },
    { type: "checkbox", key: "x", name: "X" },
    { type: "checkbox", key: "x", name: "X again" },
    { type: "select", key: "s", name: "S", options: [] },
    { type: "group", key: "g", name: "G", filters: [{ type: "select", key: "inner", name: "I", options: [{ value: "a", label: "A" }] }] },
  ]);
  assert.deepEqual(errors, [
    'filters[0] has unknown type "slider"',
    "filters[1] needs a key",
    "filters[3] repeats key x",
    "filters[4] needs options",
    "filters[5].filters[0] must be text, checkbox or tristate",
  ]);
});

test("default values match what the app sends", () => {
  assert.deepEqual(defaultFilterValues(list), {
    author: "",
    chapters: true,
    color: 0,
    mode: "or",
    sort: { value: "follows", ascending: false },
    tags: { action: 0 },
  });
});

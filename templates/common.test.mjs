import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "../runtime/html.mjs";

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL("./_common.js", import.meta.url), "utf8"), ctx);
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

test("pathOf strips origin, query and hash", () => {
  assert.equal(ctx.pathOf("https://a.com/manga/x/?q=1#c"), "/manga/x/");
  assert.equal(ctx.pathOf("https://a.com"), "/");
  assert.equal(ctx.pathOf("/already/path"), "/already/path");
});

test("query builds encoded query strings with raw keys", () => {
  assert.equal(ctx.query([["includes[]", "cover_art"], ["title", "one piece"]]), "includes[]=cover_art&title=one%20piece");
});

test("parseStatus maps common words", () => {
  assert.equal(ctx.parseStatus("OnGoing"), "ongoing");
  assert.equal(ctx.parseStatus("Completed"), "completed");
  assert.equal(ctx.parseStatus("On Hold"), "hiatus");
  assert.equal(ctx.parseStatus("Dropped"), "cancelled");
  assert.equal(ctx.parseStatus("???"), "unknown");
});

test("parseDate handles relative and absolute dates", () => {
  assert.equal(ctx.parseDate("2 days ago", NOW), NOW - 2 * 86400000);
  assert.equal(ctx.parseDate("3 hours ago", NOW), NOW - 3 * 3600000);
  assert.equal(ctx.parseDate("1 week ago", NOW), NOW - 7 * 86400000);
  assert.equal(ctx.parseDate("yesterday", NOW), NOW - 86400000);
  assert.equal(ctx.parseDate("January 5, 2024", NOW), new Date("January 5, 2024").getTime());
  assert.equal(ctx.parseDate("", NOW), null);
  assert.equal(ctx.parseDate("not a date", NOW), null);
});

test("chapterNumber extracts numbers", () => {
  assert.equal(ctx.chapterNumber("Chapter 12.5 - The End"), 12.5);
  assert.equal(ctx.chapterNumber("Ep. 3"), 3);
  assert.equal(ctx.chapterNumber("Vol.2 Ch.7"), 7);
  assert.equal(ctx.chapterNumber("Prologue"), -1);
});

test("imageUrl prefers lazy attributes", () => {
  const doc = parse("<img id=a data-src=' /lazy.jpg ' src='/ph.gif'><img id=b src='/real.jpg'>", "https://a.com/x/");
  assert.equal(ctx.imageUrl(doc.selectFirst("#a")), "https://a.com/lazy.jpg");
  assert.equal(ctx.imageUrl(doc.selectFirst("#b")), "https://a.com/real.jpg");
  assert.equal(ctx.imageUrl(null), "");
});

test("unique removes case-insensitive duplicates", () => {
  assert.deepEqual([...ctx.unique(["Action", "action", "Drama"])], ["Action", "Drama"]);
});

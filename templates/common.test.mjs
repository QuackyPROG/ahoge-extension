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
  assert.equal(ctx.parseDate("January 5, 2024", NOW), Date.UTC(2024, 0, 5));
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

test("pathOf handles protocol-relative URLs", () => {
  assert.equal(ctx.pathOf("//cdn.a.com/x/y?q=1"), "/x/y");
  assert.equal(ctx.pathOf("//cdn.a.com"), "/");
});

test("parseStatus uses whole words and negations", () => {
  assert.equal(ctx.parseStatus("Not Completed"), "ongoing");
  assert.equal(ctx.parseStatus("Incomplete"), "ongoing");
  assert.equal(ctx.parseStatus("Unfinished"), "ongoing");
  assert.equal(ctx.parseStatus("Publishing finished"), "completed");
  assert.equal(ctx.parseStatus("Ended"), "completed");
  assert.equal(ctx.parseStatus("Finished"), "completed");
  assert.equal(ctx.parseStatus("Publishing"), "ongoing");
  assert.equal(ctx.parseStatus("Hiatus"), "hiatus");
  assert.equal(ctx.parseStatus("Calendar"), "unknown");
});

test("parseDate accepts articles in relative dates", () => {
  assert.equal(ctx.parseDate("an hour ago", NOW), NOW - 3600000);
  assert.equal(ctx.parseDate("a day ago", NOW), NOW - 86400000);
  assert.equal(ctx.parseDate("A month ago", NOW), NOW - 2592000000);
  assert.equal(ctx.parseDate("1 hours ago", NOW), NOW - 3600000);
  assert.equal(ctx.parseDate("just now", NOW), NOW);
  assert.equal(ctx.parseDate("today", NOW), NOW);
});

test("parseDate parses absolute formats deterministically as UTC midnight", () => {
  const jan5 = Date.UTC(2024, 0, 5);
  assert.equal(ctx.parseDate("2024-01-05", NOW), jan5);
  assert.equal(ctx.parseDate("2024-01-05T10:30:00Z", NOW), Date.UTC(2024, 0, 5, 10, 30));
  assert.equal(ctx.parseDate("2024-01-05T10:30:00+02:00", NOW), Date.UTC(2024, 0, 5, 8, 30));
  assert.equal(ctx.parseDate("Jan 5, 2024", NOW), jan5);
  assert.equal(ctx.parseDate("Jan 5 2024", NOW), jan5);
  assert.equal(ctx.parseDate("JANUARY 5 2024", NOW), jan5);
  assert.equal(ctx.parseDate("Sept 9, 2023", NOW), Date.UTC(2023, 8, 9));
  assert.equal(ctx.parseDate("Sep 9, 2023", NOW), Date.UTC(2023, 8, 9));
  assert.equal(ctx.parseDate("5 January 2024", NOW), jan5);
  assert.equal(ctx.parseDate("5 jan 2024", NOW), jan5);
  assert.equal(ctx.parseDate("01/05/2024", NOW), jan5);
  assert.equal(ctx.parseDate("12/31/2023", NOW), Date.UTC(2023, 11, 31));
});

test("parseDate returns null for unsupported or invalid input", () => {
  assert.equal(ctx.parseDate("garbage", NOW), null);
  assert.equal(ctx.parseDate("Foo 5, 2024", NOW), null);
  assert.equal(ctx.parseDate("13/45/2024", NOW), null);
  assert.equal(ctx.parseDate("2024/01/05", NOW), null);
  assert.equal(ctx.parseDate(null, NOW), null);
});

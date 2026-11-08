import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { listSourceDirs } from "./lib/bundle.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");

// Every source ships a 192x192 PNG icon (keiyoushi's xxxhdpi launcher size).
test("every source has a 192x192 PNG icon", () => {
  const problems = [];
  for (const dir of listSourceDirs(root)) {
    const path = join(dir, "icon.png");
    if (!existsSync(path)) {
      problems.push(`${basename(dir)}: missing icon.png`);
      continue;
    }
    const b = readFileSync(path);
    const isPng = b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR";
    if (!isPng) problems.push(`${basename(dir)}: icon.png is not a PNG`);
    else if (b.readUInt32BE(16) !== 192 || b.readUInt32BE(20) !== 192) problems.push(`${basename(dir)}: icon is ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`);
  }
  assert.deepEqual(problems, []);
});

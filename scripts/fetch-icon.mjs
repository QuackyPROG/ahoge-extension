// Usage: node scripts/fetch-icon.mjs <keiyoushi path, e.g. src/en/manhuaplus> <dest.png>
import { writeFileSync } from "node:fs";

const [upstream, dest] = process.argv.slice(2);
if (!upstream || !dest) {
  console.error("usage: node scripts/fetch-icon.mjs <upstream path> <dest.png>");
  process.exit(2);
}
const url = `https://raw.githubusercontent.com/keiyoushi/extensions-source/main/${upstream}/res/mipmap-xxxhdpi/ic_launcher.png`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`HTTP ${res.status} for ${url}`);
  process.exit(1);
}
writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
console.log(`saved ${dest}`);

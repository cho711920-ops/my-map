import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".cloudflare-assets");
const directories = ["assets", "css", "data", "icons", "js"];
const files = [
  "index.html",
  "favicon.svg",
  "manifest.webmanifest",
  "daangn-collector-install.html",
  "naver-collector-install.html"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const directory of directories) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}

console.log(`Cloudflare assets prepared in ${output}`);

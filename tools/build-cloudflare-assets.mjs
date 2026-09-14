import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, sep } from "node:path";
import { transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".cloudflare-assets");
const directories = ["assets", "css", "data", "icons", "js"];
const files = [
  "_headers",
  "index.html",
  "favicon.svg",
  "manifest.webmanifest",
  "offline.html",
  "collector-install.html",
  "daangn-collector-install.html",
  "gongsil-collector-install.html",
  "naver-collector-install.html"
];

export async function minifyPublicAsset(source, filename) {
  const loader = filename.endsWith(".css") ? "css" : "js";
  const result = await transform(source, {
    loader,
    sourcefile: filename,
    target: loader === "js" ? "es2020" : "chrome100",
    minifyWhitespace: true,
    minifySyntax: true,
    // Inline HTML actions and older modules call global function names.
    // Avoid renaming these public contracts or wrapping classic scripts.
    minifyIdentifiers: false,
    legalComments: "inline",
    charset: "utf8"
  });
  return result.code;
}

export function assetDigest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function versionHtmlAssets(html, digests) {
  const publicUrls = new Set();
  const content = html.replace(/\b(src|href)="([^"]+)"/g, (original, attribute, value) => {
    const decoded = value.replaceAll("&amp;", "&");
    if (/^(?:[a-z]+:|\/\/|#)/i.test(decoded)) return original;
    const url = new URL(decoded, "https://js-map.invalid/");
    const path = url.pathname.slice(1);
    const digest = digests.get(path);
    if (!/^(?:js\/.*\.js|css\/.*\.css)$/.test(path) || !digest) return original;
    url.searchParams.set("build", digest.slice(0, 16));
    const versioned = url.pathname + url.search;
    publicUrls.add(versioned);
    return `${attribute}="${versioned.replaceAll("&", "&amp;")}"`;
  });
  return { content, publicUrls: [...publicUrls].sort() };
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? listFiles(resolve(directory, entry.name), path + "/") : [path];
  }));
  return nested.flat().sort();
}

export async function buildCloudflareAssets() {
  const relativeOutput = relative(root, output);
  if (relativeOutput !== ".cloudflare-assets" || output === root || relativeOutput.startsWith(".." + sep)) {
    throw new Error("The asset output must be the dedicated .cloudflare-assets directory.");
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all([
    ...directories.map((directory) => cp(resolve(root, directory), resolve(output, directory), { recursive: true })),
    ...files.map((file) => cp(resolve(root, file), resolve(output, file)))
  ]);

  const paths = await listFiles(output);
  let sourceBytes = 0;
  let minifiedBytes = 0;
  const digests = new Map();
  await Promise.all(paths.map(async (path) => {
    const file = resolve(output, path);
    let contents = await readFile(file);
    if (/^(?:js\/.*\.js|css\/.*\.css)$/.test(path)) {
      sourceBytes += contents.byteLength;
      contents = Buffer.from(await minifyPublicAsset(contents.toString("utf8"), path));
      minifiedBytes += contents.byteLength;
      await writeFile(file, contents);
    }
    digests.set(path, assetDigest(contents));
  }));

  const versionedUrls = new Set();
  await Promise.all(paths.filter((path) => path.endsWith(".html")).map(async (path) => {
    const html = await readFile(resolve(output, path), "utf8");
    const versioned = versionHtmlAssets(html, digests);
    await writeFile(resolve(output, path), versioned.content);
    digests.set(path, assetDigest(versioned.content));
    versioned.publicUrls.forEach((url) => versionedUrls.add(url));
  }));
  const workerTemplate = await readFile(resolve(root, "sw.js"), "utf8");
  const version = assetDigest(workerTemplate + "\n" + [...digests.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, digest]) => `${path}:${digest}`).join("\n")).slice(0, 24);
  const publicUrls = [...new Set([
    ...versionedUrls,
    "/offline", "/icons/js-192.png", "/icons/js-512.png", "/manifest.webmanifest"
  ])].sort();
  const worker = workerTemplate
    .replace('"__JS_MAP_BUILD_VERSION__"', JSON.stringify(version))
    .replace("/* __JS_MAP_PUBLIC_ASSETS__ */ []", JSON.stringify(publicUrls));
  await writeFile(resolve(output, "sw.js"), await minifyPublicAsset(worker, "sw.js"));
  console.log(`Cloudflare assets prepared in ${output}; JS/CSS ${sourceBytes} -> ${minifiedBytes} bytes; public cache ${version}`);
  return { version, sourceBytes, minifiedBytes, publicUrls };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await buildCloudflareAssets();

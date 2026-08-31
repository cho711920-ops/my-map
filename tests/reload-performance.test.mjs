import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const dataAccess = fs.readFileSync("js/data-access-v6.js", "utf8");
const auth = fs.readFileSync("js/auth-gate-v1.js", "utf8");
const map = fs.readFileSync("js/map.js", "utf8");
const script = fs.readFileSync("js/script.js", "utf8");
const initialCache = fs.readFileSync("js/initial-listings-cache-v1.js", "utf8");
const worker = fs.readFileSync("cloudflare/src/worker.js", "utf8");

test("authenticated reload overlaps critical data reads with remaining script loading", () => {
  assert.match(dataAccess, /function warmInitialData\(\)/);
  assert.match(dataAccess, /settledWarmup\(listingsCsvNetwork\(false\)\)/);
  assert.match(dataAccess, /settledWarmup\(readNetwork\("unifiedListings"/);
  assert.match(auth, /await loadScriptInOrder\(script, document\.head\);[\s\S]*?warmInitialDataAfterScript\(script\)/);
  assert.match(auth, /criticalScripts[\s\S]*?deferredScripts/);
  assert.match(html, /auth-gate-v1\.js\?v=1\.3\.1-header-logout/);
  assert.match(html, /data-access-v6\.js\?v=6\.0\.3-earliest-warmup/);
});

test("large initial datasets use ETag revalidation without timestamp cache busting", () => {
  assert.match(dataAccess, /REVALIDATED_READ_ACTIONS[\s\S]*?unifiedListings: true[\s\S]*?geocodeCache: true/);
  assert.match(dataAccess, /revalidated \? "default" : "no-store"/);
  assert.match(worker, /BROWSER_REVALIDATED_ACTIONS = new Set\(\["unifiedListings", "geocodeCache"\]\)/);
  assert.match(worker, /"cache-control": "private, max-age=0, must-revalidate"/);
  assert.match(worker, /requestEtagMatches\(request, etag\)/);
});

test("reload skips the shared geocode download when source or local coordinates are ready", () => {
  assert.match(map, /function hasReadyCoordinateWithoutSharedCacheV8213/);
  assert.match(map, /allRowsAlreadyLocatedV691 \|\| allRowsReadyWithoutSharedCacheV8213/);
  assert.match(script, /JSDataAccessV6\.read\("geocodeCache", \{\}, \{/);
  assert.match(script, /cache: "default"/);
  assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id/);
  assert.match(html, /map\.js\?v=8\.2\.22-full-initial-render/);
});

test("reload uses one complete full-list snapshot without a temporary zero or partial list", () => {
  assert.match(html, /initial-listings-cache-v1\.js\?v=1\.2\.0-full-snapshot/);
  assert.match(html, /script\.js\?v=6\.10\.8-favorite-property-id&amp;full-list-cache-v2=1/);
  assert.match(html, /map\.js\?v=8\.2\.22-full-initial-render&amp;full-list-cache-v2=1/);
  assert.match(script, /window\.jsInitialFullListingsLoadingV1 && !\(allItems \|\| \[\]\)\.length/);
  assert.match(script, /전체 매물 한 번에 준비 중/);
  assert.doesNotMatch(initialCache, /MAX_FAST_ITEMS|slice\(0,\s*80\)/);
});

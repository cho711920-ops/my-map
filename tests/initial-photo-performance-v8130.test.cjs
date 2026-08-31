const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const unifiedCss = fs.readFileSync("css/unified-listings-v8.css", "utf8");

function functionSource(name) {
  const start = unified.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = unified.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < unified.length; index += 1) {
    if (unified[index] === "{") depth += 1;
    if (unified[index] === "}") depth -= 1;
    if (depth === 0) return unified.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 끝을 찾지 못했습니다.`);
}

const preload = functionSource("preloadDetailImage");
const prime = functionSource("primeDetailImages");
const warmup = functionSource("scheduleDetailWarmup");
const render = functionSource("renderDetailPhoto");
const step = functionSource("stepDetailPhoto");
const adjacent = functionSource("preloadAdjacentDetailImages");
const swipe = functionSource("bindPhotoSwipe");

assert.doesNotMatch(unified, /photoPreloadOrder|photoWarmupTimer/);
assert.doesNotMatch(preload, /\.decode\(/);
assert.match(preload, /state\.photoPreloads\[source\] = true/);
assert.match(preload, /preload\.onload = null/);
assert.match(preload, /delete state\.photoPreloads\[source\]/);

assert.match(prime, /images\[1\]/);
assert.match(prime, /images\[images\.length - 1\]/);
assert.doesNotMatch(prime, /slice\(1, 7\)|setTimeout/);
assert.doesNotMatch(warmup, /loadDetail\s*\(|setTimeout\s*\(/);
assert.match(warmup, /state\.detailWarmupIds = \[\]/);

assert.match(render, /preloadAdjacentDetailImages\(images, safeIndex\)/);
assert.match(adjacent, /safeIndex \+ 1/);
assert.match(adjacent, /safeIndex - 1/);
assert.match(step, /state\.pendingDetailSteps\[propertyId\]/);
assert.match(step, /다음 사진 불러오는 중…/);
assert.match(unified, /images\.length > 1 && Number\.isFinite\(Number\(pendingStep\)\)/);
assert.match(swipe, /pointerdown/);
assert.match(swipe, /pointermove/);
assert.match(swipe, /Math\.abs\(deltaX\) >= 42/);
assert.match(swipe, /event\.target && typeof event\.target\.setPointerCapture/);
assert.doesNotMatch(swipe, /element\.setPointerCapture\(event\.pointerId\)/);
assert.match(unified, /function transitionPhotoV8140\(container, direction, commit\)/);
assert.match(unified, /_suppressNextPhotoClickV8140/);
assert.doesNotMatch(unified, /_suppressPhotoClickUntilV8/);
assert.match(unified, /bindPhotoSwipe\(detailGallery/);
assert.match(unified, /bindPhotoSwipe\(modal/);
assert.match(unifiedCss, /\.unified-detail-gallery-v8[\s\S]*?touch-action: pan-y/);
assert.match(unifiedCss, /\.unified-gallery-modal-v8[\s\S]*?touch-action: none/);

assert.match(html, /unified-listings-v8\.js\?v=8\.1\.40-smooth-photo-expand/);
assert.match(html, /map\.js\?v=8\.2\.22-full-initial-render/);

console.log("initial photo performance v8.1.30 tests passed");

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const unified = fs.readFileSync("js/unified-listings-v8.js", "utf8");

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

assert.doesNotMatch(unified, /photoPreloadOrder|photoWarmupTimer/);
assert.doesNotMatch(preload, /\.decode\(/);
assert.match(preload, /state\.photoPreloads\[source\] = true/);
assert.match(preload, /preload\.onload = null/);
assert.match(preload, /delete state\.photoPreloads\[source\]/);

assert.match(prime, /originalImages\(selected\)\[1\]/);
assert.doesNotMatch(prime, /slice\(1, 7\)|setTimeout/);
assert.doesNotMatch(warmup, /loadDetail\s*\(|setTimeout\s*\(/);
assert.match(warmup, /state\.detailWarmupIds = \[\]/);

assert.match(render, /images\[\(safeIndex \+ 1\) % images\.length\]/);
assert.doesNotMatch(render, /\[1, 2\]|\[3, 4, 5\]/);
assert.match(step, /state\.pendingDetailSteps\[propertyId\]/);
assert.match(step, /다음 사진 불러오는 중…/);
assert.match(unified, /images\.length > 1 && Number\.isFinite\(Number\(pendingStep\)\)/);

assert.match(html, /unified-listings-v8\.js\?v=8\.1\.33-unique-linked-selection/);
assert.match(html, /map\.js\?v=8\.2\.19-collector-fresh-sync/);

console.log("initial photo performance v8.1.30 tests passed");

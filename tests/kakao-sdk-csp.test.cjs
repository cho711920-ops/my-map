const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Kakao SDK bootstrap and the officially required CDN subdomains are narrowly allowed", () => {
  const headers = fs.readFileSync(path.join(__dirname, "..", "_headers"), "utf8");
  const policy = headers.match(/Content-Security-Policy:\s*([^\r\n]+)/)[1];
  const scriptSources = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].split(/\s+/);
  for (const origin of ["https://dapi.kakao.com", "https://t1.daumcdn.net", "https://*.kakaocdn.net"]) {
    assert.ok(scriptSources.includes(origin), origin);
  }
  assert.ok(!scriptSources.includes("https:"));
  assert.deepEqual(scriptSources.filter(source => source.includes("*")),["https://*.kakaocdn.net"]);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});


test("Map resource ownership stays with the official SDK without private URL construction or image rewriting",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","js/map-tile-recovery-v105.js"),"utf8");
 assert.doesNotMatch(source,/new URL|\.src\s*=|setAttribute\(["']src|MutationObserver|fetch\(|XMLHttpRequest|daumcdn|kakaocdn|_js_tile_retry/);
 assert.match(source,/map\.relayout\(\)/);assert.match(source,/sdk-managed-v195/);
 const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");assert.doesNotMatch(html,/preconnect[^>]+mts\./);
 assert.match(html,/https:\/\/dapi\.kakao\.com\/v2\/maps\/sdk\.js/);
});

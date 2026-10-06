const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Kakao SDK bootstrap and both official core CDN origins are explicitly allowed", () => {
  const headers = fs.readFileSync(path.join(__dirname, "..", "_headers"), "utf8");
  const policy = headers.match(/Content-Security-Policy:\s*([^\r\n]+)/)[1];
  const scriptSources = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].split(/\s+/);
  // The bootstrap currently loads main/4.5.27/kakao.js and services from the
  // kakaocdn host. Older SDK caches still reference daumcdn. Keep both exact
  // hosts without allowing arbitrary HTTPS scripts or wildcard domains.
  for (const origin of ["https://dapi.kakao.com", "https://t1.daumcdn.net", "https://t1.kakaocdn.net"]) {
    assert.ok(scriptSources.includes(origin), origin);
  }
  assert.ok(!scriptSources.includes("https:"));
  assert.ok(!scriptSources.some(source => source.includes("*")));
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

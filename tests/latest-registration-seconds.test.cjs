const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js", "script.js"), "utf8");
const map = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
const d1 = fs.readFileSync(path.join(root, "cloudflare", "src", "d1-api.js"), "utf8");
const collector = fs.readFileSync(path.join(root, "cloudflare", "src", "collector-api.js"), "utf8");

const timeFunction = script.match(/function listingRegistrationTime\(item\) \{[\s\S]*?\n\}/);
assert.ok(timeFunction, "listing registration time helper must exist");
const listingRegistrationTime = new Function(`${timeFunction[0]}\nreturn listingRegistrationTime;`)();

assert.ok(
  listingRegistrationTime({ registrationAt: "2026-08-03 7:03:44" }) >
    listingRegistrationTime({ registrationAt: "2026-08-03 1:56:02" }),
  "second-resolution registration ordering must be preserved"
);
assert.ok(
  listingRegistrationTime({ registrationAt: "2026-08-03 11:12:18" }) >
    listingRegistrationTime({ regDate: "2026.08.03" }),
  "a precise registration timestamp must win over a date-only fallback"
);

assert.match(map, /registrationAt:\s*clean\(c\[23\]\)/);
assert.match(map, /lastCollectedAt:\s*clean\(c\[24\]\)/);
assert.match(d1, /registration_at,\s*last_collected_at, latitude, longitude/);
assert.match(d1, /registrationAt:\s*clean\(row\?\.registration_at \|\| row\?\.first_collected_at\)/);
assert.match(collector, /first_collected_at, last_collected_at, created_at, updated_at/);
assert.match(collector, /first_collected_at, registration_at, last_collected_at/);
assert.match(collector, /last_collected_at=\?1, updated_at=\?1/);

console.log("second-resolution latest registration tests passed");

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/ai-visit-session-v6.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("AI visit session cache falls back to memory without clearing unrelated site data", () => {
  assert.match(source, /function writeDeviceSessionCache\(sessions\)/);
  assert.match(source, /memorySessionMap = sessions/);
  assert.match(source, /clearDeviceSessionCache\(\);[\s\S]*?localStorage\.setItem\(SESSION_KEY/);
  assert.match(source, /catch \(retryError\)[\s\S]*?return false;/);
  assert.doesNotMatch(source, /localStorage\.clear\s*\(/);
  assert.match(source, /localStorage\.removeItem\(SESSION_KEY\)/);
  assert.match(source, /localStorage\.removeItem\(LEGACY_SESSION_KEY\)/);
});

test("cloud session sync remains ready when only the device cache exceeds quota", () => {
  assert.match(source, /writeDeviceSessionCache\(sessions\);\s*cloudSessionReady = true;/);
  assert.match(source, /writeDeviceSessionCache\(sessions\);\s*scheduleCloudSessionSave\(sessions\);/);
  assert.match(source, /if \(memorySessionMap[\s\S]*?return memorySessionMap;/);
});

test("AI visit quota repair has a new browser cache version", () => {
  assert.match(html, /js\/ai-visit-session-v6\.js\?v=6\.4\.38-storage-fallback/);
});

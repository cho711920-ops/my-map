import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("Edge extension schedules one sequential daily collector run", () => {
  const manifest = JSON.parse(read("edge-automation/extension/manifest.json"));
  const background = read("edge-automation/extension/background.js");
  assert.equal(manifest.manifest_version, 3);
  assert.match(background, /const SOURCE_ORDER = \{ naver: 1, daangn: 2, gongsil: 3 \}/);
  assert.match(background, /periodInMinutes: 24 \* 60/);
  assert.match(background, /LAST_SCHEDULE_KEY/);
  assert.match(background, /scheduleIsDue/);
  assert.match(background, /for \(const target of targets\)/);
  assert.match(background, /RUN_LOCK_KEY/);
  assert.match(background, /validateTarget\(target\)/);
});

test("automatic targets and schedules stay in the dedicated Edge profile", () => {
  const background = read("edge-automation/extension/background.js");
  const content = read("edge-automation/extension/content.js");
  assert.match(background, /chrome\.storage\.local/);
  assert.doesNotMatch(background, /COLLECTOR_ACCESS_KEY|collectorKey|accessKey/);
  assert.match(content, /data-js-collector-auto-target/);
  assert.match(content, /JS_COLLECTOR_AUTOMATION_RESULT/);
});

test("all three collectors expose registration and unattended execution", () => {
  const naver = read("js/naver-collector.js");
  const daangn = read("js/daangn-collector.js");
  const gongsil = read("js/gongsil-collector.js");
  for (const source of [naver, daangn, gongsil]) {
    assert.match(source, /data-action="auto-register"/);
    assert.match(source, /runAutomatic: runAutomatic/);
    assert.match(source, /JS_COLLECTOR_REGISTER_TARGET/);
  }
  assert.match(gongsil, /clickScreenLargestCluster/);
  assert.match(gongsil, /현재 화면 전체클러스터 자동수집 등록/);
  assert.match(naver, /data-role="auto-district"/);
  assert.match(naver, /function selectAutomaticDistrict\(\)/);
  assert.match(naver, /지도 클러스터 인식과 관계없이/);
});

test("Windows installer creates a daily recoverable scheduled task", () => {
  const install = read("tools/install-edge-auto-collector.ps1");
  const uninstall = read("tools/uninstall-edge-auto-collector.ps1");
  const launch = read("tools/run-edge-auto-collector.ps1");
  assert.match(install, /New-ScheduledTaskTrigger -Once/);
  assert.match(install, /New-TimeSpan -Minutes 30/);
  assert.match(install, /-StartWhenAvailable/);
  assert.match(install, /-WakeToRun/);
  assert.match(uninstall, /Unregister-ScheduledTask/);
  assert.match(launch, /--user-data-dir=/);
  assert.match(launch, /--load-extension=/);
});

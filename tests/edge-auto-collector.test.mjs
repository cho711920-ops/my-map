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
  assert.ok(manifest.content_scripts.some((entry) => entry.world === "MAIN" && entry.js.includes("auto-bridge.js")));
  assert.match(background, /const SOURCE_ORDER = \{ naver: 1, daangn: 2, gongsil: 3 \}/);
  assert.match(background, /periodInMinutes: 24 \* 60/);
  assert.match(background, /LAST_SCHEDULE_KEY/);
  assert.match(background, /scheduleIsDue/);
  assert.match(background, /RUN_LOCK_KEY/);
  assert.match(background, /RUN_STATE_KEY/);
  assert.match(background, /if \(lock && \(!state \|\| !state\.active\)\)/);
  assert.match(background, /validateTarget\(target\)/);
  assert.match(background, /const result = await runAll\(reason\)/);
  assert.match(background, /if \(result && result\.started === true\)/);
  assert.match(background, /runScheduled\("browser-startup"\)/);
  assert.doesNotMatch(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /async function launchCurrentTarget\(state\)/);
  assert.match(background, /async function finishCurrentTarget\(result, senderTabId\)/);
  assert.match(background, /await sendRunMessage\(tab\.id, target, targetRunId, state\.runId\)/);
  assert.match(background, /JS_AUTO_TARGET_FINISHED/);
  assert.match(background, /chrome\.tabs\.onRemoved/);
  assert.match(background, /chrome\.tabs\.create\(\{ url: target\.url, active: false \}\)/);
  assert.match(background, /chrome\.windows\.update\(tab\.windowId, \{ state: "minimized" \}\)/);
  assert.match(background, /chrome\.storage\.local\.remove\(\[RUN_STATE_KEY, RUN_LOCK_KEY\]\)/);
});

test("automatic targets and schedules stay in the dedicated Edge profile", () => {
  const background = read("edge-automation/extension/background.js");
  const content = read("edge-automation/extension/content.js");
  assert.match(background, /chrome\.storage\.local/);
  assert.doesNotMatch(background, /COLLECTOR_ACCESS_KEY|collectorKey|accessKey/);
  assert.match(content, /JS_COLLECTOR_AUTOMATION_RESULT/);
  assert.match(content, /async function signalScheduledRun\(autorun\)/);
  assert.match(content, /attempt < 12/);
  assert.match(content, /JS_AUTO_START_MAIN/);
  assert.match(content, /JS_AUTO_TARGET_FINISHED/);
  assert.match(content, /async function reportTargetFinished\(message\)/);
  assert.match(content, /sendResponse\(\{ ok: true, started: true \}\)/);
  assert.match(content, /RESULT_TIMEOUT_MS/);
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
  const naverAutomatic = naver.slice(naver.indexOf("async function runAutomatic"), naver.indexOf("function requestSafeStop"));
  assert.doesNotMatch(naverAutomatic, /discoverFinContext\(\)/);
});

test("Windows installer creates a daily recoverable scheduled task", () => {
  const install = read("tools/install-edge-auto-collector.ps1");
  const uninstall = read("tools/uninstall-edge-auto-collector.ps1");
  const launch = read("tools/run-edge-auto-collector.ps1");
  assert.match(install, /New-ScheduledTaskTrigger -Daily/);
  assert.doesNotMatch(install, /New-TimeSpan -Minutes 30/);
  assert.match(install, /-StartWhenAvailable/);
  assert.match(install, /-WakeToRun/);
  assert.match(uninstall, /Unregister-ScheduledTask/);
  assert.match(launch, /--user-data-dir=/);
  assert.match(launch, /--load-extension=/);
  assert.match(launch, /--new-tab/);
  assert.match(launch, /js_auto_run=1&run=/);
  assert.match(launch, /JSMapWindow/);
  assert.match(install, /installedCollectors/);
  assert.match(install, /gongsil-collector\.js/);
});

test("automatic collector settings stay compact with long target URLs", () => {
  const options = read("edge-automation/extension/options.js");
  const styles = read("edge-automation/extension/options.css");
  assert.match(options, /function renderTargets\(targets\)/);
  assert.match(options, /function targetSummary\(target\)/);
  assert.match(options, /SOURCE_ORDER/);
  assert.match(styles, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles, /text-overflow:ellipsis/);
  assert.match(styles, /\.log-list\{max-height:430px;overflow-y:auto/);
});

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
  assert.match(background, /LAST_SCHEDULE_KEY\]: localDateKey\(\)/);
  assert.match(background, /runScheduled\("browser-startup"\)/);
  assert.doesNotMatch(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /async function launchCurrentTarget\(state, reuseTabId = null\)/);
  assert.match(background, /async function finishCurrentTarget\(result, senderTabId\)/);
  assert.match(background, /await sendRunMessage\(tab\.id, target, targetRunId, state\.runId\)/);
  assert.match(background, /JS_AUTO_TARGET_FINISHED/);
  assert.match(background, /chrome\.tabs\.onRemoved/);
  assert.match(background, /chrome\.tabs\.create\(\{ url: target\.url, active: false \}\)/);
  assert.match(background, /chrome\.windows\.update\(tab\.windowId, \{ state: "minimized" \}\)/);
  assert.match(background, /async function restartPersistedRun\(state, reason\)/);
  assert.match(background, /retryQueue/);
  assert.match(background, /RECOVERY_ALARM_NAME/);
  assert.match(background, /WATCHDOG_ALARM_NAME/);
  assert.match(background, /MAX_IMMEDIATE_ATTEMPTS = 4/);
  assert.match(background, /MAX_DEFERRED_RETRY_CYCLES = 8/);
  assert.match(background, /MAX_RUN_AGE_MS/);
  assert.match(background, /state\.summary\.failed = Number\(state\.summary\.failed \|\| 0\) \+ 1/);
  assert.match(background, /state\.summary\.retryErrors/);
  assert.match(background, /stalledLoading/);
  assert.match(background, /stalledCollection/);
  assert.doesNotMatch(background, /onInstalled[\s\S]{0,400}remove\(\[RUN_STATE_KEY, RUN_LOCK_KEY\]\)/);
});

test("automatic targets and schedules stay in the dedicated Edge profile", () => {
  const background = read("edge-automation/extension/background.js");
  const content = read("edge-automation/extension/content.js");
  assert.match(background, /chrome\.storage\.local/);
  assert.doesNotMatch(background, /COLLECTOR_ACCESS_KEY|collectorKey|accessKey/);
  assert.match(content, /JS_COLLECTOR_AUTOMATION_RESULT/);
  assert.match(content, /async function signalScheduledRun\(autorun, forceRun\)/);
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
  assert.match(naver, /AUTO_DISTRICT_PROGRESS_KEY/);
  assert.match(naver, /async function collectFinAutomaticDistrict\(district\)/);
  assert.match(naver, /saveAutoDistrictProgress\(progress\)/);
  assert.match(naver, /clearAutoDistrictProgress\(district\.cortarNo\)/);
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
  assert.match(install, /Get-CimInstance Win32_Process/);
  assert.match(install, /Stop-Process -Id \$_.ProcessId/);
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

test("automatic collector settings can move safely to another PC", () => {
  const background = read("edge-automation/extension/background.js");
  const options = read("edge-automation/extension/options.js");
  const page = read("edge-automation/extension/options.html");
  assert.match(background, /function normalizePortableConfig\(value\)/);
  assert.match(background, /JS_AUTO_IMPORT_CONFIG/);
  assert.match(background, /validateTarget\(target\)/);
  assert.match(options, /js-map-auto-collector/);
  assert.match(options, /function portableTarget\(target\)/);
  assert.match(options, /설정 파일 저장 완료/);
  assert.match(options, /개 대상 복원 완료/);
  assert.match(page, /id="exportConfig"/);
  assert.match(page, /id="importConfig"/);
  assert.doesNotMatch(options, /COLLECTOR_ACCESS_KEY|collectorKey|accessKey|password/);
});

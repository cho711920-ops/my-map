import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const background = fs.readFileSync(new URL("../edge-automation/extension/background.js", import.meta.url), "utf8");

function runtimeUrl(target) {
  const names = ["validateTarget", "automaticTargetRuntimeUrl"];
  const code = names.map((name) => {
    const match = background.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
    assert.ok(match, `missing ${name}`);
    return match[0];
  }).join("\n");
  const context = { URL };
  vm.runInNewContext(`${code}\nthis.runtimeUrl=automaticTargetRuntimeUrl;`, context);
  return context.runtimeUrl(target);
}

test("Daangn district automation keeps the district id and opens the visible map at district zoom", () => {
  const registered = new URL("https://realty.daangn.com/");
  registered.searchParams.set("cluster_id", "REGION:1130");
  registered.searchParams.set("js_district", "서구");
  registered.searchParams.set("mv", "36.30909,127.17540,36.41530,127.44893,12");
  registered.searchParams.set("af", JSON.stringify({ salesTypes: ["STORE"], tradeTypes: ["MONTH"] }));
  const result = new URL(runtimeUrl({ source: "daangn", district: "서구", url: registered.toString() }));
  assert.equal(result.searchParams.get("cluster_id"), "REGION:1130");
  assert.equal(result.searchParams.get("js_district"), "서구");
  assert.equal(result.searchParams.get("mv"), "36.30909,127.17540,36.41530,127.44893,11");
  assert.deepEqual(JSON.parse(result.searchParams.get("af")), { salesTypes: ["STORE"], tradeTypes: ["MONTH"] });
});

test("non-Daangn and manually selected Daangn targets retain their registered viewport", () => {
  const daangn = "https://realty.daangn.com/?cluster_id=CELL%3A1&mv=1,2,3,4,15";
  assert.equal(runtimeUrl({ source: "daangn", district: "", url: daangn }), daangn);
  const naver = "https://fin.land.naver.com/map?zoom=17";
  assert.equal(runtimeUrl({ source: "naver", district: "서구", url: naver }), naver);
});

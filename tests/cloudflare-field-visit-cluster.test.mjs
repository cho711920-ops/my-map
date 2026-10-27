import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const mapSource = fs.readFileSync("js/map.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function loadClusterClassHelper(isFieldVisitItem) {
  const match = mapSource.match(
    /function getFieldVisitClusterClassV684\(cluster, allDone\) \{[\s\S]*?\n\}/
  );
  assert.ok(match, "field-visit cluster helper must exist");
  const context = { isFieldVisitItem, isConfirmedVisitItem: item => /\(\s*확인매물\s*\)/.test(item.memo || ''),
    isGongsilBoxItem: item => (item.sourceTypesV8 || []).includes('gongsil') || isFieldVisitItem(item), isDone: item => item.state === '계약완료' };
  vm.createContext(context);
  vm.runInContext(`${match[0]}; this.helper = getFieldVisitClusterClassV684;`, context);
  return context.helper;
}

test("pending field-visit listings keep the cluster yellow", () => {
  const helper = loadClusterClassHelper((item) => item.memo === "(임장가자)");
  assert.equal(helper({ items: [{ memo: "(임장가자)" }] }, false), " source-gongsil");
});

test("confirmed Gongsil listings return the cluster to normal blue", () => {
  const helper = loadClusterClassHelper((item) => /\(임장가자\)|\(공실박스\)/.test(item.memo));
  assert.equal(
    helper({ items: [{ memo: "(확인매물)", sourceTypesV8: ["gongsil"] }] }, false),
    " visit-confirmed-v89"
  );
});

test('unknown and mixed groups stay unconfirmed, and confirmed colors match list badges excluding completed members', () => {
  const helper = loadClusterClassHelper(item => /\(임장가자\)|\(공실박스\)/.test(item.memo || ''));
  for (const items of [[{}],[{sourceTypesV8:['naver']}],[{memo:'(확인매물)'},{}],[{memo:'(확인매물)'},{memo:'(임장가자)'}]]) {
    assert.notEqual(helper({items},false),' visit-confirmed-v89');
  }
  assert.equal(helper({items:[{sourceTypesV8:['gongsil']}]},false),' visit-confirmed-v89');
  assert.equal(helper({items:[{sourceTypesV8:['gongsil'],memo:'(임장가자)'}]},false),' source-gongsil');
  assert.equal(helper({items:[{memo:'(확인매물)'},{state:'계약완료',memo:'(임장가자)'}]},false),' visit-confirmed-v89');
  assert.equal(helper({items:[{state:'계약완료',memo:'(확인매물)'}]},true),'');
});

test("both initial draw and redraw use pending visit state", () => {
  assert.equal(
    (mapSource.match(/getFieldVisitClusterClassV684\(cluster, allDone\)/g) || []).length,
    3,
    "the helper definition, initial draw and selected-cluster redraw must stay connected"
  );
  assert.match(html, /js\/map\.js\?v=8\.2\.22-full-initial-render/);
});

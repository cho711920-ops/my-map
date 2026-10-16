import assert from "node:assert/strict";
import test from "node:test";
import {existsSync, readFileSync} from "node:fs";
import worker from "../cloudflare/src/worker.js";
import {handleD1GetAction, handleD1PostAction} from "../cloudflare/src/d1-api.js";
import {parseXmlRows} from "../cloudflare/src/public-data-xml.js";

test("industry analysis is absent while the industry filter and map tools remain", () => {
  const html=readFileSync("index.html","utf8");
  assert.doesNotMatch(html,/permit-diagnosis|openPermitDiagnosis|industry-master|diagnosis-storage/);
  assert.match(html,/id="industryFilter"/);
  for (const handler of ["toggleMapRoadviewSelection", "toggleMultiClusterMode", "toggleDistanceMeasureV657", "building-register"]) {
    assert.ok(html.toLowerCase().includes(handler.toLowerCase()),handler);
  }
  for (const file of ["js/permit-diagnosis-ui.js","js/industry-rule-loader.js","js/diagnosis-storage.js",
    "css/permit-diagnosis-v1.css","data/industry-master.json","data/industry-ksic11-catalog.json",
    "cloudflare/src/permit-api.js","cloudflare/src/permit-open-data.js",
    "legacy/vercel/api/permit-public-data.js","legacy/vercel/api/permit-lease-legal.js"]) {
    assert.equal(existsSync(file),false,file);
  }
});

test("retired industry API routes cannot reach a provider or database", async t => {
  t.mock.method(globalThis,"fetch",()=>{throw Error("External provider must not be called");});
  const env={DB:{prepare(){throw Error("Database must not be touched");}}};
  for (const path of ["/api/permit-public-data","/api/permit-lease-legal"]) {
    for (const method of ["GET","POST"]) {
      const response=await worker.fetch(new Request("https://js-map.com"+path,{method}),env);
      assert.equal(response.status,404);
    }
  }
});

test("retired diagnosis storage is rejected before any read, mutation reservation or write", async () => {
  const env={DB:{prepare(){throw Error("Stored diagnosis records must not be read or changed");}}};
  const user={email:"retirement@example.test",role:"owner"};
  const retired={statusCode:410};
  await assert.rejects(handleD1GetAction(env,user,{action:"loadCloudState",scope:"permitDiagnosis",recordKey:"saved"}),retired);
  await assert.rejects(handleD1PostAction(env,user,{action:"saveCloudState",scope:"permitDiagnosis",recordKey:"saved"}),retired);
  await assert.rejects(handleD1PostAction(env,user,{action:"enqueueMutation",taskAction:"saveCloudState",
    payload:{scope:"permitDiagnosis",recordKey:"saved"}}),retired);
});

test("the shared building-register/elevator XML parser retains Korean, CDATA, entities and multiple rows", () => {
  const xml='<response><items><item><name><![CDATA[대전 상가]]></name><use>근린&amp;판매</use><floor>2</floor></item>'+
    '<item><name>승강기 &quot;가&quot;</name><empty></empty></item></items></response>';
  assert.deepEqual(parseXmlRows(xml),[{name:"대전 상가",use:"근린&판매",floor:"2"},{name:'승강기 "가"',empty:""}]);
  assert.deepEqual(parseXmlRows("<response><items/></response>"),[]);
});

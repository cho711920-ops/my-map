import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("async function handleApi("), source.indexOf("async function runScheduledMaintenance("));

for (const outcome of ["success", "failure"]) {
  test(`collector write lifetime is registered before completion and preserves ${outcome}`, async () => {
    let resolve, reject, calls = 0;
    const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
    const c = vm.createContext({URL, handleCollectorApi: () => { calls++; return pending; }, collectorFinalized: () => false});
    vm.runInContext(handler, c);
    const kept = [];
    const returned = c.handleApi(new Request("https://js-map.com/api/collector", {method:"POST"}), {}, {waitUntil:p=>kept.push(p)});
    assert.equal(kept.length, 1, "accepted request is protected before any response is available");
    let settled = false;
    kept[0].then(() => { settled=true; });
    await Promise.resolve();
    assert.equal(settled, false);
    if (outcome === "success") {
      resolve(new Response(JSON.stringify({ok:true}), {headers:{"content-type":"application/json"}}));
      assert.equal((await returned).status,200);
    } else {
      reject(new Error("synthetic write failure"));
      await assert.rejects(returned,/synthetic write failure/);
    }
    await kept[0];
    assert.equal(calls, 1, "lifetime protection never replays the write");
  });
}

test("read-only collector requests and runtimes without waitUntil keep their response behavior",async()=>{
  const c=vm.createContext({URL,handleCollectorApi:async()=>new Response("{}"),collectorFinalized:()=>false});
  vm.runInContext(handler,c);
  const kept=[];
  assert.equal((await c.handleApi(new Request("https://js-map.com/api/collector"),{},{waitUntil:p=>kept.push(p)})).status,200);
  assert.equal(kept.length,0);
  assert.equal((await c.handleApi(new Request("https://js-map.com/api/collector",{method:"POST"}),{},{})).status,200);
});

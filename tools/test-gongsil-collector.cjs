const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function makeControl() {
  return {
    style: {},
    disabled: false,
    textContent: "",
    addEventListener() {}
  };
}

const controls = {
  "[data-role=status]": makeControl(),
  "[data-role=detail]": makeControl(),
  "[data-action=save]": makeControl(),
  "[data-action=close]": makeControl()
};

function makeElement() {
  return {
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    style: {},
    remove() {},
    querySelector(selector) {
      return controls[selector] || makeControl();
    }
  };
}

const listCalls = [];
async function fakeFetch(url, init = {}) {
  assert.strictEqual(url, "/api/maps/lists");
  const body = JSON.parse(init.body);
  listCalls.push(body);

  // Mimic Gongsilbox: related rows can be returned because the complete bidx
  // context is required. The collector must retain only the requested bfidxs.
  const requested = body.bfidxs.map(String);
  const datas = requested.map((id, index) => ({
    Bfidx: id,
    Bidx: String(body.bidxs[index % body.bidxs.length])
  }));
  datas.push(
    { Bfidx: `related-${listCalls.length}-a`, Bidx: "related" },
    { Bfidx: `related-${listCalls.length}-b`, Bidx: "related" }
  );

  return {
    async json() {
      return { res: "success", datas, more: false };
    }
  };
}

const windowObject = {
  fetch: fakeFetch,
  prompt() { return "test-key"; }
};

const context = {
  window: windowObject,
  location: { hostname: "www.gongsilbox.com" },
  document: {
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return makeElement(); }
  },
  localStorage: {
    getItem() { return "test-key"; },
    setItem() {},
    removeItem() {}
  },
  alert() {},
  console,
  setTimeout,
  clearTimeout,
  URL,
  TextDecoder,
  TextEncoder,
  crypto: globalThis.crypto
};

vm.createContext(context);
const collectorSource = fs.readFileSync(
  require.resolve("../js/gongsil-collector.js"),
  "utf8"
);
vm.runInContext(collectorSource, context);

const api = windowObject.__JS_GONGSIL_COLLECTOR__;
assert.ok(api, "collector API should be exposed");
assert.strictEqual(api.version, "1.8.0");
assert(collectorSource.includes("classifySourceManifest"));
assert(
  collectorSource.includes("left:50%;top:50%;transform:translate(-50%,-50%)")
);
assert(collectorSource.includes("width:min(460px"));
assert(collectorSource.includes('data-metric="review"'));
assert(collectorSource.includes("주소·변환 제외"));
assert(collectorSource.includes('data-action="stop"'));
assert(collectorSource.includes("공실박스 2000개 이상 전체클러스터"));
assert(collectorSource.includes("finalizeCollectionSession"));
assert(collectorSource.includes("observedSourceIds"));
assert(collectorSource.includes("showGongsilDetailWait"));
assert(collectorSource.includes("showGongsilSaveWait"));
assert(collectorSource.includes("고객매칭은 자동으로 별도 갱신"));
assert(!collectorSource.includes("rejected.length === 0"));
assert(collectorSource.includes("네트워크 연결을 자동으로 복구 중입니다."));
assert(collectorSource.includes("저장 중단 지점부터 이어갑니다."));
assert(collectorSource.includes("전송 묶음을 줄여 자동 복구 중입니다."));
assert(collectorSource.includes("이전 오류 화면을 새 수집기로 복구했습니다."));
assert(collectorSource.includes("window.fetch.__jsGongsilOriginal"));
assert.strictEqual(
  api.collectionSignature([
    { externalId: "GB-100", values: ["상가", "서구 둔산동 1"] },
    { externalId: "GB-200", values: ["상가", "서구 둔산동 2"] }
  ]),
  "2|GB-100|GB-200",
  "resume signature must identify the actual first and last listings"
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.observedSourceIds([
    { Bfidx: "GB-A" },
    { bfidx: "GB-B" },
    { BfIdx: "GB-A" },
    { id: "GB-C" },
    {}
  ]))),
  ["GB-A", "GB-B", "GB-C"],
  "all visible source IDs must be retained for safe full-collection reconciliation"
);

const importTotals = {
  received: 0,
  created: 0,
  merged: 0,
  updated: 0,
  review: 0,
  duplicate: 0,
  failed: 0
};
api.addImportResult(importTotals, {
  received: 250,
  created: 210,
  merged: 20,
  updated: 5,
  review: 3,
  duplicate: 4,
  duplicateSnapshots: 7,
  failed: 1
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(importTotals)), {
  received: 250,
  created: 210,
  merged: 20,
  updated: 5,
  review: 3,
  duplicate: 11,
  failed: 1
});

const bfidxs = Array.from({ length: 2500 }, (_, index) => `floor-${index + 1}`);
const bidxs = Array.from({ length: 1800 }, (_, index) => `building-${index + 1}`);
const capture = {
  body: { bfidxs, bidxs, mxline: 20, key: 1, reqsID: "test" },
  response: {
    res: "success",
    datas: bfidxs.slice(0, 20).map((id, index) => ({
      Bfidx: id,
      Bidx: bidxs[index]
    })),
    more: false
  }
};

(async () => {
  const items = await api.loadAllCapturedItems(capture);
  assert.strictEqual(items.length, 2500, "all selected properties must accumulate");
  assert.strictEqual(listCalls.length, 9, "2,500 IDs should be requested in 9 chunks");
  assert.deepStrictEqual(
    listCalls.map((body) => body.bfidxs.length),
    [300, 300, 300, 300, 300, 300, 300, 300, 100]
  );
  listCalls.forEach((body) => {
    assert.strictEqual(body.mxline, 400);
    assert.strictEqual(body.bidxs.length, 1800, "complete bidx context is required");
  });
  assert.ok(
    items.every((item) => !String(item.Bfidx).startsWith("related-")),
    "related rows outside each requested chunk must be filtered out"
  );
  process.stdout.write("gongsil collector chunk accumulation test: ok\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

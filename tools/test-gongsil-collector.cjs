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
vm.runInContext(
  fs.readFileSync(require.resolve("../js/gongsil-collector.js"), "utf8"),
  context
);

const api = windowObject.__JS_GONGSIL_COLLECTOR__;
assert.ok(api, "collector API should be exposed");
assert.strictEqual(api.version, "1.2.3");

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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/announcement-v1.js", import.meta.url), "utf8");

function harness(options = {}) {
  const reads = [];
  const fetches = [];
  const local = new Map();
  let readyHandler = null;
  let modal = null;

  function createModal() {
    return {
      id: "",
      className: "",
      hidden: true,
      innerHTML: "",
      querySelectorAll() { return []; }
    };
  }

  const document = {
    readyState: "loading",
    body: {
      appendChild(node) { modal = node; }
    },
    addEventListener(name, handler) {
      if (name === "DOMContentLoaded") readyHandler = handler;
    },
    getElementById(id) {
      return modal && modal.id === id ? modal : null;
    },
    createElement() { return createModal(); }
  };
  const window = {
    localStorage: {
      getItem(key) { return local.has(key) ? local.get(key) : null; },
      setItem(key, value) { local.set(key, String(value)); }
    }
  };
  if (options.shared !== false) {
    window.JSDataAccessV6 = {
      read(action, params, settings) {
        reads.push({action, params, settings});
        return options.readError
          ? Promise.reject(options.readError)
          : Promise.resolve(options.result ?? {ok: true, announcement: null});
      }
    };
  }

  async function fetchFake(url, settings) {
    fetches.push({url: String(url), settings});
    return {
      ok: true,
      json: async () => options.result ?? {ok: true, active: false}
    };
  }

  vm.runInNewContext(source, {
    window,
    document,
    saveApiURL: options.saveApiURL,
    fetch: fetchFake,
    Promise,
    Date,
    Object,
    Array,
    String,
    Boolean,
    Error
  });

  return {
    window,
    reads,
    fetches,
    local,
    get modal() { return modal; },
    async start() {
      assert.equal(typeof readyHandler, "function");
      readyHandler();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
}

test("announcement reads through the shared boundary and normalizes the D1 row", async () => {
  const app = harness({
    result: {
      ok: true,
      action: "announcement",
      source: "D1",
      announcement: {
        id: "notice-1",
        title: "운영 안내",
        body: "1. 확인: 공지 내용을 확인하세요.",
        updated_at: "2026-08-17T00:00:00.000Z"
      }
    }
  });

  await app.start();

  assert.equal(app.reads.length, 1);
  assert.equal(app.fetches.length, 0);
  assert.equal(app.reads[0].action, "announcement");
  assert.equal(JSON.stringify(app.reads[0].params), "{}");
  assert.equal(app.reads[0].settings.cache, "no-store");
  assert.equal(app.modal.hidden, false);
  assert.match(app.modal.innerHTML, /운영 안내/);
  assert.match(app.modal.innerHTML, /공지 내용을 확인하세요/);
  assert.match(app.modal.innerHTML, /js-announcement-step/);
});

test("announcement keeps the direct saveApiURL fallback and legacy response shape", async () => {
  const app = harness({
    shared: false,
    saveApiURL: "/legacy-data?tenant=js",
    result: {
      ok: true,
      id: "legacy-1",
      title: "기존 공지",
      content: "기존 화면 호환",
      updatedAt: "2026-08-17T01:00:00.000Z",
      active: true
    }
  });

  await app.start();

  assert.equal(app.reads.length, 0);
  assert.equal(app.fetches.length, 1);
  assert.match(app.fetches[0].url, /^\/legacy-data\?tenant=js&action=announcement&_=/);
  assert.equal(app.fetches[0].settings.cache, "no-store");
  assert.equal(app.fetches[0].settings.credentials, "same-origin");
  assert.equal(app.modal.hidden, false);
  assert.match(app.modal.innerHTML, /기존 공지/);
  assert.match(app.modal.innerHTML, /기존 화면 호환/);
});

test("announcement quietly ignores missing notices and shared read failures", async () => {
  const missing = harness({result: {ok: true, announcement: null}});
  await missing.start();
  assert.equal(missing.modal, null);

  const failed = harness({readError: new Error("temporary D1 failure")});
  await failed.start();
  assert.equal(failed.modal, null);
  assert.equal(failed.fetches.length, 0);
});

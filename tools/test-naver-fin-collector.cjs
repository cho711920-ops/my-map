const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeElement {
  constructor(tag, text = "") {
    this.tagName = tag;
    this.id = "";
    this.style = {};
    this.textContent = text;
    this.innerHTML = "";
    this.disabled = false;
    this.children = [];
    this.listeners = {};
    this.nodes = {};
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  remove() {}
  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }
  querySelector(selector) {
    if (!this.nodes[selector]) this.nodes[selector] = new FakeElement("div");
    return this.nodes[selector];
  }
}

class FakeXhr {
  open() {}
  send() {}
  setRequestHeader() {}
  addEventListener() {}
}

function makeArticle(index) {
  return {
    representativeArticleInfo: {
      articleNumber: String(7000000000 + index),
      articleName: "테스트 상가 " + index,
      complexName: "JS빌딩",
      dongName: "101호",
      realEstateType: "D02",
      tradeType: "B2",
      priceInfo: {
        warrantyPrice: 10000000,
        rentPrice: 800000
      },
      spaceInfo: {
        exclusiveSpace: 49.5
      },
      articleDetail: {
        direction: "남향",
        articleFeatureDescription: "대로변 상가"
      },
      brokerInfo: {
        brokerageName: "JS공인중개사"
      },
      address: {
        city: "대전시",
        division: "서구",
        sector: "둔산동",
        jibun: "100-1",
        coordinates: {
          xCoordinate: 127.39,
          yCoordinate: 36.35
        }
      }
    }
  };
}

const allArticles = Array.from({length: 65}, (_, index) => makeArticle(index + 1));
const requestBodies = [];

const fakeFetch = async (input, options = {}) => {
  const url = new URL(String(input), "https://fin.land.naver.com");
  assert.strictEqual(
    url.pathname,
    "/front-api/v1/article/legalDivisionArticleList"
  );
  const body = JSON.parse(options.body || "{}");
  requestBodies.push(body);
  const cursor = body.articlePagingRequest.lastInfo?.[0]?.cursor || 0;
  const list = allArticles.slice(cursor, cursor + 30);
  const nextCursor = cursor + list.length;
  const payload = {
    result: {
      list,
      totalCount: allArticles.length,
      hasNextPage: nextCursor < allArticles.length,
      lastInfo: nextCursor < allArticles.length ? [{cursor: nextCursor}] : [],
      seed: "seed-1"
    }
  };
  return {
    ok: true,
    status: 200,
    url: url.href,
    clone() { return this; },
    async json() { return payload; },
    async text() { return JSON.stringify(payload); }
  };
};

const buttons = [
  new FakeElement("button", "대전시 서구"),
  new FakeElement("button", "서구 매물 65")
];
const document = {
  head: new FakeElement("head"),
  body: new FakeElement("body"),
  createElement(tag) { return new FakeElement(tag); },
  getElementById() { return null; },
  addEventListener() {},
  querySelectorAll(selector) {
    return selector === "button" ? buttons : [];
  }
};
const location = {
  hostname: "fin.land.naver.com",
  origin: "https://fin.land.naver.com",
  href: "https://fin.land.naver.com/map?tradeTypes=B2&realEstateTypes=D02-D01-E02"
};
const localStorage = {
  values: new Map(),
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); }
};
const window = {
  fetch: fakeFetch,
  performance: {getEntriesByType() { return []; }},
  XMLHttpRequest: FakeXhr,
  setTimeout,
  localStorage,
  prompt() { return ""; }
};
window.window = window;

const context = {
  window,
  document,
  location,
  localStorage,
  XMLHttpRequest: FakeXhr,
  alert() {},
  console,
  URL,
  Map,
  Set,
  Number,
  String,
  Object,
  Array,
  Math,
  Date,
  JSON,
  Promise,
  RegExp,
  setTimeout,
  clearTimeout
};
vm.createContext(context);

const collectorPath = path.join(__dirname, "..", "js", "naver-collector.js");
const source = fs.readFileSync(collectorPath, "utf8");
vm.runInContext(source, context, {filename: collectorPath});

(async () => {
  const api = window.__JS_NAVER_COLLECTOR__;
  assert(api, "collector API missing");
  assert.strictEqual(api.version, "5.1.0");
  assert.strictEqual(api.isFinNaver(), true);

  const filters = api.parseFinFilters(location.href);
  assert.deepStrictEqual(Array.from(filters.tradeTypes), ["B2"]);
  assert.deepStrictEqual(
    Array.from(filters.realEstateTypes),
    ["D02", "D01", "E02"]
  );

  const district = {name: "서구", cortarNo: "3017000000"};
  const raw = await api.collectFinDistrictRaw(district, {});
  assert.strictEqual(raw.length, 65);
  assert.strictEqual(new Set(raw.map((article) => article.articleNumber)).size, 65);
  assert.strictEqual(requestBodies.length, 3);
  assert.deepStrictEqual(
    Array.from(requestBodies[0].filter.legalDivisionNumbers),
    ["3017000000"]
  );
  assert.strictEqual(requestBodies[0].filter.legalDivisionType, "GUN");
  assert.strictEqual(requestBodies[0].articlePagingRequest.size, 30);
  assert.strictEqual(requestBodies[1].articlePagingRequest.lastInfo[0].cursor, 30);
  assert.strictEqual(requestBodies[2].articlePagingRequest.lastInfo[0].cursor, 60);
  assert.strictEqual(requestBodies[1].articlePagingRequest.seed, "seed-1");

  const normalized = api.normalize(allArticles[0].representativeArticleInfo);
  assert.strictEqual(normalized.articleNo, "7000000001");
  assert.strictEqual(normalized.buildingName, "JS빌딩");
  assert.strictEqual(normalized.category, "상가점포");
  assert.strictEqual(normalized.tradeType, "월세");
  assert.strictEqual(normalized.deposit, "1000");
  assert.strictEqual(normalized.monthly, "80");
  assert.strictEqual(normalized.areaSquareMeter, 49.5);
  assert.strictEqual(normalized.jibunAddress, "대전시 서구 둔산동 100-1");
  assert.strictEqual(normalized.latitude, 36.35);
  assert.strictEqual(normalized.longitude, 127.39);
  assert.strictEqual(
    normalized.sourceLink,
    "https://fin.land.naver.com/articles/7000000001"
  );
  assert.strictEqual(api.finKrwToManwon(126000000), 12600);
  assert.strictEqual(api.finKrwToManwon("9,300,000원"), 930);

  const legacyNormalized = api.normalize({
    articleNo: "1234",
    dealOrWarrantPrc: 3000,
    rentPrc: 250
  });
  assert.strictEqual(legacyNormalized.deposit, "3000");
  assert.strictEqual(legacyNormalized.monthly, "250");

  assert(source.includes("left:50%;top:50%;transform:translate(-50%,-50%)"));
  assert(source.includes('data-metric="review"'));
  assert(source.includes("대전 5개 구 전체 이어서 수집"));
  assert(source.includes('data-action="stop"'));
  assert(source.includes('"대전 " + district.name + " 전체"'));
  assert(source.includes("complete: true"));

  console.log("naver fin collector tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

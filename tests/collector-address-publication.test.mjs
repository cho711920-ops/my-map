import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCollectorApi, normalizedRecord, hasPublishableCollectorAddress } from "../cloudflare/src/collector-api.js";
import { exactCollectorRoadAddress } from "../cloudflare/src/collector-address.js";

const collectorUrl = new URL("../cloudflare/src/collector-api.js",import.meta.url);
const code = fs.readFileSync(collectorUrl,"utf8").replace(/\bfrom\s+(["'])(\.\/[^"']+)\1/g,
  (_,quote,path) => `from ${quote}${new URL(path,collectorUrl).href}${quote}`) + "\nexport { ingestRecords };";
const {ingestRecords} = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const directory = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(new URL(file, directory), "utf8"));
  }
  const prepare = (sql, values = []) => {
    const indexes = [];
    const compiled = sql.replace(/\?(\d+)/g, (_, number) => { indexes.push(Number(number) - 1); return "?"; });
    const args = () => indexes.length ? indexes.map(index => values[index]) : values;
    return {
      bind: (...parameters) => prepare(sql, parameters),
      async first() { return db.prepare(compiled).get(...args()) || null; },
      async all() { return { results: db.prepare(compiled).all(...args()) }; },
      async run() { return { meta: { changes: Number(db.prepare(compiled).run(...args()).changes) } }; }
    };
  };
  const env = { COLLECTOR_ACCESS_KEY: "test-only", DB: {
    prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  } };
  async function save(source, ...data) {
    if (source === "당근") return ingestRecords(env, source, data);
    const body = source === "네이버" ? { action:"saveNaverBatch", data }
      : { action:"gongsilImportBatch", source, data };
    // The ordinary importer handles all provider-normalized records.
    const response = await handleCollectorApi(new Request("https://js-map.com/api/collector", {
      method:"POST", headers:{Origin:"https://fin.land.naver.com","Content-Type":"application/json"},
      body:JSON.stringify({collectorKey:"test-only",...body})
    }),env);
    const result = await response.json();
    assert.equal(result.ok,true,JSON.stringify(result));
    return result;
  }
  return {db,env,save};
}

const naver = (id, overrides = {}) => ({articleNo:id,tradeType:"lease",category:"상가",
  jibunAddress:"중구 문창동 123-4",roomInfo:"",floorInfo:"",deposit:1000,monthly:50,
  areaSquareMeter:66.1157,listSnapshot:`snapshot-${id}`,imageUrls:["https://example.com/photo.jpg"],...overrides});

for (const [value, expected] of [
  ["대전광역시 중구 문창로 20","중구 문창로 20"],
  ["유성구 엑스포로123번길 20-1 (문지동)","유성구 엑스포로123번길 20-1"],
  ["서구 둔산대로117번길 5 유성빌딩","서구 둔산대로117번길 5"],
  ["문창로20","문창로20"],
  ["문창로",""],["문창로 1층",""],["문창로 1 층",""],
  ["문창로 12 (평)",""],["문창로 12,000원",""],["문창로 20 인근",""],
  ["역세권 문창로 20 근처",""],["문창동 1층",""],["문창동",""]
]) test(`road address evidence: ${value}`, () => assert.equal(exactCollectorRoadAddress(value),expected));

test("only Naver and Daangn accept road-only publication; Gongsil stays unchanged", () => {
  for (const source of ["네이버","당근"]) {
    assert.equal(hasPublishableCollectorAddress(source,"중구 문창로 20"),true);
    assert.equal(hasPublishableCollectorAddress(source,"중구 문창동"),false);
  }
  assert.equal(hasPublishableCollectorAddress("공실박스","중구 문창로 20"),false);
});

test("addressed floorless ads publish separately, stay idempotent and preserve user fields", async t => {
  const f = fixture(t);
  const first = await f.save("네이버",naver("floorless-1"));
  assert.equal(first.created,1);
  const listing = f.db.prepare("SELECT * FROM listings").get();
  f.db.prepare("UPDATE listings SET operating_memo='사용자 메모',status='active' WHERE id=?").run(listing.id);
  const before = f.db.prepare("SELECT * FROM listings WHERE id=?").get(listing.id);
  const second = await f.save("네이버",naver("floorless-2"));
  assert.equal(second.created,1);
  assert.equal(second.merged,0);
  assert.deepEqual(f.db.prepare("SELECT * FROM listings WHERE id=?").get(listing.id),before);
  const replay = await f.save("네이버",naver("floorless-2"));
  assert.equal(replay.created,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_sources").get().n,2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_media").get().n,2);
});

test("Naver publishes an exact road address without a parcel or floor, never a dong-only ad", async t => {
  const f = fixture(t);
  const result = await f.save("네이버",naver("road",{jibunAddress:"중구 문창동",roadAddress:"중구 문창로 20"}),
    naver("dong",{jibunAddress:"중구 문창동"}));
  assert.equal(result.created,1);
  assert.equal(result.addressMissing,1);
  const row = f.db.prepare("SELECT * FROM listings").get();
  assert.equal(row.address,"중구 문창로 20");
  assert.equal(row.road_address,"중구 문창로 20");
  assert.equal(row.room,"");
});

test("the same ad switching from parcel to its verified road keeps the existing master and memo", async t => {
  const f = fixture(t);
  await f.save("네이버",naver("same-address",{roadAddress:"중구 문창로 20",roomInfo:"1층"}));
  const source = f.db.prepare("SELECT * FROM listing_sources").get();
  f.db.prepare("UPDATE listings SET operating_memo='현장 메모' WHERE id=?").run(source.listing_id);
  await f.save("네이버",naver("same-address",{jibunAddress:"중구 문창동",roadAddress:"중구 문창로 20",roomInfo:"1층"}));
  const current = f.db.prepare("SELECT * FROM listing_sources").get();
  assert.equal(current.listing_id,source.listing_id);
  assert.equal(f.db.prepare("SELECT operating_memo FROM listings WHERE id=?").get(source.listing_id).operating_memo,"현장 메모");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listings").get().n,1);
});

test("Daangn keeps exact road evidence and photos, but never resurrects a guessed lot or blurred location", () => {
  const raw = {originalId:"road-only",floor:"",salesTypeV3:{type:"STORE"},
    trades:[{type:"MONTH",deposit:1000,monthlyPay:50}],publicJibunAddress:"중구 문창동",
    roadAddress:"대전광역시 중구 문창로 20",isHideAddress:true,publicCoordinate:{lat:36.3,lon:127.4},
    images:["https://example.com/photo.jpg"]};
  const record = normalizedRecord("당근",{source:"당근",sourceId:"road-only",raw,address:"문창동 1",tradeType:"lease"});
  assert.equal(record.address,"중구 문창로 20");
  assert.equal(record.roadAddress,"대전광역시 중구 문창로 20");
  assert.equal(record.latitude,null);
  assert.equal(record.longitude,null);
  assert.deepEqual(record.images,["https://example.com/photo.jpg"]);
  const legacy = normalizedRecord("당근",{source:"당근",sourceId:"road-only",tradeType:"lease",
    images:["https://example.com/saved-photo.jpg"],raw:{...raw,images:undefined}});
  assert.deepEqual(legacy.images,["https://example.com/saved-photo.jpg"]);
});

test("Daangn road-only ad passes the production importer with its photos and can be saved again", async t => {
  const f = fixture(t);
  const raw = {originalId:"daangn-road",floor:"",salesTypeV3:{type:"STORE"},area:66,
    trades:[{type:"MONTH",deposit:1000,monthlyPay:50}],roadAddress:"중구 문창로 20",
    isHideAddress:true,publicCoordinate:{lat:36.3,lon:127.4},images:["https://example.com/photo.jpg"]};
  const first = await f.save("당근",raw);
  assert.equal(first.created,1,JSON.stringify(first));
  assert.equal(first.failed,0);
  const row = f.db.prepare("SELECT * FROM listings").get();
  assert.equal(row.address,"중구 문창로 20");
  assert.equal(row.latitude,null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM listing_media").get().n,1);
  assert.equal((await f.save("당근",raw)).created,0);
});

test("successful addressed publication closes only its own matching-market error", async t => {
  const f = fixture(t);
  await f.save("네이버",naver("retry",{jibunAddress:"중구 문창동"}));
  assert.equal(f.db.prepare("SELECT processing_state FROM collector_raw").get().processing_state,"error");
  const result = await f.save("네이버",naver("retry",{jibunAddress:"중구 문창동",roadAddress:"중구 문창로 20"}));
  assert.equal(result.created,1);
  assert.equal(f.db.prepare("SELECT processing_state FROM collector_raw").get().processing_state,"processed");
});

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import {DatabaseSync} from "node:sqlite";
import {loadManualRepresentativeFields} from "../cloudflare/src/source-original-display.js";
import {sheetCacheStream} from "../cloudflare/src/sheet-cache-stream.js";
import worker from "../cloudflare/src/worker.js";
import {createSessionToken, SESSION_COOKIE} from "../cloudflare/src/security.js";

const source = fs.readFileSync("js/script.js", "utf8");
const ast = ts.createSourceFile("script.js", source, ts.ScriptTarget.Latest, true);
const context = vm.createContext({});
vm.runInContext(ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "parseCSVRecordsV655").getText(ast), context);
const parse = text => JSON.parse(JSON.stringify(context.parseCSVRecordsV655(text)));
const csv = rows => rows.map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\r\n");

test("manual display history uses the narrow index for full and scoped reads while preserving edit flags", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE listing_history(id INTEGER PRIMARY KEY,listing_id TEXT,action TEXT,before_json TEXT,after_json TEXT)");
    db.exec(fs.readFileSync("cloudflare/migrations/0029_manual_display_history.sql","utf8"));
    const insert=db.prepare("INSERT INTO listing_history VALUES(?,?,?,?,?)");
    for(let i=0;i<10000;i++)insert.run(i,"P"+i,"collect","{}","{}");
    insert.run(10001,"A","updateProperty",'{"deposit":1000}','{"deposit":2000}');
    insert.run(10002,"B","separateOriginalListing","{}","{}");
    insert.run(10003,"A","updateProperty",'{"room":"1층"}','{"room":"2층"}');
    const plans=[];
    const env={DB:{prepare(sql){return {bind(...args){return {async all(){
      plans.push(db.prepare("EXPLAIN QUERY PLAN "+sql).all(...args).map(row=>row.detail).join(" "));
      return {results:db.prepare(sql).all(...args)};
    }};}};}}};
    const all=await loadManualRepresentativeFields(env);
    assert.deepEqual([...all.get("A")],["deposit","room"]);
    assert.deepEqual([...all.get("B")],["__separatedV55"]);
    const scoped=await loadManualRepresentativeFields(env,["A"]);
    assert.deepEqual([...scoped.keys()],["A"]);
    for(const plan of plans)assert.match(plan,/USING INDEX idx_listing_history_manual_display_v57/);
  } finally {db.close();}
});

test("full CSV parser preserves multiline Korean memos, quoted JSON, empty values and CRLF normalization", () => {
  const rows = [["제목", "메모", "매매상세", ""], ["건물", "쉼표, 따옴표\"\r\n한글😀", JSON.stringify({monthlyIncome:215,totalDeposit:14500}), ""], ["", "\r단독\n개행", '"', "끝"]];
  const expected = rows.map(row => row.map(cell => cell.replaceAll("\r\n", "\n")));
  assert.deepEqual(parse("\uFEFF" + csv(rows) + "\r\n"), expected);
  for (const input of ["", '""', "a,b,", 'a,"b', "a\r\nb\nc\r"]) {
    const expected = input === "" || input === '""' ? [] : input === "a,b," ? [["a","b",""]] : input === 'a,"b' ? [["a","b"]] : [["a"],["b"],["c"]];
    assert.deepEqual(parse(input), expected);
  }
});

test("large complete inventory round-trips every field without a first-page-only shortcut", () => {
  const rows = Array.from({length:34000}, (_, i) => [String(i), "대전 서구 검수동 " + i, "보존, 메모\n\"확인\" " + i, JSON.stringify({monthlyIncome:i,description:"원문 보존".repeat(i%40)})]);
  assert.deepEqual(parse(csv(rows)), rows);
});

function cached(content = "제목,메모\r\n건물,\"보존\n메모\"\r\n", extra = {}) {
  let cancelled = false;
  return {httpEtag:'"r2-v57"', customMetadata:{savedAt:String(Date.now()),revision:"revision-v57",...extra},
    httpMetadata:{contentType:"text/csv; charset=utf-8"},
    body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(content));},pull(c){c.close();},cancel(){cancelled=true;}}),
    text(){throw Error("Full R2 CSV buffering is forbidden");}, cancelled:() => cancelled};
}

test("CSV cache streams immediately and preserves full bytes, private cache and revision", async () => {
  const content = csv([["한글", "첫 줄\n둘째 줄", '"', ""]]);
  const reply = (await sheetCacheStream(new Request("https://js-map.com/api/sheet"),cached(content))).response;
  assert.equal(reply.headers.get("x-js-listings-revision"),"revision-v57");
  assert.equal(reply.headers.get("cache-control"),"private, max-age=0, must-revalidate");
  assert.equal(reply.headers.get("vary"),"Cookie, Accept-Encoding");
  assert.equal(await reply.text(),content);
});

test("stored SHA ETag survives memory/R2 transitions and a 304 cancels the unread body", async () => {
  const object = cached("", {etag:'"same-sha-etag"'});
  const response = (await sheetCacheStream(new Request("https://js-map.com/api/sheet",{headers:{"if-none-match":'"other", W/"same-sha-etag"'}}),object)).response;
  assert.equal(response.status,304); assert.equal(response.body,null); assert.equal(object.cancelled(),true);
  assert.equal(response.headers.get("etag"),'"same-sha-etag"');
});

test("CSV stream negotiates gzip without manual double compression", async () => {
  for (const [encoding, enabled] of [["gzip, br",true],["identity",false],["gzip;q=0, *;q=1",false]]) {
    const response = (await sheetCacheStream(new Request("https://js-map.com/api/sheet",{headers:{"accept-encoding":encoding}}),cached())).response;
    assert.equal(response.headers.get("content-encoding"),enabled ? "gzip" : null);
    await response.body.cancel();
  }
  assert.equal(await sheetCacheStream(new Request("https://js-map.com/api/sheet"),{...cached(),customMetadata:{}}),null);
});

test("Worker protects streamed CSV, rejects expired cache and bypasses it for forced latest reads", async () => {
  let gets = 0, reads = 0;
  let stale = false;
  const writes = [], tasks = [];
  const env = {ALLOWED_EMAILS:"refresh-test@example.invalid",SESSION_SECRET:"synthetic-refresh-startup-secret-longer-than-32-characters",
    DB:{prepare(sql){return {bind(){return this;},async first(){return null;},async all(){reads++;assert.match(sql,/FROM listings/);return {results:[]};}};}},
    MEDIA:{async get(key){gets++;return key.includes("revision/") ? null : cached(undefined,stale ? {savedAt:"1"} : {});},async put(...args){writes.push(args);}}};
  const url = "https://js-map.com/api/sheet";
  assert.equal((await worker.fetch(new Request(url),env)).status,401); assert.equal(gets,0);
  const token = await createSessionToken({email:env.ALLOWED_EMAILS,sub:"test"},env);
  const headers = {cookie:SESSION_COOKIE + "=" + encodeURIComponent(token)};
  const response = await worker.fetch(new Request(url,{headers}),env);
  assert.equal(response.status,200); assert.equal(reads,0);
  assert.equal(response.headers.get("x-js-data-transport"),"r2-sheet-stream-v57");
  assert.equal(response.headers.get("x-frame-options"),"DENY"); await response.body.cancel();
  stale = true;
  const fresh = await worker.fetch(new Request(url,{headers}),env,{waitUntil(p){tasks.push(p);}});
  await fresh.text(); await Promise.all(tasks);
  assert.equal(reads,1); assert.equal(writes[0][2].customMetadata.etag,fresh.headers.get("etag"));
  const oldGets = gets;
  const forced = await worker.fetch(new Request(url,{headers:{...headers,"x-js-force-refresh":"1"}}),env,{waitUntil(p){tasks.push(p);}});
  await forced.text(); assert.equal(reads,2); assert.equal(gets,oldGets+1,"Only the revision lookup may use R2 on a forced read");
});

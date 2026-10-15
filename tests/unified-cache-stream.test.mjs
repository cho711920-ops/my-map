import assert from "node:assert/strict";
import test from "node:test";
import {unifiedCacheStream} from "../cloudflare/src/unified-cache-stream.js";
import worker from "../cloudflare/src/worker.js";
import {createSessionToken, SESSION_COOKIE} from "../cloudflare/src/security.js";

const content = JSON.stringify({ok:true,version:2,format:"compact-v2",fields:["originalId","photoCount","thumbnail"],
  groups:{M:[["source-1",7,"https://example.invalid/photo.jpg"],["source-2",0,""]]},
  sourceSnapshotKeys:{M:"sha256-v1:"+"a".repeat(64)},sourceSnapshotPropertyIds:{M:"M"},source:"D1"});
function object(body = content, chunkSize = 80) {
  const bytes = new TextEncoder().encode(body);
  let cursor = 0, pulls = 0, cancelled = false;
  return {
    httpEtag:'"r2-content-etag"', customMetadata:{savedAt:String(Date.now()),revision:"same-source-proof"},
    httpMetadata:{contentType:"application/json; charset=utf-8"},
    body:new ReadableStream({pull(controller) {
      pulls++; if(cursor === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(cursor,cursor += Math.min(chunkSize,bytes.length-cursor)));
    },cancel(){cancelled=true;}}),
    text(){throw Error("Current compact cache must never be buffered with object.text()");},
    stats(){return {pulls,cancelled};}
  };
}

test("current R2 cache returns headers before the full body, preserving every count, photo and proof byte", async () => {
  const cached = object(content.repeat(1000));
  const result = await unifiedCacheStream(new Request("https://js-map.com/api/data"), cached);
  assert.equal(result.response.headers.get("x-js-listings-revision"),"same-source-proof");
  assert.ok(cached.stats().pulls < 6,"Do not consume a full response before returning headers");
  assert.equal(await result.response.text(),content.repeat(1000));
});

test("split UTF-8 chunks and legacy envelopes are returned without losing the peeked bytes", async () => {
  const compact = await unifiedCacheStream(new Request("https://js-map.com/api/data"), object(content,1));
  assert.equal(await compact.response.text(),content);
  const legacy = JSON.stringify({ok:true,groups:{M:[{originalId:"원본",thumbnail:"한글사진.jpg",photoCount:3}]}});
  const result = await unifiedCacheStream(new Request("https://js-map.com/api/data"),object(legacy,1));
  assert.equal(result.body,legacy);
});

test("ETag hits cancel the R2 body and gzip negotiation respects explicit rejection", async () => {
  const cached = object();
  const result = await unifiedCacheStream(new Request("https://js-map.com/api/data", {
    headers:{"if-none-match":'"old", W/"r2-content-etag"',"accept-encoding":"gzip"}
  }),cached);
  assert.equal(result.response.status,304);
  assert.equal(result.response.body,null);
  assert.equal(cached.stats().cancelled,true);
  for(const [encoding,gzip] of [["br, gzip",true],["*;q=0.5",true],["gzip;q=0, *;q=1",false],["identity",false]]) {
    const reply = await unifiedCacheStream(new Request("https://js-map.com/api/data",{headers:{"accept-encoding":encoding}}),object());
    assert.equal(reply.response.headers.get("content-encoding"),gzip?"gzip":null);
    await reply.response.body.cancel();
  }
});

test("the authenticated Worker streams a current cache without reading D1 or buffering R2", async () => {
  let gets = 0;
  const env={ALLOWED_EMAILS:"stream-test@example.invalid",SESSION_SECRET:"synthetic-stream-session-secret-over-32-characters",
    MEDIA:{async get(){gets++;return object();}}};
  const token=await createSessionToken({email:env.ALLOWED_EMAILS,sub:"test"},env);
  const url="https://js-map.com/api/data?action=unifiedListings";
  const unauthorized=await worker.fetch(new Request(url),env);
  assert.equal(unauthorized.status,401); assert.equal(gets,0);
  const response=await worker.fetch(new Request(url,{headers:{cookie:SESSION_COOKIE+"="+encodeURIComponent(token)}}),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("x-js-data-transport"),"r2-stream-v1");
  assert.equal(response.headers.get("x-frame-options"),"DENY");
  assert.equal(await response.text(),content);
  assert.equal(gets,1);
});

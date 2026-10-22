import test from "node:test";
import assert from "node:assert/strict";
import {extract, read} from "./fixtures/daangn-report-fixture.mjs";
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPhotoZip} from './fixtures/photo-zip-check.mjs';

const api = extract(read("js/unified-listings-v8.js"), ["thumbnailProxyUrl", "photoDownloadUrlV73", "photoDownloadFilenameV73"], {
  URL, text: value => String(value == null ? "" : value).trim(),
  global: {location: {origin: "https://js-map.com", href: "https://js-map.com/"}}
}, "  ");
test("photo download uses authenticated same-origin image transport without altering stored provider URL", () => {
  for (const host of ["img.kr.gcp-karroter.net", "landthumb-phinf.pstatic.net", "dnvefa72aowie.cloudfront.net", "file1.gongsilbox.com"]) {
    const source = `https://${host}/original.jpg?w=1440&q=95`;
    const url = new URL(api.photoDownloadUrlV73(source), "https://js-map.com");
    assert.equal(url.pathname, "/api/listing-image");
    assert.equal(url.searchParams.get("url"), source);
  }
  assert.equal(api.photoDownloadUrlV73("/api/listing-image?url=stored"), "https://js-map.com/api/listing-image?url=stored");
  for (const value of ["", null, "javascript:alert(1)", "data:image/png;base64,x", "https://user:secret@file1.gongsilbox.com/p.jpg", "http://file1.gongsilbox.com/p.jpg", "https://unknown.example/p.jpg", "https://127.0.0.1/p.jpg"]) {
    assert.equal(api.photoDownloadUrlV73(value), "");
  }
});
test("photo filenames follow actual response format, selected index and safe Korean listing label", () => {
  assert.equal(api.photoDownloadFilenameV73("서구 괴정동 424-2", 1, "image/png"), "JS부동산_서구 괴정동 424-2_사진_02.png");
  assert.equal(api.photoDownloadFilenameV73("매물", 0, "IMAGE/JPEG ; charset=binary"), "JS부동산_매물_사진_01.jpg");
  assert.equal(api.photoDownloadFilenameV73("매물", 0, "text/html"), "");
  const filename = api.photoDownloadFilenameV73("../x\\y\n\"<>|*?\u202e", 0, "image/webp");
  assert.doesNotMatch(filename, /[/\\\n"<>|*?\u202e]/);
});

test('bulk ZIP is independently readable with ten ordered Korean filenames and exact image bytes', async () => {
  const zipApi = extract(read('js/unified-listings-v8.js'), ['photoZipV74'], {Blob, TextEncoder}, '  ');
  const entries = Array.from({length: 10}, (_, i) => ({
    name: api.photoDownloadFilenameV73('서구 괴정동 424-2', i, 'image/png'),
    bytes: new Uint8Array([137,80,78,71, i, ...Buffer.from('123456789')])
  }));
  const folder = await mkdtemp(join(tmpdir(), 'js-photo-zip-'));
  try {
    const path = join(folder, 'photos.zip');
    await writeFile(path, Buffer.from(await zipApi.photoZipV74(entries).arrayBuffer()));
    const saved = readPhotoZip(path);
    assert.equal(saved.length, 10);
    saved.forEach((entry, i) => {assert.equal(entry.name, entries[i].name); assert.deepEqual(entry.bytes, Buffer.from(entries[i].bytes));});
  } finally {await rm(folder, {recursive: true, force: true});}
});

test("shared image download transport preserves bytes, uses the session and rejects auth/error/oversized files", async () => {
  let response = new Response(new Uint8Array([1,2,3]), {headers: {"content-type": "image/png"}});
  let calls = 0;
  const imageApi = extract(read("js/data-access-v6.js"), ["readImageBlob"], {
    URL, Blob, global: {location: {origin: "https://js-map.com", href: "https://js-map.com/"},
      fetch: async (url, options) => {
        calls++; assert.equal(url, "https://js-map.com/api/listing-image?url=fixture");
        assert.equal(options.credentials, "same-origin"); assert.equal(options.redirect, "error");
        return response;
      }}
  }, "  ");
  const photo = await imageApi.readImageBlob("/api/listing-image?url=fixture");
  assert.deepEqual(new Uint8Array(await photo.blob.arrayBuffer()), new Uint8Array([1,2,3]));
  for (const invalid of [
    new Response("{}", {status: 401, headers: {"content-type": "application/json"}}),
    new Response("<html>expired</html>", {headers: {"content-type": "text/html"}}),
    new Response(new Uint8Array(0), {headers: {"content-type": "image/png"}}),
    new Response(new Uint8Array([1]), {headers: {"content-type": "image/png", "content-length": String(13*1024*1024)}}),
    new Response(new Uint8Array(12*1024*1024+1), {headers: {"content-type": "image/png"}})
  ]) {
    response = invalid;
    await assert.rejects(imageApi.readImageBlob("/api/listing-image?url=fixture"));
  }
  const before = calls;
  await assert.rejects(imageApi.readImageBlob("https://unknown.example/p.jpg"));
  assert.equal(calls, before);
});

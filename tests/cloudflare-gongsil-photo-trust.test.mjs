import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { gongsilImageUrls } from "../cloudflare/src/collector-api.js";
import { actualGongsilImages } from "../cloudflare/src/d1-api.js";

const photoRoot = "https://file1.gongsilbox.com/file/land_photo/";
const realPhoto = "2026/08/20260813_1200000000_00.png";
const representative = "2026/07/20260721_1156423452_00.png";
const falseOnlyRecord = {
  primaryImage: `${photoRoot}avatars/1.png`,
  imageUrls: [`${photoRoot}avatars/1.png`, `${photoRoot}${representative}`],
  raw: {
    list: { Photos: [], Xbfimg: representative },
    detail: {
      bdsinfo: { photo: "avatars/1.png" },
      bilinfo: { bfxphoto: representative }
    }
  }
};

test("photo-less Gongsilbox listings reject profile and representative images", () => {
  assert.deepEqual(gongsilImageUrls(falseOnlyRecord), []);
  assert.deepEqual(actualGongsilImages(falseOnlyRecord.raw), []);
});

test("Gongsilbox keeps only explicit Photos entries", () => {
  const raw = {
    list: {
      Photos: [{ Photo: realPhoto }, { Photo: "avatars/1.png" }],
      Xbfimg: representative
    }
  };
  assert.deepEqual(gongsilImageUrls({ raw }), [`${photoRoot}${realPhoto}`]);
  assert.deepEqual(actualGongsilImages(raw), [`${photoRoot}${realPhoto}`]);
});

test("unified list and detail responses sanitize legacy Gongsilbox media", () => {
  const d1 = fs.readFileSync("cloudflare/src/d1-api.js", "utf8");
  const worker = fs.readFileSync("cloudflare/src/worker.js", "utf8");
  assert.match(d1, /json_extract\(raw_json, '\$\.list\.Photos'\) AS gongsil_photos_json/);
  assert.match(d1, /clean\(original\.source\) === "공실박스"/);
  assert.match(d1, /const isGongsil = clean\(row\.source \|\| snapshot\.source\) === "공실박스"/);
  assert.match(worker, /unified-listings-v4-actual-gongsil-photos\.json/);
  assert.match(worker, /unified-detail-v2-actual-photos/);
});

test("primary dialogs share one minimal single-glyph close-button style", () => {
  const css = fs.readFileSync("css/modal-close-v1.css", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  [
    ".operations-center-close",
    ".customer-crm-dialog header > button",
    ".property-edit-close-v630",
    ".unified-detail-drawer-v8 > header > button"
  ].forEach((selector) => assert.ok(css.includes(selector), `${selector} must use the shared close control`));
  assert.match(css, /min-width: 40px !important/);
  assert.match(css, /content: none !important/);
  assert.doesNotMatch(css, /mask:/);
  assert.match(css, /#roadviewModal\.roadview-modal \.roadview-modal-close/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /modal-close-v1\.css\?v=1\.1\.0-minimal-circle/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  scrubExternalContactData,
  stripExternalPhoneNumbers
} from "../cloudflare/src/collector-api.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Naver and Daangn broker phone numbers are removed before persistence", () => {
  const text = "상담전화 010-8969-8008 / 사무실 042-123-4567, 대표 0507-1234-5678";
  const cleaned = stripExternalPhoneNumbers(text);
  assert.doesNotMatch(cleaned, /010|042|0507/);
  assert.doesNotMatch(cleaned, /상담\s*전화/);

  const raw = scrubExternalContactData({
    content: text,
    broker: { phone: "010-1111-2222", name: "중개업소" },
    articleNo: "4182029"
  });
  assert.equal(raw.broker.phone, "");
  assert.doesNotMatch(raw.content, /010|042|0507/);
  assert.equal(raw.articleNo, "4182029");
});

test("contact APIs only return Gongsilbox source contacts", () => {
  const source = fs.readFileSync(path.join(root, "cloudflare/src/d1-api.js"), "utf8");
  assert.match(source, /listingContacts[\s\S]*?JOIN listing_sources s ON s\.id = c\.source_id[\s\S]*?s\.source = '공실박스'/);
  assert.match(source, /tellContacts[\s\S]*?JOIN listing_sources s ON s\.id = c\.source_id[\s\S]*?s\.source = '공실박스'/);
});

test("listing cards never derive contacts from Naver or Daangn memo text", () => {
  const source = fs.readFileSync(path.join(root, "js/script.js"), "utf8");
  const start = source.indexOf("function extractListContactsV650(item)");
  const end = source.indexOf("function normalizeLinkedGongsilContactsV8", start);
  assert(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /providerSource\.indexOf\("네이버"\)/);
  assert.match(block, /providerSource\.indexOf\("당근"\)/);
  assert.match(block, /return contacts;/);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /js\/script\.js\?v=6\.5\.70-gongsil-contact-only/);
});

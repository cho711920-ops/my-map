import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
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

test("listing cards accept explicit manual memo contacts but reject provider phone data", () => {
  const source = fs.readFileSync(path.join(root, "js/script.js"), "utf8");
  const start = source.indexOf("function extractListContactsV650(item)");
  const end = source.indexOf("function normalizeLinkedGongsilContactsV8", start);
  assert(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /providerSource\.indexOf\("네이버"\)/);
  assert.match(block, /providerSource\.indexOf\("당근"\)/);
  assert.match(block, /if \(!externalProvider\) \{[\s\S]*?add\("임"/);
  assert.match(block, /역할이 없는 광고 전화번호/);

  const functionStart = source.indexOf("var LIST_CONTACT_ROLE_META_V650");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source.slice(functionStart, end), context);
  const contacts = context.extractListContactsV650({
    source: "네이버",
    landlordPhone: "010-1111-2222",
    contactListRaw: JSON.stringify([{ role: "부", phone: "010-2222-3333" }]),
    memo: "문의 010-3333-4444 / 중개사)010-4444-5555 / 임)010-5555-6666 / 세입자)010-7777-8888"
  });
  assert.equal(JSON.stringify(contacts.map((contact) => [contact.role, contact.phone.display])),
    JSON.stringify([["임", "010-5555-6666"], ["세", "010-7777-8888"]]));
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /js\/script\.js\?v=6\.5\.76-data-access/);
});

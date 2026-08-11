import assert from "node:assert/strict";
import test from "node:test";

import {
  extractManualMemoContacts,
  reconcileMemoContacts
} from "../cloudflare/src/d1-api.js";

test("manual landlord and tenant memo numbers are extracted with common labels", () => {
  assert.deepEqual(extractManualMemoContacts([
    "임)010-1111-2222",
    "임대인) 010 2222 3333",
    "세)010-3333-4444",
    "세입자 번호 010-4444-5555",
    "다른세입자 번호 010-5555-6666",
    "관리소장)010-6666-7777"
  ].join("\n")), [
    { role: "임", phone: "010-1111-2222" },
    { role: "임", phone: "010-2222-3333" },
    { role: "세", phone: "010-3333-4444" },
    { role: "세", phone: "010-4444-5555" },
    { role: "세", phone: "010-5555-6666" },
    { role: "관", phone: "010-6666-7777" }
  ]);
});

test("Naver and Daangn keep only explicit user memo contacts", () => {
  assert.deepEqual(reconcileMemoContacts("당근", [
    { role: "부", phone: "010-9999-0000" }
  ], "전화나 문자상담 010-8888-0000\n세입자)010-7777-0000"), [
    { role: "세", phone: "010-7777-0000" }
  ]);
});

test("Gongsilbox stored contacts and manual memo contacts are merged", () => {
  assert.deepEqual(reconcileMemoContacts("공실박스", [
    { role: "주인", phone: "010-1111-2222" }
  ], "세)010-3333-4444"), [
    { role: "주", phone: "010-1111-2222" },
    { role: "세", phone: "010-3333-4444" }
  ]);
});

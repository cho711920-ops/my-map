import test from "node:test";
import assert from "node:assert/strict";
import { businessHistoryDiff } from "../cloudflare/src/d1-api.js";

test("business history hides internal fields and maps edit aliases", () => {
  const changes = businessHistoryDiff({
    id: "internal-id",
    property_id: "property-id",
    status: "active",
    main_source: "네이버",
    title: "일반상가",
    address: "서구 탄방동 86-4",
    room: "1층",
    deposit: 2000,
    monthly_rent: 50,
    operating_memo: "기존 메모",
    contacts_json: JSON.stringify([{ role: "관리", phone: "01011112222" }])
  }, {
    name: "일반상가",
    state: "deleted",
    room: "1층",
    deposit: "2,000",
    rent: 60,
    memo: "새 메모",
    contacts: [{ role: "관리", phone: "010-3333-4444" }]
  });

  assert.deepEqual(changes, [
    { field: "monthly_rent", before: 50, after: 60 },
    { field: "operating_memo", before: "기존 메모", after: "새 메모" },
    {
      field: "contacts_json",
      before: [{ role: "관리", phone: "010-1111-2222" }],
      after: [{ role: "관리", phone: "010-3333-4444" }]
    }
  ]);
});

test("business history ignores formatting-only phone and number changes", () => {
  const changes = businessHistoryDiff({
    deposit: 3000,
    landlord_phone: "01012345678",
    contacts_json: '[{"role":"임대인","phone":"01012345678"}]'
  }, {
    deposit: "3,000",
    landlordPhone: "010-1234-5678",
    contacts: [{ role: "임대인", phone: "010-1234-5678" }]
  });
  assert.deepEqual(changes, []);
});

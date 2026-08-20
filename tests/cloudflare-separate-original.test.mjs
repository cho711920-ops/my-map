import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { remainingMasterValues, separatedMasterValues } from "../cloudflare/src/d1-api.js";

test("separating an original builds a source-specific active master", () => {
  const value = separatedMasterValues({
    source: "당근",
    source_url: "https://realty.daangn.com/?article_id=3934882",
    first_collected_at: "2026-08-01T11:48:13.000Z",
    last_collected_at: "2026-08-11T01:00:00.000Z",
    raw_json: "{}",
    list_snapshot_json: JSON.stringify({
      buildingName: "일반상가",
      address: "서구 용문동 592-4",
      room: "2/3",
      type: "사무실",
      deposit: 1000,
      rent: 100,
      fee: 5,
      premium: 0,
      area: 30.5,
      memo: "내부 화장실 2개",
      revision: 1
    })
  }, {
    title: "기존 대표매물",
    address: "서구 용문동 592-4",
    room: "2층",
    contacts_json: "[]"
  }, "M-separated-1");

  assert.equal(value.id, "M-separated-1");
  assert.equal(value.source, "당근");
  assert.equal(value.room, "2층");
  assert.equal(value.deposit, 1000);
  assert.equal(value.rent, 100);
  assert.equal(value.area, 30.5);
  assert.equal(value.memo, "내부 화장실 2개");
});

test("the source master adopts the remaining originals' rental terms after separation", () => {
  const parent = {
    deposit: 3000,
    monthly_rent: 150,
    maintenance_fee: 0,
    premium: 1,
    area_m2: 20.9,
    room: "1층",
    listing_type: "상가점포"
  };
  const value = remainingMasterValues([
    {
      source: "당근",
      list_snapshot_json: JSON.stringify({ deposit: 1000, rent: 75, fee: 1, premium: 0, area: 9.9 })
    },
    {
      source: "네이버",
      list_snapshot_json: JSON.stringify({ deposit: 1000, rent: 75, area: 10 })
    },
    {
      source: "네이버",
      list_snapshot_json: JSON.stringify({ deposit: 3000, rent: 150, area: 20.9 })
    }
  ], parent, "M-remaining");

  assert.equal(value.id, "M-remaining");
  assert.equal(value.deposit, 1000);
  assert.equal(value.rent, 75);
  assert.equal(value.fee, 1);
  assert.equal(value.premium, 0);
  assert.equal(value.area, 9.9);
});

test("a new master separated from a confirmed listing remains confirmed", () => {
  const value = separatedMasterValues({
    source: "네이버",
    raw_json: "{}",
    list_snapshot_json: JSON.stringify({
      address: "서구 괴정동 100-1",
      room: "2층",
      memo: "(임장가자) 원본 광고 설명"
    })
  }, {
    title: "기존 대표매물",
    address: "서구 괴정동 100-1",
    room: "2층",
    operating_memo: "(확인매물) / 현장에서 확인한 매물",
    contacts_json: "[]"
  }, "M-separated-confirmed");

  assert.equal(value.memo, "(확인매물) / 원본 광고 설명");
});

test("NEW target creates a master and moves source assets atomically", async () => {
  const d1 = await readFile(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../js/unified-listings-v8.js", import.meta.url), "utf8");
  const dataAccess = await readFile(new URL("../js/data-access-v6.js", import.meta.url), "utf8");
  assert.match(d1, /if \(targetMasterId === "NEW"\)/);
  assert.match(d1, /INSERT INTO listings/);
  assert.match(d1, /UPDATE listing_sources SET listing_id=\?1/);
  assert.match(d1, /UPDATE listing_media SET listing_id=\?1/);
  assert.match(d1, /UPDATE listing_contacts SET listing_id=\?1/);
  assert.match(d1, /refreshMasterTermsStatement\(env, remainingValue, source\.listing_id, now\)/);
  assert.match(d1, /sourceMasterRefreshed: !!remainingValue/);
  assert.match(d1, /'separateOriginalListing'/);
  assert.match(client, /JSDataAccessV6\.mutate\(action, payload/);
  assert.match(dataAccess, /messageFromPayload\(result, settings\.errorMessage \|\| "저장 요청 실패"\)/);
});

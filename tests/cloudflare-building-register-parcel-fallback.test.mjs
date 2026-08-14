import assert from "node:assert/strict";
import test from "node:test";

import {
  getBuildingRegister,
  parseBuildingRegisterLotAddress
} from "../cloudflare/src/building-register-api.js";

function xml(items = [], totalCount = items.length) {
  return `<response><header><resultCode>00</resultCode></header><body><items>${items.join("")}</items><totalCount>${totalCount}</totalCount></body></response>`;
}

function mockDb(rows) {
  const state = { badgeUpdates: 0, cacheWrites: 0 };
  return {
    state,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          if (/FROM building_cache/.test(sql)) return null;
          throw new Error(`unexpected first query: ${sql}`);
        },
        async all() {
          if (/LEFT JOIN listing_sources/.test(sql)) {
            assert.equal(args[0], "M-test-listing");
            return { results: rows };
          }
          throw new Error(`unexpected all query: ${sql}`);
        },
        async run() {
          if (/INSERT INTO building_cache/.test(sql)) {
            state.cacheWrites += 1;
            return { meta: { changes: 1 } };
          }
          if (/UPDATE listings SET building_year/.test(sql)) {
            state.badgeUpdates += 1;
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected run query: ${sql}`);
        }
      };
    }
  };
}

test("lot address parser accepts Daejeon jibun and rejects dong-only addresses", () => {
  assert.deepEqual(parseBuildingRegisterLotAddress("대전시 중구 선화동 12-3"), {
    district: "중구",
    neighborhood: "선화동",
    platGbCd: "0",
    bun: "0012",
    ji: "0003",
    address: "중구 선화동 12-3"
  });
  assert.equal(parseBuildingRegisterLotAddress("중구 선화동"), null);
});

test("zero-result parcel safely falls back to an exact source parcel for the same master", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  const DB = mockDb([
    {
      listing_address: "중구 선화동 12-9",
      listing_latitude: 36.3304631,
      listing_longitude: 127.4232138,
      list_snapshot_json: JSON.stringify({
        address: "중구 선화동 12-9",
        latitude: 36.3304631,
        longitude: 127.4232138
      }),
      raw_json: "{}"
    },
    {
      listing_address: "중구 선화동 12-9",
      listing_latitude: 36.3304631,
      listing_longitude: 127.4232138,
      list_snapshot_json: JSON.stringify({
        address: "중구 선화동 12-3",
        latitude: 36.3305203,
        longitude: 127.4231417
      }),
      raw_json: JSON.stringify({
        jibunAddress: "대전시 중구 선화동 12-3",
        latitude: 36.3305203,
        longitude: 127.4231417
      })
    }
  ]);

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const isAlternate = url.searchParams.get("bun") === "0012" && url.searchParams.get("ji") === "0003";
    const isTitle = url.pathname.endsWith("/getBrTitleInfo");
    const item = isAlternate && isTitle
      ? `<item><mgmBldrgstPk>ALT-12-3</mgmBldrgstPk><platPlc>대전광역시 중구 선화동 12-3</platPlc><newPlatPlc>대종로 527</newPlatPlc><bldNm>재경빌딩</bldNm><grndFlrCnt>5</grndFlrCnt><ugrndFlrCnt>1</ugrndFlrCnt><useAprDay>19870630</useAprDay></item>`
      : "";
    return new Response(xml(item ? [item] : [], item ? 1 : 0), { status: 200 });
  };

  try {
    const result = await getBuildingRegister({ DB, DATA_GO_KR_SERVICE_KEY: "test-key" }, {
      mode: "summary",
      sigunguCd: "30140",
      bjdongCd: "10200",
      platGbCd: "0",
      bun: "0012",
      ji: "0009",
      propertyId: "M-test-listing",
      address: "중구 선화동 12-9"
    });

    assert.equal(result.buildings.length, 1);
    assert.equal(result.buildings[0].buildingName, "재경빌딩");
    assert.equal(result.parcel.ji, "0003");
    assert.equal(result.parcelFallback.used, true);
    assert.equal(result.parcelFallback.requestedAddress, "중구 선화동 12-9");
    assert.equal(result.parcelFallback.resolvedAddress, "중구 선화동 12-3");
    assert.equal(DB.state.badgeUpdates, 1, "the empty primary response must not mark the listing as confirmed");
    assert.equal(calls.length, 4, "primary and alternate summary endpoints should each be queried once");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a far-away source from a bad cluster is never used as a register fallback", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  const DB = mockDb([{
    listing_address: "중구 선화동 12-9",
    listing_latitude: 36.3304631,
    listing_longitude: 127.4232138,
    list_snapshot_json: JSON.stringify({
      address: "중구 선화동 999-1",
      latitude: 36.3404631,
      longitude: 127.4232138
    }),
    raw_json: "{}"
  }]);
  globalThis.fetch = async (input) => {
    calls.push(new URL(String(input)));
    return new Response(xml(), { status: 200 });
  };
  try {
    const result = await getBuildingRegister({ DB, DATA_GO_KR_SERVICE_KEY: "test-key" }, {
      mode: "summary",
      sigunguCd: "30140",
      bjdongCd: "10200",
      platGbCd: "0",
      bun: "0012",
      ji: "0009",
      propertyId: "M-test-listing",
      address: "중구 선화동 12-9"
    });
    assert.equal(result.buildings.length, 0);
    assert.equal(result.parcelFallback, undefined);
    assert.equal(result.alternateParcelsChecked, 0);
    assert.equal(DB.state.badgeUpdates, 0);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a dong-only listing prefers its active source's exact lot over approximate coordinates", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  const DB = mockDb([{
    listing_address: "대덕구 중리동",
    listing_latitude: 36.3659021,
    listing_longitude: 127.4237246,
    list_snapshot_json: JSON.stringify({
      address: "대덕구 중리동 104-5",
      latitude: 36.3634793,
      longitude: 127.4327604
    }),
    raw_json: "{}"
  }]);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const isAlternate = url.searchParams.get("bun") === "0104" && url.searchParams.get("ji") === "0005";
    const item = isAlternate && url.pathname.endsWith("/getBrTitleInfo")
      ? `<item><mgmBldrgstPk>ALT-104-5</mgmBldrgstPk><platPlc>대전광역시 대덕구 중리동 104-5</platPlc><bldNm>원본건물</bldNm></item>`
      : "";
    return new Response(xml(item ? [item] : [], item ? 1 : 0), { status: 200 });
  };
  try {
    const result = await getBuildingRegister({ DB, DATA_GO_KR_SERVICE_KEY: "test-key" }, {
      mode: "summary",
      sigunguCd: "30230",
      bjdongCd: "10100",
      platGbCd: "0",
      bun: "0999",
      ji: "0000",
      propertyId: "M-test-listing",
      address: "대덕구 중리동"
    });
    assert.equal(result.parcelFallback.used, true);
    assert.equal(result.parcelFallback.resolvedAddress, "대덕구 중리동 104-5");
    assert.equal(result.buildings[0].buildingName, "원본건물");
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

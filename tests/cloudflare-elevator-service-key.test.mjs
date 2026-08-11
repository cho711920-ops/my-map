import assert from "node:assert/strict";
import test from "node:test";

import {
  elevatorAddressVariants,
  elevatorRoadAddressVariants,
  getElevatorCapacity,
  normalizeDataGoKrServiceKey
} from "../cloudflare/src/elevator-capacity-api.js";
import { normalizeBuildingRegisterServiceKey } from "../cloudflare/src/building-register-api.js";

test("data.go.kr encoded and decoded service keys normalize identically", () => {
  assert.equal(normalizeDataGoKrServiceKey("sampleKey%2Bvalue%3D%3D"), "sampleKey+value==");
  assert.equal(normalizeDataGoKrServiceKey("sampleKey+value=="), "sampleKey+value==");
});

test("building-register key normalization stays separate but handles encoded display keys", () => {
  assert.equal(normalizeBuildingRegisterServiceKey("building%2Bkey%3D%3D"), "building+key==");
});

test("elevator address lookup tries safe Daejeon address variants", () => {
  assert.deepEqual(elevatorAddressVariants("서구 둔산동 1236 4층"), [
    "대전광역시 서구 둔산동 1236",
    "대전 서구 둔산동 1236",
    "서구 둔산동 1236",
    "둔산동 1236"
  ]);
  assert.deepEqual(elevatorRoadAddressVariants("대전광역시 대덕구 동춘당로 79 (송촌동)"), [
    "대전광역시 대덕구 동춘당로 79",
    "대덕구 동춘당로 79",
    "동춘당로 79"
  ]);
});

test("elevator capacity uses address discovery then approved building detail", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/getOperationInfoListV1")) {
      return new Response(`<response><header><resultCode>00</resultCode></header><body><items><item>
        <elevatorNo>1234567</elevatorNo><address1>대전광역시 서구 둔산동 1236</address1>
        <address2>대전광역시 서구 둔산로 1</address2><ratedCap>0</ratedCap><liveLoad>550</liveLoad>
      </item></items><totalCount>1</totalCount></body></response>`, { status: 200 });
    }
    if (url.pathname.endsWith("/getBuldElvtrList")) {
      return new Response(`<response><header><resultCode>00</resultCode></header><body><items><item>
        <elevatorNo>1234567</elevatorNo><address1>대전광역시 서구 둔산동 1236</address1>
        <ratedCap>15</ratedCap><liveLoad>1000</liveLoad>
      </item></items></body></response>`, { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const result = await getElevatorCapacity({ ELEVATOR_OPERATION_SERVICE_KEY: "test-key" }, {
      address: "서구 둔산동 1236 4층",
      expectedCount: 1,
      force: true
    });
    assert.equal(result.matched, true);
    assert.equal(result.maxCapacity, 15);
    assert.equal(result.elevators[0].loadKg, 1000);
    assert.equal(calls.some((url) => url.pathname.endsWith("/getBuldElvtrList")), true);
    assert.equal(calls.every((url) => url.searchParams.get("serviceKey") === "test-key"), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("district operation index recovers elevator numbers when exact address search is empty", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  const objects = new Map();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/getOperationInfoListV1")) {
      const districtQuery = url.searchParams.get("buld_address") === "대전광역시 서구";
      return new Response(districtQuery
        ? `<response><header><resultCode>00</resultCode></header><body><items><item>
            <elevatorNo>7654321</elevatorNo><address1>대전광역시 서구 둔산동 1425</address1>
            <ratedCap>0</ratedCap><liveLoad>700</liveLoad>
          </item></items><totalCount>1</totalCount></body></response>`
        : `<response><header><resultCode>00</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>`,
      { status: 200 });
    }
    if (url.pathname.endsWith("/getBuldElvtrList")) {
      return new Response(`<response><header><resultCode>00</resultCode></header><body><items><item>
        <elevatorNo>7654321</elevatorNo><address1>대전광역시 서구 둔산동 1425</address1>
        <ratedCap>13</ratedCap><liveLoad>900</liveLoad>
      </item></items></body></response>`, { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const MEDIA = {
    async get(key) {
      return objects.has(key) ? { text: async () => objects.get(key) } : null;
    },
    async put(key, value) {
      objects.set(key, value);
    }
  };
  try {
    const result = await getElevatorCapacity({ ELEVATOR_OPERATION_SERVICE_KEY: "test-key", MEDIA }, {
      address: "대전광역시 서구 둔산동 1425",
      expectedCount: 1,
      force: true
    });
    assert.equal(result.matched, true);
    assert.equal(result.maxCapacity, 13);
    assert.equal(result.queryAddress, "대전광역시 서구");
    assert.equal(calls.some((url) => url.searchParams.get("buld_address") === "대전광역시 서구"), true);
    assert.equal(objects.has("api-cache/elevator-district-v2/서구.json"), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("source gateway and official road address recover capacity when proxy address search is empty", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "apis.data.go.kr") {
      return new Response(`<response><header><resultCode>00</resultCode></header><body>
        <items></items><totalCount>0</totalCount></body></response>`, { status: 200 });
    }
    if (url.hostname === "openapigw.elevator.go.kr") {
      assert.equal(url.searchParams.get("buld_address"), "대전광역시 대덕구 동춘당로 79");
      return new Response(`<response><header><resultCode>00</resultCode></header><body><items><item>
        <elevatorNo>5000593</elevatorNo><address1>대전광역시 대덕구 동춘당로 79</address1>
        <address2>(송촌동)</address2><ratedCap>13</ratedCap><liveLoad>900</liveLoad>
      </item></items><totalCount>1</totalCount></body></response>`, { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const result = await getElevatorCapacity({ ELEVATOR_OPERATION_SERVICE_KEY: "test-key" }, {
      address: "대덕구 송촌동 477-1",
      roadAddress: "대전광역시 대덕구 동춘당로 79 (송촌동)",
      expectedCount: 1,
      force: true
    });
    assert.equal(result.matched, true);
    assert.equal(result.maxCapacity, 13);
    assert.equal(result.queryAddress, "대전광역시 대덕구 동춘당로 79");
    assert.equal(calls.some((url) => url.hostname === "openapigw.elevator.go.kr"), true);
    assert.equal(calls.some((url) => url.pathname.endsWith("/getBuldElvtrList")), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

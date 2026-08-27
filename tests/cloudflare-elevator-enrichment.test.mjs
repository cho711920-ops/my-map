import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  normalizedLotAddress,
  parseDaejeonParcelAddress
} from "../cloudflare/src/elevator-enrichment.js";

const worker = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const collector = fs.readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
const building = fs.readFileSync(new URL("../js/building-register-v6.js", import.meta.url), "utf8");
const enrichment = fs.readFileSync(new URL("../cloudflare/src/elevator-enrichment.js", import.meta.url), "utf8");
const elevatorApi = fs.readFileSync(new URL("../cloudflare/src/elevator-capacity-api.js", import.meta.url), "utf8");
const buildingApi = fs.readFileSync(new URL("../cloudflare/src/building-register-api.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../cloudflare/migrations/0015_elevator_registry.sql", import.meta.url), "utf8");
const audit = fs.readFileSync(new URL("../tools/backfill-elevator-capacity.mjs", import.meta.url), "utf8");

test("future listings are enriched after collection and by the minute scheduler", () => {
  assert.match(worker, /runElevatorEnrichmentMaintenance\(env, context, "collectorElevatorEnrichment"\)/);
  assert.match(worker, /runScheduledElevatorEnrichment\(env\)/);
  assert.match(collector, /road_address=CASE WHEN road_address='' AND \?16<>''/);
  assert.match(collector, /address, road_address, building_name/);
  assert.match(enrichment, /datetime\(building_info_checked_at\)<datetime\('now','-12 hours'\)/);
});

test("safety registry independently overrides an incorrect Building-HUB zero", () => {
  assert.doesNotMatch(elevatorApi, /Number\(expectedCount \|\| 0\) <= 0/);
  assert.match(enrichment, /elevator_registry_status='unavailable'/);
  assert.match(enrichment, /elevator_registry_count/);
  assert.match(enrichment, /MAX\(COALESCE\(building_register_elevators,building_elevators,0\),\?2\)/);
  assert.match(enrichment, /\(\?6<>'' AND trim\(COALESCE\(road_address,''\)\)=\?6\) OR address=\?7/);
  assert.match(buildingApi, /building_register_elevators=\?2/);
  assert.match(buildingApi, /building_elevators=MAX\(\?2, COALESCE\(elevator_registry_count,0\)\)/);
  assert.match(migration, /building_register_elevators/);
  assert.match(migration, /elevator_registry_checked_at/);
});

test("full audit includes register-zero listings and records both matches and no-matches", () => {
  assert.doesNotMatch(audit, /WHERE l\.status<>'deleted' AND l\.building_elevators>0/);
  assert.match(audit, /Building-HUB zero but safety-registry matched/);
  assert.match(audit, /source_locations AS/);
  assert.match(audit, /json_extract\(raw_json,'\$\.publicAddress'\)/);
  assert.match(audit, /elevator_registry_status=/);
  assert.match(audit, /building_elevator_capacity=/);
});

test("card entry never starts an elevator-capacity network request", () => {
  assert.doesNotMatch(building, /function requestCapacityData/);
  assert.doesNotMatch(building, /action=elevatorCapacity/);
  assert.match(building, /Cards only render the value already prepared in D1/);
});

test("Daejeon lot addresses become Building-HUB parcel inputs", () => {
  assert.deepEqual(parseDaejeonParcelAddress("대전광역시 대덕구 송촌동 477-1번지"), {
    district: "대덕구",
    neighborhood: "송촌동",
    platGbCd: "0",
    bun: "0477",
    ji: "0001"
  });
  assert.deepEqual(parseDaejeonParcelAddress("대전광역시 유성구 봉명동 산 12-3"), {
    district: "유성구",
    neighborhood: "봉명동",
    platGbCd: "1",
    bun: "0012",
    ji: "0003"
  });
  assert.equal(
    normalizedLotAddress("대전광역시 대덕구 송촌동 477-1번지"),
    normalizedLotAddress("대덕구 송촌동 477-1")
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const worker = readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const d1 = readFileSync(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
const compactFields = JSON.parse(worker.match(/const UNIFIED_COMPACT_FIELDS = (\[[\s\S]*?\]);/)[1]);
const fields = JSON.parse(d1.match(/const UNIFIED_FIELDS = (\[[\s\S]*?\]);/)[1]);
const start = worker.indexOf("function compactUnifiedListingsBody(");
const end = worker.indexOf("\nasync function handleListingImage(", start);
assert.ok(start >= 0 && end > start);
const functionSource = worker.slice(start, end);

function harness({ forbidParse = false } = {}) {
  let parseCalls = 0;
  const context = vm.createContext({ UNIFIED_COMPACT_FIELDS: compactFields,
    JSON: { stringify: JSON.stringify, parse(value) {
      parseCalls += 1;
      if (forbidParse) throw new Error("The current compact cache must not be parsed");
      return JSON.parse(value);
    } }
  });
  vm.runInContext(functionSource, context);
  return { convert: value => context.compactUnifiedListingsBody(value), calls: () => parseCalls };
}

function representativeBody() {
  const groups = [];
  const thumbnail = "https://landthumb-phinf.pstatic.net/" + "p".repeat(270) + ".jpg";
  let count = 0;
  for (let i = 0; i < 24_312; i += 1) {
    const originals = [];
    for (let j = 0; j < (i < 424 ? 1 : 2); j += 1) {
      const id = ++count;
      const row = fields.map(field => ({
        originalId: "O-" + id, source: "네이버", link: "https://fin.land.naver.com/articles/" + (2600000000 + id),
        room: "1층", deposit: 1000, rent: 60, fee: 0, premium: 0, area: 76.7,
        latitude: 36.35, longitude: 127.38, thumbnail, photoCount: 7, contactCount: 1, revision: 1,
        tradeType: "lease", sourceListingId: String(2600000000 + id), providerSourceId: String(2600000000 + id),
        sourceUnavailable: id <= 6320, missingCount: id <= 6320 ? 1 : 0, active: id <= 6320 ? 0 : 1,
        floor: 1, literalRoom: "1층", sourceFloor: 1, sourceRoom: "1층", hasManualRoomOverride: false,
        roomManuallyEditedV1: false, lastCheckedAt: "2026-10-15T03:00:00Z", candidateEligible: id <= 6320,
        availabilityKind: id <= 6320 ? "census_missing" : "active", type: "일반상가",
        absenceConfirmedAt: id <= 6320 ? "2026-10-15T03:00:00Z" : ""
      })[field] ?? "");
      originals.push(JSON.stringify(row));
    }
    groups.push('"M-' + i + '":[' + originals.join(",") + "]");
  }
  assert.equal(count, 48_200);
  return '{"ok":true,"version":2,"format":"compact-v2","fields":' + JSON.stringify(fields) +
    ',"groups":{' + groups.join(",") + '},"sourceSearchIds":{},"originalCount":48200,"unavailableCount":6320,"source":"D1"}';
}

test("the current large D1 compact frame skips full parsing and preserves all 39 wire fields unchanged", () => {
  const body = representativeBody();
  assert.ok(Buffer.byteLength(body) >= 24_000_000, "Exercise a representative cache at least as large as the observed 23.7 MB body");
  assert.equal(fields.length, 39);
  const h = harness({ forbidParse: true });
  assert.equal(h.convert(body), body);
  assert.equal(h.calls(), 0);
});

test("legacy object caches still convert IDs, photos, availability and absence dates", () => {
  const original = { originalId: "O-1", source: "네이버", link: "https://example.test/1", room: "1층",
    thumbnail: "https://example.test/photo.jpg", photoCount: 16, sourceUnavailable: true,
    candidateEligible: true, availabilityKind: "census_missing", absenceConfirmedAt: "2026-10-15T03:00:00Z" };
  const h = harness();
  const converted = JSON.parse(h.convert(JSON.stringify({ ok: true, version: 1, groups: { M: [original] }, originalCount: 1 })));
  assert.equal(h.calls(), 1);
  assert.equal(converted.format, "compact-v2");
  for (const [key, value] of Object.entries(original)) assert.equal(converted.groups.M[0][converted.fields.indexOf(key)], value, key);
});

test("compact-v1 caches still map their field order before conversion", () => {
  const previousFields = ["photoCount", "originalId", "thumbnail", "candidateEligible", "availabilityKind", "absenceConfirmedAt", "source"];
  const values = [7, "O-v1", "https://example.test/v1.jpg", true, "census_missing", "2026-10-15T03:00:00Z", "당근"];
  const h = harness();
  const converted = JSON.parse(h.convert(JSON.stringify({ ok: true, version: 1, format: "compact-v1",
    fields: previousFields, groups: { M: [values] }, originalCount: 1 })));
  assert.equal(h.calls(), 1);
  for (const [index, field] of previousFields.entries()) assert.equal(converted.groups.M[0][converted.fields.indexOf(field)], values[index], field);
});

test("noncanonical or different envelopes use the unchanged fallback instead of a loose substring match", () => {
  for (const body of [
    JSON.stringify({ groups: { M: [] }, format: "compact-v2", fields, ok: true, version: 2, source: "D1" }),
    '{"ok":true,"version":2,"format":"compact-v2","fields":[],"groups":{},"source":"other"}',
    JSON.stringify({ ok: true, version: 2, fields, note: '"format":"compact-v2"', groups: { M: [] }, source: "D1" }),
    "not JSON"
  ]) {
    const h = harness();
    const result = h.convert(body);
    assert.equal(h.calls(), 1);
    if (body === "not JSON" || body.includes('"format":"compact-v2"') && !body.includes('"note"')) assert.equal(result, body);
    else assert.equal(JSON.parse(result).format, "compact-v2");
  }
});

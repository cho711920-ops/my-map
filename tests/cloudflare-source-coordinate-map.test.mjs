import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("naver coordinates survive collection and are preferred before address geocoding", () => {
  const collector = fs.readFileSync(path.join(root, "js", "naver-collector.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "cloudflare", "src", "collector-api.js"), "utf8");
  const map = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
  const d1 = fs.readFileSync(path.join(root, "cloudflare", "src", "d1-api.js"), "utf8");

  assert.match(collector, /latitude: item\.latitude,[\s\S]*longitude: item\.longitude/);
  assert.match(api, /latitude: coordinate\(item\?\.latitude/);
  assert.match(api, /latitude: coordinate\(record\?\.latitude/);
  assert.match(api, /longitude: coordinate\(record\?\.longitude/);
  assert.match(api, /INSERT INTO listings \([\s\S]*area_m2, latitude, longitude/);
  assert.match(d1, /last_collected_at, latitude, longitude/);
  assert.match(map, /latitude: clean\(c\[25\]\)/);
  assert.match(map, /item\.latlng = new kakao\.maps\.LatLng\(sourceLat, sourceLng\)/);
  assert.match(map, /else if \(cached && cached\.lat && cached\.lng\)/);
});

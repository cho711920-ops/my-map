import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDataGoKrServiceKey } from "../cloudflare/src/elevator-capacity-api.js";

test("data.go.kr encoded and decoded service keys normalize identically", () => {
  assert.equal(normalizeDataGoKrServiceKey("sampleKey%2Bvalue%3D%3D"), "sampleKey+value==");
  assert.equal(normalizeDataGoKrServiceKey("sampleKey+value=="), "sampleKey+value==");
});

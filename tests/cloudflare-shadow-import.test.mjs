import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv, prepareShadowImport } from "../tools/prepare-d1-shadow-import.mjs";

test("CSV parser preserves multiline memo and escaped quotes", () => {
  const rows = parseCsv('name,address,memo\r\nA,Addr,"first\nsecond ""quoted"""\r\n');
  assert.equal(rows[1][2], 'first\nsecond "quoted"');
});

test("shadow import is keyed by property id and never overwrites", () => {
  const header = Array.from({ length: 25 }, (_, index) => `h${index}`).join(",");
  const row = [
    "Building A", "Daejeon address", "101", "shop", "2000", "150", "5", "0", "33.1",
    "", "", "memo", "active", "2026-01-01", "gongsil", "M-100", "https://example.com", "",
    "", "", "", "", "", "2026-01-01", "2026-08-01"
  ];
  const csv = `${header}\n${row.join(",")}\n${row.join(",")}\n`;
  const result = prepareShadowImport(csv);
  assert.equal(result.report.preparedListings, 1);
  assert.equal(result.report.skipped.duplicatePropertyId, 1);
  assert.match(result.sql, /INSERT OR IGNORE INTO listings/);
  assert.doesNotMatch(result.sql, /INSERT OR REPLACE|UPDATE listings|DELETE FROM listings/);
  assert.match(result.sql, /M-100/);
});


import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {checkBrowserGlobals, checkWorkerGlobals} from "../tools/check-browser-globals.mjs";

test("all classic browser scripts resolve their cross-script and SDK globals", async () => {
  assert.deepEqual(await checkBrowserGlobals(), []);
});

test("all Worker modules resolve their imported and platform globals", async () => {
  assert.deepEqual(await checkWorkerGlobals(), []);
});

test("both older quick-add compatibility paths use their matching comparison helper", () => {
  const source = fs.readFileSync("js/parser.js", "utf8");
  const ast = ts.createSourceFile("parser.js", source, ts.ScriptTarget.Latest, true);
  const names = ["getQuickDuplicateComparableLegacyV616", "findQuickDuplicateLegacyV616", "quickAddFingerprintLegacyV616",
    "getQuickDuplicateComparableLegacyV626", "findQuickDuplicateLegacyV626", "quickAddFingerprintLegacyV626"];
  const context = vm.createContext({
    allItems: [{address: "괴정동 1-1", room: "101", deposit: 2000, rent: 90, area: 25}],
    normalizeQuickDuplicateAddressV616: String, normalizeQuickDuplicateRoomV616: String,
    normalizeQuickDuplicateNumberV616: String
  });
  vm.runInContext(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(ast)).join("\n"), context);
  for (const version of ["616", "626"]) {
    const values = ["", "괴정동 1-1", "101", "", 2000, 90, "", "", 25];
    assert.equal(context["findQuickDuplicateLegacyV" + version](values).type, "exact");
    assert.match(context["quickAddFingerprintLegacyV" + version](values), /괴정동 1-1/);
    values[2] = "102";
    assert.equal(context["findQuickDuplicateLegacyV" + version](values), null);
  }
});

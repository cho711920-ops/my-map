import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const collector = fs.readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
const wrangler = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

assert.match(worker, /async scheduled\(_event, env, context\)/);
assert.match(worker, /runScheduledReviewRepair\(env\)/);
assert.match(worker, /runScheduledElevatorEnrichment\(env\)/);
assert.match(worker, /adjustOperationsDashboard\(env, review\.operationAdjustments/);
assert.match(collector, /export async function runScheduledReviewRepair\(env\)/);
assert.match(collector, /repairExactReviews\(env, systemUser, \{[\s\S]*?source: "공실박스"/);
assert.match(collector, /if \(Number\(gongsilRepair\?\.scanned \|\| 0\) > 0\) return gongsilRepair/);
assert.match(collector, /repairExactReviews\(env, systemUser, \{ includeRemaining: false \}\)/);
assert.match(collector, /if \(Number\(exactRepair\?\.scanned \|\| 0\) > 0\) return exactRepair/);
assert.match(collector, /return mergeSingleCandidateReviews\(env, systemUser/);
assert.match(collector, /const REVIEW_CLASSIFICATION_VERSION = 7/);
assert.match(collector, /const decisionVersion = REVIEW_CLASSIFICATION_VERSION/);
assert.match(collector, /UPDATE collector_raw SET result_json=\?1, error_text='' WHERE id=\?2/);
assert.match(collector, /action: "autoMergeExactAlias"/);
assert.match(collector, /async function attachPendingReviewAliases/);
assert.match(collector, /aliasesMerged: aliases\.merged/);
assert.match(collector, /json_array_length\(json_extract\(cr\.result_json, '\$\.candidateIds'\)\)=1/);
assert.match(collector, /NOT EXISTS \(SELECT 1 FROM listings other/);
assert.match(collector, /preserveRepresentative: true/);
assert.match(wrangler, /crons = \["\* \* \* \* \*"\]/);

console.log("scheduled review repair tests passed");

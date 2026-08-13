import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
const d1 = fs.readFileSync(new URL("../cloudflare/src/d1-api.js", import.meta.url), "utf8");
const listingUi = fs.readFileSync(new URL("../js/unified-listings-v8.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");

assert.match(collector, /"mergeSingleCandidateReviews"/);
assert.match(collector, /async function currentSingleAddressCandidate/);
assert.match(collector, /classified\.decision === "review" && await currentSingleAddressCandidate/);
assert.match(collector, /json_array_length\(json_extract\(cr\.result_json, '\$\.candidateIds'\)\)=1/);
assert.match(collector, /l\.address=json_extract\(cr\.payload_json, '\$\.address'\)/);
assert.match(collector, /other\.status <> 'deleted' AND other\.address=l\.address AND other\.id<>l\.id/);
assert.match(collector, /attachSource\(env, record, listingId,[\s\S]*?true\);/);
assert.match(collector, /autoMergeSingleCandidateAlias/);
assert.match(collector, /processing_state='duplicate'[\s\S]*?canonicalReviewId/);
assert.match(collector, /const protectListing = preserveRepresentative && !updateCondition/);
assert.match(d1, /"preserveRepresentative"/);
assert.match(listingUi, /preserveRepresentative\) return 10/);
assert.match(worker, /collectorAdmin\.affectedListingIds/);
assert.match(worker, /review\?\.affectedListingIds/);

console.log("single candidate review merge: ok");

import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
const collector = fs.readFileSync(new URL("../cloudflare/src/collector-api.js", import.meta.url), "utf8");
const wrangler = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

assert.match(worker, /async scheduled\(_event, env, context\)/);
assert.match(worker, /runScheduledReviewRepair\(env\)/);
assert.match(worker, /adjustOperationsDashboard\(env, result\.operationAdjustments/);
assert.match(collector, /export async function runScheduledReviewRepair\(env\)/);
assert.match(collector, /includeRemaining: false/);
assert.match(collector, /reviewRows\.length >= 20/);
assert.match(wrangler, /crons = \["\* \* \* \* \*"\]/);

console.log("scheduled review repair tests passed");

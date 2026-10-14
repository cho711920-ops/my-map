import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runScheduledReviewRepair } from "../cloudflare/src/collector-api.js";

test("scheduled maintenance does not publish stale pending ads or force ambiguous masters together", async () => {
  const forbidden = new Proxy({}, { get() { throw new Error("cron must not access the database for stale review repair"); } });
  const result = await runScheduledReviewRepair(forbidden);
  assert.equal(result.skipped, true); assert.equal(result.policy, "source-advertisement-v1");
  assert.equal(result.scanned, 0); assert.equal(result.merged, 0); assert.equal(result.created, 0);
  const worker = fs.readFileSync(new URL("../cloudflare/src/worker.js", import.meta.url), "utf8");
  const wrangler = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(worker, /async scheduled\(_event, env, context\)/);
  assert.match(worker, /runScheduledElevatorEnrichment\(env\)/);
  assert.match(wrangler, /crons = \["\* \* \* \* \*"\]/);
});

test("pending-review migration retains historical evidence but requires fresh source observation to publish", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../cloudflare/migrations/", import.meta.url);
    const files = fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
    for (const file of files.filter(name => name < "0026")) db.exec(fs.readFileSync(new URL(file, directory), "utf8"));
    db.prepare("INSERT INTO collector_sessions(id,source) VALUES ('session','네이버')").run();
    for (const state of ["review", "error", "processed"]) {
      db.prepare(`INSERT INTO collector_raw (id,session_id,source,source_listing_id,processing_state,payload_json,result_json)
        VALUES (?,'session','네이버',?,?,'{"proof":"preserved"}','{}')`).run(state, state, state);
    }
    db.exec(fs.readFileSync(new URL("0026_advertisement_presence_policy.sql", directory), "utf8"));
    const row = db.prepare("SELECT processing_state,payload_json,result_json FROM collector_raw WHERE id='review'").get();
    assert.equal(row.processing_state, "awaiting_source_refresh"); assert.equal(JSON.parse(row.payload_json).proof, "preserved");
    assert.equal(JSON.parse(row.result_json).previousProcessingState, "review");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM listings").get().n, 0);
    assert.equal(db.prepare("SELECT processing_state FROM collector_raw WHERE id='error'").get().processing_state, "error");
    assert.equal(db.prepare("SELECT processing_state FROM collector_raw WHERE id='processed'").get().processing_state, "processed");
  } finally { db.close(); }
});

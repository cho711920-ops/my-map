import { appendUnifiedPhotoLists, buildD1SheetCsv, handleD1GetAction } from "./d1-api.js";
import { listingReadEnv, transientListingReadError } from "./listing-read-retry.js";

const PART_BYTES = 5 * 1024 * 1024;
const ENCODE_CHARS = 64 * 1024;
const FOLLOWER_WAIT_MS = 80_000;
const BUILD_JOB_ID = "listing-snapshot-build-v126:database";
const SHEET_BUILD_JOB_ID = "listing-snapshot-build-v133:sheet";
const builds = new WeakMap();

// Complete atomically in R2 before serving. No full CSV string, duplicate hash
// buffer, unbounded tee, or large process-global body survives this build.
// A failed part leaves the previous cache intact and is explicitly aborted.
export function buildSheetSnapshot(env, key, revision, leaseOnly = false, compress = false, saleOnlyV152 = false) {
  const readEnv = {...listingReadEnv(env), SNAPSHOT_READ_PAGE_SIZE_V125:500};
  return singleBuild(env, key, lease => writeSnapshot(env, key, revision,
    emit => buildD1SheetCsv(readEnv, emit, leaseOnly, saleOnlyV152), "text/csv; charset=utf-8",lease,compress), saleOnlyV152?'listing-snapshot-build-v153:sale-sheet':SHEET_BUILD_JOB_ID);
}

export function buildUnifiedSnapshot(env, key, revision, user, query) {
  const readEnv = {...listingReadEnv(env), SNAPSHOT_READ_PAGE_SIZE_V125:query.queryMetadataV152===true?1000:250};
  return singleBuild(env, key, lease => writeSnapshot(env, key, revision, async emit => {
    const payload = await handleD1GetAction(readEnv, user, query, { onReadPage: () => lease?.renew(), deferPhotoLists: true, saleOnlyV152:query.saleOnlyV152===true });
    await emit("{");
    let first = true;
    for (const [name, value] of Object.entries(payload)) {
      await emit((first ? "" : ",") + JSON.stringify(name) + ":"); first = false;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        await emit("{"); let firstEntry = true;
        const ids = Object.keys(value);
        for (let start = 0; start < ids.length; start += 250) {
          const batch = ids.slice(start, start + 250);
          if (name === "groups") { if(query.deferPhotoLists!==true)await appendUnifiedPhotoLists(readEnv, payload, batch); await lease?.renew(); }
          for (const id of batch) {
            await emit((firstEntry ? "" : ",") + JSON.stringify(id) + ":" + JSON.stringify(value[id])); firstEntry = false;
            // Serialized groups no longer need to retain their photos or wide
            // display objects. At most one small photo batch is live at once.
            if (name === "groups") delete value[id];
          }
        }
        await emit("}");
      } else await emit(JSON.stringify(value));
    }
    await emit("}");
  }, "application/json; charset=utf-8",lease,query.gzipSnapshot === true, {collectorRevisionV142:String(query.collectorRevisionV142 || ""),
    ...(query.queryMetadataV152===true?{queryMetadataV152:'1'}:{})}),query.saleOnlyV152===true?'listing-snapshot-build-v153:sale-query':query.queryMetadataV152===true?'listing-snapshot-build-v152:query':BUILD_JOB_ID);
}

function singleBuild(env, key, run, jobId = BUILD_JOB_ID) {
  let map = builds.get(env);
  if (!map) { map = new Map(); builds.set(env, map); }
  const current = map.get(key);
  if (current) return current;
  const task = sharedBuild(env, key, run, Date.now(), jobId).finally(() => { map.delete(key); if (!map.size) builds.delete(env); });
  map.set(key, task);
  return task;
}

// The WeakMap above protects one isolate only. Cold requests on a tablet,
// desktop and the minute cron otherwise each scan the entire database.
// Share one bounded lease through D1, and let followers wait on R2 alone.
async function sharedBuild(env, key, run, started = Date.now(), jobId = BUILD_JOB_ID) {
  if (typeof env.MEDIA?.head !== "function" || !env.DB?.prepare) return run();
  // CSVs share one short critical lane; all original/photo snapshots share
  // one separate lane. A large photo build must not block first-page masters
  // for 80 seconds. This permits at most two paged scans, not one per device.
  const id = jobId;
  const token = crypto.randomUUID(), claimedAt = Date.now();
  const claimStatement = env.DB.prepare(`INSERT INTO jobs
    (id,job_type,owner_email,state,leased_until,progress_json,updated_at)
    VALUES (?1,'listing-snapshot-build','system','running',?2,?3,?4)
    ON CONFLICT(id) DO UPDATE SET state='running',leased_until=excluded.leased_until,
      progress_json=excluded.progress_json,updated_at=excluded.updated_at
    WHERE jobs.state<>'running' OR jobs.leased_until='' OR julianday(jobs.leased_until)<=julianday(?4)`)
    .bind(id,new Date(claimedAt+120_000).toISOString(),JSON.stringify({token,key}),new Date(claimedAt).toISOString());
  const claim = await retryLeaseStatement(claimStatement, async () => {
    // The INSERT may have committed before the connection failed. Recover its
    // own token rather than turning the original owner into its own follower.
    const owner = await env.DB.prepare("SELECT state,leased_until,progress_json FROM jobs WHERE id=?1").bind(id).first();
    return owner?.state === "running" && Date.parse(owner.leased_until || "") > Date.now() &&
      parseLease(owner).token === token ? {meta:{changes:1}} : null;
  });
  if (!Number(claim?.meta?.changes || 0)) {
    const owner = await env.DB.prepare("SELECT progress_json,updated_at FROM jobs WHERE id=?1").bind(id).first();
    let ownerToken = "";
    ownerToken = parseLease(owner).token || "";
    // Follow a live owner without duplicating its full query. Large snapshots
    // can legitimately take longer than the former 40-second follower limit.
    // Re-read only the tiny lease every two seconds, so a failed/abandoned owner
    // does not leave every device sleeping until the entire wait expires.
    let lastOwnerCheck = started;
    do {
      const object = await env.MEDIA.head(key);
      if (ownerToken && object?.customMetadata?.snapshotBuildToken === ownerToken) return;
      if (Date.now()-lastOwnerCheck >= 2_000) {
        const currentOwner = await env.DB.prepare("SELECT state,leased_until,progress_json FROM jobs WHERE id=?1").bind(id).first();
        if (currentOwner?.state === "completed" || currentOwner?.state === "failed" && parseLease(currentOwner).key !== key) {
          if (Date.now()-started >= FOLLOWER_WAIT_MS) throw snapshotPending("listing_snapshot_pending");
          return sharedBuild(env,key,run,started,jobId);
        }
        if (!currentOwner || currentOwner.state === "failed" ||
            currentOwner.state === "running" && Date.parse(currentOwner.leased_until || "") <= Date.now()) {
          throw snapshotPending("listing_snapshot_owner_unavailable");
        }
        ownerToken = parseLease(currentOwner).token || "";
        lastOwnerCheck = Date.now();
      }
      await new Promise(resolve => setTimeout(resolve,500));
    } while (Date.now()-started<FOLLOWER_WAIT_MS);
    throw snapshotPending("listing_snapshot_pending");
  }

  let renewed = started;
  const lease = {
    token,
    async renew(force = false) {
      const now = Date.now();
      if (!force && now-renewed<20_000) return;
      const result = await retryLeaseStatement(env.DB.prepare(`UPDATE jobs SET leased_until=?1,updated_at=?2
        WHERE id=?3 AND state='running' AND json_extract(progress_json,'$.token')=?4
          AND julianday(leased_until)>julianday(?2)`)
        .bind(new Date(now+120_000).toISOString(),new Date(now).toISOString(),id,token));
      if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("목록 생성 소유권이 변경되어 이전 생성을 중단했습니다."),{statusCode:503});
      renewed = now;
    }
  };
  try {
    await run(lease);
    await retryLeaseStatement(env.DB.prepare(`UPDATE jobs SET state='completed',leased_until='',updated_at=?1
      WHERE id=?2 AND json_extract(progress_json,'$.token')=?3`)
      .bind(new Date().toISOString(),id,token));
  } catch (error) {
    await retryLeaseStatement(env.DB.prepare(`UPDATE jobs SET state='failed',leased_until='',updated_at=?1
      WHERE id=?2 AND json_extract(progress_json,'$.token')=?3`)
      .bind(new Date().toISOString(),id,token)).catch(()=>{});
    throw error;
  }
}

function parseLease(row) {
  try {return JSON.parse(row?.progress_json || "{}");} catch {return {};}
}

// Only the token-guarded, idempotent snapshot job statements above use this.
// This is deliberately separate from the SELECT wrapper: no listing, source,
// collector receipt or user mutation is ever replayed.
async function retryLeaseStatement(statement, recover = null) {
  for (let attempt=0;;attempt++) {
    try {return await statement.run();}
    catch (error) {
      if (attempt>=2 || !transientListingReadError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve,attempt ? 3000 : 1000));
      if (recover) {
        try {const committed=await recover();if(committed)return committed;}
        catch (recoveryError) {if(!transientListingReadError(recoveryError))throw recoveryError;}
      }
    }
  }
}

function snapshotPending(code) {
  return Object.assign(new Error("매물 목록을 준비 중입니다. 잠시 후 다시 시도해 주세요."), {statusCode:503,code});
}

async function writeSnapshot(env, key, revision, produce, contentType, lease = null, compress = false, extraMetadata = {}) {
  const upload = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: {contentType, ...(compress ? {contentEncoding:"gzip"} : {})},
    customMetadata: {savedAt: String(Date.now()), revision, ...extraMetadata, ...(compress ? {format:contentType.startsWith("application/json") ? "compact-v2" : "csv"} : {}),...(lease ? {snapshotBuildToken:lease.token} : {})}
  });
  const pending = [];
  let zipWriter, zipReader, zipPump;
  try {
    const encoder = new TextEncoder(), parts = [];
    let partNumber = 0, failure = null;
    const queuePart = async bytes => {
      const number = ++partNumber;
      // Two fixed-size uploads overlap R2 latency without retaining the full
      // snapshot. Keep completion order independent of network response order.
      pending.push(upload.uploadPart(number, bytes).then(
        part => { parts[number - 1] = part; }, error => { failure ||= error; }));
      if (pending.length >= 2) await pending.shift();
      if (failure) throw failure;
    };
    let buffer = new Uint8Array(PART_BYTES), used = 0;
    // Coalesce small CSV rows / JSON tokens before encoding. Keep at most one
    // small character batch beside the two fixed-size multipart upload buffers.
    // No complete CSV/JSON body or second full encoded copy is retained.
    let textBatch = [], textChars = 0;
    const acceptBytes = async bytes => {
      for (let offset = 0; offset < bytes.length;) {
        const count = Math.min(buffer.length - used, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + count), used);
        used += count; offset += count;
        if (used === buffer.length) {
          await queuePart(buffer);
          buffer = new Uint8Array(PART_BYTES); used = 0;
        }
      }
    };
    if (compress) {
      const stream = new CompressionStream("gzip");
      zipWriter = stream.writable.getWriter(); zipReader = stream.readable.getReader();
      zipPump = (async () => {
        for (;;) { const chunk = await zipReader.read(); if (chunk.done) break; await acceptBytes(chunk.value); }
      })();
      // Observe a failed upload while a producer is blocked on compression.
      zipPump.catch(error => { failure ||= error; zipWriter.abort(error).catch(() => {}); });
    }
    const encode = async text => {
      await lease?.renew();
      const bytes = encoder.encode(text);
      if (compress) await zipWriter.write(bytes); else await acceptBytes(bytes);
    };
    await produce(async text => {
      textBatch.push(text); textChars += text.length;
      if (textChars >= ENCODE_CHARS) {
        const joined = textBatch.join(""); textBatch = []; textChars = 0;
        await encode(joined);
      }
    });
    if (textChars) { await encode(textBatch.join("")); textBatch = []; }
    if (compress) { await zipWriter.close(); await zipPump; }
    if (used) await queuePart(buffer.subarray(0, used));
    await Promise.all(pending);
    if (failure) throw failure;
    await lease?.renew(true);
    if (typeof env.MEDIA.get === "function") {
      const current = await env.MEDIA.get("api-cache/revision/listings.json");
      let state = null; try { state = current ? JSON.parse(await current.text()) : null; } catch {}
      // This private metadata stream is never a globally verified catalog.
      // Each own-parent/source proof is checked against the CSV, and every
      // changed/missing proof is repaired by exact ID before a query publishes.
      // Keep its captured revision so a collection can advance without making
      // a 60k-ad metadata build restart forever. Public/full files stay strict.
      if (extraMetadata.queryMetadataV152!=='1' && state && (contentType.startsWith("text/csv") ? state.revision !== revision :
          String(state.collectorRevisionV142 || "") !== String(extraMetadata.collectorRevisionV142 || ""))) {
        throw snapshotPending("listing_snapshot_superseded");
      }
    }
    await upload.complete(parts);
  } catch (error) {
    if (zipWriter) await zipWriter.abort(error).catch(() => {});
    if (zipReader) await zipReader.cancel(error).catch(() => {});
    if (zipPump) await zipPump.catch(() => {});
    await Promise.all(pending);
    await upload.abort().catch(() => {});
    throw error;
  }
}

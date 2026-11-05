import { appendUnifiedPhotoLists, buildD1SheetCsv, handleD1GetAction } from "./d1-api.js";

const PART_BYTES = 5 * 1024 * 1024;
const ENCODE_CHARS = 64 * 1024;
const FOLLOWER_WAIT_MS = 80_000;
const builds = new WeakMap();

// Complete atomically in R2 before serving. No full CSV string, duplicate hash
// buffer, unbounded tee, or large process-global body survives this build.
// A failed part leaves the previous cache intact and is explicitly aborted.
export function buildSheetSnapshot(env, key, revision) {
  return singleBuild(env, key, lease => writeSnapshot(env, key, revision,
    emit => buildD1SheetCsv(env, emit), "text/csv; charset=utf-8",lease));
}

export function buildUnifiedSnapshot(env, key, revision, user, query) {
  return singleBuild(env, key, lease => writeSnapshot(env, key, revision, async emit => {
    const payload = await handleD1GetAction(env, user, query, { onReadPage: () => lease?.renew(), deferPhotoLists: true });
    await emit("{");
    let first = true;
    for (const [name, value] of Object.entries(payload)) {
      await emit((first ? "" : ",") + JSON.stringify(name) + ":"); first = false;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        await emit("{"); let firstEntry = true;
        const ids = Object.keys(value);
        for (let start = 0; start < ids.length; start += 250) {
          const batch = ids.slice(start, start + 250);
          if (name === "groups") { await appendUnifiedPhotoLists(env, payload, batch); await lease?.renew(); }
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
  }, "application/json; charset=utf-8",lease));
}

function singleBuild(env, key, run) {
  let map = builds.get(env);
  if (!map) { map = new Map(); builds.set(env, map); }
  const current = map.get(key);
  if (current) return current;
  const task = sharedBuild(env, key, run).finally(() => { map.delete(key); if (!map.size) builds.delete(env); });
  map.set(key, task);
  return task;
}

// The WeakMap above protects one isolate only. Cold requests on a tablet,
// desktop and the minute cron otherwise each scan the entire database.
// Share one bounded lease through D1, and let followers wait on R2 alone.
async function sharedBuild(env, key, run) {
  if (typeof env.MEDIA?.head !== "function" || !env.DB?.prepare) return run();
  const id = "listing-snapshot-build-v78:" + key;
  const token = crypto.randomUUID(), started = Date.now();
  const claim = await env.DB.prepare(`INSERT INTO jobs
    (id,job_type,owner_email,state,leased_until,progress_json,updated_at)
    VALUES (?1,'listing-snapshot-build','system','running',?2,?3,?4)
    ON CONFLICT(id) DO UPDATE SET state='running',leased_until=excluded.leased_until,
      progress_json=excluded.progress_json,updated_at=excluded.updated_at
    WHERE jobs.state<>'running' OR jobs.leased_until='' OR julianday(jobs.leased_until)<=julianday(?4)`)
    .bind(id,new Date(started+120_000).toISOString(),JSON.stringify({token}),new Date(started).toISOString()).run();
  if (!Number(claim?.meta?.changes || 0)) {
    const owner = await env.DB.prepare("SELECT progress_json,updated_at FROM jobs WHERE id=?1").bind(id).first();
    let ownerToken = "";
    try { ownerToken = JSON.parse(owner?.progress_json || "{}").token || ""; } catch { /* Remain pending. */ }
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
        if (!currentOwner || currentOwner.state === "failed" ||
            currentOwner.state === "running" && Date.parse(currentOwner.leased_until || "") <= Date.now()) {
          throw snapshotPending("listing_snapshot_owner_unavailable");
        }
        try { ownerToken = JSON.parse(currentOwner.progress_json || "{}").token || ""; } catch { ownerToken = ""; }
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
      const result = await env.DB.prepare(`UPDATE jobs SET leased_until=?1,updated_at=?2
        WHERE id=?3 AND state='running' AND json_extract(progress_json,'$.token')=?4
          AND julianday(leased_until)>julianday(?2)`)
        .bind(new Date(now+120_000).toISOString(),new Date(now).toISOString(),id,token).run();
      if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("목록 생성 소유권이 변경되어 이전 생성을 중단했습니다."),{statusCode:503});
      renewed = now;
    }
  };
  try {
    await run(lease);
    await env.DB.prepare(`UPDATE jobs SET state='completed',leased_until='',updated_at=?1
      WHERE id=?2 AND json_extract(progress_json,'$.token')=?3`)
      .bind(new Date().toISOString(),id,token).run();
  } catch (error) {
    await env.DB.prepare(`UPDATE jobs SET state='failed',leased_until='',updated_at=?1
      WHERE id=?2 AND json_extract(progress_json,'$.token')=?3`)
      .bind(new Date().toISOString(),id,token).run().catch(()=>{});
    throw error;
  }
}

function snapshotPending(code) {
  return Object.assign(new Error("매물 목록을 준비 중입니다. 잠시 후 다시 시도해 주세요."), {statusCode:503,code});
}

async function writeSnapshot(env, key, revision, produce, contentType, lease = null) {
  const upload = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: {contentType},
    customMetadata: {savedAt: String(Date.now()), revision,...(lease ? {snapshotBuildToken:lease.token} : {})}
  });
  const pending = [];
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
    const encode = async text => {
      await lease?.renew();
      const bytes = encoder.encode(text);
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
    await produce(async text => {
      textBatch.push(text); textChars += text.length;
      if (textChars >= ENCODE_CHARS) {
        const joined = textBatch.join(""); textBatch = []; textChars = 0;
        await encode(joined);
      }
    });
    if (textChars) { await encode(textBatch.join("")); textBatch = []; }
    if (used) await queuePart(buffer.subarray(0, used));
    await Promise.all(pending);
    if (failure) throw failure;
    await lease?.renew(true);
    await upload.complete(parts);
  } catch (error) {
    await Promise.all(pending);
    await upload.abort().catch(() => {});
    throw error;
  }
}

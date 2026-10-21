import { buildD1SheetCsv, handleD1GetAction } from "./d1-api.js";

const PART_BYTES = 5 * 1024 * 1024;
const builds = new WeakMap();

// Complete atomically in R2 before serving. No full CSV string, duplicate hash
// buffer, unbounded tee, or large process-global body survives this build.
// A failed part leaves the previous cache intact and is explicitly aborted.
export function buildSheetSnapshot(env, key, revision) {
  return singleBuild(env, key, () => writeSnapshot(env, key, revision,
    emit => buildD1SheetCsv(env, emit), "text/csv; charset=utf-8"));
}

export function buildUnifiedSnapshot(env, key, revision, user, query) {
  return singleBuild(env, key, () => writeSnapshot(env, key, revision, async emit => {
    const payload = await handleD1GetAction(env, user, query);
    await emit("{");
    let first = true;
    for (const [name, value] of Object.entries(payload)) {
      await emit((first ? "" : ",") + JSON.stringify(name) + ":"); first = false;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        await emit("{"); let firstEntry = true;
        for (const [id, entry] of Object.entries(value)) {
          await emit((firstEntry ? "" : ",") + JSON.stringify(id) + ":" + JSON.stringify(entry)); firstEntry = false;
        }
        await emit("}");
      } else await emit(JSON.stringify(value));
    }
    await emit("}");
  }, "application/json; charset=utf-8"));
}

function singleBuild(env, key, run) {
  let map = builds.get(env);
  if (!map) { map = new Map(); builds.set(env, map); }
  const current = map.get(key);
  if (current) return current;
  const task = run().finally(() => { map.delete(key); if (!map.size) builds.delete(env); });
  map.set(key, task);
  return task;
}

async function writeSnapshot(env, key, revision, produce, contentType) {
  const upload = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: {contentType},
    customMetadata: {savedAt: String(Date.now()), revision}
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
    await produce(async text => {
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
    });
    if (used) await queuePart(buffer.subarray(0, used));
    await Promise.all(pending);
    if (failure) throw failure;
    await upload.complete(parts);
  } catch (error) {
    await Promise.all(pending);
    await upload.abort().catch(() => {});
    throw error;
  }
}

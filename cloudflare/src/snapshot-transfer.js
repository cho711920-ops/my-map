export const SNAPSHOT_CHUNK_BYTES = 256 * 1024;
export const SNAPSHOT_CHUNK_BYTES_V128 = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

// A manifest describes one complete immutable representation (ETag), not a
// guessed latest revision. Every range is conditional on that same ETag.
export async function snapshotTransfer(env, key, maxAgeMs, request, expectedRevision = null) {
  const mode = request?.headers.get("x-js-snapshot-mode");
  if (!["manifest-v125","chunk-v125","manifest-v128","chunk-v128"].includes(mode)) return undefined;
  const chunkBytes = mode.endsWith("v128") ? SNAPSHOT_CHUNK_BYTES_V128 : SNAPSHOT_CHUNK_BYTES;
  if (typeof env.MEDIA?.head !== "function") return undefined; // Legacy/test binding.
  const headers = {"cache-control":"private, no-store", "vary":"Cookie, X-JS-Listings-Scope, X-JS-Snapshot-Mode",
    "x-js-snapshot-protocol":"ranges-v125"};
  if (mode.startsWith("manifest-")) {
    const object = await env.MEDIA.head(key);
    if (!object || Date.now() - Number(object.customMetadata?.savedAt || 0) > maxAgeMs ||
        expectedRevision !== null && (!expectedRevision || expectedRevision === "0" || object.customMetadata?.revision !== expectedRevision)) return null;
    if (!object.httpEtag || !object.customMetadata?.revision || !Number.isSafeInteger(object.size) ||
        object.size < 1 || object.size > MAX_SNAPSHOT_BYTES) return undefined;
    return {response:Response.json({ok:true, protocol:"ranges-v125", etag:object.httpEtag,
      size:object.size, chunkBytes,
      revision:object.customMetadata.revision,
      encoding:object.httpMetadata?.contentEncoding || "identity",
      contentType:object.httpMetadata?.contentType || "application/json; charset=utf-8"}, {headers})};
  }
  const etag = request.headers.get("x-js-snapshot-etag") || "";
  const offset = Number(request.headers.get("x-js-snapshot-offset"));
  const length = Number(request.headers.get("x-js-snapshot-length"));
  if (!/^"[a-zA-Z0-9_-]+(?:-[0-9]+)?"$/.test(etag) ||
      !Number.isSafeInteger(offset) || offset < 0 || offset >= MAX_SNAPSHOT_BYTES ||
      !Number.isSafeInteger(length) || length < 1 || length > chunkBytes || offset + length > MAX_SNAPSHOT_BYTES) {
    return {response:Response.json({ok:false, code:"snapshot_range_invalid"},{status:400,headers})};
  }
  const object = await env.MEDIA.get(key, {onlyIf:{etagMatches:etag.replace(/^"|"$/g, "")},range:{offset,length}});
  if (!object?.body || object.httpEtag !== etag) {
    await object?.body?.cancel?.();
    return {response:Response.json({ok:false, code:"snapshot_changed"},{status:409,headers})};
  }
  if (object.range?.offset !== offset || object.range?.length !== length) {
    await object.body.cancel();
    return {response:Response.json({ok:false,code:"snapshot_range_mismatch"},{status:409,headers})};
  }
  return {response:new Response(object.body,{headers:{...headers,"content-type":"application/octet-stream",
    "x-js-snapshot-etag":etag,"x-js-snapshot-offset":String(offset),"x-js-snapshot-length":String(length)}})};
}

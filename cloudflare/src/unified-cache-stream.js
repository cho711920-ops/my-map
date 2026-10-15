const COMPACT_PREFIX = '{"ok":true,"version":2,"format":"compact-v2","fields":[';

function gzipAccepted(request) {
  const encodings = new Map(String(request.headers.get("accept-encoding") || "").split(",").map(value => {
    const [name, ...parameters] = value.trim().toLowerCase().split(";");
    const quality = parameters.find(parameter => /^\s*q=/.test(parameter));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return (encodings.has("gzip") ? encodings.get("gzip") : encodings.get("*")) > 0;
}

// Inspect only the compact envelope prefix. Reuse the R2 stream rather than
// retaining a 30 MB string, a second UTF-8 hash buffer and the response at once.
// Legacy envelopes keep the existing conversion path without losing any bytes.
export async function unifiedCacheStream(request, object) {
  if (!object.body?.getReader || !object.httpEtag || !object.customMetadata?.revision) return null;
  const reader = object.body.getReader();
  const prefixChunks = [];
  let size = 0, ended = false;
  try {
    while (size < COMPACT_PREFIX.length) {
      const chunk = await reader.read();
      if (chunk.done) { ended = true; break; }
      prefixChunks.push(chunk.value);
      size += chunk.value.byteLength;
    }
  } catch (error) { reader.releaseLock(); throw error; }
  const prefix = new Uint8Array(Math.min(size, COMPACT_PREFIX.length));
  let copied = 0;
  for (const chunk of prefixChunks) {
    const part = chunk.subarray(0, prefix.length - copied);
    prefix.set(part, copied); copied += part.length;
    if (copied === prefix.length) break;
  }
  const body = new ReadableStream({
    start(controller) { prefixChunks.forEach(chunk => controller.enqueue(chunk)); },
    async pull(controller) {
      if (ended) { reader.releaseLock(); controller.close(); return; }
      try {
        const chunk = await reader.read();
        if (chunk.done) { ended = true; reader.releaseLock(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) { reader.releaseLock(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } }
  });
  if (new TextDecoder().decode(prefix) !== COMPACT_PREFIX) {
    return {body: await new Response(body).text()};
  }
  const etag = "W/" + object.httpEtag;
  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType || "application/json; charset=utf-8",
    "cache-control": "private, max-age=0, must-revalidate",
    vary: "Cookie, Accept-Encoding", etag,
    "x-js-listings-revision": object.customMetadata.revision,
    "x-js-data-cache": "HIT",
    "x-js-data-transport": "r2-stream-v1"
  });
  const candidate = request.headers.get("if-none-match") || "";
  if (candidate.split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === object.httpEtag)) {
    await body.cancel();
    return {response: new Response(null, {status: 304, headers})};
  }
  // Workers' default encodeBody=automatic compresses this uncompressed stream
  // according to Content-Encoding, including after the security-header wrapper.
  // Clients without gzip support receive the same original bytes unchanged.
  if (gzipAccepted(request)) headers.set("content-encoding", "gzip");
  return {response: new Response(body, {headers})};
}

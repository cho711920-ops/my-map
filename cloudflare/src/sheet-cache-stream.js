import { gzipAccepted } from "./unified-cache-stream.js";

// CSV has no legacy envelope to inspect. Return the complete R2 byte stream
// immediately, without allocating another full string and SHA-256 buffer.
export async function sheetCacheStream(request, object) {
  if (!object.body?.getReader || !object.httpEtag || !object.customMetadata?.revision) return null;
  const etag = object.customMetadata.etag || "W/" + object.httpEtag;
  const headers = new Headers({
    "content-type": "text/csv; charset=utf-8",
    "cache-control": "private, max-age=0, must-revalidate",
    vary: "Cookie, Accept-Encoding", etag,
    "x-js-listings-revision": object.customMetadata.revision,
    "x-js-data-source": "D1", "x-js-data-cache": "HIT",
    "x-js-data-transport": "r2-sheet-stream-v57"
  });
  const candidate = request.headers.get("if-none-match") || "";
  if (candidate.split(",").some(value => value.trim() === "*" ||
      value.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""))) {
    await object.body.cancel();
    return {response: new Response(null, {status: 304, headers})};
  }
  // Workers compress this original byte stream once (encodeBody=automatic).
  if (gzipAccepted(request)) headers.set("content-encoding", "gzip");
  return {response: new Response(object.body, {headers})};
}

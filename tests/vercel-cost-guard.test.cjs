const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const queue = fs.readFileSync(path.join(root, "js", "async-mutation-queue-v1.js"), "utf8");
const proxy = fs.readFileSync(path.join(root, "api", "apps-script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

ok(queue.includes("statusPollingSuspended"), "stale client polling must be suspendable");
ok(queue.includes("remaining.length") && queue.includes("result.processing") && queue.includes("result.pending"), "polling may stop only after the owner queue is idle");
ok(!queue.includes("Number(lastServerStatus.processing || 0) ||"), "another job must not keep every browser polling");
ok(proxy.includes("STATUS_CACHE_TTL_MS = 15000"), "work queue status requests need a short upstream cache");
ok(proxy.includes("statusInFlight"), "concurrent status requests must share one upstream request");
ok(proxy.includes("UPSTREAM_TIMEOUT_MS = 20000"), "an Apps Script wait must not hold Vercel memory indefinitely");
ok(proxy.includes("sendLegacyQueueGuard"), "old browser tabs must not reach Apps Script status polling");
ok(proxy.includes("sendLegacyBuildingGuard"), "old bulk building prefetch must be stopped server-side");
ok(proxy.includes("response = await fetchWithTimeout(upstreamUrl(query)"), "all read-only Apps Script calls need a bounded timeout");
ok(queue.includes("client="), "the current queue client must identify itself to the server guard");
ok(html.includes("1.0.8-legacy-server-guard"), "the browser cache key must be updated");

console.log("vercel cost guard tests passed");

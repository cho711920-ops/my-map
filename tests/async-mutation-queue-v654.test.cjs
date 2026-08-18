const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const queue = read("js", "async-mutation-queue-v1.js");
const script = [read("js", "script.js"), read("js", "property-edit-v648.js")].join("\n");
const operations = read("js", "operations-center-v7.js");
const reviews = read("js", "operations-collection-v8.js");
const dataAccess = read("js", "data-access-v6.js");
const d1 = read("cloudflare", "src", "d1-api.js");
const html = read("index.html");
const css = [read("css", "style.css"), read("css", "app-final-overrides-v690.css")].join("\n");

assert.match(queue, /js_async_mutation_outbox_v1/);
assert.match(queue, /js_async_mutation_active_v1/);
assert.match(queue, /keepalive:\s*true/);
assert.match(queue, /js-async-mutation-finished/);
assert.match(queue, /function hasQueuedWork\(\)/);
assert.match(queue, /function scheduleStatusPolling\(delay\)/);
assert.match(queue, /document\.visibilityState === "hidden"/);
assert.doesNotMatch(queue, /setInterval\(refreshStatus, 5000\)/);
assert.match(html, /id="asyncMutationStatusV1"/);
assert.match(html, /src="js\/async-mutation-queue-v1\.js\?v=1\.0\.9-data-access"/);
assert.match(queue, /JSDataAccessV6\.mutate\(action, payload,/);
assert.match(queue, /JSDataAccessV6\.read\(action, params,/);
assert.match(css, /\.v6-toolbar-secondary\.v6-command-bar > \.async-mutation-status-v1/);

assert.match(script, /postSafeMutationV654\("updatePropertyMemo"/);
assert.match(script, /postSafeMutationV654\("toggleDone"/);
assert.match(script, /postSafeMutationV654\("updateProperty"/);
assert.match(script, /result\.retryable === true/);
assert.doesNotMatch(operations, /return window\.JSAsyncMutations\.enqueue\(/);
assert.doesNotMatch(reviews, /return window\.JSAsyncMutations\.enqueue\(/);

assert.match(dataAccess, /var DATA_API = "\/api\/data"/);
assert.match(dataAccess, /credentials:\s*"same-origin"/);
assert.match(d1, /"deleteProperty", "enqueueMutation", "moveOriginalListing", "quickAdd"/);
assert.match(d1, /"saveGeocodeCache", "toggleDone", "updateProperty", "updatePropertyMemo"/);
assert.match(d1, /async function updateMemo\(env, user, body\)/);
assert.match(d1, /async function toggleDone\(env, user, body\)/);
assert.match(d1, /async function updateProperty\(env, user, body\)/);
assert.match(d1, /async function deleteProperty\(env, user, body\)/);
assert.match(d1, /source:\s*"D1"/);
assert.match(d1, /persisted:\s*true, queued:\s*false/);

console.log("async mutation and direct D1 persistence tests passed");

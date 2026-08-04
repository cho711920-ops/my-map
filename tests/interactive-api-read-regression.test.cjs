const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const proxy = fs.readFileSync(path.join(root, "api", "apps-script.js"), "utf8");

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

[
  "unifiedListings",
  "unifiedListingDetail",
  "unifiedListingContacts",
  "tellContacts",
  "mutationStatus",
  "loadCloudState",
  "announcement"
].forEach((action) => {
  ok(!proxy.includes(`String(query.action || \"\") === \"${action}\"`),
    `${action} must remain an unrestricted interactive read`);
});

ok(proxy.includes("response = (") && proxy.includes(": await fetch(upstreamUrl(query), requestOptions);"),
  "ordinary interactive reads must use the original upstream path");
ok(proxy.includes("String(query.mode || \"\") === \"summary\""),
  "only automatic building summaries should use the short cost timeout");
ok(proxy.includes("response = await fetch(upstreamUrl({}),"),
  "POST saves must keep the verified persistence path");

console.log("interactive API read regression tests passed");

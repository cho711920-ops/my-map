// Read-only remote preview. No R2 binding, D1 run(), batch(), or apply option.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCollectorRetention } from "../cloudflare/src/collector-retention.js";

export function bindPreviewSql(sql, values) {
  if (!/^\s*SELECT\b/i.test(sql) || sql.includes(";")) {
    throw new Error("Retention preview accepts one SELECT only");
  }
  return sql.replace(/\?(\d+)/g, (_, index) => {
    const value = values[Number(index) - 1];
    if (value == null) return "NULL";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return `'${String(value).replaceAll("'", "''")}'`;
  });
}

function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const args = process.argv.slice(2);
  if (args.some(arg => !/^--(?:now|cursor|batch-limit)=/.test(arg))) {
    throw new Error("Supported: --now=<ISO time>, --cursor=<JSON>, --batch-limit=<1..100>. Preview is always read-only.");
  }
  const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const query = (sql, values = []) => {
    const result = spawnSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "d1", "execute", "js-map-primary", "--remote", "--command", bindPreviewSql(sql, values), "--json"],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Wrangler exited ${result.status}`);
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.some(item => item.success === false)) throw new Error("Remote retention preview query failed");
    return parsed.flatMap(item => item.results || []);
  };
  const prepare = (sql, values = []) => ({
    bind(...bindings) { return prepare(sql, bindings); },
    async all() { return { results: query(sql, values) }; },
    async first() { return query(sql, values)[0] || null; }
  });
  return runCollectorRetention({ DB: { prepare }, COLLECTOR_RETENTION_BATCH_LIMIT: option("batch-limit") }, {
    now: option("now"), cursor: JSON.parse(option("cursor") || "{}"), dryRun: true
  }).then(report => console.log(JSON.stringify(report, null, 2)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

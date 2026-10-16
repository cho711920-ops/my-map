// User-authorized Naver/Daangn recovery. Default is a read-only preview.
// Reuse ingestion against an isolated SQLite snapshot, then apply guarded row
// changes. Existing masters, sources, favorites, memos and contacts are untouched.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {resolve,isAbsolute,relative} from "node:path";
import {normalizedRecord,hasPublishableCollectorAddress,isMonthlyCollectorRecord} from "../cloudflare/src/collector-api.js";
import {collectorProviderSourceId} from "../cloudflare/src/collector-offer-identity.js";

const root=resolve(import.meta.dirname,"..");
const privateRoot=process.argv.find(arg=>arg.startsWith("--backup="))?.slice(9);
assert.ok(privateRoot && isAbsolute(privateRoot) && relative(root,resolve(privateRoot)).startsWith(".."),"Private absolute --backup outside repository required");
const apply=process.argv.includes("--apply");
const directory=resolve(privateRoot,"addressed-ads-"+new Date().toISOString().replace(/[:.]/g,"-"));
mkdirSync(directory,{recursive:true});
const quote=value=>value==null?"NULL":typeof value==="number"?String(value):"'"+String(value).replaceAll("'","''")+"'";
function run(args) {
  const result=spawnSync(process.execPath,["--max-old-space-size=192",resolve(root,"node_modules/wrangler/bin/wrangler.js"),...args],
    {cwd:root,encoding:"utf8",maxBuffer:32*1024*1024,windowsHide:true});
  if(result.status!==0) {
    writeFileSync(resolve(directory,"wrangler-failure.log"),result.stderr+"\n"+result.stdout);
    throw Error("Wrangler operation failed; inspect wrangler-failure.log in the private backup");
  }
  return result.stdout;
}
function query(sql) {
  const response=JSON.parse(run(["d1","execute","js-map-primary","--remote","--json","--command",sql]));
  assert.ok(response.every(row=>row.success && row.meta.rows_written===0),"Preview queries must be read-only");
  return response[0].results;
}
async function writeBatch(sql) {
  // --file uses the blocking bulk-import endpoint. Use the ordinary D1 query
  // endpoint so the guarded batch does not take the live database offline.
  const token=process.env.CLOUDFLARE_API_TOKEN || readFileSync(resolve(process.env.APPDATA,
    "xdg.config/.wrangler/config/default.toml"),"utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(token,"Existing Cloudflare authorization required");
  const base="https://api.cloudflare.com/client/v4";
  const request=async(path,body)=>{
    const response=await fetch(base+path,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${token}`,
      "Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    const result=await response.json();
    if(!response.ok || !result.success) {
      writeFileSync(resolve(directory,"query-api-failure.json"),JSON.stringify(result));
      throw Error("Cloudflare query request failed: "+(result.errors || []).map(error=>error.code).join(","));
    }
    return result.result;
  };
  const accounts=process.env.CLOUDFLARE_ACCOUNT_ID?[{id:process.env.CLOUDFLARE_ACCOUNT_ID}]:await request("/accounts");
  let accountId="";
  for(const account of accounts) {
    const databases=await request(`/accounts/${account.id}/d1/database?name=js-map-primary`);
    if(databases.some(database=>database.uuid==="e5b41e5f-8929-4c10-948e-178a17ee5f18")) {accountId=account.id;break;}
  }
  assert.ok(accountId,"Exact production database not found");
  const result=await request(`/accounts/${accountId}/d1/database/e5b41e5f-8929-4c10-948e-178a17ee5f18/query`,{sql});
  assert.ok(result.every(row=>row.success),"D1 batch failed");
  return JSON.stringify(result);
}
const cutoff=new Date(Date.now()-48*60*60*1000).toISOString();
const candidateSql=`WITH ranked AS (SELECT *,ROW_NUMBER() OVER (
  PARTITION BY source,source_listing_id,trade_type ORDER BY created_at DESC,id DESC) rn
  FROM collector_raw WHERE source IN ('네이버','당근'))
  SELECT c.* FROM ranked c WHERE rn=1 AND processing_state IN ('error','review','awaiting_source_refresh')
  AND c.created_at>=${quote(cutoff)} AND json_valid(c.payload_json)
  AND EXISTS(SELECT 1 FROM collector_source_presence p WHERE p.source=c.source AND p.source_listing_id=c.source_listing_id
    AND p.trade_type=c.trade_type AND p.missing_count=0 AND p.last_seen_at>=${quote(cutoff)})
  AND NOT EXISTS(SELECT 1 FROM listing_sources s WHERE s.source=c.source AND s.source_listing_id=c.source_listing_id)
  ORDER BY c.source,c.source_listing_id`;
const rows=[];
const from=process.argv.find(arg=>arg.startsWith("--from="))?.slice(7);
if(from) {
  assert.ok(isAbsolute(from) && relative(root,resolve(from)).startsWith(".."),"Private preview file required");
  rows.push(...JSON.parse(readFileSync(from,"utf8")).map(item=>item.raw));
} else {
  for(let offset=0;;offset+=100) {
    const page=query(`${candidateSql} LIMIT 100 OFFSET ${offset}`);
    rows.push(...page);
    if(page.length<100) break;
  }
}
let selected=[];
for(const row of rows) {
  assert.ok(["네이버","당근"].includes(row.source) && ["lease","sale"].includes(row.trade_type));
  assert.ok(row.created_at>=cutoff,"Old review needs a fresh source collection");
  const payload=JSON.parse(row.payload_json), saved=payload.record || payload;
  const input=row.source==="네이버" ? {...(saved.raw || saved),listSnapshot:saved.listSnapshot} : saved;
  const record=normalizedRecord(row.source,input);
  if(!record || !isMonthlyCollectorRecord(row.source,record) || record.tradeType!==row.trade_type ||
    !hasPublishableCollectorAddress(row.source,record.address) || record.tradeType==="sale" && !(record.salePrice>0)) continue;
  const provider=collectorProviderSourceId(row.source_listing_id).replace(/^네이버-/,"");
  assert.equal(collectorProviderSourceId(record.sourceId).replace(/^네이버-/,""),provider,"Original advertisement identity must match");
  const {rn,...raw}=row;
  selected.push({raw,input,record});
}
for(const source of ["네이버","당근"]) {
  const items=selected.filter(item=>item.raw.source===source);
  for(let offset=0;offset<items.length;offset+=80) {
    const chunk=items.slice(offset,offset+80),allIds=new Set();
    for(const {raw} of chunk) {const base=raw.source_listing_id.replace(/::(?:lease|sale)$/,"");allIds.add(base);allIds.add(base+"::"+raw.trade_type);}
    const existing=query(`SELECT source_listing_id,trade_type FROM listing_sources WHERE source=${quote(source)}
      AND source_listing_id IN (${[...allIds].map(quote).join(",")})`);
    const presence=query(`SELECT * FROM collector_source_presence WHERE source=${quote(source)}
      AND source_listing_id IN (${chunk.map(item=>quote(item.raw.source_listing_id)).join(",")}) AND missing_count=0
      AND last_seen_at>=${quote(cutoff)} ORDER BY last_seen_at DESC`);
    for(const item of chunk) {
      const base=item.raw.source_listing_id.replace(/::(?:lease|sale)$/,"");
      if(existing.some(row=>row.trade_type===item.raw.trade_type && [base,base+"::"+row.trade_type].includes(row.source_listing_id))) continue;
      item.presence=presence.find(row=>row.source_listing_id===item.raw.source_listing_id && row.trade_type===item.raw.trade_type);
    }
  }
}
selected=selected.filter(item=>item.presence);
writeFileSync(resolve(directory,"before.json"),JSON.stringify(selected));
console.log(JSON.stringify({apply,examined:rows.length,eligible:selected.length,
  bySource:Object.fromEntries(["네이버","당근"].map(source=>[source,selected.filter(item=>item.raw.source===source).length])),backup:directory}));
if(!selected.length) process.exit(0);

const url=new URL("../cloudflare/src/collector-api.js",import.meta.url);
const code=readFileSync(url,"utf8").replace(/\bfrom\s+(["'])(\.\/[^"']+)\1/g,
  (_,delimiter,path)=>`from ${delimiter}${new URL(path,url).href}${delimiter}`)+"\nexport { ingestRecords };";
const {ingestRecords}=await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const db=new DatabaseSync(":memory:");
const historyMax=Number(query("SELECT COALESCE(MAX(id),0) n FROM listing_history")[0].n);
const migrations=resolve(root,"cloudflare/migrations");
for(const file of readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort()) db.exec(readFileSync(resolve(migrations,file),"utf8"));
db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='listing_history'").run(historyMax);
db.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'listing_history',? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='listing_history')").run(historyMax);
function insert(table,row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(quote).join(",")});`;
}
for(const {raw} of selected) {
  db.prepare("INSERT OR IGNORE INTO collector_sessions(id,source,state) VALUES(?,?,'completed')").run(raw.session_id,raw.source);
  db.exec(insert("collector_raw",raw));
}
const tables=["listings","listing_sources","listing_media","listing_contacts","listing_history","collector_sessions","collector_raw","customer_matches","cloud_state"];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row}))]));
const before=snapshot();
const prepare=(sql,values=[])=>{
  const indexes=[];
  const compiled=sql.replace(/\?(\d+)/g,(_,index)=>{indexes.push(Number(index)-1);return "?";});
  const args=()=>indexes.length?indexes.map(index=>values[index]):values;
  return {bind:(...params)=>prepare(sql,params),async first(){return db.prepare(compiled).get(...args()) || null;},
    async all(){return {results:db.prepare(compiled).all(...args())};},
    async run(){return {meta:{changes:Number(db.prepare(compiled).run(...args()).changes)}};}};
};
const env={DB:{prepare,async batch(statements){const result=[];for(const statement of statements) result.push(await statement.run());return result;}}};
for(const source of ["네이버","당근"]) {
  const inputs=selected.filter(item=>item.raw.source===source).map(item=>item.input);
  if(!inputs.length) continue;
  const result=await ingestRecords(env,source,inputs,{sessionId:"address-publication-"+source+"-"+crypto.randomUUID(),scope:"주소 확인된 보류 광고 복원 · 전체수집 아님"});
  assert.equal(result.failed,0,JSON.stringify(result));
  assert.equal(result.created+result.merged,inputs.length);
}
db.exec("UPDATE collector_sessions SET state='completed',finished_at=updated_at WHERE id LIKE 'address-publication-%'");
const after=snapshot();
assert.ok(after.listing_history.every(row=>Number(row.id)>historyMax),"Recovery history must follow the captured remote sequence");
assert.equal(after.listing_sources.length,selected.length);
assert.equal(after.listing_contacts.length,0);
assert.equal(after.cloud_state.length,0);
const ids=new Set(selected.map(item=>item.raw.source_listing_id));
assert.ok(after.listing_sources.every(row=>ids.has(row.source_listing_id)),"Storage ID changed unexpectedly");
for(const {raw,record} of selected) {
  const source=after.listing_sources.find(row=>row.source===raw.source && row.source_listing_id===raw.source_listing_id);
  const listing=after.listings.find(row=>row.id===source.listing_id);
  assert.equal(listing.address,record.address);
  assert.equal(listing.room,record.room);
  assert.equal(after.listing_media.filter(row=>row.source_id===source.id && row.status==="external").length,record.images.length);
}
const exact=row=>Object.entries(row).map(([key,value])=>`${key} IS ${quote(value)}`).join(" AND ");
const guard="_address_publication_guard";
const statements=[`CREATE TABLE ${guard}(ok INTEGER CHECK(ok=1));`];
function requireOne(condition){statements.push(`INSERT INTO ${guard} SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END;`);}
requireOne(`NOT EXISTS(SELECT 1 FROM collector_sessions WHERE source IN ('네이버','당근') AND state IN ('running','finalizing') AND started_at>=${quote(cutoff)})`);
requireOne(`(SELECT COALESCE(MAX(id),0) FROM listing_history)=${historyMax}`);
for(const {raw,presence} of selected) {
  requireOne(`EXISTS(SELECT 1 FROM collector_raw WHERE ${exact(raw)})`);
  requireOne(`EXISTS(SELECT 1 FROM collector_source_presence WHERE ${exact(presence)})`);
  const base=raw.source_listing_id.replace(/::(?:lease|sale)$/,"");
  requireOne(`NOT EXISTS(SELECT 1 FROM listing_sources WHERE source=${quote(raw.source)}
    AND source_listing_id IN (${quote(base)},${quote(base+"::"+raw.trade_type)}) AND trade_type=${quote(raw.trade_type)})`);
  requireOne(`NOT EXISTS(SELECT 1 FROM collector_raw WHERE source=${quote(raw.source)} AND source_listing_id=${quote(raw.source_listing_id)}
    AND trade_type=${quote(raw.trade_type)} AND (created_at>${quote(raw.created_at)} OR (created_at=${quote(raw.created_at)} AND id>${quote(raw.id)})))`);
}
const changes=[];
// Parents precede children; old collector sessions are never changed.
for(const table of ["collector_sessions","listings","listing_sources","listing_media","listing_contacts","listing_history","collector_raw"]) {
  const previous=new Map(before[table].map(row=>[row.id,row]));
  for(const row of after[table]) {
    const old=previous.get(row.id);
    if(!old) {statements.push(insert(table,row));changes.push({table,action:"insert",row});continue;}
    const fields=Object.keys(row).filter(key=>row[key]!==old[key]);
    if(!fields.length) continue;
    assert.equal(table,"collector_raw","Only the selected raw error/review rows may change");
    requireOne(`EXISTS(SELECT 1 FROM ${table} WHERE ${exact(old)})`);
    statements.push(`UPDATE ${table} SET ${fields.map(key=>`${key}=${quote(row[key])}`).join(",")} WHERE id=${quote(row.id)};`);
    changes.push({table,action:"update",before:old,row});
  }
}
statements.push(`DROP TABLE ${guard};`);
writeFileSync(resolve(directory,"planned.json"),JSON.stringify(changes));
writeFileSync(resolve(directory,"repair.sql"),statements.join("\n"));
// Validate the generated SQL against the original isolated snapshot.
db.close();
const verify=new DatabaseSync(":memory:");
for(const file of readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort()) verify.exec(readFileSync(resolve(migrations,file),"utf8"));
for(const row of before.collector_sessions) verify.exec(insert("collector_sessions",row));
for(const row of before.collector_raw) verify.exec(insert("collector_raw",row));
for(const {presence} of selected) verify.exec(insert("collector_source_presence",presence));
// The isolated database contains no unrelated history rows. Its sequence is
// the captured remote maximum; mirror that maximum for the guard dry run.
verify.prepare("INSERT INTO listings(id,address) VALUES('preview-history-parent','preview only')").run();
verify.prepare("INSERT INTO listing_history(id,listing_id,action) VALUES(?,'preview-history-parent','preview-only')").run(historyMax);
verify.exec(statements.join("\n"));
verify.exec("DELETE FROM listing_history WHERE action='preview-only'; DELETE FROM listings WHERE id='preview-history-parent';");
for(const table of tables) assert.deepEqual(verify.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row})),after[table],table);
assert.throws(()=>verify.exec(statements.join("\n")),/CHECK constraint/);
verify.close();
console.log(JSON.stringify({localPlanAndConflictGuard:"passed",newAds:after.listing_sources.length,newMasters:after.listings.length,photos:after.listing_media.length}));
if(apply) {
  const result=await writeBatch(statements.join("\n"));
  writeFileSync(resolve(directory,"apply-result.json"),result);
  const verified=[];
  for(const table of new Set(changes.map(change=>change.table))) {
    const entries=changes.filter(change=>change.table===table);
    for(let offset=0;offset<entries.length;offset+=80) {
      const chunk=entries.slice(offset,offset+80);
      const actual=new Map(query(`SELECT * FROM ${table} WHERE id IN (${chunk.map(change=>quote(change.row.id)).join(",")})`).map(row=>[row.id,row]));
      for(const change of chunk) {
        assert.deepEqual(actual.get(change.row.id),change.row,table+" verification failed");
        verified.push({table,id:change.row.id});
      }
    }
  }
  writeFileSync(resolve(directory,"after.json"),JSON.stringify(after));
  writeFileSync(resolve(directory,"verified.json"),JSON.stringify(verified));
  console.log(JSON.stringify({applied:true,verifiedChanges:verified.length,newAds:after.listing_sources.length,photos:after.listing_media.length}));
}

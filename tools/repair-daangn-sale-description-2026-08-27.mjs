// One authorized source only. Default: read-only inspection, backup, SQL/rollback
// dry-run. --apply writes only the guarded source/listing and an audit entry.
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, isAbsolute, relative } from 'node:path';
import assert from 'node:assert/strict';
import { normalizedRecord } from '../cloudflare/src/collector-api.js';

const root=resolve(import.meta.dirname,'..');
const target={id:'M-04be49f5-54dd-4134-af29-fa791e987d98',sourceId:'O-ba39f279-bdd9-41f1-9be9-04463773a267',externalId:'4084712'};
const backupRoot=process.argv.find(a=>a.startsWith('--backup='))?.slice(9);
if(!backupRoot || !isAbsolute(backupRoot) || !relative(root,resolve(backupRoot)).startsWith('..')) throw Error('Use a private absolute --backup directory outside the repository');
const apply=process.argv.includes('--apply');
const dir=resolve(backupRoot,'daangn-sale-description-'+new Date().toISOString().replace(/[:.]/g,'-'));
const quote=v=>v==null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
function run(args){const r=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;}
function query(sql){return JSON.parse(run(['d1','execute','js-map-primary','--remote','--json','--command',sql]))[0].results;}
function state(){return Object.fromEntries([
  ['listings',`SELECT * FROM listings WHERE id=${quote(target.id)}`],
  ['listing_sources',`SELECT * FROM listing_sources WHERE listing_id=${quote(target.id)} ORDER BY id`],
  ['listing_history',`SELECT * FROM listing_history WHERE listing_id=${quote(target.id)} ORDER BY id`],
  ['listing_contacts',`SELECT * FROM listing_contacts WHERE listing_id=${quote(target.id)} ORDER BY id`],
  ['listing_media',`SELECT * FROM listing_media WHERE listing_id=${quote(target.id)} ORDER BY id`],
  ['customer_matches',`SELECT * FROM customer_matches WHERE listing_id=${quote(target.id)} ORDER BY customer_id,listing_id`],
  ['cloud_state',`SELECT * FROM cloud_state WHERE value_json LIKE '%${target.id}%' ORDER BY owner_email,scope,record_key`]
].map(([key,sql])=>[key,query(sql)]));}
const before=state();
assert.equal(before.listings.length,1);assert.equal(before.listing_sources.length,1);
const listing=before.listings[0], source=before.listing_sources[0];
assert.equal(source.id,target.sourceId);assert.equal(source.source_listing_id,target.externalId);assert.equal(source.source,'당근');
assert.equal(listing.trade_type,'sale');assert.equal(source.trade_type,'sale');
assert.equal(listing.version,1);assert.equal(listing.sale_price,85000);assert.equal(listing.status,'active');
assert.ok(before.listing_history.every(h=>['collectorCreated','sourceMerged'].includes(h.action)),'User modifications or previous repair require a new review');
const raw=JSON.parse(source.raw_json), old=JSON.parse(source.list_snapshot_json);
const record=normalizedRecord('당근',raw);
assert.equal(record.salePrice,85000);assert.equal(record.saleCategory,'multifamily');assert.equal(record.area,90.7);assert.equal(record.room,'전체');
assert.equal(record.saleDetails.totalDeposit,17880);assert.equal(record.saleDetails.loanAmount,30000);
assert.equal(record.saleDetails.monthlyNetIncome,202);assert.equal(record.saleDetails.advertisedYield,6.53);
assert.ok(record.saleDetails.monthlyIncome==null);
const stamp=new Date().toISOString();
const nextListing={...listing,listing_type:record.category,sale_category:record.saleCategory,room:record.room,area_m2:record.area,version:listing.version+1,updated_at:stamp};
const nextSource={...source,sale_category:record.saleCategory,list_snapshot_json:JSON.stringify({...old,type:record.category,saleCategory:record.saleCategory,room:record.room,area:record.area,saleDetails:record.saleDetails}),updated_at:stamp};
function exact(row){return Object.entries(row).map(([k,v])=>`${k} IS ${quote(v)}`).join(' AND ');}
function sql(reverse=false){
  const statements=['CREATE TABLE _daangn_description_guard(n INTEGER CHECK(n=1));'];
  for(const [table,from,to] of [['listings',reverse?nextListing:listing,reverse?listing:nextListing],['listing_sources',reverse?nextSource:source,reverse?source:nextSource]]){
    statements.push(`INSERT INTO _daangn_description_guard SELECT count(*) FROM ${table} WHERE ${exact(from)};`);
  }
  statements.push(`INSERT INTO _daangn_description_guard SELECT count(*) FROM listing_sources WHERE listing_id=${quote(target.id)};`);
  for(const [table,from,to] of [['listings',reverse?nextListing:listing,reverse?listing:nextListing],['listing_sources',reverse?nextSource:source,reverse?source:nextSource]]){
    const changed=Object.entries(to).filter(([k,v])=>v!==from[k]).map(([k,v])=>`${k}=${quote(v)}`).join(',');
    statements.push(`UPDATE ${table} SET ${changed} WHERE id=${quote(from.id)};`);
  }
  const summary=r=>JSON.stringify({category:r.listing_type,room:r.room,area:r.area_m2,salePrice:r.sale_price});
  statements.push(`INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json) VALUES(${quote(target.id)},${quote(target.sourceId)},${quote(reverse?'saleDescriptionRepairRollback':'saleDescriptionRepair')},'codex-sale-repair',${quote(summary(reverse?nextListing:listing))},${quote(summary(reverse?listing:nextListing))});`);
  statements.push('DROP TABLE _daangn_description_guard;');return statements.join('\n');
}
const forward=sql(),rollback=sql(true),local=new DatabaseSync(':memory:');
for(const table of ['listings','listing_sources']){const row=before[table][0];local.exec(`CREATE TABLE ${table}(${Object.keys(row).map(k=>k+(k==='version'?' INTEGER':'')).join(',')});INSERT INTO ${table} VALUES(${Object.values(row).map(quote).join(',')});`);}
local.exec('CREATE TABLE listing_history(listing_id,source_id,action,actor_email,before_json,after_json);');
local.exec(forward);
assert.deepEqual({...local.prepare('SELECT * FROM listings').get()},nextListing);
assert.deepEqual({...local.prepare('SELECT * FROM listing_sources').get()},nextSource);
local.exec(rollback);
assert.deepEqual({...local.prepare('SELECT * FROM listings').get()},listing);
assert.deepEqual({...local.prepare('SELECT * FROM listing_sources').get()},source);
local.exec('UPDATE listings SET version=version+1');assert.throws(()=>local.exec(forward),/CHECK constraint/);local.close();
mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'before.json'),JSON.stringify(before,null,2));writeFileSync(resolve(dir,'repair.sql'),forward);writeFileSync(resolve(dir,'rollback.sql'),rollback);
console.log(JSON.stringify({apply,backup:dir,localForwardRollbackConflictGuard:'passed',externalId:target.externalId,area:record.area,category:record.category,deposit:record.saleDetails.totalDeposit,monthlyNet:record.saleDetails.monthlyNetIncome,advertisedYield:record.saleDetails.advertisedYield}));
if(apply){
  run(['d1','execute','js-map-primary','--remote','--file',resolve(dir,'repair.sql'),'--yes']);
  const after=state();writeFileSync(resolve(dir,'after.json'),JSON.stringify(after,null,2));
  assert.deepEqual(after.listings[0],nextListing);assert.deepEqual(after.listing_sources[0],nextSource);
  for(const table of ['listing_contacts','listing_media','customer_matches','cloud_state'])assert.deepEqual(after[table],before[table],table+' preserved');
  assert.equal(after.listing_history.length,before.listing_history.length+1);
  assert.deepEqual(after.listing_history.filter(h=>h.action!=='saleDescriptionRepair'),before.listing_history);
  console.log('Verified exact one-source repair. Photos, contacts, memo, user status, favorites and customer state preserved.');
}

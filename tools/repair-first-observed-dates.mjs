// Default: read-only preview with a private evidence/rollback bundle.
// Apply only the exact saved plan: --apply-plan=<directory> --confirm=<digest>.
// After verification, invalidate generated CSV/unified caches and the listings
// revision object. This CLI deliberately does not silently delete R2 objects.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advertisementObservationKey, firstObservedAdvertisement } from '../cloudflare/src/collector-first-observed.js';

const quote = value => "'" + String(value ?? '').replaceAll("'", "''") + "'";
const digest = value => createHash('sha256').update(value).digest('hex');
const iso = value => /^\d{4}-\d{2}-\d{2}T/.test(String(value || '')) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : '';
const fields = ['id','property_id','first_collected_at','registration_at','created_at','updated_at','version'];
const sourceFields = ['id','listing_id','source','source_listing_id','trade_type','first_collected_at','created_at','session_id'];

export function buildFirstObservedRepairPlan(dataset, {now = new Date().toISOString()} = {}) {
  assert.ok(iso(now), 'valid repair time required');
  const rawByKey = new Map(), sourceByParent = new Map(), sourceChanges = [];
  for (const row of dataset.raw || []) {
    const key = advertisementObservationKey(row.source,row.source_listing_id,row.trade_type);
    if (!rawByKey.has(key)) rawByKey.set(key,[]);
    rawByKey.get(key).push(row);
  }
  for (const source of dataset.sources || []) {
    const key = advertisementObservationKey(source.source,source.source_listing_id,source.trade_type);
    const observed = firstObservedAdvertisement({source:source.source,sourceId:source.source_listing_id,
      tradeType:source.trade_type,sourceRows:[source],rawRows:rawByKey.get(key)||[],now});
    const before = iso(source.first_collected_at), after = iso(observed.firstObservedAt);
    const eligible = dataset.candidateSourceIds.includes(source.id);
    const next = eligible && before && after && after < before ? after : before;
    if (!sourceByParent.has(source.listing_id)) sourceByParent.set(source.listing_id,[]);
    if (next) sourceByParent.get(source.listing_id).push(next);
    if (eligible && before && after && after < before) sourceChanges.push({id:source.id,listingId:source.listing_id,
      before:source.first_collected_at,after,tradeType:source.trade_type,rawEvidenceIds:observed.rawEvidenceIds});
  }
  const affectedParents = new Set(sourceChanges.map(row=>row.listingId));
  const masterChanges = (dataset.listings || []).filter(row=>affectedParents.has(row.id)).map(row=>{
    const before = {first_collected_at:row.first_collected_at,registration_at:row.registration_at};
    const first = iso(row.first_collected_at);
    const candidate = [first,...(sourceByParent.get(row.id)||[])].filter(Boolean).sort()[0];
    const after = {...before};
    if (first && candidate && candidate < first) {
      after.first_collected_at = candidate;
      // Preserve a separately chosen registration date, if one exists.
      if (iso(row.registration_at) === first) after.registration_at = candidate;
    }
    return {id:row.id,propertyId:row.property_id,before,after};
  });
  const guard = 'first_observed_repair_guard';
  const beforeWhere = state => Object.entries(state).map(([key,value])=>`${key}=${quote(value)}`).join(' AND ');
  const sourceWhere = (row,when) => `id=${quote(row.id)} AND listing_id=${quote(row.listingId)} AND trade_type=${quote(row.tradeType)} AND first_collected_at=${quote(row[when])}`;
  const start = [`CREATE TABLE ${guard}(ok INTEGER NOT NULL CHECK(ok=1));`];
  const forward = [...start], rollback = [...start];
  const changedById=new Map(sourceChanges.map(row=>[row.id,row]));
  const inventoryGuard=(row,phase,target)=>{
    const known=(dataset.sources||[]).filter(source=>source.listing_id===row.id).map(source=>{
      const change=changedById.get(source.id);
      const expected=phase==='after'&&change?change.after:source.first_collected_at;
      return `(id=${quote(source.id)} AND first_collected_at=${quote(expected)})`;
    }).join(' OR ')||'0';
    // Newer ads may arrive during collection. A newly earlier observation that
    // changes this parent's minimum requires a fresh preview, not a guessed date.
    return `INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM listing_sources WHERE listing_id=${quote(row.id)} AND julianday(first_collected_at)<julianday(${quote(target)}) AND NOT (${known});`;
  };
  // Check all dates before any update. D1 executes the file transactionally;
  // concurrent unrelated memo/presence updates are never replaced wholesale.
  for (const row of sourceChanges) {
    forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END FROM listing_sources WHERE ${sourceWhere(row,'before')};`);
    rollback.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END FROM listing_sources WHERE ${sourceWhere(row,'after')};`);
  }
  for (const row of masterChanges) {
    forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END FROM listings WHERE id=${quote(row.id)} AND ${beforeWhere(row.before)};`);
    rollback.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END FROM listings WHERE id=${quote(row.id)} AND ${beforeWhere(row.after)};`);
    forward.push(inventoryGuard(row,'before',row.after.first_collected_at));
    rollback.push(inventoryGuard(row,'after',row.before.first_collected_at));
  }
  for (const row of sourceChanges) {
    forward.push(`UPDATE listing_sources SET first_collected_at=${quote(row.after)} WHERE ${sourceWhere(row,'before')};`);
    rollback.push(`UPDATE listing_sources SET first_collected_at=${quote(row.before)} WHERE ${sourceWhere(row,'after')};`);
  }
  for (const row of masterChanges) {
    const update = (after,before) => `UPDATE listings SET first_collected_at=${quote(after.first_collected_at)},registration_at=${quote(after.registration_at)},version=version+1,updated_at=MAX(COALESCE(updated_at,''),strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=${quote(row.id)} AND ${beforeWhere(before)};`;
    const history = (action,before,after) => `INSERT INTO listing_history(listing_id,action,actor_email,before_json,after_json) VALUES (${quote(row.id)},${quote(action)},'system-first-observed-date-repair@js-map.com',${quote(JSON.stringify(before))},${quote(JSON.stringify(after))});`;
    forward.push(update(row.after,row.before),history('repairFirstObservedDate',row.before,row.after));
    rollback.push(update(row.before,row.after),history('repairFirstObservedDateRollback',row.after,row.before));
  }
  forward.push(`DROP TABLE ${guard};`);rollback.push(`DROP TABLE ${guard};`);
  const forwardSql = forward.join('\n')+'\n', rollbackSql = rollback.join('\n')+'\n';
  return {sourceChanges,masterChanges,forwardSql,rollbackSql,digest:digest(forwardSql),now};
}

const root = resolve(import.meta.dirname,'..');
function wrangler(args) {
  const result = spawnSync(process.execPath,['--max-old-space-size=192',resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args],
    {cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
  assert.equal(result.status,0,'Wrangler operation failed; no private response body is printed');
  return result.stdout;
}
function query(sql) {
  const result = JSON.parse(wrangler(['d1','execute','js-map-primary','--remote','--command',sql,'--json']));
  assert.equal(result[0]?.success,true);
  return result[0].results || [];
}
function chunks(values,size) {return Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));}
function remoteDataset(since) {
  const candidates=query(`SELECT ${sourceFields.join(',')} FROM listing_sources WHERE created_at>=${quote(since)} AND created_at<${quote(new Date().toISOString())} AND listing_id IS NOT NULL ORDER BY id`);
  const ids=[...new Set(candidates.map(row=>row.listing_id))];
  const listings=chunks(ids,100).flatMap(batch=>query(`SELECT ${fields.join(',')} FROM listings WHERE id IN (${batch.map(quote).join(',')})`));
  const sources=chunks(ids,100).flatMap(batch=>query(`SELECT ${sourceFields.join(',')} FROM listing_sources WHERE listing_id IN (${batch.map(quote).join(',')})`));
  const raw=[],seen=new Set();
  for(const source of ['네이버','당근','공실박스']) {
    const aliases=[...new Set(candidates.filter(row=>row.source===source).flatMap(row=>{
      const base=row.source_listing_id.replace(/::(?:lease|sale)$/,'');
      const bare=source==='네이버'?base.replace(/^네이버-/,''):base;
      return [row.source_listing_id,base,base+'::lease',base+'::sale',bare,bare+'::lease',bare+'::sale'];
    }))];
    for(const batch of chunks(aliases,400)) {
      for(const row of query(`SELECT id,source,source_listing_id,trade_type,processing_state,error_text,result_json,payload_json,created_at FROM collector_raw WHERE source=${quote(source)} AND source_listing_id IN (${batch.map(quote).join(',')}) AND processing_state<>'error' ORDER BY created_at,id`)) {
        if(!seen.has(row.id)){seen.add(row.id);raw.push(row);}
      }
    }
  }
  return {since,candidateSourceIds:candidates.map(row=>row.id),listings,sources,raw};
}
function privatePath(value) {
  assert.ok(value && isAbsolute(value),'absolute private path required');
  const destination=resolve(value),rel=relative(root,destination);
  assert.ok(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep),'backup must be outside repository');
  return destination;
}
const arg=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1)||'';
function main() {
  if(arg('--apply-plan')) {
    const directory=privatePath(arg('--apply-plan'));
    const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8'));
    const sql=readFileSync(resolve(directory,'repair.sql'),'utf8');
    assert.equal(digest(sql),manifest.digest,'saved plan changed');assert.equal(arg('--confirm'),manifest.digest,'exact plan digest confirmation required');
    writeFileSync(resolve(directory,'apply-result.json'),wrangler(['d1','execute','js-map-primary','--remote','--file',resolve(directory,'repair.sql'),'--yes','--json']));
    const sourceRows=chunks(manifest.sourceChanges.map(row=>row.id),100).flatMap(ids=>query(`SELECT id,first_collected_at FROM listing_sources WHERE id IN (${ids.map(quote).join(',')})`));
    const sourceMap=new Map(sourceRows.map(row=>[row.id,row.first_collected_at]));
    for(const row of manifest.sourceChanges) assert.equal(sourceMap.get(row.id),row.after,'source date verification failed');
    const masters=chunks(manifest.masterChanges.map(row=>row.id),100).flatMap(ids=>query(`SELECT id,first_collected_at,registration_at FROM listings WHERE id IN (${ids.map(quote).join(',')})`));
    const masterMap=new Map(masters.map(row=>[row.id,row]));
    for(const row of manifest.masterChanges) for(const field of ['first_collected_at','registration_at']) assert.equal(masterMap.get(row.id)?.[field],row.after[field],'master date verification failed');
    writeFileSync(resolve(directory,'verified.json'),JSON.stringify({at:new Date().toISOString(),sources:sourceRows.length,masters:masters.length}));
    console.log(JSON.stringify({mode:'applied-and-verified',sources:sourceRows.length,masters:masters.length,backup:directory,
      generatedListingCacheInvalidationRequired:true}));
    return;
  }
  const since=arg('--since');assert.ok(iso(since),'--since=<ISO timestamp> required');
  const directory=resolve(privatePath(arg('--backup')),'first-observed-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const dataset=arg('--evidence')?JSON.parse(readFileSync(privatePath(arg('--evidence')),'utf8')):remoteDataset(since);
  assert.equal(dataset.since,since,'evidence scope does not match the requested range');
  const plan=buildFirstObservedRepairPlan(dataset);
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'evidence-private.json'),JSON.stringify(dataset));
  writeFileSync(resolve(directory,'repair.sql'),plan.forwardSql);writeFileSync(resolve(directory,'rollback.sql'),plan.rollbackSql);
  writeFileSync(resolve(directory,'manifest.json'),JSON.stringify({...plan,forwardSql:undefined,rollbackSql:undefined},null,2));
  console.log(JSON.stringify({mode:'preview-only',sources:plan.sourceChanges.length,masters:plan.masterChanges.length,
    masterDatesChanged:plan.masterChanges.filter(row=>row.before.first_collected_at!==row.after.first_collected_at).length,digest:plan.digest,backup:directory}));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();

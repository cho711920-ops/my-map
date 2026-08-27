// Read-only by default. --apply repairs only saved provider metadata, never
// price, area, status, contacts, photos, ownership, master linkage or raw data.
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,isAbsolute,relative} from 'node:path';
import assert from 'node:assert/strict';
import {gongsilSaleFields} from '../cloudflare/src/sale-fields.js';
const root=resolve(import.meta.dirname,'..'),backup=process.argv.find(a=>a.startsWith('--backup='))?.slice(9);
if(!backup || !isAbsolute(backup) || !relative(root,resolve(backup)).startsWith('..'))throw Error('Private --backup outside repository required');
const apply=process.argv.includes('--apply'),dir=resolve(backup,'gongsil-metadata-'+new Date().toISOString().replace(/[:.]/g,'-'));
const quote=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
function run(args){const r=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;}
function query(sql){return JSON.parse(run(['d1','execute','js-map-primary','--remote','--json','--command',sql]))[0].results;}
const projection=`id,listing_id,source_listing_id,sale_category,updated_at,list_snapshot_json,
  json_object('list',json_object('JiMok',json_extract(raw_json,'$.list.JiMok'),'YongdoAddr',json_extract(raw_json,'$.list.YongdoAddr'),
    'Jimok',json_extract(raw_json,'$.list.Jimok'),'LandUse',json_extract(raw_json,'$.list.LandUse'),
    'UseArea',json_extract(raw_json,'$.list.UseArea'),'Zoning',json_extract(raw_json,'$.list.Zoning'),
    'Bfokdate',json_extract(raw_json,'$.list.Bfokdate'),'Bfokdt',json_extract(raw_json,'$.list.Bfokdt')),
    'detail',json_object('bilinfo',json_object('jimok',json_extract(raw_json,'$.detail.bilinfo.jimok'),'yongdoaddr',json_extract(raw_json,'$.detail.bilinfo.yongdoaddr')),
      'getlands',json(json_extract(raw_json,'$.detail.getlands')),'getbilbases',json(json_extract(raw_json,'$.detail.getbilbases')))) AS metadata_raw`;
const before=query(`SELECT ${projection} FROM listing_sources WHERE source='공실박스' AND trade_type='sale' ORDER BY id`);
const fields=['landUse','zoning','secondaryZoning','parcelShape','cadastralAreaM2','roadAccess','buildingUse','otherUse'];
const updates=[];
for(const row of before){
  const old=JSON.parse(row.list_snapshot_json||'{}'),parsed=gongsilSaleFields(JSON.parse(row.metadata_raw)).saleDetails,detail={...(old.saleDetails||{})},changed=[];
  for(const key of fields)if(parsed[key]!=null && parsed[key]!=='' && detail[key]!==parsed[key]){detail[key]=parsed[key];changed.push(key);}
  if(!changed.length)continue;
  detail.fieldSources={...detail.fieldSources,...parsed.fieldSources};detail.metadataVersion=2;
  if(parsed.providerCheckedAt)detail.providerCheckedAt=parsed.providerCheckedAt;
  const next=JSON.stringify({...old,saleDetails:detail});
  updates.push({...row,next,changed});
}
function statement(row,reverse=false){return `UPDATE listing_sources SET list_snapshot_json=${quote(reverse?row.list_snapshot_json:row.next)} WHERE id=${quote(row.id)} AND source='공실박스' AND trade_type='sale' AND updated_at IS ${quote(row.updated_at)} AND list_snapshot_json IS ${quote(reverse?row.next:row.list_snapshot_json)};`;}
const local=new DatabaseSync(':memory:');local.exec('CREATE TABLE listing_sources(id TEXT PRIMARY KEY,source,trade_type,updated_at,list_snapshot_json);');
for(const row of updates){
  local.prepare('INSERT INTO listing_sources VALUES(?,?,?,?,?)').run(row.id,'공실박스','sale',row.updated_at,row.list_snapshot_json);
  local.exec(statement(row));assert.equal(local.prepare('SELECT list_snapshot_json FROM listing_sources WHERE id=?').get(row.id).list_snapshot_json,row.next);
  local.exec(statement(row,true));assert.equal(local.prepare('SELECT list_snapshot_json FROM listing_sources WHERE id=?').get(row.id).list_snapshot_json,row.list_snapshot_json);
}
if(updates[0]){const r=updates[0];local.prepare('UPDATE listing_sources SET updated_at=? WHERE id=?').run('changed-by-collector',r.id);local.exec(statement(r));assert.equal(local.prepare('SELECT list_snapshot_json FROM listing_sources WHERE id=?').get(r.id).list_snapshot_json,r.list_snapshot_json);}
local.close();mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'before.json'),JSON.stringify(before));writeFileSync(resolve(dir,'planned.json'),JSON.stringify(updates));
writeFileSync(resolve(dir,'rollback.sql'),updates.map(r=>statement(r,true)).join('\n'));
const gained=field=>updates.filter(r=>!JSON.parse(r.list_snapshot_json).saleDetails?.[field] && JSON.parse(r.next).saleDetails?.[field]);
console.log(JSON.stringify({apply,backup:dir,sources:before.length,updated:updates.length,land:before.filter(r=>r.sale_category==='land').length,landUseRecovered:gained('landUse').length,zoningRecovered:gained('zoning').length,landUseRecoveredInLand:gained('landUse').filter(r=>r.sale_category==='land').length,zoningRecoveredInLand:gained('zoning').filter(r=>r.sale_category==='land').length,localForwardRollbackConflictGuard:'passed'}));
if(apply){
  let affected=0;
  for(let i=0;i<updates.length;i+=60){const file=resolve(dir,'repair-'+i+'.sql');writeFileSync(file,updates.slice(i,i+60).map(r=>statement(r)).join('\n'));const response=run(['d1','execute','js-map-primary','--remote','--file',file,'--yes','--json']);writeFileSync(resolve(dir,'result-'+i+'.json'),response);console.log(JSON.stringify({processed:Math.min(i+60,updates.length),total:updates.length}));}
  const after=query(`SELECT id,list_snapshot_json FROM listing_sources WHERE source='공실박스' AND trade_type='sale' ORDER BY id`),map=new Map(after.map(r=>[r.id,r.list_snapshot_json]));
  for(const r of updates)if(map.get(r.id)===r.next)affected++;
  writeFileSync(resolve(dir,'after.json'),JSON.stringify(after));console.log(JSON.stringify({verified:affected,planned:updates.length,concurrentChanged:updates.length-affected}));
}

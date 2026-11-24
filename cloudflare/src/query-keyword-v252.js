// Match text against the complete ad projection and current operating memo.
// Only matching memos are read server-side; none are added to the wire packet.
import {sourceSnapshotProofSql,hashSourceSnapshotRows} from './source-snapshot-proof.js';
import {publicMasterWhereSql,publicMasterSourcesWhereSql} from './source-availability.js';
const fail=message=>Object.assign(Error(message),{statusCode:409});
function keywordTermsV289(spec){
  const terms=[...new Set(String(spec.filters.keyword||'').toLowerCase().split(/[,\s]+/).filter(Boolean))];
  // SQLite lower() must not disagree with the shared JS text matcher.
  if(!terms.length||terms.length>32||terms.some(term=>[...term].some(ch=>ch.charCodeAt(0)>127&&ch.toUpperCase()!==ch.toLowerCase())))return null;
  return terms;
}
async function keywordMemoRowsV289(env,terms){
  // Bound D1 to memo hits. The compact protocol never loads the full 14MB
  // advertisement packet or transfers memo text to the browser.
  const whitespace=[' ', '\t','\n','\r','\f','\v','\u00a0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007','\u2008','\u2009','\u200a','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'];
  const compact=whitespace.reduce((sql,ch)=>`replace(${sql},char(${ch.charCodeAt(0)}),'')`,"lower(COALESCE(operating_memo,''))");
  const result=await env.DB.prepare(`WITH memo_hits AS MATERIALIZED (
      SELECT id FROM listings WHERE property_id<>'' AND EXISTS (SELECT 1 FROM json_each(?1) term
        WHERE instr(lower(COALESCE(operating_memo,'')),substr(term.value,1,1))>0
          AND instr(lower(COALESCE(operating_memo,'')),substr(term.value,-1,1))>0
          AND (instr(lower(COALESCE(operating_memo,'')),term.value)>0 OR instr(${compact},term.value)>0)))
    SELECT property_id, operating_memo, ${sourceSnapshotProofSql()} AS source_snapshot_proof
    FROM listings WHERE listings.id IN (SELECT id FROM memo_hits)
      AND ${publicMasterWhereSql('listings')} AND ${publicMasterSourcesWhereSql('listings')}`)
    .bind(JSON.stringify(terms)).all();
  if(!Array.isArray(result?.results)||result.results.length>50000)throw fail('검색 메모 응답 범위가 다릅니다.');
  const rows=await hashSourceSnapshotRows(result.results),seen=new Set();
  for(const row of rows){
    if(typeof row.property_id!=='string'||!row.property_id||seen.has(row.property_id)||typeof row.operating_memo!=='string'||!/^sha256-v1:[a-f0-9]{64}$/.test(row.source_snapshot_key))throw fail('검색 메모 연결이 다릅니다.');
    seen.add(row.property_id);
  }
  return rows;
}
export async function keywordIdsV289(env,spec){
  const terms=keywordTermsV289(spec);if(!terms)throw Object.assign(fail('검색 전체 기준 조회가 필요합니다.'),{statusCode:425});
  return (await keywordMemoRowsV289(env,terms)).map(row=>{
    const text=row.operating_memo.toLowerCase(),compact=text.replace(/\s/g,'');
    const mask=terms.reduce((value,term,index)=>text.includes(term)||compact.includes(term)?value|(1<<index):value,0)>>>0;
    return [row.property_id,row.source_snapshot_key,mask];
  });
}
export async function keywordMatchesV252(env,packet,spec,match){
  if(!match||packet.numericCatalogV177?.complete!==true||packet.numericCatalogV177.marketV215!==spec.mode||packet.numericCatalogV177.revision!==packet.revision)return null;
  const terms=keywordTermsV289(spec);if(!terms)return null;
  const id=packet.fields.indexOf('propertyId'),proof=packet.fields.indexOf('sourceSnapshotKey'),expected=new Map(),memos=new Map();
  if(id<0||proof<0)throw fail('검색 원장 연결 항목이 없습니다.');
  for(const row of packet.rows){if(typeof row[id]!=='string'||!row[id]||expected.has(row[id])||!/^sha256-v1:[a-f0-9]{64}$/.test(row[proof]))throw fail('검색 원장 기준이 다릅니다.');expected.set(row[id],row[proof]);}
  const rows=await keywordMemoRowsV289(env,terms),repairs=new Set();
  for(const row of rows){
    if(!expected.has(row.property_id))continue;
    if(expected.get(row.property_id)!==row.source_snapshot_key)repairs.add(row.property_id);
    else memos.set(row.property_id,row.operating_memo);
  }
  if(repairs.size>1024)throw fail('검색 변경 범위를 다시 준비해야 합니다.');
  // A current memo cannot certify retained advertisement facts. Exclude the
  // mismatched masters until their own current originals have been evaluated.
  const accept=row=>!repairs.has(row.propertyId)&&match({...row,memo:memos.get(row.propertyId)||''});
  accept.repairIdsV238=[...repairs];return accept;
}

// Industry filtering uses the operating master memo, as the shared runtime
// does. Return only matching IDs/proofs, never transfer private memo text or
// reconstruct every original advertisement to perform this text predicate.
import {sourceSnapshotProofSql,hashSourceSnapshotRows} from './source-snapshot-proof.js';
import {publicMasterWhereSql,publicMasterSourcesWhereSql} from './source-availability.js';
const fail=message=>Object.assign(Error(message),{statusCode:409});
export async function industryIdsV238(env,spec){
  const terms=[...new Set(String(spec.filters.industryFilter||'').trim().toLowerCase().split(',').map(s=>s.trim()).filter(Boolean))];
  if(!terms.length||terms.some(term=>Array.from(term).some(ch=>ch.charCodeAt(0)>127&&ch.toUpperCase()!==ch.toLowerCase())))throw Object.assign(fail('업종 전체 기준 조회가 필요합니다.'),{statusCode:425});
  const result=await env.DB.prepare(`SELECT property_id, ${sourceSnapshotProofSql()} AS source_snapshot_proof
    FROM listings WHERE property_id<>''
      AND ${publicMasterWhereSql('listings')} AND ${publicMasterSourcesWhereSql('listings')}
      AND EXISTS (SELECT 1 FROM json_each(?1) term WHERE instr(lower(COALESCE(operating_memo,'')),term.value)>0)`)
    .bind(JSON.stringify(terms)).all();
  if(!Array.isArray(result?.results)||result.results.length>50000)throw fail('업종 필터 응답 범위가 다릅니다.');
  const rows=await hashSourceSnapshotRows(result.results),seen=new Set();
  return rows.map(row=>{
    if(typeof row.property_id!=='string'||!row.property_id||row.property_id.length>100||seen.has(row.property_id)||!/^sha256-v1:[a-f0-9]{64}$/.test(row.source_snapshot_key))throw fail('업종 필터 응답 연결이 다릅니다.');
    seen.add(row.property_id);return [row.property_id,row.source_snapshot_key];
  });
}
export async function industryMatchesV238(env,packet,spec){
  if(packet.numericCatalogV177?.marketV215!==spec.mode||packet.numericCatalogV177.complete!==true||packet.revision!==packet.numericCatalogV177.revision)throw fail('업종 필터 전체 기준이 다릅니다.');
  const id=packet.fields.indexOf('propertyId'),proof=packet.fields.indexOf('sourceSnapshotKey'),expected=new Map();
  if(id<0||proof<0)throw fail('업종 필터 연결 항목이 없습니다.');
  for(const row of packet.rows){
    if(typeof row[id]!=='string'||!row[id]||expected.has(row[id])||!/^sha256-v1:[a-f0-9]{64}$/.test(row[proof]))throw fail('업종 필터 원장 연결이 다릅니다.');
    expected.set(row[id],row[proof]);
  }
  const terms=[...new Set(String(spec.filters.industryFilter||'').trim().toLowerCase().split(',').map(s=>s.trim()).filter(Boolean))];
  // SQLite lower() is ASCII-only. Cased Unicode terms retain the unchanged JS
  // evaluator instead of acquiring false negative matches.
  if(!terms.length||terms.some(term=>Array.from(term).some(ch=>ch.charCodeAt(0)>127&&ch.toUpperCase()!==ch.toLowerCase())))return null;
  const ids=JSON.stringify([...expected.keys()]);if(new TextEncoder().encode(ids).length>2*1024*1024)return null;
  const result=await env.DB.prepare(`SELECT property_id, ${sourceSnapshotProofSql()} AS source_snapshot_proof
    FROM listings WHERE property_id IN (SELECT value FROM json_each(?1)) AND property_id<>''
      AND ${publicMasterWhereSql('listings')} AND ${publicMasterSourcesWhereSql('listings')}
      AND EXISTS (SELECT 1 FROM json_each(?2) term WHERE instr(lower(COALESCE(operating_memo,'')),term.value)>0)`)
    .bind(ids,JSON.stringify(terms)).all();
  if(!Array.isArray(result?.results)||result.results.length>expected.size)throw fail('업종 필터 응답 범위가 다릅니다.');
  const rows=await hashSourceSnapshotRows(result.results),matched=new Set(),repairs=new Set(),seen=new Set();
  for(const row of rows){
    const property=row.property_id;
    if(!expected.has(property)||seen.has(property)||!/^sha256-v1:[a-f0-9]{64}$/.test(row.source_snapshot_key))throw fail('업종 필터 응답 연결이 다릅니다.');
    seen.add(property);if(row.source_snapshot_key===expected.get(property))matched.add(property);else repairs.add(property);
  }
  if(repairs.size>1024)throw fail('업종 필터 변경 범위를 다시 준비해야 합니다.');
  const accept=row=>matched.has(row.propertyId);accept.repairIdsV238=[...repairs];return accept;
}

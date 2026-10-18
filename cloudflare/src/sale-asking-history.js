import { publicSourceWhereSql } from './source-availability.js';
const clean=v=>String(v??'').trim();
const number=v=>v==null||typeof v==='boolean'||!clean(v)?null:Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
function snapshot(value){try{return JSON.parse(value||'{}');}catch{return {};}}
function identity(s,row){return clean(s.originalId)===row.id&&clean(s.source)===row.source&&clean(s.sourceId)===row.source_listing_id&&s.tradeType==='sale';}
export function askingHistoryEntry(row,source){
  const before=snapshot(row.before_json),after=snapshot(row.after_json);
  if(!identity(after,source))return null;
  const price=number(after.salePrice);if(price==null||!Number.isFinite(Date.parse(row.created_at)))return null;
  if(row.action==='sourceMerged'&&!clean(before.originalId)&&number(before.salePrice)==null)return {id:row.id,at:row.created_at,kind:'observed',price};
  if(row.action!=='sourceUpdated'||!identity(before,source))return null;
  const old=number(before.salePrice);if(old==null)return {id:row.id,at:row.created_at,kind:'observed',price};
  if(old===price)return null;
  const fields=['address','room','saleCategory'];
  const areas=['landAreaM2','grossAreaM2','exclusiveAreaM2'];
  const changed=fields.some(k=>clean(before[k]).replace(/\s/g,'')!==clean(after[k]).replace(/\s/g,''))||areas.some(k=>number(before.saleDetails?.[k])!==number(after.saleDetails?.[k]))||clean(before.saleDetails?.saleExtent)!==clean(after.saleDetails?.saleExtent);
  return {id:row.id,at:row.created_at,kind:changed?'conditions_changed':'price_changed',beforePrice:old,price};
}
export async function getSaleAskingHistory(env,query){
  const propertyId=clean(query.propertyId),originalId=clean(query.originalId),cursor=clean(query.beforeId);
  if(!propertyId||propertyId.length>100||!originalId||originalId.length>180||cursor&&!/^[1-9]\d{0,14}$/.test(cursor))throw Object.assign(Error('조회할 매물과 원본 광고를 확인해 주세요.'),{statusCode:400});
  const source=await env.DB.prepare(`SELECT s.id,s.source,s.source_listing_id,s.listing_id FROM listing_sources s
    JOIN listings l ON l.id=s.listing_id WHERE s.id=?1 AND (l.id=?2 OR l.property_id=?2) AND l.status<>'deleted' AND l.trade_type='sale'
    AND s.trade_type='sale' AND ${publicSourceWhereSql('s')} AND NOT EXISTS(
      SELECT 1 FROM listing_data_quality_holds q WHERE q.listing_id=l.id AND q.state='open' AND q.blocks_publication=1) LIMIT 1`)
    .bind(originalId,propertyId).first();
  if(!source)throw Object.assign(Error('현재 조회할 수 있는 매매 원본 광고가 아닙니다.'),{statusCode:404});
  function projection(column){const json=`CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END`;
    return `json_object(${['originalId','source','sourceId','tradeType','saleCategory','address','room','salePrice'].map(k=>`'${k}',json_extract(${json},'$.${k}')`).join(',')},'saleDetails',json_object(${['landAreaM2','grossAreaM2','exclusiveAreaM2','saleExtent'].map(k=>`'${k}',json_extract(${json},'$.saleDetails.${k}')`).join(',')}))`;
  }
  const result=await env.DB.prepare(`SELECT id,action,${projection('before_json')} AS before_json,${projection('after_json')} AS after_json,created_at FROM listing_history
    WHERE listing_id=?1 AND source_id=?2 AND action IN ('sourceUpdated','sourceMerged') AND id<?3 ORDER BY id DESC LIMIT 51`)
    .bind(source.listing_id,source.id,cursor?Number(cursor):Number.MAX_SAFE_INTEGER).all();
  const scanned=(result.results||[]).slice(0,50),hasMore=(result.results||[]).length>50;
  return {ok:true,action:'saleAskingHistory',propertyId,originalId,source:source.source,sourceListingId:source.source_listing_id,
    entries:scanned.map(row=>askingHistoryEntry(row,source)).filter(Boolean),hasMore,nextCursor:hasMore?String(scanned.at(-1).id):'',
    scanned:scanned.length,queriedAt:new Date().toISOString()};
}

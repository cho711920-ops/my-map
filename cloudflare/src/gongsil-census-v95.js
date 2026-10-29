import {advertisementCensusAudit, validatedAdvertisementScope} from "./advertisement-presence.js";
import {gongsilProviderSourceId, resolveGongsilOfferIds} from "./gongsil-offers.js";

// Independent list proof. A detail/save error cannot make a present ad absent.
// Legacy clients and runs lacking the v95 census stay on their existing path.
export async function gongsilCensusV95(env, body, markets) {
  const census = body.censusV95;
  const invalid = issue => ({valid:false,issue,offers:[]});
  if (census == null) return body.censusIssueV95 ? invalid(String(body.censusIssueV95).slice(0,300)) : null;
  if (census.version !== 95 || census.complete !== true || census.selectionVerified !== true || body.stopped ||
      !/^2\.3\.(?:[4-9]|[1-9]\d+)$/.test(String(body.collectorVersion)) || !markets.length) return invalid("광고 전체대조 증명 또는 실행 상태 미확인");
  const scope = validatedAdvertisementScope("공실박스",census.scope);
  const ids = census.ids;
  if (!scope || !Array.isArray(ids) || ids.length > 5000 || new Set(ids).size !== ids.length ||
      ids.some(id=>typeof id!=="string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return invalid("광고 전체대조 범위·번호목록 오류");
  const captured = Date.parse(census.capturedAt);
  if (!Number.isFinite(captured) || captured > Date.now()+60000 || captured < Date.now()-86400000 || !ids.length && census.emptyConfirmed !== true) {
    return invalid("광고 전체대조 시각 또는 빈목록 미확인");
  }
  const proof = {version:1,terminalReached:true,listComplete:true,scopeVerified:true,issueCodes:[],expectedCountKnown:true,
    providerExpectedCount:ids.length,observedUniqueCount:ids.length,capturedAt:census.capturedAt,emptyConfirmed:census.emptyConfirmed===true};
  const censusBody = {...body,validationVersion:3,presenceScope:scope,completionProof:proof};
  const audit = advertisementCensusAudit("공실박스",censusBody,ids.length);
  if (!audit.valid) return invalid(audit.issues.join(" · "));
  const current = Array.isArray(body.providerObservedOffersV95) ? body.providerObservedOffersV95 : [];
  if (current.length > 60000 || current.some(row=>!row || typeof row.sourceId!=="string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(row.sourceId) || !["lease","sale"].includes(row.tradeType))) return invalid("거래유형별 관측목록 오류");
  const seen = new Set(ids), known = new Set(current.map(row=>row.sourceId));
  const offers = current.filter(row=>seen.has(row.sourceId) && markets.includes(row.tradeType));
  // IDs still in the provider's map may have a failed detail or lie in the
  // pinned bounds outside today's resized viewport. Preserve only their
  // existing market links; never invent prices, addresses, or new offers.
  const unknown = ids.filter(id=>!known.has(id));
  for (let offset=0;offset<unknown.length;offset+=512) {
    const wanted=unknown.slice(offset,offset+512).flatMap(id=>[id,`${id}::lease`,`${id}::sale`]);
    const rows=await env.DB.prepare(`SELECT source_listing_id,COALESCE(NULLIF(trade_type,''),'lease') AS trade_type
      FROM listing_sources WHERE source='공실박스' AND source_listing_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(wanted)).all();
    for (const row of rows.results||[]) if(markets.includes(row.trade_type)) offers.push({sourceId:gongsilProviderSourceId(row.source_listing_id),tradeType:row.trade_type});
  }
  const unique=[...new Map(offers.map(row=>[`${row.tradeType}:${row.sourceId}`,{sourceId:row.sourceId,tradeType:row.tradeType}])).values()];
  return {valid:true,issue:"",body:censusBody,offers:await resolveGongsilOfferIds(env,unique),providerCount:ids.length};
}

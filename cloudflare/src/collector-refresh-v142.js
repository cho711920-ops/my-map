// Exact public master IDs committed by one collector session. No addresses,
// user state or inferred same-building grouping participate in this journal.
export async function collectorRefreshIdsV142(env, source, sessionId, affectedIds = []) {
  const extra = [...new Set(affectedIds.filter(id => typeof id === "string" && id))];
  let result;
  try { result = await env.DB.prepare(`SELECT DISTINCT COALESCE(NULLIF(l.property_id,''),l.id) AS property_id
    FROM listing_sources s JOIN listings l ON l.id=s.listing_id WHERE s.source=?1 AND s.session_id=?2
    UNION SELECT COALESCE(NULLIF(property_id,''),id) AS property_id FROM listings
    WHERE id IN (SELECT value FROM json_each(?3)) LIMIT 1025`)
    .bind(source,sessionId,JSON.stringify(extra)).all();
  } catch {
    // Delta discovery is an optimization after committed source writes. A
    // failed read must request a full refresh, never fail/replay collection or
    // claim that there were no changes.
    return {version:142,propertyIds:[],fullReload:true};
  }
  const ids = [...new Set((result?.results || []).map(row => String(row.property_id || "").trim()).filter(Boolean))];
  return {version:142,propertyIds:ids.length > 1024 ? [] : ids,fullReload:ids.length > 1024};
}

export function validCollectorRefreshV142(value) {
  return value?.version === 142 && typeof value.fullReload === "boolean" && Array.isArray(value.propertyIds) &&
    value.propertyIds.length <= 1024 && value.propertyIds.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id)) &&
    new Set(value.propertyIds).size === value.propertyIds.length && (!value.fullReload || !value.propertyIds.length);
}

export const SOURCE_CANDIDATE_POLICY_VERSION = 3;
const eligibleKinds = new Set(["legacy_candidate", "census_missing"]);

function alias(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Invalid internal SQL alias");
  return value;
}

export function sourceAvailability(active, kind) {
  if (Number(active) !== 0) return { availabilityKind: "active", candidateEligible: false };
  const value = String(kind || "").trim();
  const availabilityKind = eligibleKinds.has(value) ? value : "legacy_unverified";
  return { availabilityKind, candidateEligible: eligibleKinds.has(availabilityKind) };
}

export function availabilityKindSql(source = "s") {
  return `(SELECT availability.kind FROM listing_source_availability availability WHERE availability.source_id=${alias(source)}.id)`;
}

export function candidateSourceWhereSql(source = "s") {
  const name = alias(source);
  return `${name}.active=0 AND EXISTS (SELECT 1 FROM listing_source_availability availability
    WHERE availability.source_id=${name}.id AND availability.kind IN ('legacy_candidate','census_missing'))`;
}

export function publicSourceWhereSql(source = "s") {
  const name = alias(source);
  return `(${name}.active=1 OR (${candidateSourceWhereSql(name)}))`;
}

export function publicMasterWhereSql(master = "l") {
  const name = alias(master);
  return `${name}.status<>'deleted' AND NOT EXISTS (SELECT 1 FROM listing_data_quality_holds hold
    WHERE hold.listing_id=${name}.id AND hold.state='open' AND hold.blocks_publication=1)`;
}

export function publicMasterSourcesWhereSql(master = "l") {
  const name = alias(master);
  return `(${name}.status='계약완료'
    OR NOT EXISTS (SELECT 1 FROM listing_sources stored WHERE stored.listing_id=${name}.id)
    OR EXISTS (SELECT 1 FROM listing_sources published WHERE published.listing_id=${name}.id
      AND ${publicSourceWhereSql("published")}))`;
}

export function candidateMasterWhereSql(master = "l") {
  const name = alias(master);
  return `${publicMasterWhereSql(name)} AND ${name}.status<>'계약완료'
    AND EXISTS (SELECT 1 FROM listing_sources candidate WHERE candidate.listing_id=${name}.id
      AND ${candidateSourceWhereSql("candidate")})`;
}

// Start the global ad count at the small, indexed eligible evidence set, not
// at every historical raw-payload row in listing_sources.
export function candidateAdCountSql() {
  return `(SELECT COUNT(*) FROM listing_source_availability candidate_availability
    JOIN listing_sources s ON s.id=candidate_availability.source_id JOIN listings l ON l.id=s.listing_id
    WHERE candidate_availability.kind IN ('legacy_candidate','census_missing') AND s.active=0
      AND ${publicMasterWhereSql()} AND l.status<>'계약완료')`;
}

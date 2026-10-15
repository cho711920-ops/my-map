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

// Project only the small proof envelope needed for the display date. Neither
// raw provider data nor the full evidence document belongs in public responses.
export function absenceMetadataSql(source = "s") {
  const name = alias(source);
  return `(SELECT CASE WHEN json_valid(availability.evidence_json) THEN json_object(
      'version',json_extract(availability.evidence_json,'$.version'),
      'validationVersion',json_extract(availability.evidence_json,'$.validationVersion'),
      'reason',json_extract(availability.evidence_json,'$.reason'),
      'scopeKey',json_extract(availability.evidence_json,'$.scopeKey'),
      'sessionId',json_extract(availability.evidence_json,'$.sessionId'),
      'capturedAt',json_extract(availability.evidence_json,'$.capturedAt'),
      'checkedAt',json_extract(availability.evidence_json,'$.checkedAt'),
      'updatedAt',availability.updated_at) END
    FROM listing_source_availability availability WHERE ${name}.active=0
      AND availability.source_id=${name}.id AND availability.kind='census_missing')`;
}

function proofTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  // Reject JS Date's rollover of invalid calendar dates such as February 30.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN;
}

export function sourceAbsenceConfirmedAt(row, now = Date.now()) {
  if (Number(row?.active) !== 0 || row?.availability_kind !== "census_missing") return "";
  let proof;
  try { proof = JSON.parse(row.absence_metadata_json || "null"); } catch { return ""; }
  const prefix = ({ "네이버": "naver-region", "당근": "daangn-cluster", "공실박스": "gongsil-map" })[row.source];
  if (!prefix || proof?.version !== 1 || !Number.isInteger(proof.validationVersion) || proof.validationVersion < 3 ||
      proof.reason !== "scoped-census-missing" || typeof proof.sessionId !== "string" || !proof.sessionId.trim() ||
      typeof proof.scopeKey !== "string" || !new RegExp(`^${prefix}-v1-[a-f0-9]{64}$`).test(proof.scopeKey)) return "";
  const checked = proofTimestamp(proof.checkedAt);
  const captured = proofTimestamp(proof.capturedAt);
  const written = proofTimestamp(proof.updatedAt);
  // checkedAt is a server-written absence event, not source.updated_at or the
  // migration time. A reappearance suppresses this historical proof entirely.
  return Number.isFinite(checked) && Number.isFinite(captured) && checked === written &&
    captured <= checked + 60_000 && checked <= now + 60_000 ? new Date(checked).toISOString() : "";
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

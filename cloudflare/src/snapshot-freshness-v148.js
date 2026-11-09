// A complete representation with the current authoritative revision/epoch
// does not become incorrect merely because an hour elapsed. TTL remains the
// fallback for legacy/ordinary caches without a usable freshness token.
export function snapshotFreshV148(object, maxAgeMs, expectedRevision = null, collectorRevision = null, now = Date.now()) {
  if (!object) return false;
  const metadata = object.customMetadata || {};
  if (expectedRevision !== null && (!expectedRevision || expectedRevision === '0' || metadata.revision !== expectedRevision)) return false;
  if (collectorRevision !== null && String(metadata.collectorRevisionV142 || '') !== collectorRevision) return false;
  if (expectedRevision !== null || collectorRevision !== null && collectorRevision !== '' && collectorRevision !== '0') {
    return typeof metadata.revision === 'string' && metadata.revision !== '' && metadata.revision !== '0';
  }
  const savedAt = Number(metadata.savedAt);
  return Number.isFinite(savedAt) && savedAt > 0 && now - savedAt <= maxAgeMs;
}

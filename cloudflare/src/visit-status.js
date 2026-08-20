function clean(value) {
  return String(value == null ? "" : value).trim();
}

export function hasConfirmedVisitMemo(value) {
  return /\(\s*확인매물\s*\)/i.test(clean(value));
}

export function markConfirmedVisitMemo(value) {
  const body = clean(value)
    .replace(/\(\s*임장가자\s*\)/gi, "")
    .replace(/\(\s*공실박스\s*\)/gi, "")
    .replace(/\(\s*확인매물\s*\)/gi, "")
    .replace(/\s*\/\s*\/\s*/g, " / ")
    .replace(/^\s*\/\s*/, "")
    .replace(/\s*\/\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return body ? `(확인매물) / ${body}` : "(확인매물)";
}

/** Keep user-owned confirmation and memo text during provider refreshes. */
export function preserveConfirmedVisitMemo(currentMemo, incomingMemo) {
  return hasConfirmedVisitMemo(currentMemo) ? clean(currentMemo) : clean(incomingMemo);
}

/** Carry confirmation to the master that survives a move or consolidation. */
export function carryConfirmedVisitMemo(targetMemo, sourceMemo) {
  const target = clean(targetMemo);
  if (hasConfirmedVisitMemo(target)) return target;
  if (!hasConfirmedVisitMemo(sourceMemo)) return target;
  return markConfirmedVisitMemo(target || sourceMemo);
}

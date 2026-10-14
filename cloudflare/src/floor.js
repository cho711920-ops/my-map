/** @param {unknown} value */
function clean(value) {
  return String(value == null ? "" : value).trim();
}

/** @param {unknown} value */
function compact(value) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

/** Read an actual floor label before interpreting any trailing unit number.
 * @param {unknown} value @returns {number | null}
 */
function explicitFloor(value) {
  const text = compact(value);
  const korean = text.match(/(?:지하|(?:^|[^가-힣])지)0*(\d{1,2})(?:층|F)?/);
  if (korean) return -Math.max(1, Number(korean[1]) || 1);
  const negative = text.match(/(?:^|[^0-9])-(\d{1,2})(?:층|F)/);
  if (negative) return -Math.max(1, Number(negative[1]) || 1);
  const basement = text.match(/(?:^|[^A-Z0-9])B0*(\d{1,2})(?:층|F)/);
  if (basement) return -Math.max(1, Number(basement[1]) || 1);
  const aboveGround = text.match(/(?:^|[^0-9A-Z])(\d{1,2})(?:층|F)/);
  return aboveGround ? Number(aboveGround[1]) || null : null;
}

/** @param {number} floor */
function floorLabel(floor) {
  return floor < 0 ? `지하${Math.abs(floor)}층` : `${floor}층`;
}

/** @param {unknown} value */
function literalRoomLabel(value) {
  const text = clean(value);
  if (!text) return "";
  return /호(?:실)?$/i.test(text) ? text.replace(/호실$/i, "호") : `${text}호`;
}

/** @param {unknown} value @returns {number | null} */
export function parseBasementFloor(value) {
  const text = compact(value);
  if (!text) return null;

  const b = text.match(/B0*(\d{1,4})?/i);
  if (b) {
    const digits = String(b[1] || "");
    let floor = 1;
    if (digits) {
      if (digits.length === 1 || digits.charAt(0) === "0") floor = Number(digits);
      else floor = Number(digits.slice(0, -2) || digits.charAt(0));
    }
    return -Math.max(1, Number(floor) || 1);
  }

  const korean = text.match(/지하0*(\d{1,2})?/);
  if (korean) return -Math.max(1, Number(korean[1]) || 1);

  const shortKorean = text.match(/(?:^|[^가-힣])지0*(\d{1,2})?(?:층|호|$)/);
  if (shortKorean) return -Math.max(1, Number(shortKorean[1]) || 1);

  const negative = text.match(/^-0*(\d{1,2})(?:층|F|호)?$/);
  if (negative) return -Math.max(1, Number(negative[1]) || 1);
  return null;
}

/** @param {unknown} value @param {boolean} [inferRoom] @returns {number | null} */
export function parseListingFloor(value, inferRoom = true) {
  const text = compact(value);
  if (!text) return null;

  const labeledFloor = explicitFloor(text);
  if (labeledFloor != null) return labeledFloor;

  // A provider's literal unit B03호 is not evidence for basement 3. Bare B03
  // remains a legacy floor alias unless explicit provider metadata is supplied.
  if (inferRoom && /^B0\d{1,3}호(?:실)?$/.test(text)) return null;
  const basement = parseBasementFloor(text);
  if (basement != null) return basement;

  // Provider floor labels use "current floor / total floors" (for example
  // 1/3 or 6/7).  Only the first value identifies the listing's floor.
  const currentAndTotal = text.match(/^(-?\d+(?:\.\d+)?)[/／]\d+(?:\.\d+)?$/);
  if (currentAndTotal) {
    const current = Number(currentAndTotal[1]);
    return Number.isFinite(current) && current !== 0 ? current : null;
  }

  const numericFloor = text.match(/^(-?\d+(?:\.\d+)?)(?:층|F)$/);
  if (numericFloor) {
    const current = Number(numericFloor[1]);
    return Number.isFinite(current) && current !== 0 ? current : null;
  }

  const explicit = text.match(/(?:^|[^0-9])(\d{1,2})(?:층|F)(?:[^0-9]|$)/);
  if (explicit) return Number(explicit[1]) || null;

  if (inferRoom) {
    const room = text.match(/(?:^|[^0-9])(\d{3,4})호?(?:[^0-9]|$)/);
    if (room) {
      const digits = room[1];
      const floor = Number(digits.slice(0, -2));
      return floor > 0 ? floor : null;
    }
  }

  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/** @param {{ floor?: unknown, room?: unknown } | null | undefined} row */
export function listingFloor(row) {
  const fromFloor = parseListingFloor(row?.floor, false);
  return fromFloor == null ? parseListingFloor(row?.room, true) : fromFloor;
}

/** @param {unknown} value @param {unknown} [knownFloor] */
export function canonicalListingRoom(value, knownFloor) {
  const text = clean(value);
  const authoritativeFloor = parseListingFloor(knownFloor, false);
  const hasKnownFloor = authoritativeFloor != null && authoritativeFloor !== 0;
  if (!text) return hasKnownFloor ? floorLabel(authoritativeFloor) : "";

  const composite = text.match(/^((?:지하|지)\s*\d{1,2}\s*층?|(?:-?\d{1,2}|B\d{1,2})\s*(?:층|F))\s*(B?\d{1,4}(?:\s*[,/~·-]\s*B?\d{1,4})*(?:호(?:실)?)?)$/i);
  if (composite) {
    const current = hasKnownFloor ? authoritativeFloor : parseListingFloor(composite[1], false);
    if (current != null) return `${floorLabel(current)} ${literalRoomLabel(composite[2])}`;
  }
  const explicitUnit = /^B0\d{1,3}호(?:실)?$/i.test(text.replace(/\s+/g, ""));
  const unitWithKnownFloor = hasKnownFloor && /^(?:B\d{2,4}(?:호(?:실)?)?|\d{3,4}(?:호(?:실)?)?|\d{1,2}호(?:실)?|B?\d{1,4}(?:[,/~·-]B?\d{1,4})+호(?:실)?)$/i.test(text.replace(/\s+/g, ""));
  if (explicitUnit || unitWithKnownFloor) {
    return hasKnownFloor ? `${floorLabel(authoritativeFloor)} ${literalRoomLabel(text)}` : text;
  }
  if (hasKnownFloor && /^(?:(?:지하|지)\d{0,2}(?:층|F)?|B\d{0,4}(?:층|F|호)?|-?\d+(?:\.\d+)?(?:층|F)?(?:[/／]\d+(?:\.\d+)?)?)$/i.test(compact(text))) {
    const fromLabel = parseListingFloor(text, false);
    if (fromLabel != null) return floorLabel(authoritativeFloor);
  }

  const currentAndTotal = text.replace(/\s+/g, "").match(/^(-?\d+(?:\.\d+)?)[/／](\d+(?:\.\d+)?)$/);
  if (currentAndTotal) {
    const current = Number(currentAndTotal[1]);
    const total = Number(currentAndTotal[2]);
    if (Number.isFinite(current) && Number.isFinite(total) && current !== 0 && total > 0) {
      // Providers expose "current floor / total floors" here.  The listing's
      // room field is used by cards, matching, filters and duplicate checks,
      // so keep only the actual listing floor.  The original provider payload
      // remains in listing_sources.raw_json when the total-floor value is
      // needed for auditing.
      return current < 0 ? `지하${Math.abs(current)}층` : `${current}층`;
    }
  }

  const basement = parseBasementFloor(text);
  if (basement != null) return `지하${Math.abs(basement)}층`;

  const decimalFloor = text.replace(/\s+/g, "").match(/^(\d+(?:\.0+)?)(층|F)$/i);
  if (decimalFloor) {
    const current = Number(decimalFloor[1]);
    if (Number.isFinite(current) && current !== 0) return `${current}${decimalFloor[2]}`;
  }
  return text;
}

/** @param {unknown} value @param {unknown} [knownFloor] */
export function normalizedRoomKey(value, knownFloor) {
  return canonicalListingRoom(value, knownFloor)
    .replace(/\s+/g, "")
    .replace(/호실$/g, "호");
}

/** @param {unknown} floor @param {unknown} minimum @param {unknown} maximum */
export function floorMatchesBounds(floor, minimum, maximum) {
  const min = minimum == null || minimum === "" ? null : Number(minimum);
  const max = maximum == null || maximum === "" ? null : Number(maximum);
  if (min == null && max == null) return true;
  if (floor == null || floor === "" || !Number.isFinite(Number(floor))) return true;
  const value = Number(floor);
  if (min != null && Number.isFinite(min) && value < min) return false;
  if (max != null && Number.isFinite(max) && value > max) return false;
  return true;
}

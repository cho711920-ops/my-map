function clean(value) {
  return String(value == null ? "" : value).trim();
}

function compact(value) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

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

export function parseListingFloor(value, inferRoom = true) {
  const text = compact(value);
  if (!text) return null;

  const basement = parseBasementFloor(text);
  if (basement != null) return basement;

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

export function listingFloor(row) {
  const fromFloor = parseListingFloor(row?.floor, true);
  return fromFloor == null ? parseListingFloor(row?.room, true) : fromFloor;
}

export function canonicalListingRoom(value) {
  const text = clean(value);
  if (!text) return "";
  const basement = parseBasementFloor(text);
  return basement == null ? text : `지하${Math.abs(basement)}층`;
}

export function normalizedRoomKey(value) {
  return canonicalListingRoom(value)
    .replace(/\s+/g, "")
    .replace(/호실$/g, "호");
}

export function floorMatchesBounds(floor, minimum, maximum) {
  const min = minimum == null || minimum === "" ? null : Number(minimum);
  const max = maximum == null || maximum === "" ? null : Number(maximum);
  if (min == null && max == null) return true;
  if (floor == null || !Number.isFinite(Number(floor))) return false;
  const value = Number(floor);
  if (Number.isFinite(min) && value < min) return false;
  if (Number.isFinite(max) && value > max) return false;
  return true;
}

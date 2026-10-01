// Read-only advertising area supplement. Never infer an area from generic size,
// building scope, prices or the ambiguous label "건평"; never change stored data.
const AREA_FIELDS = {
  전용: "exclusiveAreaM2", 전용면적: "exclusiveAreaM2",
  대지: "landAreaM2", 대지면적: "landAreaM2",
  연면적: "grossAreaM2", 건축면적: "buildingAreaM2"
};
const M2_PER_PYEONG = 3.305785;
const number = "(?:[1-9]\\d{0,2}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const quantity = new RegExp("^(약\\s*)?(" + number + ")\\s*(㎡|m²|m2|평)", "i");
const positive = value => {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function saleDescriptionAreas(content) {
  if (typeof content !== "string") return {};
  const text = content.slice(0, 12000);
  const lines = text.split(/[\r\n]+/).map(row => row.replace(/^[\s🔶🔸🔹🔷✅✔☑*·\-▶▷●○■□]+/u, ""));
  // A separate-property or rented-part heading can own the labelled rows
  // below it. Do not guess where that section ends: withhold this optional
  // description supplement entirely, leaving all saved areas untouched.
  if (lines.some(line => /^(?:(?:별도|다른|참고)\s*(?:소개\s*)?매물|임대\s*중인\s*\S)/.test(line))) return {};
  const found = {};
  // Only standalone labelled rows are read. Prose describing a rented part or
  // another property must not become this listing's exclusive/whole area.
  const labels = /(?:^|[·,;|/]\s*)(전용면적|전용|대지면적|대지|연면적|건축면적)\s*(?:\(건평\)\s*)?(?:[:：]|-(?=\s|약))?\s*/g;
  for (const line of lines) {
    const matches = [...line.matchAll(labels)];
    if (!matches.length || matches[0].index !== 0) continue;
    for (const [index, label] of matches.entries()) {
      const body = line.slice(label.index + label[0].length, matches[index + 1]?.index ?? line.length).trim();
      const first = quantity.exec(body);
      if (!first) continue;
      const tail = body.slice(first[0].length).trim();
      const firstValue = positive(first[2]);
      if (firstValue == null) continue;
      let area = first[3] === "평" ? firstValue * M2_PER_PYEONG : firstValue;
      // For paired 평(㎡), retain printed square metres. All unparsed suffixes
      // (ranges, bounds, prose and conflicting slash measurements) are refused.
      if (tail) {
        if (!/^\(\s*/.test(tail)) continue;
        const inner = tail.replace(/^\(\s*/, "");
        const second = quantity.exec(inner);
        if (!second || !/^\s*\)$/.test(inner.slice(second[0].length))) continue;
        const secondValue = positive(second[2]);
        if (secondValue == null) continue;
        const secondM2 = second[3] === "평" ? secondValue * M2_PER_PYEONG : secondValue;
        if (Math.abs(area - secondM2) > Math.max(M2_PER_PYEONG, area * 0.01)) continue;
        if (first[3] === "평" && second[3] !== "평") area = secondM2;
      }
      const key = AREA_FIELDS[label[1]];
      (found[key] ||= []).push(Math.round(area * 100) / 100);
    }
  }
  // Multiple contradictory statements in one advertisement do not establish
  // a single area. Do not let whichever happens to occur first win.
  return Object.fromEntries(Object.entries(found).flatMap(([key, values]) => {
    const unique = [...new Set(values)];
    return unique.length === 1 ? [[key, unique[0]]] : [];
  }));
}

export function withSaleAreaDisplay(original, provider = {}) {
  if (original?.tradeType !== "sale" || original.saleCategory === "land" || original.saleDetails?.scope === "land") return original;
  const detail = original.saleDetails || {};
  const description = typeof detail.descriptionText === "string" && detail.descriptionText.trim()
    ? detail.descriptionText : (provider.source || original.source) === "당근" ? provider.daangn?.description : "";
  const supplement = saleDescriptionAreas(description);
  const missing = Object.fromEntries(Object.entries(supplement).filter(([key]) =>
    detail[key] == null || typeof detail[key] === "string" && /^(?:\s*|\s*-\s*)$/.test(detail[key])));
  return Object.keys(missing).length ? { ...original, saleDetails: { ...detail, ...missing } } : original;
}

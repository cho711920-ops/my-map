// A road name without a building number is not a publishable address.
// Keep this parser independent of geocoding: provider evidence is required.
export function exactCollectorRoadAddress(value, wholeValue = false) {
  const original = String(value ?? "").trim();
  if (/\d\s*\(\s*(?:층|평(?:형)?|㎡|m[²2]|제곱(?:미터)?|호(?:실)?|만원|원)\s*\)/i.test(original)) return "";
  const text = original.replace(/^대한민국\s+/, "").replace(/^(?:대전광역시|대전시)\s+/, "")
    .replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const match = text.match(/^((?:[가-힣0-9·.]+(?:도|시|군|구|읍|면)\s+)*[가-힣0-9·.]+(?:로|길)\s*\d+(?:-\d+)?)(?=\s|$|,(?!\d))(?!\s*(?:층|평|㎡|m[²2]|제곱(?:미터)?|호(?:실)?|만원|원|인근|근처|부근|일대)(?:\s|$|,))/i);
  if (!match || wholeValue && match[0] !== text) return "";
  return match[1];
}

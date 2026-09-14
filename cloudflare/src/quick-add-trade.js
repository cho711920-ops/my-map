// @ts-check
/** @param {unknown} value @param {string} label @param {boolean} [required] */
function amount(value, label, required = false) {
  if (value == null || String(value).trim() === "") {
    if (required) throw Object.assign(new Error(`${label}을 입력해 주세요.`), { statusCode: 400 });
    return null;
  }
  const raw = String(value).trim().replace(/,/g, "");
  const parsed = Number(raw);
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw Object.assign(new Error(`${label}은 0 이상의 숫자로 입력해 주세요.`), { statusCode: 400 });
  }
  return parsed;
}

const categories = new Set(["commercial", "multifamily", "house", "building", "land", "factory_warehouse", "apartment", "villa", "officetel", "one_room", "office", "mixed_house", "reconstruction", "redevelopment", "apartment_presale", "officetel_presale", "knowledge_center", "other"]);

/** Validate explicit market fields. Legacy lease clients remain supported, never infer a sale price from deposit.
 * @param {Record<string, unknown>} body
 * @param {unknown[]} values
 */
export function validateQuickAddTrade(body, values) {
  const tradeType = String(body.tradeType || "lease");
  if (tradeType !== "lease" && tradeType !== "sale") throw Object.assign(new Error("거래유형을 확인해 주세요."), { statusCode: 400 });
  if (tradeType === "lease" && (body.salePrice != null && String(body.salePrice) !== "" || /매매/.test(String(values[3] || "")))) {
    throw Object.assign(new Error("매매 매물은 거래유형을 매매로 선택한 뒤 등록해 주세요."), { statusCode: 400 });
  }
  for (const [index, label] of /** @type {[number, string][]} */ ([[4, "보증금"], [5, "월세"], [6, "관리비"], [7, "권리금"], [8, "평수"]])) amount(values[index], label);
  if (tradeType === "lease") return { tradeType, saleCategory: "", salePrice: null, saleDetails: {} };
  const saleCategory = String(body.saleCategory || "");
  if (!categories.has(saleCategory)) throw Object.assign(new Error("매매 구분을 선택해 주세요."), { statusCode: 400 });
  const salePrice = amount(body.salePrice, "매매가(만원)", true);
  if (!(salePrice != null && salePrice > 0)) throw Object.assign(new Error("매매가는 0보다 커야 합니다."), { statusCode: 400 });
  const input = body.saleDetails && typeof body.saleDetails === "object" && !Array.isArray(body.saleDetails)
    ? /** @type {Record<string, unknown>} */ (body.saleDetails) : {};
  /** @type {Record<string, string | number | null>} */
  const saleDetails = { scope: saleCategory === "land" ? "land" : "whole_building" };
  for (const key of ["landAreaM2", "grossAreaM2", "totalDeposit", "monthlyIncome"]) saleDetails[key] = amount(input[key], key);
  if (saleCategory === "land") {
    for (const key of ["landUse", "zoning"]) saleDetails[key] = String(input[key] || "").trim().slice(0, 160);
  }
  return { tradeType, saleCategory, salePrice, saleDetails };
}

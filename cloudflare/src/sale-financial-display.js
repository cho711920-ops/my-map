import { saleDescriptionFields, supplementSaleDescription } from "./sale-description.js";
import { naverSaleFinancialFields } from "./sale-fields.js";

const evidenceLabels = { salePrice: "매매가", loanAmount: "융자", totalDeposit: "보증금", monthlyIncome: "월 임대수입",
  monthlyNetIncome: "이자 차감 월수익", statedMonthlyIncome: "기준 미확인 월수익", investmentAmount: "실투자금", advertisedYield: "광고 연 수익률" };
const numeric = value => ["number", "string"].includes(typeof value) && String(value).trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

// Repair only the response projection of this exact original. No writes,
// recollection, cross-source borrowing, inferred totals or financing arithmetic.
export function withSaleFinancialDisplay(original, provider = {}) {
  const source = provider.source || original?.source;
  if (original?.tradeType !== "sale" || original.saleCategory === "land" || original.saleDetails?.scope === "land" || !["네이버", "당근"].includes(source) || original.masterFallback) return original;
  const detail = original.saleDetails || {};
  const description = typeof detail.descriptionText === "string" && detail.descriptionText.trim()
    ? detail.descriptionText : source === "당근" ? provider.daangn?.description : provider.naverDescription || "";
  const hasDescription = typeof description === "string" && Boolean(description.trim());
  if (!hasDescription && source !== "네이버") return original;
  const base = { ...detail };
  // Older values with an exact extraction marker can be reinterpreted, while a
  // user/structured value differing from that marker remains authoritative.
  const knownBasis = source === "당근" || provider.naverPriceInfo != null;
  const manualFields = Array.isArray(detail.manualSaleFieldsV1) ? detail.manualSaleFieldsV1 : [];
  if (hasDescription && knownBasis && [1,2].includes(Number(detail.descriptionVersion))) {
    for (const [field, label] of Object.entries(evidenceLabels)) {
      if (field === "salePrice" || manualFields.includes(field)) continue;
      const previous = numeric(detail.descriptionFinancials?.[field]);
      if (previous != null && numeric(base[field]) === previous && detail.descriptionEvidence?.[label]) delete base[field];
    }
  }
  if (source === "네이버") for (const [field,value] of Object.entries(naverSaleFinancialFields(provider.naverPriceInfo))) {
    if (value != null && base[field] == null && !manualFields.includes(field)) base[field] = value;
  }
  const described = hasDescription ? saleDescriptionFields(description) : null;
  const projected = hasDescription ? supplementSaleDescription(base, described, numeric(original.salePrice), detail.descriptionText || "") : base;
  // The advertiser's explicit current rent may disagree with the numeric
  // provider field. Show that same ad's unambiguous description amount, with
  // both values retained for review. Never infer gross rent from net profit,
  // another floor/ad, a future scenario or a mismatched asking price.
  delete projected.monthlyIncomeConflict;
  const priorConflict = detail.monthlyIncomeConflict;
  const providerIncome = source === "네이버" ? numeric(naverSaleFinancialFields(provider.naverPriceInfo).monthlyIncome) : null;
  const structuredIncome = priorConflict?.basis === "description" && numeric(base.monthlyIncome) === numeric(priorConflict.description)
    ? providerIncome ?? numeric(priorConflict.structured)
    : numeric(base.monthlyIncome);
  const descriptionIncome = numeric(described?.monthlyIncome);
  const priceMatches = described?.salePrice == null || numeric(original.salePrice) === described.salePrice;
  const depositMatches = described?.totalDeposit == null || numeric(base.totalDeposit) == null ||
    Math.abs(numeric(base.totalDeposit) - described.totalDeposit) <= 0.1;
  if (!manualFields.includes("monthlyIncome") && structuredIncome != null && descriptionIncome != null &&
      providerIncome != null && structuredIncome === providerIncome &&
      Math.abs(structuredIncome - descriptionIncome) > 0.1 && priceMatches && depositMatches &&
      !described.descriptionPartialFields?.includes("monthlyIncome") &&
      !described.descriptionUnitAssumptions?.includes("monthlyIncome")) {
    projected.monthlyIncome = descriptionIncome;
    projected.monthlyIncomeConflict = {structured: structuredIncome, description: descriptionIncome, basis: "description"};
    projected.financialDisplayVersion = 113;
  }
  for (const field of manualFields) if (field !== "salePrice" && Object.hasOwn(evidenceLabels,field) && Object.hasOwn(detail,field)) projected[field] = detail[field];
  return { ...original, saleDetails: projected };
}

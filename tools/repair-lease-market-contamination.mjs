// Safe two-phase repair for historical zero-rent lease contamination.
//
// Phase 1 (default) is read-only against D1.  It writes a private evidence
// bundle and guarded forward/rollback SQL outside the repository:
//   node tools/repair-lease-market-contamination.mjs --backup=C:\private
//
// Phase 2 can only execute that exact reviewed bundle.  It requires both its
// directory and SHA-256 digest.  This file never hard-deletes a listing,
// source, favorite, customer link, contact, media row, memo, or history row:
//   node tools/repair-lease-market-contamination.mjs \
//     --apply-plan=C:\private\lease-market-repair-... --confirm=<sha256>

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { gongsilAdvertisedOffers, hasGongsilOfferEvidence } from "../cloudflare/src/gongsil-offers.js";

const REPAIR_ACTOR = "system-lease-market-repair@js-map.com";
const USER_HISTORY_ACTIONS = new Set([
  "updateProperty", "updatePropertyMemo", "toggleDone", "deleteProperty",
  "restoreListingHistory", "quickAdd", "moveOriginalListing"
]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function number(value) {
  if (value == null || clean(value) === "" || typeof value === "boolean") return null;
  const parsed = Number(clean(value).replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function validJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function tradeLabel(value) {
  return clean(value).toUpperCase();
}

function daangnSaleCategory(raw = {}) {
  const value = tradeLabel(raw?.salesTypeV3?.type || raw?.salesTypeV3?.__typename || raw?.saleCategory);
  if (/FACTORY|WAREHOUSE/.test(value)) return "factory_warehouse";
  if (/LAND/.test(value)) return "land";
  if (/MULTI|VILLA/.test(value)) return "multifamily";
  if (/HOUSE/.test(value)) return "house";
  if (/BUILDING/.test(value)) return "building";
  if (/STORE|OFFICE|COMMERCIAL/.test(value)) return "commercial";
  return "other";
}

export function daangnTradeEvidence(source = {}) {
  const raw = parseJson(source.raw_json);
  const trades = Array.isArray(raw.trades) ? raw.trades : [];
  const buy = trades
    .filter((trade) => /BUY/.test(tradeLabel(trade?.type || trade?.__typename)))
    .map((trade) => ({ price: number(trade?.price), preferred: Boolean(trade?.preferred) }))
    .find((trade) => trade.price > 0) || null;
  const month = trades
    .filter((trade) => /MONTH/.test(tradeLabel(trade?.type || trade?.__typename)))
    .map((trade) => ({
      deposit: number(trade?.deposit ?? trade?.price),
      rent: number(trade?.monthlyPay ?? trade?.yearlyPay),
      preferred: Boolean(trade?.preferred)
    }))
    .find((trade) => trade.deposit != null && trade.rent > 0) || null;
  return {
    buy,
    month,
    hasBuyType: trades.some((trade) => /BUY/.test(tradeLabel(trade?.type || trade?.__typename))),
    hasMonthType: trades.some((trade) => /MONTH/.test(tradeLabel(trade?.type || trade?.__typename))),
    saleCategory: daangnSaleCategory(raw),
    structured: trades.length > 0
  };
}

function preservedRepresentative(sources) {
  return sources.some((source) => {
    const snapshot = parseJson(source.list_snapshot_json);
    return snapshot.preserveRepresentative === true || snapshot.preserveRepresentative === 1 ||
      clean(snapshot.preserveRepresentative).toLowerCase() === "true";
  });
}

function latest(rows) {
  return [...rows].sort((left, right) =>
    clean(right.updated_at ?? right.source?.updated_at).localeCompare(clean(left.updated_at ?? left.source?.updated_at)) ||
      clean(right.id ?? right.source?.id).localeCompare(clean(left.id ?? left.source?.id)))[0] || null;
}

function safeEvidence(listing, sources, extra = {}) {
  return {
    stored: {
      tradeType: clean(listing.trade_type),
      deposit: number(listing.deposit) ?? 0,
      monthlyRent: number(listing.monthly_rent) ?? 0,
      mainSource: clean(listing.main_source)
    },
    sourceIds: sources.map((source) => clean(source.id)).filter(Boolean).sort(),
    sourceCount: sources.length,
    activeSourceCount: sources.filter((source) => Number(source.active) === 1).length,
    preserveRepresentative: preservedRepresentative(sources),
    customerMatchCount: Number(listing.customer_match_count || 0),
    cloudReferenceCount: Number(listing.cloud_reference_count || 0),
    contactCount: Number(listing.contact_count || 0),
    mediaCount: Number(listing.media_count || 0),
    ...extra
  };
}

function decision(listing, sources, kind, issueCode, blocksPublication, reason, evidence, correction = null) {
  return {
    listingId: clean(listing.id),
    propertyId: clean(listing.property_id),
    kind,
    issueCode,
    blocksPublication,
    reason,
    evidence,
    correction,
    sources
  };
}

export function classifyLeaseMarketListing({ listing, sources = [], historyActions = [] }) {
  assert.ok(listing && clean(listing.id), "listing.id is required");
  const baseEvidence = safeEvidence(listing, sources);
  const preserve = baseEvidence.preserveRepresentative;
  const manualHistory = historyActions.some((action) => USER_HISTORY_ACTIONS.has(clean(action)));
  const saleCollisions = Number(listing.sale_collision_count || 0);

  if (!sources.length) {
    return decision(listing, sources, "hold", "orphan_zero_rent_lease", 1,
      "No source row is attached; preserve the master and quarantine it for review.", baseEvidence);
  }

  if (clean(listing.main_source) === "당근") {
    const daangn = sources.filter((source) => clean(source.source) === "당근");
    const proofs = daangn.map((source) => ({ source, evidence: daangnTradeEvidence(source) }));
    const hasBuy = proofs.some((row) => row.evidence.hasBuyType);
    const hasMonth = proofs.some((row) => row.evidence.hasMonthType);
    const activeMonth = latest(proofs.filter((row) => Number(row.source.active) === 1 && row.evidence.month));
    const latestBuy = latest(proofs.filter((row) => row.evidence.buy));
    const activeNonDaangn = sources.filter((source) => Number(source.active) === 1 && clean(source.source) !== "당근");
    const invalidSnapshots = daangn.filter((source) => !validJsonObject(source.list_snapshot_json));
    const facts = safeEvidence(listing, sources, {
      hasBuy,
      hasMonth,
      manualHistory,
      saleCollisionCount: saleCollisions,
      activeNonDaangnCount: activeNonDaangn.length
    });
    const underlyingIssue = hasBuy && hasMonth ? "daangn_monthly_terms_stale"
      : hasBuy ? "daangn_buy_only_in_lease" : "daangn_zero_rent_unproven";

    if (preserve) {
      return decision(listing, sources, "hold", underlyingIssue, 1,
        "preserveRepresentative is set; automatic representative repair is forbidden.", facts);
    }
    if (manualHistory) {
      return decision(listing, sources, "hold", underlyingIssue, 1,
        "A user-restorable listing edit exists; transaction terms require manual review.", facts);
    }
    if (invalidSnapshots.length) {
      return decision(listing, sources, "hold", underlyingIssue, 1,
        "A source snapshot is not valid JSON; automatic repair would not preserve it exactly.", facts);
    }
    if (saleCollisions > 0) {
      return decision(listing, sources, "hold", underlyingIssue, 1,
        "A sale master with the same physical identity already exists; merge review is required.", facts);
    }
    if (activeNonDaangn.length) {
      return decision(listing, sources, "hold", underlyingIssue, 1,
        "Another active provider is attached; changing the representative could contradict it.", facts);
    }

    if (hasBuy && hasMonth) {
      if (!activeMonth) {
        return decision(listing, sources, "hold", underlyingIssue, 1,
          "BUY and MONTH exist, but no active source has a complete positive monthly offer.", facts);
      }
      return decision(listing, sources, "repair_monthly", underlyingIssue, 0,
        "Restore the active provider MONTH terms on the same master ID.", {
          ...facts,
          selectedSourceId: clean(activeMonth.source.id),
          correctedDeposit: activeMonth.evidence.month.deposit,
          correctedMonthlyRent: activeMonth.evidence.month.rent
        }, {
          sourceId: clean(activeMonth.source.id),
          deposit: activeMonth.evidence.month.deposit,
          monthlyRent: activeMonth.evidence.month.rent
        });
    }

    if (hasBuy && !hasMonth) {
      const everyStructuredSourceIsBuyOnly = proofs.length > 0 && proofs.every((row) =>
        row.evidence.structured && row.evidence.hasBuyType && !row.evidence.hasMonthType && row.evidence.buy);
      const allSourcesAreDaangn = sources.every((source) => clean(source.source) === "당근");
      const anyActive = sources.some((source) => Number(source.active) === 1);
      if (!latestBuy || !everyStructuredSourceIsBuyOnly || !allSourcesAreDaangn || anyActive) {
        return decision(listing, sources, "hold", underlyingIssue, 1,
          "Pure-sale evidence is incomplete, mixed with another source, or still actively changing.", facts);
      }
      return decision(listing, sources, "reclassify_sale", underlyingIssue, 0,
        "Reclassify the same master ID as a sale; all user-linked relations remain attached.", {
          ...facts,
          selectedSourceId: clean(latestBuy.source.id),
          correctedSalePrice: latestBuy.evidence.buy.price,
          correctedSaleCategory: latestBuy.evidence.saleCategory
        }, {
          sourceId: clean(latestBuy.source.id),
          salePrice: latestBuy.evidence.buy.price,
          saleCategory: latestBuy.evidence.saleCategory
        });
    }

    return decision(listing, sources, "hold", underlyingIssue, 1,
      "No structured Daangn transaction proves a safe automatic correction.", facts);
  }

  if (clean(listing.main_source) === "공실박스") {
    const gongsil = sources.filter((source) => clean(source.source) === "공실박스");
    const parsed = gongsil.map((source) => {
      const raw = parseJson(source.raw_json);
      const list = raw.list || raw;
      const detail = raw.detail || {};
      return { source, list, detail, offers: gongsilAdvertisedOffers(list, detail), structured: hasGongsilOfferEvidence(list, detail) };
    });
    const positiveLease = latest(parsed.filter((row) => row.offers.some((offer) => offer.tradeType === "lease" && offer.rent > 0)));
    const saleOnly = parsed.some((row) => row.offers.some((offer) => offer.tradeType === "sale")) &&
      !parsed.some((row) => row.offers.some((offer) => offer.tradeType === "lease"));
    const verifiedJeonse = parsed.some((row) => {
      const subtype = clean(row.detail?.floorinfo?.LndSubtype ?? row.list?.Subtype ?? row.list?.subtype);
      return subtype.includes("2") && !/[39]/.test(subtype);
    });
    const facts = safeEvidence(listing, sources, {
      hasPositiveLeaseOffer: Boolean(positiveLease),
      hasSaleOnlyOffer: saleOnly,
      hasStructuredEvidence: parsed.some((row) => row.structured),
      verifiedJeonse
    });
    if (positiveLease) {
      const offer = positiveLease.offers.find((value) => value.tradeType === "lease" && value.rent > 0);
      return decision(listing, sources, "hold", "gongsil_master_terms_stale", 1,
        "Provider evidence has positive rent, but legacy Gongsil rows require manual representative review.", {
          ...facts, suggestedDeposit: offer.deposit, suggestedMonthlyRent: offer.rent,
          selectedSourceId: clean(positiveLease.source.id)
        });
    }
    if (saleOnly) {
      return decision(listing, sources, "hold", "gongsil_sale_in_lease", 1,
        "Only a sale offer is evidenced; legacy Gongsil rows are never auto-reclassified.", facts);
    }
    if (verifiedJeonse) {
      return decision(listing, sources, "hold", "gongsil_verified_jeonse", 0,
        "A zero-monthly-rent jeonse is provider-supported; retain it and record the classification.", facts);
    }
    return decision(listing, sources, "hold", "gongsil_zero_rent_needs_review", 1,
      "Legacy Gongsil evidence is missing or does not prove a valid positive monthly offer.", facts);
  }

  return decision(listing, sources, "hold", "zero_rent_lease_needs_review", 0,
    "Zero monthly rent is not itself proof of a sale; retain and classify without automatic mutation.", baseEvidence);
}

export function auditLeaseMarketDataset({ listings = [], sources = [], history = [] }) {
  const byListing = new Map();
  for (const source of sources) {
    const id = clean(source.listing_id);
    if (!byListing.has(id)) byListing.set(id, []);
    byListing.get(id).push(source);
  }
  const historyByListing = new Map();
  for (const row of history) {
    const id = clean(row.listing_id);
    if (!historyByListing.has(id)) historyByListing.set(id, []);
    historyByListing.get(id).push(clean(row.action));
  }
  const decisions = listings.map((listing) => classifyLeaseMarketListing({
    listing,
    sources: byListing.get(clean(listing.id)) || [],
    historyActions: historyByListing.get(clean(listing.id)) || []
  }));
  const summary = {};
  for (const item of decisions) {
    const key = `${item.kind}:${item.issueCode}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  return { decisions, summary };
}

function quote(value) {
  if (value == null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function same(value) {
  return value == null ? "NULL" : quote(value);
}

function snapshotAfter(source, fields) {
  const snapshot = parseJson(source.list_snapshot_json);
  return JSON.stringify({ ...snapshot, ...fields });
}

function listingState(listing) {
  return {
    status: clean(listing.status),
    main_source: clean(listing.main_source),
    trade_type: clean(listing.trade_type) || "lease",
    sale_category: clean(listing.sale_category),
    sale_price: listing.sale_price == null ? null : Number(listing.sale_price),
    deposit: listing.deposit == null ? null : Number(listing.deposit),
    monthly_rent: listing.monthly_rent == null ? null : Number(listing.monthly_rent),
    version: Number(listing.version || 0),
    updated_at: clean(listing.updated_at)
  };
}

function changedAssignments(before, after) {
  return Object.entries(after).filter(([key, value]) => value !== before[key])
    .map(([key, value]) => `${key}=${quote(value)}`).join(", ");
}

function rollbackAssignments(before, after) {
  const assignments = Object.entries(before)
    .filter(([key, value]) => !["version", "updated_at"].includes(key) && value !== after[key])
    .map(([key, value]) => `${key}=${quote(value)}`);
  if (Object.hasOwn(before, "version")) assignments.push("version=version+1");
  assignments.push("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  return assignments.join(", ");
}

function sourceState(source) {
  return {
    active: Number(source.active || 0),
    trade_type: clean(source.trade_type) || "lease",
    sale_category: clean(source.sale_category),
    sale_price: source.sale_price == null ? null : Number(source.sale_price),
    snapshot_hash: clean(source.snapshot_hash),
    list_snapshot_json: String(source.list_snapshot_json || "{}"),
    updated_at: clean(source.updated_at)
  };
}

function stateWhere(state) {
  return Object.entries(state).map(([key, value]) => `${key} IS ${same(value)}`).join(" AND ");
}

function historyPayload(item, state, extra = {}) {
  return JSON.stringify({
    issueCode: item.issueCode,
    tradeType: state.trade_type,
    saleCategory: state.sale_category,
    salePrice: state.sale_price,
    deposit: state.deposit,
    monthlyRent: state.monthly_rent,
    ...extra
  });
}

function holdUpsert(item, now, state = "open", resolution = {}) {
  const sourceId = item.evidence.selectedSourceId || item.correction?.sourceId || null;
  return `INSERT INTO listing_data_quality_holds (
    listing_id, issue_code, source_id, state, blocks_publication, evidence_json,
    resolution_json, detected_by, resolved_by, detected_at, resolved_at, updated_at
  ) VALUES (${quote(item.listingId)}, ${quote(item.issueCode)}, ${quote(sourceId)}, ${quote(state)},
    ${Number(item.blocksPublication)}, ${quote(JSON.stringify(item.evidence))}, ${quote(JSON.stringify(resolution))},
    ${quote(REPAIR_ACTOR)}, ${state === "resolved" ? quote(REPAIR_ACTOR) : "''"}, ${quote(now)},
    ${state === "resolved" ? quote(now) : "''"}, ${quote(now)})
  ON CONFLICT(listing_id, issue_code) DO UPDATE SET
    source_id=excluded.source_id, state=excluded.state,
    blocks_publication=excluded.blocks_publication,
    evidence_json=excluded.evidence_json, resolution_json=excluded.resolution_json,
    resolved_by=excluded.resolved_by, resolved_at=excluded.resolved_at,
    updated_at=excluded.updated_at;`;
}

export function buildLeaseMarketRepairSql(dataset, { now = new Date().toISOString() } = {}) {
  const audit = auditLeaseMarketDataset(dataset);
  const listingById = new Map(dataset.listings.map((listing) => [clean(listing.id), listing]));
  const guard = `_lease_market_guard_${now.replace(/\D/g, "").slice(0, 17)}`;
  const forward = [`CREATE TABLE ${guard} (ok INTEGER NOT NULL CHECK (ok = 1));`];
  const rollback = [`CREATE TABLE ${guard}_rollback (ok INTEGER NOT NULL CHECK (ok = 1));`];
  const expected = [];

  for (const item of audit.decisions) {
    const listing = listingById.get(item.listingId);
    const before = listingState(listing);
    forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
      FROM listings WHERE id=${quote(item.listingId)} AND ${stateWhere(before)};`);
    forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=${item.sources.length} THEN 1 ELSE 0 END
      FROM listing_sources WHERE listing_id=${quote(item.listingId)};`);
    for (const source of item.sources) {
      forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
        FROM listing_sources WHERE id=${quote(source.id)} AND listing_id=${quote(item.listingId)}
          AND active IS ${quote(Number(source.active || 0))} AND updated_at IS ${quote(clean(source.updated_at))};`);
    }

    if (item.kind === "hold") {
      forward.push(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
        SELECT ${quote(item.listingId)}, ${quote(item.evidence.selectedSourceId || null)}, 'dataQualityHoldOpened',
          ${quote(REPAIR_ACTOR)}, ${quote(historyPayload(item, before))},
          ${quote(JSON.stringify({ issueCode: item.issueCode, decision: "hold", reason: item.reason,
            blocksPublication: item.blocksPublication }))}
        WHERE NOT EXISTS (SELECT 1 FROM listing_data_quality_holds
          WHERE listing_id=${quote(item.listingId)} AND issue_code=${quote(item.issueCode)}
            AND state='open' AND evidence_json=${quote(JSON.stringify(item.evidence))});`);
      forward.push(holdUpsert(item, now));
      rollback.push(`UPDATE listing_data_quality_holds SET state='dismissed', blocks_publication=0,
        resolution_json=${quote(JSON.stringify({ action: "planRollback", at: now }))},
        resolved_by=${quote(REPAIR_ACTOR)}, resolved_at=${quote(now)}, updated_at=${quote(now)}
        WHERE listing_id=${quote(item.listingId)} AND issue_code=${quote(item.issueCode)} AND state='open';`);
      continue;
    }

    let after;
    if (item.kind === "repair_monthly") {
      after = {
        ...before,
        trade_type: "lease",
        sale_category: "",
        sale_price: null,
        deposit: item.correction.deposit,
        monthly_rent: item.correction.monthlyRent,
        version: before.version + 1,
        updated_at: now
      };
    } else {
      after = {
        ...before,
        trade_type: "sale",
        sale_category: item.correction.saleCategory,
        sale_price: item.correction.salePrice,
        deposit: 0,
        monthly_rent: 0,
        version: before.version + 1,
        updated_at: now
      };
      forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM listings sale
        WHERE sale.id<>${quote(item.listingId)} AND sale.status<>'deleted' AND sale.trade_type='sale'
          AND ((sale.physical_key<>'' AND sale.physical_key=(SELECT physical_key FROM listings WHERE id=${quote(item.listingId)}))
            OR (sale.address<>'' AND sale.address=(SELECT address FROM listings WHERE id=${quote(item.listingId)})
              AND COALESCE(sale.room,'')=COALESCE((SELECT room FROM listings WHERE id=${quote(item.listingId)}),'')));`);
    }

    forward.push(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
      VALUES (${quote(item.listingId)}, ${quote(item.correction.sourceId)}, 'repairLeaseMarketClassification',
        ${quote(REPAIR_ACTOR)}, ${quote(historyPayload(item, before))},
        ${quote(historyPayload(item, after, { reason: item.reason }))});`);
    forward.push(`UPDATE listings SET ${changedAssignments(before, after)}
      WHERE id=${quote(item.listingId)} AND ${stateWhere(before)};`);
    forward.push(`INSERT INTO ${guard} VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END);`);

    const sourceChanges = [];
    for (const source of item.sources) {
      if (clean(source.source) !== "당근") continue;
      const proof = daangnTradeEvidence(source);
      if (item.kind === "repair_monthly" && !proof.month) continue;
      if (item.kind === "reclassify_sale" && (!proof.buy || proof.hasMonthType)) continue;
      const sourceBefore = sourceState(source);
      const fields = item.kind === "repair_monthly"
        ? { tradeType: "lease", saleCategory: "", salePrice: null,
          deposit: proof.month.deposit, rent: proof.month.rent }
        : { tradeType: "sale", saleCategory: proof.saleCategory, salePrice: proof.buy.price,
          deposit: 0, rent: 0 };
      const sourceAfter = {
        ...sourceBefore,
        trade_type: fields.tradeType,
        sale_category: fields.saleCategory,
        sale_price: fields.salePrice,
        snapshot_hash: "",
        list_snapshot_json: snapshotAfter(source, fields),
        updated_at: now
      };
      forward.push(`INSERT INTO ${guard} SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
        FROM listing_sources WHERE id=${quote(source.id)} AND listing_id=${quote(item.listingId)} AND ${stateWhere(sourceBefore)};`);
      forward.push(`UPDATE listing_sources SET ${changedAssignments(sourceBefore, sourceAfter)}
        WHERE id=${quote(source.id)} AND listing_id=${quote(item.listingId)} AND ${stateWhere(sourceBefore)};`);
      forward.push(`INSERT INTO ${guard} VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END);`);
      sourceChanges.push({ id: clean(source.id), before: sourceBefore, after: sourceAfter });
    }

    forward.push(holdUpsert(item, now, "resolved", {
      action: item.kind,
      preservedListingId: item.listingId,
      correctedAt: now
    }));

    rollback.push(`INSERT INTO ${guard}_rollback SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
      FROM listings WHERE id=${quote(item.listingId)} AND ${stateWhere(after)};`);
    rollback.push(`INSERT INTO listing_history (listing_id, source_id, action, actor_email, before_json, after_json)
      VALUES (${quote(item.listingId)}, ${quote(item.correction.sourceId)}, 'repairLeaseMarketClassificationRollback',
        ${quote(REPAIR_ACTOR)}, ${quote(historyPayload(item, after))},
        ${quote(historyPayload(item, before, { reason: "explicit rollback" }))});`);
    rollback.push(`UPDATE listings SET ${rollbackAssignments(before, after)}
      WHERE id=${quote(item.listingId)} AND ${stateWhere(after)};`);
    rollback.push(`INSERT INTO ${guard}_rollback VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END);`);
    for (const sourceChange of sourceChanges) {
      rollback.push(`INSERT INTO ${guard}_rollback SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END
        FROM listing_sources WHERE id=${quote(sourceChange.id)} AND ${stateWhere(sourceChange.after)};`);
      rollback.push(`UPDATE listing_sources SET ${rollbackAssignments(sourceChange.before, sourceChange.after)}
        WHERE id=${quote(sourceChange.id)} AND ${stateWhere(sourceChange.after)};`);
      rollback.push(`INSERT INTO ${guard}_rollback VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END);`);
    }
    rollback.push(`UPDATE listing_data_quality_holds SET state='open', blocks_publication=1,
      resolution_json=${quote(JSON.stringify({ action: "repairRollback", at: now }))},
      resolved_by='', resolved_at='', updated_at=${quote(now)}
      WHERE listing_id=${quote(item.listingId)} AND issue_code=${quote(item.issueCode)};`);
    expected.push({ listingId: item.listingId, kind: item.kind, before, after,
      customerMatchCount: Number(listing.customer_match_count || 0),
      cloudReferenceCount: Number(listing.cloud_reference_count || 0),
      contactCount: Number(listing.contact_count || 0),
      mediaCount: Number(listing.media_count || 0) });
  }

  forward.push(`DROP TABLE ${guard};`);
  rollback.push(`DROP TABLE ${guard}_rollback;`);
  const forwardSql = `${forward.join("\n")}\n`;
  const rollbackSql = `${rollback.join("\n")}\n`;
  return {
    audit,
    forwardSql,
    rollbackSql,
    expected,
    digest: createHash("sha256").update(forwardSql).digest("hex")
  };
}

function wrangler(root, args) {
  const executable = resolve(root, "node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `wrangler exited ${result.status}`);
  return result.stdout;
}

function queryRemote(root, sql) {
  const output = JSON.parse(wrangler(root, [
    "d1", "execute", "js-map-primary", "--remote", "--json", "--command", sql
  ]));
  if (!Array.isArray(output) || !output[0]?.success) throw new Error("D1 query did not succeed");
  return output[0].results || [];
}

function sqlIds(ids) {
  return ids.map(quote).join(",");
}

function loadDataset(root) {
  const listings = queryRemote(root, `SELECT
      l.id, l.property_id, l.status, l.main_source, l.trade_type, l.sale_category, l.sale_price,
      l.deposit, l.monthly_rent, l.version, l.updated_at, l.address, l.building_name, l.room,
      l.physical_key, l.condition_key,
      (SELECT COUNT(*) FROM customer_matches cm WHERE cm.listing_id=l.id) AS customer_match_count,
      (SELECT COUNT(*) FROM cloud_state cs WHERE instr(cs.value_json,l.id)>0) AS cloud_reference_count,
      (SELECT COUNT(*) FROM listing_contacts lc WHERE lc.listing_id=l.id) AS contact_count,
      (SELECT COUNT(*) FROM listing_media lm WHERE lm.listing_id=l.id) AS media_count,
      (SELECT COUNT(*) FROM listing_history lh WHERE lh.listing_id=l.id) AS history_count,
      (SELECT COUNT(*) FROM listings sale WHERE sale.id<>l.id AND sale.status<>'deleted' AND sale.trade_type='sale'
        AND ((l.physical_key<>'' AND sale.physical_key=l.physical_key)
          OR (l.address<>'' AND sale.address=l.address AND COALESCE(sale.room,'')=COALESCE(l.room,'')
            AND (l.building_name='' OR sale.building_name='' OR sale.building_name=l.building_name)))) AS sale_collision_count
    FROM listings l
    WHERE l.status<>'deleted' AND l.trade_type='lease' AND COALESCE(l.monthly_rent,0)=0
    ORDER BY l.id`);
  if (!listings.length) return { listings, sources: [], history: [] };
  const ids = sqlIds(listings.map((listing) => listing.id));
  const sources = queryRemote(root, `SELECT id, listing_id, source, source_listing_id, active,
      trade_type, sale_category, sale_price, snapshot_hash, list_snapshot_json, raw_json, updated_at
    FROM listing_sources WHERE listing_id IN (${ids}) ORDER BY listing_id, updated_at DESC, id`);
  const history = queryRemote(root, `SELECT listing_id, action FROM listing_history
    WHERE listing_id IN (${ids}) ORDER BY listing_id, id`);
  return { listings, sources, history };
}

function privateDirectory(root, value, name) {
  assert.ok(value && isAbsolute(value), "an absolute private directory is required");
  const destination = resolve(value);
  const pathFromRoot = relative(root, destination);
  assert.ok(pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot),
    "the evidence directory must be outside the repository");
  return resolve(destination, name);
}

function arg(name) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function sanitizedAudit(audit) {
  return {
    summary: audit.summary,
    decisions: audit.decisions.map((item) => ({
      listingId: item.listingId,
      propertyId: item.propertyId,
      kind: item.kind,
      issueCode: item.issueCode,
      blocksPublication: item.blocksPublication,
      reason: item.reason,
      evidence: item.evidence,
      correction: item.correction
    }))
  };
}

function verifyReferences(root, expected) {
  for (const row of expected) {
    const listing = queryRemote(root, `SELECT trade_type,sale_category,sale_price,deposit,monthly_rent,version,updated_at,
        (SELECT COUNT(*) FROM customer_matches cm WHERE cm.listing_id=listings.id) AS customer_match_count,
        (SELECT COUNT(*) FROM cloud_state cs WHERE instr(cs.value_json,listings.id)>0) AS cloud_reference_count,
        (SELECT COUNT(*) FROM listing_contacts lc WHERE lc.listing_id=listings.id) AS contact_count,
        (SELECT COUNT(*) FROM listing_media lm WHERE lm.listing_id=listings.id) AS media_count
      FROM listings WHERE id=${quote(row.listingId)}`)[0];
    assert.ok(listing, `missing repaired listing ${row.listingId}`);
    for (const field of ["trade_type", "sale_category", "sale_price", "deposit", "monthly_rent", "version", "updated_at"]) {
      assert.equal(listing[field], row.after[field], `${row.listingId} ${field}`);
    }
    for (const field of ["customer_match_count", "cloud_reference_count", "contact_count", "media_count"]) {
      assert.equal(Number(listing[field] || 0), Number(row[field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] || 0),
        `${row.listingId} ${field} changed`);
    }
  }
}

function invalidateRepairCaches(root, directory, listingIds = []) {
  const keys = [
    "api-cache/d1-sheet.csv",
    "api-cache/unified-listings-v5-source-aware-review.json",
    "api-cache/operations-dashboard.json",
    "api-cache/revision/listings.json",
    "api-cache/revision/operations.json",
    ...listingIds.map((id) => `api-cache/unified-detail-v5-sale-metadata/${clean(id)}.json`)
  ].filter(Boolean);
  const results = [...new Set(keys)].map((key) => {
    try {
      wrangler(root, ["r2", "object", "delete", `js-map-media/${key}`, "--remote"]);
      return { key, ok: true };
    } catch (error) {
      return { key, ok: false, error: clean(error?.message || error).slice(0, 1_000) };
    }
  });
  writeFileSync(resolve(directory, "cache-invalidation.json"), JSON.stringify(results, null, 2));
  assert.ok(results.every((entry) => entry.ok),
    "database repair succeeded, but one or more query caches were not invalidated; inspect cache-invalidation.json");
  return results;
}

function main() {
  const root = resolve(import.meta.dirname, "..");
  const applyPlan = arg("--apply-plan");
  if (applyPlan) {
    const directory = privateDirectory(root, applyPlan, ".");
    const repairFile = resolve(directory, "repair.sql");
    const manifestFile = resolve(directory, "manifest.json");
    assert.ok(existsSync(repairFile) && existsSync(manifestFile), "repair.sql and manifest.json are required");
    const repairSql = readFileSync(repairFile, "utf8");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    const digest = createHash("sha256").update(repairSql).digest("hex");
    assert.equal(digest, manifest.digest, "the reviewed SQL no longer matches its manifest");
    assert.equal(arg("--confirm"), digest, "pass --confirm=<manifest digest> to execute the exact reviewed plan");
    assert.ok(queryRemote(root, "SELECT name FROM sqlite_master WHERE type='table' AND name='listing_data_quality_holds'").length,
      "apply migration 0020 before this plan");
    const result = wrangler(root, ["d1", "execute", "js-map-primary", "--remote", "--file", repairFile, "--yes", "--json"]);
    writeFileSync(resolve(directory, "apply-result.json"), result);
    verifyReferences(root, manifest.expected || []);
    const cacheResults = invalidateRepairCaches(root, directory,
      manifest.affectedListingIds || (manifest.expected || []).map((row) => row.listingId));
    writeFileSync(resolve(directory, "verified.json"), JSON.stringify({ verifiedAt: new Date().toISOString(),
      repaired: (manifest.expected || []).length, cachesInvalidated: cacheResults.length }, null, 2));
    console.log(JSON.stringify({ mode: "applied-and-verified", digest, repaired: (manifest.expected || []).length,
      plan: directory }, null, 2));
    return;
  }

  const backupRoot = arg("--backup");
  const directory = privateDirectory(root, backupRoot,
    `lease-market-repair-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(directory, { recursive: true });
  const dataset = loadDataset(root);
  const plan = buildLeaseMarketRepairSql(dataset);
  writeFileSync(resolve(directory, "evidence-private.json"), JSON.stringify(dataset, null, 2));
  writeFileSync(resolve(directory, "audit.json"), JSON.stringify(sanitizedAudit(plan.audit), null, 2));
  writeFileSync(resolve(directory, "repair.sql"), plan.forwardSql);
  writeFileSync(resolve(directory, "rollback.sql"), plan.rollbackSql);
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify({
    digest: plan.digest,
    createdAt: new Date().toISOString(),
    database: "js-map-primary",
    expected: plan.expected,
    affectedListingIds: plan.audit.decisions.map((item) => item.listingId),
    preservation: {
      hardDeletes: false,
      listingIdsChanged: false,
      memosChanged: false,
      customerMatchesChanged: false,
      cloudStateChanged: false,
      contactsChanged: false,
      mediaChanged: false,
      historyDeleted: false
    }
  }, null, 2));
  console.log(JSON.stringify({ mode: "dry-run", plan: directory, digest: plan.digest,
    candidates: dataset.listings.length, summary: plan.audit.summary,
    autoRepairs: plan.expected.length,
    instruction: `Review audit.json and repair.sql, then use --apply-plan=${directory} --confirm=${plan.digest}`
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();

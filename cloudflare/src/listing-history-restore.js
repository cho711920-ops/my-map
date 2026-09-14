// Restore only explicitly selected business fields. Source evidence and quality holds
// are deliberately outside this allowlist and are never modified here.
const FIELDS = ["title", "building_name", "room", "deposit", "monthly_rent", "maintenance_fee",
  "premium", "area_m2", "landlord_phone", "tenant_phone", "operating_memo", "contacts_json", "status"];
const ACTIONS = new Set(["updateProperty", "updatePropertyMemo", "toggleDone", "deleteProperty"]);
const clean = (value) => String(value ?? "").trim();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
function json(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function authorize(user) {
  if (!["owner", "admin"].includes(clean(user?.role))) throw failure("관리자만 변경이력을 복구할 수 있습니다.", 403);
}

export function historyRestoreFields(history, listing) {
  const before = json(history.before_json), after = json(history.after_json);
  return FIELDS.filter((field) => own(before, field) && own(after, field) && !equal(before[field], after[field]))
    .map((field) => ({ field, current: listing[field] ?? null, target: before[field] ?? null,
      recordedAfter: after[field] ?? null, changedSinceHistory: !equal(listing[field], after[field]),
      alreadyRestored: equal(listing[field], before[field]) }));
}

async function context(env, user, input) {
  authorize(user);
  const id = Number(input.historyId);
  if (!Number.isSafeInteger(id) || id <= 0) throw failure("변경이력 번호가 올바르지 않습니다.");
  const history = await env.DB.prepare(`SELECT id, listing_id, action, before_json, after_json
    FROM listing_history WHERE id=?1 LIMIT 1`).bind(id).first();
  if (!history || !ACTIONS.has(clean(history.action))) throw failure("복구할 수 있는 변경이력이 아닙니다.");
  const listing = await env.DB.prepare(`SELECT * FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1`)
    .bind(clean(history.listing_id)).first();
  if (!listing) throw failure("복구 대상 매물을 찾을 수 없습니다.", 404);
  return { history, listing, fields: historyRestoreFields(history, listing) };
}

export async function previewListingHistoryRestore(env, user, query) {
  const { history, listing, fields } = await context(env, user, query);
  return { ok: true, historyId: history.id, propertyId: listing.property_id || listing.id,
    expectedVersion: Number(listing.version) || 0, title: listing.title || listing.address || "매물", fields };
}

export async function restoreSelectedListingHistory(env, user, body) {
  const { history, listing, fields } = await context(env, user, body);
  const expectedVersion = body.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw failure("현재 값을 다시 확인한 뒤 복구해 주세요.");
  if (expectedVersion !== Number(listing.version || 0)) throw failure("다른 작업에서 매물이 변경되었습니다. 현재 값을 다시 확인해 주세요.", 409);
  const selected = Array.isArray(body.fields) ? [...new Set(body.fields)] : [];
  if (!selected.length || selected.some((key) => !fields.some((entry) => entry.field === key))) {
    throw failure("복구할 항목을 하나 이상 선택해 주세요.");
  }
  const changes = fields.filter((entry) => selected.includes(entry.field));
  if (changes.some((entry) => !own(body.expectedValues || {}, entry.field) || !equal(body.expectedValues[entry.field], entry.current))) {
    throw failure("비교했던 현재 값이 달라졌습니다. 다시 확인한 뒤 복구해 주세요.", 409);
  }
  if (changes.every((entry) => entry.alreadyRestored)) throw failure("선택한 항목은 이미 같은 값입니다.");
  const values = changes.map((entry) => entry.target);
  const assignments = changes.map((entry, i) => `${entry.field}=?${i + 1}`);
  const now = new Date().toISOString();
  values.push(now, listing.id, expectedVersion);
  const nowIndex = values.length - 2, idIndex = values.length - 1, versionIndex = values.length;
  const checks = changes.map((entry) => { values.push(entry.current); return `${entry.field} IS ?${values.length}`; });
  const after = Object.assign({}, listing, Object.fromEntries(changes.map((entry) => [entry.field, entry.target])),
    { version: expectedVersion + 1, updated_at: now });
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET ${assignments.join(", ")}, version=version+1, updated_at=?${nowIndex}
      WHERE id=?${idIndex} AND version=?${versionIndex} AND ${checks.join(" AND ")}`).bind(...values),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      SELECT ?1, 'restoreListingHistory', ?2, ?3, ?4 WHERE changes()=1`)
      .bind(listing.id, clean(user.email), JSON.stringify(listing), JSON.stringify(after))
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1) throw failure("동시에 매물이 변경되어 복구하지 않았습니다. 현재 값을 다시 확인해 주세요.", 409);
  const activeDelta = clean(listing.status) === "deleted" && clean(after.status) !== "deleted" ? 1
    : clean(listing.status) !== "deleted" && clean(after.status) === "deleted" ? -1 : 0;
  return { ok: true, persisted: true, action: "restoreListingHistory", historyId: history.id,
    propertyId: listing.property_id || listing.id, restoredFields: selected,
    operationAdjustments: { activeMaster: activeDelta, history: 1 }, source: "D1" };
}

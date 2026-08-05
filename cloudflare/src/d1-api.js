const UNIFIED_FIELDS = [
  "originalId", "source", "link", "room", "deposit", "rent", "fee", "premium", "area",
  "thumbnail", "photoCount", "contactCount", "revision"
];

const D1_GET_ACTIONS = new Set([
  "announcement", "checkDuplicate", "geocodeCache", "loadCloudState", "mutationStatus",
  "tellContacts", "unifiedListingContacts", "unifiedListingDetail", "unifiedListings",
  "workQueueStatus", "customerWorkspace", "customerMatches", "operationsDashboard"
]);

const D1_POST_ACTIONS = new Set([
  "deleteProperty", "enqueueMutation", "moveOriginalListing", "quickAdd", "saveCloudState",
  "saveGeocodeCache", "toggleDone", "updateProperty", "updatePropertyMemo", "saveCustomer",
  "updateCustomerMatch", "rebuildCustomerMatches", "addCustomerActivity"
]);

const CUSTOMER_HEADERS = [
  "고객명/상호", "연락처", "상태", "희망지역", "희망구분", "보증금최소", "보증금최대",
  "월세최소", "월세최대", "권리금최대", "평수최소", "평수최대", "최저층", "최고층",
  "필수태그", "선호태그", "제외태그", "요청사항", "담당자", "조건버전", "등록일시",
  "수정일시", "고객ID"
];

const MATCH_HEADERS = [
  "매칭ID", "고객ID", "대표매물ID", "점수", "진행상태", "최초매칭일시", "연락일시",
  "메모", "수정일시"
];

const ACTIVITY_HEADERS = [
  "상담ID", "고객ID", "일시", "단계", "출처", "상담내용", "다음연락일", "담당자"
];

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function propertyIdFrom(body) {
  return clean(body?.key?.propertyId || body?.propertyId || body?.listingId).slice(0, 100);
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function allPages(env, sql, pageSize = 4_000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await env.DB.prepare(`${sql} LIMIT ?1 OFFSET ?2`).bind(pageSize, offset).all();
    const page = result?.results || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export function isD1GetAction(action) {
  return D1_GET_ACTIONS.has(clean(action));
}

export function isD1PostAction(action) {
  return D1_POST_ACTIONS.has(clean(action));
}

export async function buildD1SheetCsv(env) {
  const rows = await allPages(env, `SELECT
    title, address, room, listing_type, deposit, monthly_rent, maintenance_fee, premium, area_m2,
    landlord_phone, tenant_phone, operating_memo, status, first_collected_at, main_source,
    property_id, source_url, contacts_json, building_year, building_elevators,
    building_approval_date, building_info_checked_at, building_info_status, registration_at,
    last_collected_at
  FROM listings WHERE status <> 'deleted' ORDER BY rowid`, 3_000);
  const header = [
    "건물명", "주소", "호실", "구분", "보증금", "월세", "관리비", "권리금", "평수",
    "임대인연락처", "임차인연락처", "메모", "상태", "등록일", "출처", "매물ID", "원본링크",
    "연락처목록", "준공연도", "승강기", "사용승인일", "건축물확인일", "건축물상태", "등록시각",
    "최종수집시각"
  ];
  const body = [header, ...rows.map((row) => [
    row.title, row.address, row.room, row.listing_type, row.deposit, row.monthly_rent,
    row.maintenance_fee, row.premium, row.area_m2, row.landlord_phone, row.tenant_phone,
    row.operating_memo, row.status, row.first_collected_at, row.main_source, row.property_id,
    row.source_url, row.contacts_json, row.building_year, row.building_elevators,
    row.building_approval_date, row.building_info_checked_at, row.building_info_status,
    row.registration_at, row.last_collected_at
  ])].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `${body}\r\n`;
}

async function unifiedListings(env) {
  const rows = await allPages(env, `SELECT listing_id, list_snapshot_json
    FROM listing_sources WHERE active = 1 ORDER BY listing_id, rowid`, 4_000);
  const groups = {};
  for (const row of rows) {
    const original = parseJson(row.list_snapshot_json, {});
    const propertyId = clean(row.listing_id || original.propertyId);
    if (!propertyId) continue;
    if (!groups[propertyId]) groups[propertyId] = [];
    const values = UNIFIED_FIELDS.map((field) => original[field] ?? "");
    while (values.length && values[values.length - 1] === "") values.pop();
    groups[propertyId].push(values);
  }
  return {
    ok: true,
    version: 2,
    format: "compact-v2",
    fields: UNIFIED_FIELDS,
    groups,
    originalCount: rows.length,
    source: "D1"
  };
}

async function unifiedDetail(env, propertyId) {
  const sourceResult = await env.DB.prepare(`SELECT id, list_snapshot_json, raw_json
    FROM listing_sources WHERE listing_id = ?1 AND active = 1 ORDER BY rowid`).bind(propertyId).all();
  const mediaResult = await env.DB.prepare(`SELECT source_id, external_url, r2_key, thumbnail_r2_key, sort_order
    FROM listing_media WHERE listing_id = ?1 AND status <> 'deleted' ORDER BY source_id, sort_order, rowid`)
    .bind(propertyId).all();
  const mediaBySource = {};
  for (const media of mediaResult?.results || []) {
    const sourceId = clean(media.source_id);
    if (!mediaBySource[sourceId]) mediaBySource[sourceId] = [];
    const url = clean(media.external_url);
    if (url && !mediaBySource[sourceId].includes(url)) mediaBySource[sourceId].push(url);
  }
  const originals = (sourceResult?.results || []).map((row) => {
    const snapshot = {
      ...parseJson(row.list_snapshot_json, {}),
      ...parseJson(row.raw_json, {})
    };
    const images = mediaBySource[clean(row.id)] || [];
    if (images.length) snapshot.images = images;
    snapshot.photoCount = Math.max(images.length, Number(snapshot.photoCount) || 0);
    return snapshot;
  });
  return { ok: true, action: "unifiedListingDetail", propertyId, originals, source: "D1" };
}

async function listingContacts(env, propertyId) {
  const result = await env.DB.prepare(`SELECT id, role, name, phone, normalized_phone, status,
    first_seen_at, last_seen_at FROM listing_contacts
    WHERE listing_id = ?1 AND status <> 'deleted' ORDER BY rowid`).bind(propertyId).all();
  const contacts = (result?.results || []).map((row) => ({
    id: row.id,
    role: row.role,
    name: row.name,
    phone: row.phone,
    normalizedPhone: row.normalized_phone,
    status: row.status,
    firstSeen: row.first_seen_at,
    lastSeen: row.last_seen_at
  }));
  return { ok: true, action: "unifiedListingContacts", propertyId, contactCount: contacts.length, contacts };
}

async function tellContacts(env, query) {
  const pattern = `%${clean(query).slice(0, 100)}%`;
  const result = await env.DB.prepare(`SELECT c.id, c.listing_id, c.role, c.name, c.phone,
      l.title, l.address, l.room
    FROM listing_contacts c JOIN listings l ON l.id = c.listing_id
    WHERE c.status <> 'deleted' AND (
      c.phone LIKE ?1 OR c.normalized_phone LIKE ?1 OR c.name LIKE ?1 OR
      l.title LIKE ?1 OR l.address LIKE ?1 OR l.room LIKE ?1
    ) ORDER BY c.last_seen_at DESC LIMIT 100`).bind(pattern).all();
  return {
    ok: true,
    action: "tellContacts",
    query: clean(query),
    contacts: (result?.results || []).map((row) => ({
      id: row.id,
      propertyId: row.listing_id,
      role: row.role,
      name: row.name,
      phone: row.phone,
      buildingName: row.title,
      address: row.address,
      room: row.room
    }))
  };
}

async function geocodeCache(env) {
  const rows = await allPages(env, `SELECT cache_key, address, latitude, longitude, checked_at
    FROM geocode_cache ORDER BY cache_key`, 4_000);
  const entries = {};
  for (const row of rows) {
    const key = clean(row.address || row.cache_key);
    if (!key) continue;
    entries[key] = { lat: Number(row.latitude), lng: Number(row.longitude), savedAt: row.checked_at };
  }
  return { ok: true, action: "geocodeCache", count: rows.length, entries, source: "D1" };
}

async function cloudState(env, user, query) {
  const scope = clean(query.scope).slice(0, 100);
  const recordKey = clean(query.recordKey || "default").slice(0, 100);
  const row = await env.DB.prepare(`SELECT value_json, version, updated_at FROM cloud_state
    WHERE owner_email = ?1 AND scope = ?2 AND record_key = ?3`)
    .bind(clean(user?.email).toLowerCase(), scope, recordKey).first();
  return row
    ? { ok: true, action: "loadCloudState", found: true, scope, recordKey,
      data: parseJson(row.value_json, null), version: row.version, updatedAt: row.updated_at }
    : { ok: true, action: "loadCloudState", found: false, scope, recordKey, data: null, version: 0 };
}

async function announcement(env) {
  const row = await env.DB.prepare(`SELECT id, title, body, starts_at, ends_at, updated_at
    FROM announcements WHERE active = 1
      AND (starts_at = '' OR datetime(starts_at) <= datetime('now'))
      AND (ends_at = '' OR datetime(ends_at) >= datetime('now'))
    ORDER BY updated_at DESC LIMIT 1`).first();
  return { ok: true, action: "announcement", announcement: row || null, source: "D1" };
}

async function duplicateCheck(env, values) {
  const row = Array.isArray(values) ? values : [];
  const address = clean(row[1]);
  const room = clean(row[2]);
  const deposit = number(row[4]);
  const rent = number(row[5]);
  const exact = await env.DB.prepare(`SELECT property_id, title, address, room, deposit, monthly_rent
    FROM listings WHERE status <> 'deleted' AND address = ?1 AND room = ?2
      AND COALESCE(deposit, 0) = COALESCE(?3, 0) AND COALESCE(monthly_rent, 0) = COALESCE(?4, 0)
    LIMIT 1`).bind(address, room, deposit, rent).first();
  const similar = exact || await env.DB.prepare(`SELECT property_id, title, address, room, deposit, monthly_rent
    FROM listings WHERE status <> 'deleted' AND address = ?1 LIMIT 1`).bind(address).first();
  const existing = similar ? {
    propertyId: similar.property_id,
    name: similar.title,
    address: similar.address,
    room: similar.room,
    deposit: similar.deposit,
    rent: similar.monthly_rent
  } : null;
  return { ok: true, action: "checkDuplicate", duplicateType: exact ? "exact" : similar ? "similar" : "none", existing };
}

async function mutationStatus(env, requestId) {
  const row = await env.DB.prepare(`SELECT state, result_json FROM mutation_results WHERE request_id = ?1`)
    .bind(clean(requestId).slice(0, 160)).first();
  if (!row) return { ok: true, ready: false, requestId: clean(requestId) };
  return { ok: true, ready: row.state === "completed", requestId: clean(requestId), result: parseJson(row.result_json, {}) };
}

async function workQueueStatus(env, user) {
  const result = await env.DB.prepare(`SELECT request_id, action, state, result_json, created_at
    FROM mutation_results WHERE owner_email = ?1 ORDER BY created_at DESC LIMIT 30`)
    .bind(clean(user?.email).toLowerCase()).all();
  const jobs = (result?.results || []).map((row) => ({
    requestId: row.request_id,
    action: row.action,
    state: row.state,
    result: parseJson(row.result_json, {}),
    createdAt: row.created_at
  }));
  return {
    ok: true,
    action: "workQueueStatus",
    completed: jobs.filter((job) => job.state === "completed").length,
    processing: 0,
    pending: 0,
    failed: jobs.filter((job) => job.state === "failed").length,
    jobs,
    source: "D1"
  };
}

function requirementsFromCustomer(row) {
  return parseJson(row?.requirements_json, {});
}

function customerRow(row) {
  const requirements = requirementsFromCustomer(row);
  return [
    row.name || "", row.phone || "", row.status || "미팅전", requirements.regions || "",
    requirements.types || "", requirements.depositMin || "", requirements.depositMax || "",
    requirements.rentMin || "", requirements.rentMax || "", requirements.premiumMax || "",
    requirements.areaMin || "", requirements.areaMax || "", requirements.floorMin || "",
    requirements.floorMax || "", requirements.requiredTags || "", requirements.preferredTags || "",
    requirements.excludedTags || "", row.memo || "", requirements.manager || "",
    Number(requirements.conditionVersion) || 1, row.created_at || "", row.updated_at || "", row.id || ""
  ];
}

function displayMatchState(value) {
  const state = clean(value);
  if (state === "candidate") return "신규";
  if (state === "introduced") return "소개";
  if (state === "held") return "보류";
  return state || "신규";
}

function matchId(customerId, listingId) {
  return `CM-${clean(customerId)}-${clean(listingId)}`;
}

function matchRow(row) {
  return [
    matchId(row.customer_id, row.listing_id), row.customer_id || "", row.property_id || row.listing_id || "",
    Math.round(Number(row.score) || 0), displayMatchState(row.state), row.created_at || "",
    row.contacted_at || "", row.memo || "", row.updated_at || ""
  ];
}

function activityRow(row) {
  return [
    row.id || "", row.customer_id || "", row.created_at || "", row.stage || "", row.source || "",
    row.memo || "", row.next_contact_date || "", row.actor_email || ""
  ];
}

async function customerRecords(env) {
  return allPages(env, `SELECT id, name, phone, status, requirements_json, memo, created_at, updated_at
    FROM customers ORDER BY updated_at DESC, created_at DESC`, 1_000);
}

async function customerMatchRecords(env, customerId = "") {
  const id = clean(customerId);
  const result = id
    ? await env.DB.prepare(`SELECT m.customer_id, m.listing_id, m.state, m.score, m.memo,
        m.created_at, m.updated_at, '' AS contacted_at, l.property_id
      FROM customer_matches m JOIN listings l ON l.id=m.listing_id
      WHERE m.customer_id=?1 AND l.status <> 'deleted'
      ORDER BY m.score DESC, m.updated_at DESC LIMIT 800`).bind(id).all()
    : await env.DB.prepare(`SELECT m.customer_id, m.listing_id, m.state, m.score, m.memo,
        m.created_at, m.updated_at, '' AS contacted_at, l.property_id
      FROM customer_matches m JOIN listings l ON l.id=m.listing_id
      WHERE l.status <> 'deleted' ORDER BY m.updated_at DESC LIMIT 3000`).all();
  return result?.results || [];
}

async function activityRecords(env) {
  return allPages(env, `SELECT id, customer_id, stage, source, memo, next_contact_date, actor_email, created_at
    FROM customer_activities ORDER BY created_at ASC`, 1_000);
}

function summarizeMatches(rows) {
  const byCustomer = {};
  for (const row of rows) {
    const id = clean(row.customer_id);
    if (!byCustomer[id]) byCustomer[id] = { customerId: id, total: 0, fresh: 0, introduced: 0, held: 0, overdue: 0 };
    const item = byCustomer[id];
    const state = displayMatchState(row.state);
    item.total += 1;
    if (state === "신규") item.fresh += 1;
    if (state === "소개") item.introduced += 1;
    if (state === "보류") item.held += 1;
    if (state === "신규" && !row.contacted_at && Date.now() - Date.parse(row.created_at || 0) >= 3 * 86400000) {
      item.overdue += 1;
    }
  }
  return Object.values(byCustomer);
}

async function customerWorkspace(env, requestedCustomerId = "") {
  const customers = await customerRecords(env);
  const selectedCustomerId = clean(requestedCustomerId) || clean(customers[0]?.id);
  const [allMatches, activities] = await Promise.all([
    customerMatchRecords(env),
    activityRecords(env)
  ]);
  const selectedMatches = selectedCustomerId
    ? allMatches.filter((row) => clean(row.customer_id) === selectedCustomerId)
    : [];
  return {
    ok: true,
    action: "customerWorkspace",
    customerHeaders: CUSTOMER_HEADERS,
    customers: customers.map(customerRow),
    matchHeaders: MATCH_HEADERS,
    matches: selectedMatches.map(matchRow),
    matchSummary: summarizeMatches(allMatches),
    activityHeaders: ACTIVITY_HEADERS,
    activities: activities.map(activityRow),
    selectedCustomerId,
    contactReminderDays: 3,
    source: "D1"
  };
}

async function customerMatches(env, customerId) {
  const rows = await customerMatchRecords(env, customerId);
  return { ok: true, action: "customerMatches", headers: MATCH_HEADERS, rows: rows.map(matchRow), source: "D1" };
}

async function operationsDashboard(env) {
  const result = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM listings WHERE status <> 'deleted') AS active_master,
      (SELECT COUNT(*) FROM listing_sources WHERE active=1) AS raw_count,
      (SELECT COUNT(*) FROM collector_raw WHERE processing_state IN ('pending','review')) AS pending_review,
      (SELECT COUNT(*) FROM customers WHERE status NOT IN ('계약완료','종료')) AS open_customers,
      (SELECT COUNT(*) FROM customer_matches WHERE state IN ('candidate','신규')) AS new_matches,
      (SELECT COUNT(*) FROM customer_matches WHERE state IN ('introduced','소개')) AS introduced_matches,
      (SELECT COUNT(*) FROM customer_matches WHERE state IN ('candidate','신규')
        AND datetime(created_at) <= datetime('now','-3 days')) AS overdue_matches,
      (SELECT COUNT(*) FROM customer_activities WHERE next_contact_date <> ''
        AND date(next_contact_date) <= date('now')) AS due_followups,
      (SELECT COUNT(*) FROM listing_sources WHERE active=1 AND missing_count >= 3) AS transaction_candidates,
      (SELECT COUNT(*) FROM listing_history) AS history_count`).first();
  const customerSummary = await env.DB.prepare(`SELECT customer_id,
      SUM(CASE WHEN state IN ('candidate','신규') THEN 1 ELSE 0 END) AS fresh,
      SUM(CASE WHEN state IN ('candidate','신규') AND datetime(created_at) <= datetime('now','-3 days') THEN 1 ELSE 0 END) AS overdue
    FROM customer_matches GROUP BY customer_id`).all();
  return {
    ok: true,
    action: "operationsDashboard",
    activeMaster: Number(result?.active_master) || 0,
    master: Number(result?.active_master) || 0,
    raw: Number(result?.raw_count) || 0,
    pendingReview: Number(result?.pending_review) || 0,
    review: Number(result?.pending_review) || 0,
    openCustomers: Number(result?.open_customers) || 0,
    customers: Number(result?.open_customers) || 0,
    newMatches: Number(result?.new_matches) || 0,
    matches: Number(result?.new_matches) || 0,
    introducedMatches: Number(result?.introduced_matches) || 0,
    overdueMatches: Number(result?.overdue_matches) || 0,
    dueFollowups: Number(result?.due_followups) || 0,
    transactionCheckCandidates: Number(result?.transaction_candidates) || 0,
    history: Number(result?.history_count) || 0,
    newMatchCustomers: (customerSummary?.results || []).filter((row) => Number(row.fresh) > 0).length,
    overdueCustomers: (customerSummary?.results || []).filter((row) => Number(row.overdue) > 0).length,
    contactReminderDays: 3,
    source: "D1"
  };
}

export async function handleD1GetAction(env, user, query) {
  const action = clean(query.action);
  if (!env.DB || !isD1GetAction(action)) return null;
  if (action === "unifiedListings") return unifiedListings(env);
  if (action === "unifiedListingDetail") return unifiedDetail(env, clean(query.propertyId).slice(0, 100));
  if (action === "unifiedListingContacts") return listingContacts(env, clean(query.propertyId).slice(0, 100));
  if (action === "tellContacts") return tellContacts(env, query.query);
  if (action === "geocodeCache") return geocodeCache(env);
  if (action === "loadCloudState") return cloudState(env, user, query);
  if (action === "announcement") return announcement(env);
  if (action === "checkDuplicate") return duplicateCheck(env, parseJson(query.values, []));
  if (action === "mutationStatus") return mutationStatus(env, query.requestId);
  if (action === "workQueueStatus") return workQueueStatus(env, user);
  if (action === "customerWorkspace") return customerWorkspace(env, query.customerId);
  if (action === "customerMatches") return customerMatches(env, query.customerId);
  if (action === "operationsDashboard") return operationsDashboard(env);
  return null;
}

async function recordMutation(env, user, action, requestId, result, state = "completed") {
  const id = clean(requestId || `${action}-${crypto.randomUUID()}`).slice(0, 160);
  await env.DB.prepare(`INSERT INTO mutation_results (
      request_id, owner_email, action, state, result_json, created_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now', '+7 days'))
    ON CONFLICT(request_id) DO UPDATE SET state=excluded.state, result_json=excluded.result_json`)
    .bind(id, clean(user?.email).toLowerCase(), action, state, JSON.stringify(result || {}), new Date().toISOString()).run();
  return id;
}

async function updateProperty(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const before = await env.DB.prepare("SELECT * FROM listings WHERE property_id = ?1").bind(propertyId).first();
  if (!before) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  const value = body.updated && typeof body.updated === "object" ? body.updated : {};
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE listings SET
      title=?1, building_name=?1, room=?2, deposit=?3, monthly_rent=?4, maintenance_fee=?5,
      premium=?6, area_m2=?7, landlord_phone=?8, tenant_phone=?9, operating_memo=?10,
      status=?11, contacts_json=?12, version=version+1, updated_at=?13 WHERE property_id=?14`)
      .bind(clean(value.name), clean(value.room), number(value.deposit), number(value.rent), number(value.fee),
        number(value.premium), number(value.area), clean(value.landlordPhone), clean(value.tenantPhone),
        clean(value.memo), clean(value.state) || "active", JSON.stringify(value.contacts || []), now, propertyId),
    env.DB.prepare(`INSERT INTO listing_history (listing_id, action, actor_email, before_json, after_json)
      VALUES (?1, 'updateProperty', ?2, ?3, ?4)`)
      .bind(propertyId, clean(user?.email), JSON.stringify(before), JSON.stringify(value))
  ]);
  return { ok: true, persisted: true, queued: false, propertyId, updated: value, source: "D1" };
}

async function updateMemo(env, user, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const result = await env.DB.prepare(`UPDATE listings SET operating_memo=?1, contacts_json=?2,
    version=version+1, updated_at=?3 WHERE property_id=?4`)
    .bind(clean(body.memo), JSON.stringify(body.contacts || []), new Date().toISOString(), propertyId).run();
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  return { ok: true, persisted: true, queued: false, propertyId, memo: clean(body.memo), contacts: body.contacts || [], source: "D1" };
}

async function toggleDone(env, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const result = await env.DB.prepare(`UPDATE listings SET status=?1, operating_memo=?2,
    version=version+1, updated_at=?3 WHERE property_id=?4`)
    .bind(clean(body.state) || "active", clean(body.memo), new Date().toISOString(), propertyId).run();
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  return { ok: true, persisted: true, queued: false, propertyId, state: clean(body.state), memo: clean(body.memo), source: "D1" };
}

async function deleteProperty(env, body) {
  const propertyId = propertyIdFrom(body);
  if (!propertyId) throw Object.assign(new Error("매물ID가 없습니다."), { statusCode: 400 });
  const result = await env.DB.prepare(`UPDATE listings SET status='deleted', version=version+1, updated_at=?1
    WHERE property_id=?2`).bind(new Date().toISOString(), propertyId).run();
  if (!Number(result?.meta?.changes || 0)) throw Object.assign(new Error("매물을 찾을 수 없습니다."), { statusCode: 404 });
  return { ok: true, persisted: true, queued: false, deleted: true, propertyId, source: "D1" };
}

async function quickAdd(env, body) {
  const values = Array.isArray(body.values) ? body.values : [];
  const duplicate = await duplicateCheck(env, values);
  if (duplicate.duplicateType !== "none" && !body.forceDuplicate) {
    return { ...duplicate, persisted: false };
  }
  const propertyId = clean(values[15]) || `M-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO listings (
    id, property_id, status, main_source, title, address, building_name, room, listing_type,
    deposit, monthly_rent, maintenance_fee, premium, area_m2, landlord_phone, tenant_phone,
    operating_memo, first_collected_at, source_url, contacts_json, registration_at, last_collected_at, updated_at
  ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
    ?15, ?16, ?17, ?18, ?19, ?20, ?20)`)
    .bind(propertyId, clean(values[12]) || "active", clean(values[14]) || "직접등록", clean(values[0]),
      clean(values[1]), clean(values[2]), clean(values[3]), number(values[4]), number(values[5]),
      number(values[6]), number(values[7]), number(values[8]), clean(values[9]), clean(values[10]),
      clean(values[11]), clean(values[13]) || now, clean(values[16]), clean(values[17]) || "[]",
      clean(values[23]) || now, clean(values[24]) || now).run();
  return { ok: true, persisted: true, queued: false, propertyId, source: "D1" };
}

async function saveCloudState(env, user, body) {
  const owner = clean(user?.email).toLowerCase();
  const scope = clean(body.scope).slice(0, 100);
  const recordKey = clean(body.recordKey || "default").slice(0, 100);
  const version = Math.max(1, Number(body.version) || Date.now());
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO cloud_state (owner_email, scope, record_key, value_json, version, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(owner_email, scope, record_key) DO UPDATE SET
      value_json=excluded.value_json, version=excluded.version, updated_at=excluded.updated_at`)
    .bind(owner, scope, recordKey, JSON.stringify(body.data ?? null), version, now).run();
  return { ok: true, persisted: true, queued: false, scope, recordKey, version, updatedAt: now, source: "D1" };
}

async function saveGeocode(env, body) {
  const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 500);
  if (!entries.length) return { ok: true, persisted: true, saved: 0, source: "D1" };
  const now = new Date().toISOString();
  const statements = entries.map((entry) => {
    const address = clean(entry.address);
    return env.DB.prepare(`INSERT INTO geocode_cache (
      cache_key, address, latitude, longitude, provider, payload_json, checked_at
    ) VALUES (?1, ?1, ?2, ?3, 'kakao', ?4, ?5)
    ON CONFLICT(cache_key) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude,
      payload_json=excluded.payload_json, checked_at=excluded.checked_at`)
      .bind(address, number(entry.lat), number(entry.lng), JSON.stringify(entry), now);
  });
  await env.DB.batch(statements);
  return { ok: true, persisted: true, saved: statements.length, source: "D1" };
}

async function moveOriginal(env, body) {
  const originalId = clean(body.originalId).slice(0, 160);
  const targetMasterId = clean(body.targetMasterId).slice(0, 100);
  const source = await env.DB.prepare("SELECT listing_id FROM listing_sources WHERE id=?1").bind(originalId).first();
  const target = await env.DB.prepare("SELECT id FROM listings WHERE id=?1 AND status <> 'deleted'").bind(targetMasterId).first();
  if (!source || !target) throw Object.assign(new Error("이동할 원본매물 또는 대상매물을 찾을 수 없습니다."), { statusCode: 404 });
  await env.DB.batch([
    env.DB.prepare("UPDATE listing_sources SET listing_id=?1, updated_at=?2 WHERE id=?3")
      .bind(targetMasterId, new Date().toISOString(), originalId),
    env.DB.prepare("UPDATE listing_media SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
      .bind(targetMasterId, new Date().toISOString(), originalId),
    env.DB.prepare("UPDATE listing_contacts SET listing_id=?1, updated_at=?2 WHERE source_id=?3")
      .bind(targetMasterId, new Date().toISOString(), originalId)
  ]);
  return { ok: true, persisted: true, queued: false, originalId, sourceMasterId: source.listing_id, targetMasterId, source: "D1" };
}

function splitRequirement(value) {
  return clean(value).split(/[,/|]/).map((item) => item.trim()).filter(Boolean);
}

function nullableRequirementNumber(value) {
  const valueText = clean(value);
  if (!valueText) return null;
  const parsed = Number(valueText.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function listingFloor(row) {
  const source = clean(row.floor || row.room);
  const basement = source.match(/B\s*(\d+)|지하\s*(\d*)/i);
  if (basement) return -(Number(basement[1] || basement[2]) || 1);
  const matched = source.match(/(-?\d+)\s*층/);
  return matched ? Number(matched[1]) : null;
}

function evaluateCustomerListing(requirements, row) {
  const regions = splitRequirement(requirements.regions);
  const types = splitRequirement(requirements.types);
  const requiredTags = splitRequirement(requirements.requiredTags);
  const preferredTags = splitRequirement(requirements.preferredTags);
  const excludedTags = splitRequirement(requirements.excludedTags);
  const searchable = [row.title, row.address, row.road_address, row.building_name, row.listing_type,
    row.operating_memo, row.search_tags].map(clean).join(" ").toLowerCase();
  if (regions.length && !regions.some((item) => searchable.includes(item.toLowerCase()))) return null;
  if (types.length && !types.some((item) => searchable.includes(item.toLowerCase()))) return null;
  if (requiredTags.some((item) => !searchable.includes(item.toLowerCase()))) return null;
  if (excludedTags.some((item) => searchable.includes(item.toLowerCase()))) return null;

  const deposit = Number(row.deposit) || 0;
  const rent = Number(row.monthly_rent) || 0;
  const premium = Number(row.premium) || 0;
  const area = Number(row.area_m2) || 0;
  const floor = listingFloor(row);
  const limits = {
    depositMin: nullableRequirementNumber(requirements.depositMin),
    depositMax: nullableRequirementNumber(requirements.depositMax),
    rentMin: nullableRequirementNumber(requirements.rentMin),
    rentMax: nullableRequirementNumber(requirements.rentMax),
    premiumMax: nullableRequirementNumber(requirements.premiumMax),
    areaMin: nullableRequirementNumber(requirements.areaMin),
    areaMax: nullableRequirementNumber(requirements.areaMax),
    floorMin: nullableRequirementNumber(requirements.floorMin),
    floorMax: nullableRequirementNumber(requirements.floorMax)
  };
  if (limits.depositMin != null && deposit < limits.depositMin) return null;
  if (limits.depositMax != null && deposit > limits.depositMax) return null;
  if (limits.rentMin != null && rent < limits.rentMin) return null;
  if (limits.rentMax != null && rent > limits.rentMax) return null;
  if (limits.premiumMax != null && premium > limits.premiumMax) return null;
  if (limits.areaMin != null && area < limits.areaMin) return null;
  if (limits.areaMax != null && area > limits.areaMax) return null;
  if (limits.floorMin != null && floor != null && floor < limits.floorMin) return null;
  if (limits.floorMax != null && floor != null && floor > limits.floorMax) return null;

  let score = 70;
  if (regions.length) score += 8;
  if (types.length) score += 7;
  if (requiredTags.length) score += Math.min(9, requiredTags.length * 3);
  score += Math.min(6, preferredTags.filter((item) => searchable.includes(item.toLowerCase())).length * 2);
  if (limits.depositMax != null && limits.depositMax > 0) score += Math.max(0, 3 - Math.round(deposit / limits.depositMax * 3));
  if (limits.rentMax != null && limits.rentMax > 0) score += Math.max(0, 3 - Math.round(rent / limits.rentMax * 3));
  return Math.min(100, score);
}

async function rebuildCustomerMatches(env, customerId = "") {
  const requested = clean(customerId);
  const customers = requested
    ? (await env.DB.prepare(`SELECT id, requirements_json FROM customers WHERE id=?1`).bind(requested).all())?.results || []
    : await allPages(env, `SELECT id, requirements_json FROM customers
        WHERE status NOT IN ('계약완료','종료') ORDER BY updated_at DESC`, 500);
  const listings = await allPages(env, `SELECT id, property_id, title, address, road_address, building_name,
      listing_type, floor, room, deposit, monthly_rent, premium, area_m2, operating_memo, search_tags
    FROM listings WHERE status <> 'deleted'`, 3_000);
  let rebuilt = 0;
  let matchCount = 0;
  for (const customer of customers) {
    const requirements = requirementsFromCustomer(customer);
    const candidates = listings.map((listing) => ({ listing, score: evaluateCustomerListing(requirements, listing) }))
      .filter((item) => item.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 800);
    await env.DB.prepare(`DELETE FROM customer_matches
      WHERE customer_id=?1 AND state IN ('candidate','신규')`).bind(customer.id).run();
    const now = new Date().toISOString();
    for (let offset = 0; offset < candidates.length; offset += 50) {
      await env.DB.batch(candidates.slice(offset, offset + 50).map(({ listing, score }) => env.DB.prepare(`INSERT INTO customer_matches (
          customer_id, listing_id, state, score, memo, created_at, updated_at
        ) VALUES (?1, ?2, '신규', ?3, '', ?4, ?4)
        ON CONFLICT(customer_id, listing_id) DO UPDATE SET
          score=excluded.score, updated_at=excluded.updated_at`)
        .bind(customer.id, listing.id, score, now)));
    }
    rebuilt += 1;
    matchCount += candidates.length;
  }
  return { rebuilt, matchCount };
}

function customerRequirementsFromInput(input, previous = {}) {
  return {
    regions: clean(input["희망지역"] ?? previous.regions),
    types: clean(input["희망구분"] ?? previous.types),
    depositMin: clean(input["보증금최소"] ?? previous.depositMin),
    depositMax: clean(input["보증금최대"] ?? previous.depositMax),
    rentMin: clean(input["월세최소"] ?? previous.rentMin),
    rentMax: clean(input["월세최대"] ?? previous.rentMax),
    premiumMax: clean(input["권리금최대"] ?? previous.premiumMax),
    areaMin: clean(input["평수최소"] ?? previous.areaMin),
    areaMax: clean(input["평수최대"] ?? previous.areaMax),
    floorMin: clean(input["최저층"] ?? previous.floorMin),
    floorMax: clean(input["최고층"] ?? previous.floorMax),
    requiredTags: clean(input["필수태그"] ?? previous.requiredTags),
    preferredTags: clean(input["선호태그"] ?? previous.preferredTags),
    excludedTags: clean(input["제외태그"] ?? previous.excludedTags),
    manager: clean(input["담당자"] ?? previous.manager),
    conditionVersion: Math.max(1, Number(previous.conditionVersion) || 0) + 1
  };
}

async function insertCustomerActivity(env, user, values) {
  const id = `CA-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const stage = clean(values.stage) || "상담";
  await env.DB.prepare(`INSERT INTO customer_activities (
      id, customer_id, stage, source, memo, next_contact_date, actor_email, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, clean(values.customerId), stage, clean(values.source) || "web", clean(values.memo),
      clean(values.nextContactDate), clean(user?.email), now).run();
  if (["미팅완료", "임장"].includes(stage)) {
    await env.DB.prepare(`UPDATE customers SET status='미팅후', updated_at=?1 WHERE id=?2`)
      .bind(now, clean(values.customerId)).run();
  }
  return {
    id,
    customer_id: clean(values.customerId),
    stage,
    source: clean(values.source) || "web",
    memo: clean(values.memo),
    next_contact_date: clean(values.nextContactDate),
    actor_email: clean(user?.email),
    created_at: now
  };
}

async function saveCustomer(env, user, body) {
  const input = body.customer && typeof body.customer === "object" ? body.customer : {};
  const customerId = clean(body.customerId) || `C-${crypto.randomUUID()}`;
  const existing = await env.DB.prepare(`SELECT * FROM customers WHERE id=?1`).bind(customerId).first();
  const previousRequirements = requirementsFromCustomer(existing);
  const requirements = customerRequirementsFromInput(input, previousRequirements);
  if (!existing) requirements.conditionVersion = 1;
  const name = clean(input["고객명/상호"] ?? existing?.name);
  if (!name) throw Object.assign(new Error("고객명/상호를 입력해주세요."), { statusCode: 400 });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customers (id, name, phone, status, requirements_json, memo, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, status=excluded.status,
      requirements_json=excluded.requirements_json, memo=excluded.memo, updated_at=excluded.updated_at`)
    .bind(customerId, name, clean(input["연락처"] ?? existing?.phone),
      clean(input["상태"] ?? existing?.status) || "미팅전", JSON.stringify(requirements),
      clean(input["요청사항"] ?? existing?.memo), existing?.created_at || now).run();
  let savedActivity = null;
  if (clean(body.consultationMemo) || clean(body.nextContactDate)) {
    savedActivity = await insertCustomerActivity(env, user, {
      customerId,
      stage: "상담",
      source: "customerSave",
      memo: body.consultationMemo,
      nextContactDate: body.nextContactDate
    });
  }
  const rebuilt = await rebuildCustomerMatches(env, customerId);
  const updated = await env.DB.prepare(`SELECT * FROM customers WHERE id=?1`).bind(customerId).first();
  const matches = await customerMatchRecords(env, customerId);
  const allMatches = await customerMatchRecords(env);
  const result = {
    ok: true,
    action: "saveCustomer",
    persisted: true,
    queued: false,
    customerId,
    customerHeaders: CUSTOMER_HEADERS,
    customerRow: customerRow(updated),
    matchHeaders: MATCH_HEADERS,
    matches: matches.map(matchRow),
    matchSummary: summarizeMatches(allMatches),
    activityHeaders: ACTIVITY_HEADERS,
    activityRow: savedActivity ? activityRow(savedActivity) : null,
    rebuilt: rebuilt.rebuilt,
    matchCount: rebuilt.matchCount,
    source: "D1"
  };
  if (!body.compactResponse) result.workspace = await customerWorkspace(env, customerId);
  return result;
}

async function updateCustomerMatch(env, body) {
  const customerId = clean(body.customerId);
  const propertyId = clean(body.masterId || body.propertyId);
  const listing = await env.DB.prepare(`SELECT id FROM listings WHERE id=?1 OR property_id=?1 LIMIT 1`)
    .bind(propertyId).first();
  if (!customerId || !listing) throw Object.assign(new Error("고객 또는 매칭 매물을 찾을 수 없습니다."), { statusCode: 404 });
  const state = displayMatchState(body.status);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customer_matches (
      customer_id, listing_id, state, score, memo, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 0, '', ?4, ?4)
    ON CONFLICT(customer_id, listing_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`)
    .bind(customerId, listing.id, state, now).run();
  return {
    ok: true,
    action: "updateCustomerMatch",
    persisted: true,
    queued: false,
    customerId,
    propertyId,
    matchId: matchId(customerId, listing.id),
    status: state,
    source: "D1"
  };
}

async function addCustomerActivity(env, user, body) {
  const customerId = clean(body.customerId);
  const customer = await env.DB.prepare(`SELECT id FROM customers WHERE id=?1`).bind(customerId).first();
  if (!customer) throw Object.assign(new Error("고객을 찾을 수 없습니다."), { statusCode: 404 });
  const saved = await insertCustomerActivity(env, user, body);
  return {
    ok: true,
    action: "addCustomerActivity",
    persisted: true,
    queued: false,
    stage: saved.stage,
    activityHeaders: ACTIVITY_HEADERS,
    activityRow: activityRow(saved),
    source: "D1"
  };
}

async function executePost(env, user, body) {
  const action = clean(body.action);
  if (action === "updatePropertyMemo") return updateMemo(env, user, body);
  if (action === "updateProperty") return updateProperty(env, user, body);
  if (action === "toggleDone") return toggleDone(env, body);
  if (action === "deleteProperty") return deleteProperty(env, body);
  if (action === "quickAdd") return quickAdd(env, body);
  if (action === "saveCloudState") return saveCloudState(env, user, body);
  if (action === "saveGeocodeCache") return saveGeocode(env, body);
  if (action === "moveOriginalListing") return moveOriginal(env, body);
  if (action === "saveCustomer") return saveCustomer(env, user, body);
  if (action === "updateCustomerMatch") return updateCustomerMatch(env, body);
  if (action === "rebuildCustomerMatches") {
    const rebuilt = await rebuildCustomerMatches(env, body.customerId);
    return { ok: true, action, persisted: true, queued: false, ...rebuilt,
      workspace: await customerWorkspace(env, body.customerId), source: "D1" };
  }
  if (action === "addCustomerActivity") return addCustomerActivity(env, user, body);
  if (action === "enqueueMutation") {
    const nested = { ...(body.payload || {}), action: clean(body.taskAction), requestId: clean(body.requestId) };
    if (!isD1PostAction(nested.action) || nested.action === "enqueueMutation") return null;
    return executePost(env, user, nested);
  }
  return null;
}

export async function handleD1PostAction(env, user, body) {
  const action = clean(body?.action);
  if (!env.DB || !isD1PostAction(action)) return null;
  const requestId = clean(body.requestId || body?.payload?.requestId || `${action}-${crypto.randomUUID()}`).slice(0, 160);
  const result = await executePost(env, user, body);
  if (!result) return null;
  const finalResult = { ...result, requestId };
  await recordMutation(env, user, action === "enqueueMutation" ? clean(body.taskAction) : action, requestId, finalResult);
  return finalResult;
}

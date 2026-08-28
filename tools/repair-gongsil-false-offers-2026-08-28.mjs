// Default: read-only audit + private backups + local forward/rollback tests.
// --apply: execute only guarded, evidence-backed corrections. No hard deletes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { gongsilAdvertisedOffers, hasGongsilOfferEvidence } from '../cloudflare/src/gongsil-offers.js';
const root = resolve(import.meta.dirname, '..');
const backup = process.argv.find(a => a.startsWith('--backup='))?.slice(9);
assert.ok(backup && isAbsolute(backup) && relative(root, resolve(backup)).startsWith('..'), 'Private backup outside repo required');
const dir = resolve(backup, `gongsil-false-offers-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(dir, { recursive: true });
const q = v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const parse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
function run(args) {
  const r = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  if (r.status) throw Error(r.stderr || r.stdout);
  return r.stdout;
}
const query = sql => JSON.parse(run(['d1', 'execute', 'js-map-primary', '--remote', '--json', '--command', sql]))[0].results;
const all = query("SELECT * FROM listing_sources WHERE source='공실박스'");
const unsupported = all.filter(s => { const raw = parse(s.raw_json); return hasGongsilOfferEvidence(raw.list, raw.detail) && !gongsilAdvertisedOffers(raw.list, raw.detail).some(o => o.tradeType === s.trade_type); });
// Today's split IDs prove newly invented offers, unlike old single IDs which
// may have changed their advertised market over time and need separate review.
const targets = unsupported.filter(s => /::(sale|lease)$/.test(s.source_listing_id) && s.created_at >= '2026-08-28' && s.listing_id);
const ids = [...new Set(targets.map(s => s.listing_id))];
assert.ok(ids.length, 'No supported repair target remains');
const inIds = ids.map(q).join(',');
const before = { listings: query(`SELECT * FROM listings WHERE id IN (${inIds}) ORDER BY id`),
  listing_sources: query(`SELECT * FROM listing_sources WHERE listing_id IN (${inIds}) ORDER BY id`),
  listing_media: query(`SELECT * FROM listing_media WHERE listing_id IN (${inIds}) ORDER BY id`),
  listing_contacts: query(`SELECT * FROM listing_contacts WHERE listing_id IN (${inIds}) ORDER BY id`),
  listing_history: query(`SELECT * FROM listing_history WHERE listing_id IN (${inIds}) ORDER BY id`),
  customer_matches: query(`SELECT * FROM customer_matches WHERE listing_id IN (${inIds}) ORDER BY customer_id,listing_id`),
  cloud_state: query(`SELECT * FROM cloud_state WHERE ${ids.map(id => `value_json LIKE '%${id}%'`).join(' OR ')} ORDER BY owner_email,scope,record_key`),
  collector_raw: query("SELECT * FROM collector_raw WHERE source='공실박스' AND processing_state IN ('review','pending') AND created_at>='2026-08-28'") };
const targetIds = new Set(targets.map(s => s.id));
const missingSiblings = [];
const advertisedSiblings = targets.flatMap(s => {
  const base = s.source_listing_id.replace(/::(sale|lease)$/, '');
  const raw = parse(s.raw_json), types = gongsilAdvertisedOffers(raw.list, raw.detail).map(o => o.tradeType);
  const siblings = all.filter(other => other.id !== s.id && other.source_listing_id.replace(/::(sale|lease)$/, '') === base && types.includes(other.trade_type) && other.listing_id);
  if (!siblings.length) missingSiblings.push({ source: s, offers: gongsilAdvertisedOffers(raw.list, raw.detail) });
  return siblings;
});
before.advertisedSiblings = [...new Map(advertisedSiblings.map(s => [s.id, s])).values()].sort((a,b) => a.id.localeCompare(b.id));
before.advertisedMasters = query(`SELECT * FROM listings WHERE id IN (${[...new Set(advertisedSiblings.map(s => s.listing_id))].map(q).join(',')}) ORDER BY id`);
writeFileSync(resolve(dir, 'preflight.json'), JSON.stringify({ before, missingSiblings }));
// The one inspected exception is a genuine semi-jeonse advertisement, not a
// phantom duplicate. Correct its transaction in place; preserve its entire row.
assert.ok(missingSiblings.every(m => m.source.source_listing_id === '2630750::sale'
  && m.offers.length === 1 && m.offers[0].tradeType === 'lease'
  && m.offers[0].deposit === 60000 && m.offers[0].rent === 315), 'Uninspected missing sibling');
const now = new Date().toISOString();
const changes = [];
const edit = (table, row, fields) => changes.push({ table, before: row, after: { ...row, ...fields } });
const held = [];
for (const listing of before.listings) {
  const sources = before.listing_sources.filter(s => s.listing_id === listing.id);
  const reclassify = missingSiblings.find(m => m.source.listing_id === listing.id);
  if (sources.every(s => targetIds.has(s.id))) {
    // A fake standalone card must only have automatic creation history. Never
    // remove a user's confirmed/contracted/edited/card-linked state blindly.
    const histories = before.listing_history.filter(h => h.listing_id === listing.id);
    const referenced = before.customer_matches.some(m => m.listing_id === listing.id) || before.cloud_state.some(s => s.value_json.includes(listing.id));
    const autoOnly = listing.status === 'active' && listing.version === 1 && histories.length > 0 && histories.every(h => ['collectorCreated', 'sourceMerged'].includes(h.action));
    if (!autoOnly || referenced) { held.push(listing.id); continue; }
    if (reclassify) {
      assert.equal(sources.length, 1);
      const source = sources[0], snapshot = parse(source.list_snapshot_json), offer = reclassify.offers[0];
      assert.ok(!all.some(s => s.source_listing_id === '2630750::lease'));
      edit('listings', listing, { trade_type: 'lease', sale_category: '', sale_price: null,
        deposit: offer.deposit, monthly_rent: offer.rent, version: listing.version + 1, updated_at: now });
      const corrected = { ...snapshot, ...offer, sourceId: '2630750::lease', saleCategory: '' };
      delete corrected.saleDetails;
      edit('listing_sources', source, { source_listing_id: '2630750::lease', trade_type: 'lease', sale_category: '', sale_price: null,
        list_snapshot_json: JSON.stringify(corrected), snapshot_hash: 'offer-type-repair-20260828', updated_at: now });
      continue;
    }
    edit('listings', listing, { status: 'deleted', version: listing.version + 1, updated_at: now });
  }
  for (const s of sources.filter(s => targetIds.has(s.id))) {
    // Preserve raw/contacts/media, just disconnect this false market copy. Its
    // actual advertised sibling and every valid source remain untouched.
    edit('listing_sources', s, { listing_id: null, active: 0, updated_at: now });
    for (const table of ['listing_media', 'listing_contacts']) {
      for (const row of before[table].filter(r => r.source_id === s.id)) edit(table, row, { listing_id: null });
    }
  }
}
const badReview = before.collector_raw.filter(r => {
  if (!/::(sale|lease)$/.test(r.source_listing_id)) return false;
  const payload = parse(r.payload_json), raw = payload.raw || {};
  return hasGongsilOfferEvidence(raw.list, raw.detail) && !gongsilAdvertisedOffers(raw.list, raw.detail).some(o => o.tradeType === r.trade_type);
});
for (const row of badReview) edit('collector_raw', row, { processing_state: 'excluded', error_text: '공실박스 실제 거래유형에 없는 오분류 조건 복구', processed_at: now });
const priceMismatches = all.filter(s => s.source_listing_id.includes('::')).flatMap(s => {
  const raw = parse(s.raw_json), snap = parse(s.list_snapshot_json);
  const offer = gongsilAdvertisedOffers(raw.list, raw.detail).find(o => o.tradeType === s.trade_type);
  if (!offer) return [];
  const mismatch = offer.tradeType === 'sale' ? Number(snap.salePrice) !== offer.salePrice : Number(snap.deposit) !== offer.deposit || Number(snap.rent) !== offer.rent;
  return mismatch ? [{ id: s.id, listing_id: s.listing_id, externalId: s.source_listing_id, actual: offer, stored: { salePrice: snap.salePrice, deposit: snap.deposit, rent: snap.rent } }] : [];
});
writeFileSync(resolve(dir, 'before.json'), JSON.stringify(before));
writeFileSync(resolve(dir, 'audit.json'), JSON.stringify({ unsupported, targets, held, badReview, priceMismatches }));
assert.equal(held.length, 0, 'User-modified/referenced fake cards require an explicit preservation plan; see backup');
const exact = row => Object.entries(row).map(([k,v]) => `${k} IS ${q(v)}`).join(' AND ');
const assign = (from, to) => Object.entries(to).filter(([k,v]) => v !== from[k]).map(([k,v]) => `${k}=${q(v)}`).join(',');
function sql(reverse = false) {
  const lines = ['CREATE TABLE _gongsil_offer_guard (n INTEGER CHECK(n=1));'];
  // Full-row guards prevent overwriting edits/collection happening meanwhile.
  for (const c of changes) lines.push(`INSERT INTO _gongsil_offer_guard SELECT count(*) FROM ${c.table} WHERE ${exact(reverse ? c.after : c.before)};`);
  // Also guard source counts: a new valid source must prevent hiding its card.
  for (const c of changes.filter(c => c.table === 'listings')) {
    const count = reverse && c.after.status === 'deleted' ? 0 : before.listing_sources.filter(s => s.listing_id === c.before.id).length;
    lines.push(`INSERT INTO _gongsil_offer_guard SELECT CASE WHEN count(*)=${count} THEN 1 ELSE 0 END FROM listing_sources WHERE listing_id=${q(c.before.id)};`);
  }
  for (const c of changes) {
    const from = reverse ? c.after : c.before, to = reverse ? c.before : c.after;
    lines.push(`UPDATE ${c.table} SET ${assign(from, to)} WHERE id=${q(from.id)};`);
    if (c.table === 'listing_sources') lines.push(`INSERT INTO listing_history(listing_id,source_id,action,actor_email,before_json,after_json) VALUES (${q(c.before.listing_id)},${q(c.before.id)},${q(reverse ? 'falseOfferRepairRollback' : 'falseOfferRepair')},'codex-offer-repair',${q(JSON.stringify({ listing_id: from.listing_id, active: from.active, trade_type: from.trade_type, source_listing_id: from.source_listing_id }))},${q(JSON.stringify({ listing_id: to.listing_id, active: to.active, trade_type: to.trade_type, source_listing_id: to.source_listing_id, reason: 'provider advertised trade type excludes this offer' }))});`);
  }
  lines.push('DROP TABLE _gongsil_offer_guard;');
  return lines.join('\n');
}
const forward = sql(), rollback = sql(true);
const local = new DatabaseSync(':memory:');
for (const table of new Set(changes.map(c => c.table))) {
  const rows = before[table];
  local.exec(`CREATE TABLE ${table}(${Object.keys(rows[0]).join(',')});`);
  for (const row of rows) local.exec(`INSERT INTO ${table} VALUES (${Object.values(row).map(q).join(',')});`);
}
local.exec('CREATE TABLE listing_history(listing_id,source_id,action,actor_email,before_json,after_json);');
local.exec(forward);
for (const c of changes) assert.deepEqual({ ...local.prepare(`SELECT * FROM ${c.table} WHERE id=?`).get(c.before.id) }, c.after);
local.exec(rollback);
for (const c of changes) assert.deepEqual({ ...local.prepare(`SELECT * FROM ${c.table} WHERE id=?`).get(c.before.id) }, c.before);
local.exec(`UPDATE listings SET version=version+1 WHERE id=${q(changes.find(c => c.table === 'listings').before.id)};`);
assert.throws(() => local.exec(forward), /CHECK constraint/);
local.close();
writeFileSync(resolve(dir, 'repair.sql'), forward);
writeFileSync(resolve(dir, 'rollback.sql'), rollback);
const summary = { backup: dir, targets: targets.length, unrelatedLegacyDiscrepancies: unsupported.length - targets.length,
  changes: Object.fromEntries([...new Set(changes.map(c => c.table))].map(table => [table, changes.filter(c => c.table === table).length])),
  preservedMixedMasters: before.listings.length - changes.filter(c => c.table === 'listings').length,
  hiddenStandaloneCards: changes.filter(c => c.table === 'listings' && c.after.status === 'deleted').length,
  reclassified: missingSiblings.length,
  priceMismatches, userReferencesReferences: before.cloud_state.length, customerMatches: before.customer_matches.length, localForwardRollbackConflictGuard: 'passed' };
console.log(JSON.stringify(summary));
if (process.argv.includes('--apply')) {
  run(['d1', 'execute', 'js-map-primary', '--remote', '--file', resolve(dir, 'repair.sql'), '--yes']);
  const after = {};
  for (const table of new Set(changes.map(c => c.table))) {
    after[table] = query(`SELECT * FROM ${table} WHERE id IN (${changes.filter(c => c.table === table).map(c => q(c.before.id)).join(',')})`);
  }
  writeFileSync(resolve(dir, 'after.json'), JSON.stringify(after));
  for (const c of changes) assert.deepEqual(after[c.table].find(r => r.id === c.before.id), c.after);
  for (const table of ['listings', 'listing_sources']) {
    const untouched = before[table].filter(r => !changes.some(c => c.table === table && c.before.id === r.id));
    if (untouched.length) {
      const rows = query(`SELECT * FROM ${table} WHERE id IN (${untouched.map(r => q(r.id)).join(',')}) ORDER BY id`);
      assert.deepEqual(rows, untouched, `${table} untouched rows preserved`);
    }
  }
  assert.deepEqual(query(`SELECT * FROM customer_matches WHERE listing_id IN (${inIds}) ORDER BY customer_id,listing_id`), before.customer_matches);
  assert.deepEqual(query(`SELECT * FROM cloud_state WHERE ${ids.map(id => `value_json LIKE '%${id}%'`).join(' OR ')} ORDER BY owner_email,scope,record_key`), before.cloud_state);
  const siblingsAfter = query(`SELECT * FROM listing_sources WHERE id IN (${before.advertisedSiblings.map(s => q(s.id)).join(',')})`);
  for (const s of before.advertisedSiblings) assert.deepEqual(siblingsAfter.find(r => r.id === s.id), s, 'Actual advertised sibling preserved');
  assert.deepEqual(query(`SELECT * FROM listings WHERE id IN (${before.advertisedMasters.map(s => q(s.id)).join(',')}) ORDER BY id`), before.advertisedMasters, 'Actual advertised master preserved');
  console.log('Verified exact recovery; valid linked sources/masters and user references preserved. No hard-deleted data.');
}

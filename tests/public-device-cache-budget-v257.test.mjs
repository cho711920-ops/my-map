import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('js/data-access-v6.js', 'utf8');
function harness(initial = {}, limit = 5242880) {
  const data = new Map(Object.entries(initial)), removed = [], events = {};
  let reads = 0;
  const storage = {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { reads++; return data.get(key) ?? null; },
    removeItem(key) { removed.push(key); data.delete(key); },
    setItem(key, value) {
      const next = new Map(data); next.set(key, String(value));
      if ([...next].reduce((sum, [k, v]) => sum + k.length + v.length, 0) > limit) {
        const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error;
      }
      data.set(key, String(value));
    }
  };
  const window = {localStorage: storage, addEventListener(name, listener) { events[name] = listener; }};
  vm.runInNewContext(source, {window, URL, URLSearchParams, AbortController, AbortSignal, TextDecoder, console});
  return {data, storage, removed, api: window.JSOptionalPublicCacheV257, window, events, reads: () => reads};
}

test('full device store recovers before app reads without touching account or unsynced user data', () => {
  const protectedData = {
    js_authenticated_account_v1: 'account', js_favorite_lists_v6: 'unsynced favorite',
    js_ai_visit_sessions_v6: 'offline visit', js_memo_draft: 'memo draft',
    js_list_sync_dirty_v6_favorite: 'pending', JS_REAL_ESTATE_DONE_VIEW_V1: 'only',
    'js-building-register-v99:future': 'unknown future schema'
  };
  const h = harness({...protectedData, 'js-building-register-v11:old': 'x'.repeat(700000),
    'js-building-badge-v3:old': 'x'.repeat(4300000)});
  for (const [key, value] of Object.entries(protectedData)) assert.equal(h.data.get(key), value);
  assert.equal(h.api.stats().obsoleteRemoved, 2);
  assert.doesNotThrow(() => h.storage.setItem('js_ai_visit_sessions_v6', 'new offline visit'));
  assert.deepEqual(h.removed.sort(), ['js-building-badge-v3:old', 'js-building-register-v11:old']);
  assert.ok(h.window.JSDataAccessV6);
});

test('repeated public lookups remain bounded and preserve recent exact-parcel cache values', () => {
  const h = harness({js_memo_draft: 'do not alter'});
  for (let i = 1; i <= 24; i++) assert.equal(h.api.setItem('js-building-badge-v4:' + i,
    JSON.stringify({savedAt: i, data: 'x'.repeat(100000)})), true);
  const total = [...h.data].filter(([key]) => key.startsWith('js-building-'))
    .reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  assert.ok(total <= 1500000);
  assert.equal(h.data.get('js_memo_draft'), 'do not alter');
  assert.ok(h.data.has('js-building-badge-v4:24'));
  assert.equal(h.data.has('js-building-badge-v4:1'), false);
  assert.ok(h.api.stats().evicted > 0);
});

test('updating a public entry counts its replacement once and drops obsolete oversized results', () => {
  const h = harness();
  assert.equal(h.api.setItem('js-building-register-v12:one', 'old'), true);
  assert.equal(h.api.setItem('js-building-register-v12:one', 'x'.repeat(140000)), false);
  assert.equal(h.data.has('js-building-register-v12:one'), false);
  assert.equal(h.api.setItem('js-building-register-v12:one', 'new'), true);
  assert.equal(h.data.get('js-building-register-v12:one'), 'new');
});

test('quota retries evict only known public caches and never discard protected entries', () => {
  const h = harness({js_memo_draft: 'x'.repeat(700),
    'js-building-badge-v4:old': 'x'.repeat(200)}, 1050);
  assert.equal(h.api.setItem('js-building-register-v12:new', 'x'.repeat(200)), true);
  assert.equal(h.data.has('js-building-badge-v4:old'), false);
  assert.equal(h.data.get('js_memo_draft'), 'x'.repeat(700));
  assert.equal(h.api.setItem('js-building-register-v12:large', 'x'.repeat(800)), false);
  assert.equal(h.data.get('js_memo_draft'), 'x'.repeat(700));
  assert.equal(h.api.setItem('js_authenticated_account_v1', 'replace'), false);
});

test('blocked storage cannot throw out of app initialization or public cache writes', () => {
  const window = {};
  Object.defineProperty(window, 'localStorage', {get() { throw new Error('blocked'); }});
  assert.doesNotThrow(() => vm.runInNewContext(source, {window, URL, URLSearchParams,
    AbortController, AbortSignal, TextDecoder, console}));
  assert.equal(window.JSOptionalPublicCacheV257.setItem('js-building-parcel-v1:a', 'data'), false);
  assert.ok(window.JSDataAccessV6);
});

test('public writes reuse the bounded inventory rather than scanning thousands of entries per lookup', () => {
  const initial = Object.fromEntries(Array.from({length: 2500}, (_, i) => ['js-building-parcel-v1:' + i, '{}']));
  const h = harness(initial), reads = h.reads();
  for (let i = 0; i < 25; i++) assert.equal(h.api.setItem('js-building-badge-v4:current', '{}'), true);
  assert.equal(h.reads(), reads);
});

test('a public cache change from another tab invalidates accounting without touching private records', () => {
  const h = harness({js_memo_draft: 'keep'});
  h.storage.setItem('js-building-badge-v4:other-tab', 'x'.repeat(1400000));
  h.events.storage({key: 'js-building-badge-v4:other-tab'});
  assert.equal(h.api.setItem('js-building-register-v12:new', 'x'.repeat(120000)), true);
  assert.equal(h.data.has('js-building-badge-v4:other-tab'), false);
  assert.equal(h.data.get('js_memo_draft'), 'keep');
});

test('all production public cache writers use the budget without changing durable save endpoints', () => {
  const register = readFileSync('js/building-register-v6.js', 'utf8');
  for (const prefix of ['LOCAL_CACHE_PREFIX', 'BADGE_CACHE_PREFIX', 'PARCEL_CACHE_PREFIX'])
    assert.match(register, new RegExp('setPublicLookupCacheV257\\(' + prefix));
  assert.match(readFileSync('js/script.js', 'utf8'), /JSOptionalPublicCacheV257\.setItem\(geocodeCacheKey/);
  assert.doesNotMatch(source, /localStorage\.clear\(/);
});

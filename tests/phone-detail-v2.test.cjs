const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const unified = fs.readFileSync('js/unified-listings-v8.js', 'utf8');
const main = fs.readFileSync('js/script.js', 'utf8');
const css = fs.readFileSync('css/phone-detail-v2.css', 'utf8');

function between(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}

function detailHarness(phone) {
  const calls = [], alerts = [];
  const body = {innerHTML: '', querySelector() { return null; }};
  const drawer = {actions: '', querySelector() { return null; }, insertAdjacentHTML(_, markup) { this.actions = markup; }};
  const nodes = {unifiedDetailBodyV8: body, unifiedDetailTitleV8: {}, unifiedDetailSubtitleV8: {}};
  const window = {
    allItems: [{propertyId: 'P1', key: 'same-key'}, {propertyId: 'P2', key: 'same-key'}],
    JSPhoneDeviceV1: {isPhone() { return phone; }},
    addEventListener() {},
    openListContactPopupV654(key) { calls.push(['contact', key]); },
    openItemListDestinationPicker(key) { calls.push(['favorite', key]); },
    openKakaoNavigation(key) { calls.push(['navigation', key]); },
    openPropertyEditModalV630(key) { calls.push(['edit', key]); },
    JSSaleWorkbenchV1: {detailTools() { return '<div>sale-management</div>'; }},
    __drawer: drawer,
    __closeForPicker() { calls.push(['close-detail']); }
  };
  const instrumented = unified.replace('global.JSUnifiedListingsV8 = {', `
    global.__test = {renderDetail, phoneDetailFactsV2, phoneDetailActionsV2};
    ensureDrawer = function() { return global.__drawer; };
    positionDrawer = function() {};
    showDetailDrawerV827 = function() {};
    closeDetailForOverlay = global.__closeForPicker;
    global.JSUnifiedListingsV8 = {`);
  vm.runInNewContext(instrumented, {window, document: {addEventListener() {}, getElementById(id) { return nodes[id]; }}, alert(message) { alerts.push(message); }});
  return {window, api: window.JSUnifiedListingsV8, test: window.__test, body, drawer, calls, alerts};
}

test('phone detail uses exact property identity for existing contact and favorite pickers', () => {
  const h = detailHarness(true);
  h.api.runDetailAction('contact', 'P2');
  h.api.runDetailAction('favorite', 'P2');
  h.api.runDetailAction('navigation', 'P2');
  assert.deepEqual(h.calls, [['contact', 'id%3AP2'], ['close-detail'], ['favorite', 'property%3AP2'], ['navigation', 'same-key']]);
  h.api.runDetailAction('contact', 'missing');
  assert.equal(h.calls.length, 4);
  assert.match(h.alerts[0], /찾지 못했습니다/);
  h.window.openListContactPopupV654 = null;
  h.api.runDetailAction('contact', 'P2');
  assert.match(h.alerts[1], /잠시 후/);
});

const original = {originalId: 'O1', propertyId: 'P2', source: '당근', address: '대전 서구 둔산동', room: '1층',
  type: '일반상가', deposit: 2000, rent: 70, area: 19.7, fee: 5, premium: 0, memo: '현장 확인 필요',
  link: 'https://example.test/listing/2'};

test('phone detail keeps property facts and original selection while removing management UI', () => {
  const h = detailHarness(true);
  h.test.renderDetail('P2', [original, {...original, originalId: 'O2'}], 'O1');
  assert.match(h.body.innerHTML, /phone-detail-price-v2.*보 2,000 \/ 월 70/);
  assert.match(h.body.innerHTML, /19.7평/);
  assert.match(h.body.innerHTML, /관리비/);
  assert.match(h.body.innerHTML, /권리금/);
  assert.match(h.body.innerHTML, /현장 확인 필요/);
  assert.match(h.body.innerHTML, /이 공간의 원본매물/);
  assert.doesNotMatch(h.body.innerHTML, /대표 전체 합치기|원본 1개 합치기|별도 매물 분리|sale-management|>수정<|>대장</);
  assert.match(h.drawer.actions, />전화<.*>길찾기<.*>찜하기<.*>원본 ↗</);
  assert.equal(h.calls.length, 0, 'merely opening or refreshing a detail never closes the folder/detail');
});

test('phone save action replaces the covering detail before opening the folder picker', () => {
  const h = detailHarness(true);
  h.api.runDetailAction('favorite', 'P2');
  assert.deepEqual(h.calls, [['close-detail'], ['favorite', 'property%3AP2']]);
  h.calls.length = 0;
  h.window.openItemListDestinationPicker = null;
  h.api.runDetailAction('favorite', 'P2');
  assert.deepEqual(h.calls, [], 'unavailable favorite module must not discard the currently open detail');
  assert.match(h.alerts[0], /잠시 후/);
});

test('tablet and desktop detail retain previous management UI and have no phone footer', () => {
  const h = detailHarness(false);
  h.test.renderDetail('P2', [original, {...original, originalId: 'O2'}], 'O1');
  assert.match(h.body.innerHTML, /대표 전체 합치기/);
  assert.match(h.body.innerHTML, /별도 매물 분리/);
  assert.match(h.body.innerHTML, /sale-management/);
  assert.match(h.body.innerHTML, />수정</);
  assert.match(h.body.innerHTML, />대장</);
  assert.doesNotMatch(h.body.innerHTML, /phone-detail-price-v2/);
  assert.equal(h.drawer.actions, '');
  h.api.runDetailAction('edit', 'P2');
  assert.deepEqual(h.calls, [['edit', 'id%3AP2']]);
});

test('phone detail does not invent absent amounts or unsafe source links', () => {
  const h = detailHarness(true);
  assert.match(h.test.phoneDetailFactsV2({...original, rent: null}), /월 미확인/);
  assert.match(h.test.phoneDetailActionsV2('P2', {...original, link: 'javascript:alert(1)'}), /disabled.*원본 없음/);
  assert.doesNotMatch(h.test.phoneDetailActionsV2('P2', {...original, link: ''}), /openExternalLink/);
  assert.match(h.test.phoneDetailFactsV2({...original, type: '<img src=x>'}), /&lt;img src=x&gt;/);
});

function listHarness(phone) {
  const list = {scrollTop: 310, getBoundingClientRect() { return {top: 80}; }};
  const sidebar = {scrollTop: 25, getBoundingClientRect() { return {top: 40}; }};
  const window = {JSPhoneDeviceV1: {isPhone() { return phone; }}, scrollX: 0, scrollY: 0};
  const context = {window, document: {getElementById(id) { return id === 'list' ? list : sidebar; }, querySelector() { return null; }},
    isFavorite() { return true; }, CSS: {escape(value) { return value; }}, requestAnimationFrame(callback) { callback(); }};
  vm.createContext(context);
  vm.runInContext(between(main, 'function isPhoneListingV2(', 'var currentItems') +
    between(main, 'function captureMemoListScrollPosition(', 'function showMemoListKeepingPosition(') +
    between(main, 'function restoreListScrollAfterRender(', 'function refreshDoneStatusUI('), context);
  return {context, list, sidebar};
}

test('smartphone list refresh restores the actual list scroller, leaving desktop sidebar untouched', () => {
  const h = listHarness(true);
  const position = h.context.captureMemoListScrollPosition('');
  assert.equal(position.sidebarTop, 310);
  h.list.scrollTop = 0;
  h.context.restoreMemoListScrollPosition(position);
  assert.equal(h.list.scrollTop, 310);
  assert.equal(h.sidebar.scrollTop, 25);
  h.context.restoreListScrollAfterRender(500);
  assert.equal(h.list.scrollTop, 500);
  assert.equal(h.sidebar.scrollTop, 25);
  assert.match(h.context.buildPhoneFavoriteButtonV2({}, 'property%3AP2'), /phone-card-favorite-v2 saved/);
});

test('tablet/desktop list keeps original sidebar scroller and no new favorite button', () => {
  const h = listHarness(false);
  assert.equal(h.context.captureMemoListScrollPosition('').sidebarTop, 25);
  h.context.restoreListScrollAfterRender(100);
  assert.equal(h.sidebar.scrollTop, 100);
  assert.equal(h.list.scrollTop, 310);
  assert.equal(h.context.buildPhoneFavoriteButtonV2({}, 'property%3AP2'), '');
});

test('incremental list loads and restores chunks from phone list scroll events, not sidebar events', () => {
  const h = listHarness(true);
  let next = 0, previous = 0;
  for (const element of [h.list, h.sidebar]) {
    Object.assign(element, {scrollHeight: 1600, clientHeight: 500, scrollTop: 1100, offsetTop: 90,
      addEventListener(_, callback) { this.scrollListener = callback; }});
  }
  Object.assign(h.context, {listRenderScrollBound: false, listVirtualScrollScheduledV1: false,
    listVirtualTopHeightV1: 0, listRenderStart: 0,
    renderNextListChunk() { next += 1; }, renderPreviousListChunkV1() { previous += 1; }});
  h.context.window.requestAnimationFrame = callback => callback();
  vm.runInContext(between(main, 'function bindIncrementalListRendering(', 'var unifiedDuplicateShimmerObserverV812'), h.context);
  h.context.bindIncrementalListRendering();
  h.sidebar.scrollListener({currentTarget: h.sidebar});
  assert.equal(next, 0);
  h.list.scrollListener({currentTarget: h.list});
  assert.equal(next, 1);
  h.context.listRenderStart = 25;
  h.context.listVirtualTopHeightV1 = 1000;
  h.list.scrollTop = 1050;
  h.list.scrollListener({currentTarget: h.list});
  assert.equal(previous, 1);
  h.context.window.JSPhoneDeviceV1.isPhone = () => false;
  h.context.listRenderStart = 0;
  h.list.scrollListener({currentTarget: h.list});
  assert.equal(next, 1, 'desktop ignores the inner list event');
  h.sidebar.scrollListener({currentTarget: h.sidebar});
  assert.equal(next, 2, 'desktop still listens on its original sidebar');
});

test('detail CSS is phone-root scoped, not a width-based tablet override', () => {
  assert.doesNotMatch(css, /@media\s*\(max-width/);
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const selectors = rule.split('{')[0].trim();
    if (!selectors) continue;
    for (const selector of selectors.split(',')) assert.match(selector.trim(), /^\.js-phone-app-v2 /);
  }
  assert.match(main, /div\.ondblclick = function\(event\) \{\s*if \(isPhoneListingV2\(\)\) return;/);
  assert.match(main, /getListingScrollContainerV2\(\)[\s\S]*?renderPreviousListChunkV1\(\)/);
});

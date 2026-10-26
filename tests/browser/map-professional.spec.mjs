import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../js/map.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('map.js', source, ts.ScriptTarget.Latest, true);
const functions = new Set(['getPremiumClusterSizeClassV635', 'buildClusterOverlayContentV655', 'openCluster',
  'openAdministrativeClusterV655', 'redrawSelectedMarkers', 'isAdministrativeClusterSelectedV1',
  'setAdministrativeListSelectionV6570', 'clearAdministrativeListSelectionV6570', 'getAdministrativeListStatusV6570', 'getFieldVisitClusterClassV684']);
const runtime = ast.statements.filter(n => ts.isFunctionDeclaration(n) && functions.has(n.name?.text)).map(n => n.getText(ast)).join('\n');
const listControls = ['#sourceFilter', '#typeFilter', '#brokerageFeeFilter', '#sortDropdownBtn'];

async function expectListControls(page, visible) {
  for (const selector of listControls) {
    if (visible) await expect(page.locator(selector)).toBeVisible();
    else await expect(page.locator(selector)).toBeHidden();
  }
}

async function prepare(page, context) {
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/api/') && route.request().method() !== 'GET') writes.push(url.pathname);
    return route.continue();
  });
  await page.goto('/?mapFirst=1');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('#mapListingCountV825')).toBeVisible();
  await expect(page.locator('#mapListingCountV825 button')).toHaveCount(0);
  await expect(page.locator('#mapListOpenV1,#mapQuickNew3DaysBtn,#mapQuickNew7DaysBtn,#mapQuickNew15DaysBtn,#mapQuickVisitOnlyBtn')).toHaveCount(0);
  await page.locator('#fixtureControls').evaluate(el => el.hidden = true);
  return {errors, writes};
}

async function installMap(page) {
  await page.addScriptTag({content: runtime});
  await page.evaluate(() => {
    document.documentElement.classList.add('js-world-grid-clusters-v690');
    window.jsAdministrativeListSelectionV6570 = null;
    window.closeOpenListingDetailsForMapSelectionV6525 = () => {};
    window.pinCurrentClusterSelectionV6515 = () => {window.jsPinnedClusterSelectionV6515 = {key: selectedGroupKey};};
    window.clearPinnedClusterSelectionV6515 = clear => {
      window.jsPinnedClusterSelectionV6515 = null;
      if (clear) {window.selectedGroupKey = null; window.selectedGroupKeys = [];}
    };
    window.keepPinnedClusterSelectionAcrossTransientUiV6525 = () => {};
    window.mapTest = {level: 6, center: {x: 0, y: 0}, layouts: 0};
    window.map = {
      getLevel: () => mapTest.level,
      getCenter: () => mapTest.center,
      setCenter: value => {mapTest.center = value;},
      getBounds: () => ({contain: () => true}),
      relayout: () => {mapTest.layouts++;}
    };
    window.kakao = {maps: {Point: function(x, y) {this.x = x; this.y = y;}}};
    window.getMapDisplayProjectionV1 = () => ({
      containerPointFromCoords: p => ({x: document.getElementById('map').clientWidth / 2 + p.x - mapTest.center.x,
        y: document.getElementById('map').clientHeight / 2 + p.y - mapTest.center.y}),
      coordsFromContainerPoint: p => ({x: p.x - document.getElementById('map').clientWidth / 2 + mapTest.center.x,
        y: p.y - document.getElementById('map').clientHeight / 2 + mapTest.center.y})
    });
    window.paintTestClusters = clusters => {
      document.querySelectorAll('.design-test-overlay').forEach(el => el.remove());
      window.overlays = clusters.map((cluster, i) => {
        const host = document.createElement('div'); host.className = 'design-test-overlay';
        host.style.cssText = 'position:absolute;left:' + (65 + i * 130) + 'px;top:220px';
        document.getElementById('map').append(host);
        const content = buildClusterOverlayContentV655(cluster, ''); host.innerHTML = content;
        return {__cluster: cluster, __adminRegionContentV1: content,
          setContent: value => {host.innerHTML = value;}, setZIndex: value => {host.style.zIndex = value;}};
      });
    };
  });
}

test('desktop list opens by default and preserves search geometry and selection on reopen', async ({page, context, isMobile}, info) => {
  test.skip(isMobile, 'Desktop and unfolded layout use the collapsible right panel');
  const h = await prepare(page, context);
  await expect(page.locator('html')).not.toHaveClass(/js-map-list-closed-v1/);
  await expectListControls(page, true);
  expect(await page.locator('#map').evaluate(el => el.clientWidth)).toBeLessThan(1280);
  await page.locator('#mapListCloseV1').click();
  await expectListControls(page, false);
  const search = await page.locator('#keyword').boundingBox();
  const fullWidth = await page.locator('#map').evaluate(el => el.clientWidth);
  expect(fullWidth).toBe(1280);
  await expect(page.locator('#keyword')).toBeVisible();
  await installMap(page);
  await page.evaluate(() => paintTestClusters([{key: 'test-12', worldGrid: true, latlng: {x: 500, y: 0}, items: allItems.slice(0, 1)}]));
  await page.locator('.design-test-overlay .circle-marker').click();
  await expect(page.locator('html')).not.toHaveClass(/js-map-list-closed-v1/);
  await expect(page.locator('#mapListTitleV1')).toHaveText('선택한 매물 1개');
  await expect(page.locator('.design-test-overlay .circle-marker')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.9)');
  expect(await page.locator('.design-test-overlay .circle-marker').evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.design-test-overlay .circle-marker')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('#list .item')).toHaveCount(1);
  await expectListControls(page, true);
  expect(await page.locator('#keyword').boundingBox()).toEqual(search);
  const state = await page.evaluate(() => ({key: selectedGroupKey, level: map.getLevel(), width: document.getElementById('map').clientWidth,
    point: getMapDisplayProjectionV1().containerPointFromCoords({x: 500, y: 0})}));
  expect(state.width).toBeLessThan(fullWidth);
  expect(state.point.x).toBeLessThanOrEqual(state.width - 79);
  expect(state.level).toBe(6);
  await page.screenshot({path: info.outputPath('desktop-selected-list.png')});
  await page.locator('#mapListCloseV1').click();
  await expect(page.locator('html')).toHaveClass(/js-map-list-closed-v1/);
  await expectListControls(page, false);
  expect(await page.evaluate(() => selectedGroupKey)).toBe(state.key);
  await expect(page.locator('#mapQuickViewBtn')).toBeFocused();
  await page.locator('.design-test-overlay .circle-marker').click();
  await expect(page.locator('#mapListTitleV1')).toHaveText('선택한 매물 1개');
  await expectListControls(page, true);
  expect(await page.evaluate(() => selectedGroupKey)).toBe(state.key);
  expect(await page.locator('#keyword').boundingBox()).toEqual(search);
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

test('simplified vertical view menu still toggles today and mutually exclusive completed filters', async ({page, context, isMobile}, info) => {
  test.skip(isMobile, 'The vertical toolbar belongs to the desktop and fitted landscape layout');
  const h = await prepare(page, context);
  await page.addScriptTag({url:'/js/map-quick-tools-v657.js'});
  await page.locator('#mapQuickViewBtn').click();
  const menu = page.locator('#mapQuickPopoverView');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button > span:last-child')).toHaveText(['오늘 신규매물','계약완료 숨김','계약완료만 보기']);
  await page.locator('#mapQuickTodayBtn').click();
  await expect(page.locator('#mapQuickTodayBtn')).toHaveAttribute('aria-checked','true');
  await page.locator('#mapQuickTodayBtn').click();
  await expect(page.locator('#mapQuickTodayBtn')).toHaveAttribute('aria-checked','false');
  await page.locator('#mapQuickDoneOnlyBtn').click();
  await expect(page.locator('#mapQuickDoneOnlyBtn')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#mapQuickHideDoneBtn')).toHaveAttribute('aria-checked','false');
  await page.locator('#mapQuickHideDoneBtn').click();
  await expect(page.locator('#mapQuickHideDoneBtn')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#mapQuickDoneOnlyBtn')).toHaveAttribute('aria-checked','false');
  await page.screenshot({path:info.outputPath('simplified-view-menu.png')});
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

test('density size distinguishes counts and becomes compact when zoomed in without changing cluster membership', async ({page, context}) => {
  const h = await prepare(page, context);
  await installMap(page);
  const sizes = await page.evaluate(() => {
    const clusters = [1, 10, 100, 500, 1000].map(count => ({key: String(count), worldGrid: true, items: Array(count).fill(allItems[0])}));
    paintTestClusters(clusters);
    const measure = () => [...document.querySelectorAll('.design-test-overlay .circle-marker')].map(el => el.getBoundingClientRect().width);
    const wide = measure(); mapTest.level = 3; paintTestClusters(clusters); const close = measure();
    return {wide, close, counts: overlays.map(o => o.__cluster.items.length)};
  });
  expect(sizes.wide[0]).toBeLessThan(sizes.wide[1]);
  expect(sizes.wide[1]).toBeLessThan(sizes.wide[2]);
  expect(sizes.wide[2]).toBeLessThan(sizes.wide[3]);
  expect(sizes.wide[3]).toBeLessThan(sizes.wide[4]);
  expect(sizes.wide[0]).toBeGreaterThanOrEqual(40); expect(sizes.close[0]).toBeGreaterThanOrEqual(40);
  expect(sizes.wide[4]).toBe(110); expect(sizes.close[4]).toBeLessThanOrEqual(66);
  expect(sizes.counts).toEqual([1,10,100,500,1000]);
  for (const marker of await page.locator('.design-test-overlay .circle-marker').all()) {
    await expect(marker).toHaveCSS('border-top-width','0px');
    await expect(marker).toHaveCSS('box-shadow','none');
    await expect(marker).toHaveCSS('color','rgb(30, 41, 59)');
  }
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

test('pastel circles keep the same diameter and counts when selected, hovered and cleared', async ({page, context}, info) => {
  const h = await prepare(page, context);
  await installMap(page);
  await page.evaluate(() => {
    paintTestClusters([{key:'pastel-626',worldGrid:true,items:Array(626).fill(allItems[0])},
      {key:'pastel-12',worldGrid:true,items:Array(12).fill(allItems[0])}]);
  });
  const marker=page.locator('.design-test-overlay .circle-marker').first();
  const read=()=>marker.evaluate(el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {
    width:r.width,height:r.height,fill:c.backgroundColor,image:c.backgroundImage,shadow:c.boxShadow,
    filter:c.filter,border:parseFloat(c.borderTopWidth),borderColor:c.borderTopColor,text:el.textContent};});
  const before=await read();
  expect(before.fill).toBe('rgba(255, 224, 112, 0.62)');
  expect(before.image).toBe('none');expect(before.shadow).toBe('none');expect(before.text).toBe('626');
  await marker.hover();expect((await read()).filter).toBe('none');expect((await read()).shadow).toBe('none');
  await page.evaluate(()=>{selectedGroupKey='pastel-626';redrawSelectedMarkers();});
  const selected=await read();
  expect(selected.fill).toBe('rgba(255, 255, 255, 0.9)');expect(selected.borderColor).toBe('rgb(212, 181, 65)');
  expect(selected.border).toBeGreaterThanOrEqual(1);expect(selected.border).toBeLessThanOrEqual(1.5);
  expect(selected.width).toBe(before.width);expect(selected.height).toBe(before.height);
  expect(selected.image).toBe('none');expect(selected.shadow).toBe('none');expect(selected.text).toBe('626');
  await page.screenshot({path:info.outputPath('pastel-yellow-selected-626.png')});
  await page.evaluate(()=>{selectedGroupKey=null;redrawSelectedMarkers();});
  expect((await read()).fill).toBe(before.fill);expect((await read()).border).toBe(0);
  expect(await page.evaluate(()=>overlays.map(o=>o.__cluster.items.length))).toEqual([626,12]);
  expect(h.errors).toEqual([]);expect(h.writes).toEqual([]);
});

test('active spatial clusters stay flat pastel yellow while visit and completion states survive redraws', async ({page, context}) => {
  const h = await prepare(page, context);
  await installMap(page);
  await page.evaluate(() => {
    const base = allItems[0];
    const confirmed = {...base, address: '서구 괴정동 424-2', room: '2층', memo: '(확인매물)', sourceTypesV8: ['gongsil']};
    const pending = {...base, memo: '(임장가자)', sourceTypesV8: ['naver']};
    paintTestClusters([
      {key: 'confirmed', worldGrid: true, items: [confirmed]},
      {key: 'pending', worldGrid: true, items: [pending]},
      {key: 'mixed', worldGrid: true, items: [confirmed, pending]}
    ]);
    redrawSelectedMarkers();
  });
  const markers = page.locator('.design-test-overlay .circle-marker');
  const fills = () => markers.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  const initial = await fills();
  expect(initial).toEqual(Array(3).fill('rgba(255, 224, 112, 0.62)'));
  await expect(markers.nth(1)).toHaveClass(/source-gongsil/);
  await expect(markers.nth(2)).toHaveClass(/source-gongsil/);
  await expect(markers.nth(0)).not.toHaveClass(/source-gongsil/);
  await page.evaluate(() => {
    overlays[1].__cluster.items[0].memo = '(확인매물)';
    redrawSelectedMarkers();
  });
  expect((await fills())[1]).toBe('rgba(255, 224, 112, 0.62)');
  await expect(markers.nth(1)).not.toHaveClass(/source-gongsil/);
  await page.evaluate(() => {selectedGroupKey = 'pending'; redrawSelectedMarkers();});
  await expect(markers.nth(1)).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.9)');
  await page.evaluate(() => {
    selectedGroupKey = null;
    overlays[2].__cluster.items.forEach(item => {item.state = '계약완료';});
    redrawSelectedMarkers();
  });
  await expect(markers.nth(2)).toHaveCSS('background-color', 'rgba(226, 232, 240, 0.9)');
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

test('closing and reopening the same cluster preserves a deep list position and filter values', async ({page, context, isMobile}) => {
  test.skip(isMobile, 'Desktop panel scroll position');
  const h = await prepare(page, context);
  await installMap(page);
  await page.evaluate(() => {
    const base = allItems[0];
    allItems = Array.from({length:240}, (_, i) => ({...base, propertyId:'DESIGN-'+i, key:'design-'+i}));
    JSUnifiedListingsV8.attach(allItems, {ok:true, groups:Object.fromEntries(allItems.map(item => [item.propertyId, []]))});
    document.getElementById('maxRent').value = '130';
    paintTestClusters([{key:'deep', worldGrid:true, latlng:{x:0,y:0}, items:allItems}]);
  });
  await page.locator('.design-test-overlay .circle-marker').click();
  await page.locator('#sidebar').evaluate(el => {el.scrollTop = 6000;});
  await expect.poll(() => page.locator('#list').getAttribute('data-rendered-start')).not.toBe('0');
  const anchor = await page.locator('#sidebar').evaluate(el => {
    const top = el.getBoundingClientRect().top + 85;
    const row = [...el.querySelectorAll('#list .item')].find(row => row.getBoundingClientRect().bottom > top);
    return {id:row.dataset.listCardIdV681, top:row.getBoundingClientRect().top};
  });
  await page.locator('#mapListCloseV1').click();
  await page.locator('.design-test-overlay .circle-marker').click();
  const restored = await page.locator('#list .item').evaluateAll((rows, id) => rows.find(row => row.dataset.listCardIdV681 === id)?.getBoundingClientRect().top, anchor.id);
  expect(restored).toBeCloseTo(anchor.top, 0);
  await expect(page.locator('#maxRent')).toHaveValue('130');
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

test('phone-number states remain green/gray while ordinary action colors and selected cards stay restrained', async ({page, context, isMobile}, info) => {
  const h = await prepare(page, context);
  await page.evaluate(() => {
    const base = allItems[0];
    allItems = [{...base, key: 'with-phone', propertyId: 'WITH-PHONE', memo: '임대인 010-0000-0000'},
      {...base, key: 'without-phone', propertyId: 'WITHOUT-PHONE', memo: ''}];
    JSUnifiedListingsV8.attach(allItems, {ok:true, groups:{'WITH-PHONE':[], 'WITHOUT-PHONE':[]}});
    showList(allItems); JSMapListPanelV1.open();
  });
  const buttons = page.locator('#list .item-contact-button-v654');
  await expect(buttons.nth(0)).toHaveClass(/has-contacts/);
  await expect(buttons.nth(0)).toHaveCSS('background-color', 'rgb(16, 185, 129)');
  await expect(buttons.nth(1)).toHaveClass(/no-contacts/);
  await expect(buttons.nth(1)).toHaveCSS('background-color', 'rgb(229, 231, 235)');
  await expect(buttons.nth(1).locator('span')).toHaveCSS('color', 'rgb(135, 147, 162)');
  await expect(page.locator('#list .item-nav-btn').first()).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await page.locator('#list .item').first().evaluate(el => el.classList.add('selected'));
  await expect(page.locator('#list .item').first()).toHaveCSS('box-shadow', 'none');
  await page.screenshot({path: info.outputPath(isMobile ? 'phone-list.png' : 'desktop-contact-states.png')});
  if (isMobile) {
    await expect(page.locator('html')).toHaveAttribute('data-jsm-mobile-view', 'list');
    // The lease size selector now exposes this header on narrow phones.
    // Verify its existing close action instead of the pre-v80 hidden state.
    await expect(page.locator('#mapListCloseV1')).toBeVisible();
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    const beforeClose=await page.evaluate(()=>JSON.stringify(allItems));
    await page.locator('#mapListCloseV1').click();
    await expect(page.locator('html')).toHaveAttribute('data-jsm-mobile-view','map');
    await page.locator('[data-mobile-view="list"]').click();
    await expect(page.locator('#list .item')).toHaveCount(2);
    expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(beforeClose);
  }
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

test('unfolded landscape reclaims map width and opens the same fitted desktop list with reachable controls', async ({page, context, isMobile}, info) => {
  test.skip(!isMobile, 'Use the touch mobile context and native viewport fitting');
  const h = await prepare(page, context);
  await page.setViewportSize({width:930, height:530});
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {width:930, height:530, screenWidth:1100, screenHeight:720,
    mobile:true, deviceScaleFactor:1, screenOrientation:{type:'landscapePrimary', angle:90}});
  await expect(page.locator('html')).toHaveClass(/js-landscape-desktop-fit-v1/);
  await expect(page.locator('html')).not.toHaveClass(/js-map-list-closed-v1/);
  await expectListControls(page, true);
  expect(await page.locator('#map').evaluate(el => el.clientWidth)).toBeLessThan(1280);
  const search = await page.locator('#keyword').boundingBox();
  await installMap(page);
  await page.evaluate(() => paintTestClusters([{key:'unfolded', worldGrid:true, latlng:{x:0,y:0}, items:allItems}]));
  await page.locator('.design-test-overlay .circle-marker').tap();
  await expect(page.locator('#list .item').first()).toBeVisible();
  await expect(page.locator('#mapListCloseV1')).toBeVisible();
  await expectListControls(page, true);
  expect(await page.locator('#keyword').boundingBox()).toEqual(search);
  expect(await page.locator('html').evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(1281);
  await page.screenshot({path:info.outputPath('unfolded-landscape-list.png')});
  await page.locator('#mapListCloseV1').tap();
  await expect(page.locator('html')).toHaveClass(/js-map-list-closed-v1/);
  await expectListControls(page, false);
  expect(h.errors).toEqual([]); expect(h.writes).toEqual([]);
});

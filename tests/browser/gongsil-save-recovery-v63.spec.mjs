import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../js/gongsil-collector.js',import.meta.url),'utf8');
const url='https://www.gongsilbox.com/__isolated_v63_fixture';
test.beforeEach(async({page,context})=>{
  await context.route('**/*',route=>route.request().url()===url
    ?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>격리된 수집기 검수</body></html>'})
    :route.abort());
  await page.goto(url);
});

test('the new collector opens in an isolated browser without sending provider requests',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addScriptTag({content:source});
  await expect(page.locator('#js-gongsil-collector-panel')).toBeVisible();
  expect(await page.evaluate(()=>window.__JS_GONGSIL_COLLECTOR__.version)).toBe('2.3.4');
  expect(await page.evaluate(()=>window.__JS_GONGSIL_COLLECTOR__.isBusy())).toBe(false);
  expect(errors).toEqual([]);
});

for(const pending of [false,true])test(`updated code preserves an old ${pending?'pending save':'active run'} and its progress`,async({page})=>{
  await page.evaluate(pending=>{
    document.body.insertAdjacentHTML('beforeend','<section id="js-gongsil-collector-panel"><button data-action="stop">안전중단</button><p>기존 진행 100 / 300</p></section>');
    document.querySelector('[data-action="stop"]').disabled=pending;
    window.oldCollector={version:'2.3.2',getPendingSave:()=>pending?{records:[{id:'keep'}]}:null};
    window.__JS_GONGSIL_COLLECTOR__=window.oldCollector;
    window.oldFetch=window.fetch;
  },pending);
  await page.addScriptTag({content:source});
  expect(await page.evaluate(()=>window.__JS_GONGSIL_COLLECTOR__===window.oldCollector)).toBe(true);
  expect(await page.evaluate(()=>window.fetch===window.oldFetch)).toBe(true);
  await expect(page.locator('#js-gongsil-collector-panel')).toContainText('기존 진행 100 / 300');
});

test('a genuinely hung browser upload hits its deadline without submitting another request',async({page})=>{
  await page.clock.install();
  let posts=0;
  await page.route('https://js-map.com/api/collector',()=>{posts++;return new Promise(()=>{});});
  const helper=source.match(/^ {2}async function postAppsScriptWithRetry\([^]*?^ {2}}/m)[0];
  await page.addScriptTag({content:`var state={stopRequested:false};var COLLECTOR_API_URL='https://js-map.com/api/collector';var originalFetch=window.fetch.bind(window);\n${helper}`});
  await page.evaluate(()=>{window.upload=postAppsScriptWithRetry({action:'fixture',requestId:'same'}).catch(error=>{window.uploadError=error.message;});});
  await expect.poll(()=>posts).toBe(1);
  await page.clock.fastForward(30001);
  await expect.poll(()=>page.evaluate(()=>window.uploadError)).toContain('시간 초과');
  expect(posts).toBe(1);
});

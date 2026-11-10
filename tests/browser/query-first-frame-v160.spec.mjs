import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('public startup preloads download code while a denied session cannot execute listing code or read private data',async({page,context})=>{
  let downloaded=0,privateReads=0;
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/js/data-access-v6.js*',route=>{downloaded++;return route.continue();});
  await context.route('**/api/session',route=>route.fulfill({status:401,json:{ok:false}}));
  await context.route('**/api/auth-config',route=>route.fulfill({json:{googleClientId:'',localLoginEnabled:true}}));
  await context.route('**/api/data**',route=>{privateReads++;return route.fulfill({status:401,json:{ok:false}});});
  await context.route('**/',async route=>route.fulfill({contentType:'text/html',body:await readFile('index.html','utf8')}));
  await page.goto('/');await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
  await expect.poll(()=>downloaded).toBeGreaterThan(0);expect(privateReads).toBe(0);
  expect(await page.evaluate(()=>typeof window.JSDataAccessV6)).toBe('undefined');
  await expect(page.locator('#list .item')).toHaveCount(0);
});

test('refresh preview contains only proof-validated first-window cards even when virtualization has already appended another window',async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.route('**/preview-photo-v160.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#2563eb"/></svg>'}));
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/query-collection-v152.js'});await page.addScriptTag({url:'/js/query-preview-v154.js'});
  const result=await page.evaluate(()=>{
    map.getCenter=()=>({getLat:()=>36.3504,getLng:()=>127.3845});map.getLevel=()=>7;
    const ids=Array.from({length:12},(_,i)=>'FIRST-FRAME-'+i),proof='sha256-v1:'+'a'.repeat(64),signature=JSON.stringify({mode:'lease',filters:{sortFilter:'latest'},hideDone:true});
    const points=ids.slice(0,6).map(id=>({row:{property_id:id,source_snapshot_key:proof},unified:{ok:true,format:'expanded-v2',
      groups:{[id]:[{propertyId:id,originalId:'original-'+id}]},sourceSnapshotKeys:{[id]:proof},sourceSnapshotPropertyIds:{[id]:id}}}));
    const value={kind:'query-scope-v152',completeCatalog:false,account:JSAuthenticatedAccountEmail,cacheEpochV152:'',signature,points,
      packet:{ok:true,version:152,completeQuery:true,grouping:'client-v152',revision:'fixture-current',total:12,fields:['propertyId','sourceSnapshotKey'],rows:ids.map(id=>[id,proof])}};
    document.querySelector('#list').innerHTML=ids.map(id=>'<div class="item" data-property-id="'+id+'"><button><img src="/preview-photo-v160.svg" alt="검사 사진"></button></div>').join('');
    value.preview=JSQueryPreviewV154.capture(value);
    document.querySelector('#list').replaceChildren();document.documentElement.classList.add('auth-pending');document.querySelector('#wrap').inert=true;
    return {ids:value.preview?.ids,shown:JSQueryPreviewV154.show(value,signature,()=>true)};
  });
  expect(result.ids).toEqual(Array.from({length:6},(_,i)=>'FIRST-FRAME-'+i));expect(result.shown).toBe(true);
  await expect(page.locator('#list .item')).toHaveCount(6);
  await expect.poll(()=>page.locator('#list img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth===320))).toBe(true);
  expect(await page.locator('#wrap').evaluate(node=>node.inert)).toBe(true);
});

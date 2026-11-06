import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

async function setup(page,context) {
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
}
test('refresh verifies the persisted complete catalog with one tiny request and no full CSV/original download',async({page,context})=>{
  await setup(page,context);
  let whole=0,checks=0;
  await context.route('**/api/sheet',r=>{whole++;return r.fulfill({status:503,body:'unreachable full file'});});
  await context.route('**/api/data?**',r=>{
    const action=new URL(r.request().url()).searchParams.get('action');
    if(action==='dataRevision'){checks++;return r.fulfill({json:{ok:true,revision:'verified-r1'}});}
    if(action==='unifiedListings'){whole++;return r.fulfill({status:503,body:'unreachable full originals'});}return r.fallback();
  });
  await page.evaluate(async()=>{
    const items=__fixtureItems.filter(i=>i.tradeType==='lease');
    const groups=Object.fromEntries(items.map(i=>[i.propertyId,[{originalId:i.propertyId+'-ORIGINAL',source:'네이버',room:i.room,
      deposit:i.deposit,rent:i.rent,area:i.area,thumbnail:'',photoCount:0,active:true,tradeType:'lease'}]]));
    // Per-property proof results have a CSV baseline but no invented global
    // originals revision. This is the normal persistent-cache write path.
    await JSInitialListingsCacheV1.write(items,{ok:true,groups},{revision:'verified-r1'});
    window.kakao={maps:{load(){},LatLng:function(a,b){this.getLat=()=>a;this.getLng=()=>b;}}};
  });
  await page.addScriptTag({content:await readFile(new URL('../../js/map.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{
    document.getElementById('fixtureControls')?.remove();
    window.drawItems=items=>{showList(items);updateMapListingCountV825(items);};window.clearPinnedClusterSelectionV6515=()=>{};
    allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();
    JSInitialListingsCacheV1.warm();JSDataAccessV6.warmInitialData();void loadSheet(false,false);
  });
  await expect(page.locator('html')).toHaveAttribute('data-initial-cache-validated-v125','true');
  await expect(page.locator('#list .item')).toHaveCount(2);
  await expect(page.locator('#list')).toContainText('테스트 괴정 상가');
  expect({whole,checks}).toEqual({whole:0,checks:1});
  expect(await page.evaluate(()=>({revision:jsListingsRevisionV682,loading:isLoadingSheet,phase:jsListingsLoadStateV65.phase})))
    .toEqual({revision:'verified-r1',loading:false,phase:'ready'});
});

test('PC and mobile decode the real gzip ranges, retry one failed range, and preserve exact CSV IDs and quoted memos',async({page,context})=>{
  await setup(page,context);
  const text='name,address,id,memo\r\n"건물 A","같은 주소","A","첫줄\n둘째줄"\r\n"건물 B","같은 주소","B","다른 메모"';
  const bytes=gzipSync(text);let manifests=0,ranges=0;
  await context.route('**/api/sheet',r=>{
    const h=r.request().headers();
    if(h['x-js-snapshot-mode']==='manifest-v125'){manifests++;return r.fulfill({headers:{'x-js-snapshot-protocol':'ranges-v125','x-js-listings-scope':'lease'},json:{ok:true,protocol:'ranges-v125',etag:'"fixture"',size:bytes.length,chunkBytes:262144,revision:'range-r1',encoding:'gzip',contentType:'text/csv'}});}
    ranges++;if(ranges===1)return r.fulfill({status:503,body:'one transient failure'});
    const offset=Number(h['x-js-snapshot-offset']),length=Number(h['x-js-snapshot-length']);
    return r.fulfill({headers:{'content-type':'application/octet-stream','x-js-snapshot-etag':'"fixture"','x-js-snapshot-offset':String(offset),'x-js-snapshot-length':String(length)},body:bytes.subarray(offset,offset+length)});
  });
  const result=await page.evaluate(async()=>{const r=await JSDataAccessV6.listingsSnapshot(false);return{rows:r.rows,revision:r.revision};});
  expect(result).toEqual({rows:[['name','address','id','memo'],['건물 A','같은 주소','A','첫줄\n둘째줄'],['건물 B','같은 주소','B','다른 메모']],revision:'range-r1'});
  expect({manifests,ranges}).toEqual({manifests:1,ranges:2});
});

test('confirmed saves invalidate only the global validation receipt while preserving the saved master and its neighbor',async({page,context})=>{
  await setup(page,context);
  expect(await page.evaluate(async()=>{
    const c=JSInitialListingsCacheV1,a={propertyId:'A',memo:'old A'},b={propertyId:'B',memo:'old B'};
    await c.write([a,b],{ok:true,groups:{A:[],B:[]}},{revision:'base'});
    const before=await c.read();await c.commitItem(a,{persisted:true,propertyId:'A',memo:'saved A'});
    const after=await c.read();return{before:before.baselineRevisionV125,after:after.baselineRevisionV125,values:after.items.map(i=>[i.propertyId,i.memo])};
  })).toEqual({before:'base',after:'',values:[['A','saved A'],['B','old B']]});
});

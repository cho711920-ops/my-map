import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

async function setup(page,context) {
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.addScriptTag({url:'/js/initial-listings-cache-v1.js'});
}

for (const proofValid of [true,false]) test('collector delta over 50 IDs reloads without full files and preserves a same-address neighbor: '+(proofValid?'valid source proof':'wrong source parent rejected'),async({page,context})=>{
  await setup(page,context);let whole=0,points=0;const proof='sha256-v1:'+'a'.repeat(64);
  await context.route('**/api/sheet',r=>{whole++;return r.fulfill({status:503,body:'full file unavailable'});});
  await context.route('**/api/data?**',r=>{
    const u=new URL(r.request().url()),action=u.searchParams.get('action');
    if(action==='dataRevision')return r.fulfill({json:{ok:true,revision:'r2',fullReload:false,changeIds:Array.from({length:75},(_,i)=>i?'REMOVED-'+i:'A')}});
    if(action==='unifiedListings'){whole++;return r.fulfill({status:503,body:'full originals unavailable'});}
    if(action==='listingOriginals'){
      points++;const batch=u.searchParams.get('ids').split(',');expect(batch.length).toBeLessThanOrEqual(50);if(!batch.includes('A'))return r.fulfill({json:{ok:true,requestedIds:batch,missingIds:batch,items:[],unified:{ok:true,format:'expanded-v2',groups:{},sourceSnapshotKeys:{},sourceSnapshotPropertyIds:{},sourceSearchIds:{}}}});
      return r.fulfill({json:{ok:true,requestedIds:batch,missingIds:batch.filter(id=>id!=='A'),items:[{id:'A',property_id:'A',title:'검수 A',address:'서구 괴정동 1-1',room:'1층',listing_type:'상가',deposit:2000,monthly_rent:150,operating_memo:'A 최신 메모',status:'active',trade_type:'lease',area_m2:10,latitude:36.35,longitude:127.38,source_snapshot_key:proof}],
        unified:{ok:true,format:'expanded-v2',groups:{A:[{propertyId:proofValid?'A':'B',originalId:'ad-A',source:'네이버',room:'1층',deposit:2000,rent:150,area:10,active:1,tradeType:'lease'}]},sourceSnapshotKeys:{A:proof},sourceSnapshotPropertyIds:{A:'A'},sourceSearchIds:{A:[]}}}});
    }
    return r.fallback();
  });
  await page.evaluate(async()=>{
    const items=['A','B',...Array.from({length:74},(_,i)=>'REMOVED-'+(i+1))].map((id,index)=>({propertyId:id,name:'검수 '+id,address:'서구 괴정동 1-1',room:'1층',type:'상가',tradeType:'lease',deposit:2000,rent:index?200:100,memo:id+' 기존 메모',state:'active',area:10,latitude:36.35,longitude:127.38}));
    const groups=Object.fromEntries(items.map(i=>[i.propertyId,[{originalId:'ad-'+i.propertyId,source:'네이버',room:'1층',deposit:2000,rent:i.rent,area:10,active:1,tradeType:'lease'}]]));
    await JSInitialListingsCacheV1.write(items,{ok:true,groups},{revision:'r1'});
    window.kakao={maps:{load(){},LatLng:function(a,b){this.getLat=()=>a;this.getLng=()=>b;}}};
  });
  await page.addScriptTag({content:await readFile(new URL('../../js/map.js',import.meta.url),'utf8')});
  await page.evaluate(()=>{
    document.getElementById('fixtureControls')?.remove();window.drawItems=items=>showList(items);window.clearPinnedClusterSelectionV6515=()=>{};
    allItems=[];currentItems=[];visibleListItems=[];document.getElementById('list').replaceChildren();
    JSInitialListingsCacheV1.warm();JSDataAccessV6.warmInitialData();window.__deltaLoadV125=loadSheet(false,false);
  });
  if (!proofValid) {
    await expect.poll(()=>page.evaluate(()=>jsListingsLoadStateV65.phase)).toBe('error');
    expect(await page.evaluate(()=>allItems.length)).toBe(76);expect(await page.evaluate(()=>allItems.filter(i=>['A','B'].includes(i.propertyId)).map(i=>[i.propertyId,i.rent,i.memo]))).toEqual([['A',100,'A 기존 메모'],['B',200,'B 기존 메모']]);
    expect({whole,points}).toEqual({whole:0,points:2});
    expect(await page.evaluate(async()=>(await JSInitialListingsCacheV1.read()).baselineRevisionV125)).toBe('r1');
    expect(await page.evaluate(()=>jsListingsRevisionV682)).toBe('r1');
    return;
  }
  await expect(page.locator('html')).toHaveAttribute('data-initial-cache-validated-v125','true');
  expect(await page.evaluate(()=>allItems.map(i=>[i.propertyId,i.rent,i.memo]))).toEqual([['A',150,'A 최신 메모'],['B',200,'B 기존 메모']]);
  expect({whole,points}).toEqual({whole:0,points:2});
  const saved=await page.evaluate(async()=>{const c=await JSInitialListingsCacheV1.read();return{revision:c.baselineRevisionV125,values:c.items.map(i=>[i.propertyId,i.rent,i.memo])};});
  expect(saved).toEqual({revision:'r2',values:[['A',150,'A 최신 메모'],['B',200,'B 기존 메모']]});
  expect(await page.evaluate(()=>({same:JSInitialListingsCacheV1.needsRefresh('r2'),changed:JSInitialListingsCacheV1.needsRefresh('r3')})))
    .toEqual({same:false,changed:true});
});

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
    JSInitialListingsCacheV1.warm();JSDataAccessV6.warmInitialData();window.__deltaLoadV125=loadSheet(false,false);
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

test('confirmed saves keep the old watermark and exact revalidation IDs while preserving the saved master and its neighbor',async({page,context})=>{
  await setup(page,context);
  expect(await page.evaluate(async()=>{
    const c=JSInitialListingsCacheV1,a={propertyId:'A',memo:'old A'},b={propertyId:'B',memo:'old B'};
    await c.write([a,b],{ok:true,groups:{A:[],B:[]}},{revision:'base'});
    const before=await c.read();await c.commitItem(a,{persisted:true,propertyId:'A',memo:'saved A'});
    const after=await c.read();return{before:before.baselineRevisionV125,after:after.baselineRevisionV125,confirmed:after.confirmedIdsV125,values:after.items.map(i=>[i.propertyId,i.memo])};
  })).toEqual({before:'base',after:'base',confirmed:['A'],values:[['A','saved A'],['B','old B']]});
  expect(await page.evaluate(async()=>{
    const c=JSInitialListingsCacheV1,before=await c.read();
    await c.write(before.items,before.unified,{revision:before.baselineRevisionV125,preserveSavedAt:true});
    return (await c.read()).savedAt===before.savedAt;
  })).toBe(true);
});

for (const proofValid of [true,false]) test('a reload handles an exact-master delta without a full download or neighbor overwrite: '+(proofValid?'valid source proof':'wrong source parent rejected'),async({page,context})=>{
  await setup(page,context);let whole=0,points=0;const proof='sha256-v1:'+'a'.repeat(64);
  await context.route('**/api/sheet',r=>{whole++;return r.fulfill({status:503,body:'full file unavailable'});});
  await context.route('**/api/data?**',r=>{
    const u=new URL(r.request().url()),action=u.searchParams.get('action');
    if(action==='dataRevision')return r.fulfill({json:{ok:true,revision:'r2',fullReload:false,changeIds:['A']}});
    if(action==='unifiedListings'){whole++;return r.fulfill({status:503,body:'full originals unavailable'});}
    if(action==='listingOriginals'){
      points++;expect(u.searchParams.get('ids')).toBe('A');
      return r.fulfill({json:{ok:true,requestedIds:['A'],missingIds:[],items:[{id:'A',property_id:'A',title:'검수 A',address:'서구 괴정동 1-1',room:'1층',listing_type:'상가',deposit:2000,monthly_rent:150,operating_memo:'A 최신 메모',status:'active',trade_type:'lease',area_m2:10,latitude:36.35,longitude:127.38,source_snapshot_key:proof}],
        unified:{ok:true,format:'expanded-v2',groups:{A:[{propertyId:proofValid?'A':'B',originalId:'ad-A',source:'네이버',room:'1층',deposit:2000,rent:150,area:10,active:1,tradeType:'lease'}]},sourceSnapshotKeys:{A:proof},sourceSnapshotPropertyIds:{A:'A'},sourceSearchIds:{A:[]}}}});
    }
    return r.fallback();
  });
  await page.evaluate(async()=>{
    const items=['A','B'].map((id,index)=>({propertyId:id,name:'검수 '+id,address:'서구 괴정동 1-1',room:'1층',type:'상가',tradeType:'lease',deposit:2000,rent:index?200:100,memo:id+' 기존 메모',state:'active',area:10,latitude:36.35,longitude:127.38}));
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
    expect(await page.evaluate(()=>allItems.map(i=>[i.propertyId,i.rent,i.memo]))).toEqual([['A',100,'A 기존 메모'],['B',200,'B 기존 메모']]);
    expect({whole,points}).toEqual({whole:0,points:1});
    expect(await page.evaluate(async()=>(await JSInitialListingsCacheV1.read()).baselineRevisionV125)).toBe('r1');
    expect(await page.evaluate(()=>jsListingsRevisionV682)).toBe('r1');
    return;
  }
  await expect(page.locator('html')).toHaveAttribute('data-initial-cache-validated-v125','true');
  expect(await page.evaluate(()=>allItems.map(i=>[i.propertyId,i.rent,i.memo]))).toEqual([['A',150,'A 최신 메모'],['B',200,'B 기존 메모']]);
  expect({whole,points}).toEqual({whole:0,points:1});
  const saved=await page.evaluate(async()=>{const c=await JSInitialListingsCacheV1.read();return{revision:c.baselineRevisionV125,values:c.items.map(i=>[i.propertyId,i.rent,i.memo])};});
  expect(saved).toEqual({revision:'r2',values:[['A',150,'A 최신 메모'],['B',200,'B 기존 메모']]});
  expect(await page.evaluate(()=>({same:JSInitialListingsCacheV1.needsRefresh('r2'),changed:JSInitialListingsCacheV1.needsRefresh('r3')})))
    .toEqual({same:false,changed:true});
});

for(const outcome of ['matching','proof','wrong-proof','failed','mismatched','edited'])test('a full refresh retains the complete visible pair until matching originals arrive: '+outcome,async({page,context})=>{
  await setup(page,context);
  await page.evaluate(()=>{window.kakao={maps:{load(){},LatLng:function(a,b){this.getLat=()=>a;this.getLng=()=>b;}}};});
  await page.addScriptTag({content:await readFile(new URL('../../js/map.js',import.meta.url),'utf8')});
  await page.evaluate(outcome=>{
    document.getElementById('fixtureControls')?.remove();window.drawItems=items=>showList(items);window.clearPinnedClusterSelectionV6515=()=>{};
    allItems=__fixtureItems.filter(i=>i.tradeType==='lease').map(i=>({...i,memo:'확인된 기존 메모'}));
    currentItems=allItems;visibleListItems=allItems;jsListingsCompleteBaseV1=true;jsListingsRevisionV682='r1';
    showList(allItems);window.__stagedCardV126=document.querySelector('#list .item');
    const rows=[Array(33).fill('header'),...allItems.map(i=>{
      const r=Array(33).fill('');r[0]=i.name;r[1]=i.address;r[2]=i.room;r[3]=i.type;r[4]='2000';r[5]='999';r[8]='10';r[11]='네트워크 새 메모';r[12]='active';r[14]='네이버';r[15]=i.propertyId;r[25]='36.35';r[26]='127.38';r[28]='lease';if(outcome.includes('proof'))r[32]='sha256-v1:'+'b'.repeat(64);return r;
    })];
    window.JSDataAccessV6={...JSDataAccessV6,listingsSnapshot:async()=>({rows,revision:'r2',scope:'lease'})};
    window.JSUnifiedListingsV8={...JSUnifiedListingsV8,load:()=>new Promise(resolve=>{window.__finishOriginalsV126=resolve;})};
    window.__stagedWorkV126=loadSheet(true,true);
  },outcome);
  await expect(page.locator('html')).toHaveAttribute('data-listings-pair-staged-v126','pending');
  expect(await page.evaluate(()=>({same:document.querySelector('#list .item')===__stagedCardV126,memos:allItems.map(i=>i.memo),revision:jsListingsRevisionV682})))
    .toEqual({same:true,memos:['확인된 기존 메모','확인된 기존 메모'],revision:'r1'});
  await page.evaluate(outcome=>{
    if(outcome==='edited')allItems[0].memo='사용자가 방금 확정한 메모';
    const groups=Object.fromEntries(allItems.map(i=>{
      const known=JSUnifiedListingsV8.allOriginals(i.propertyId);
      const rows=known.length?known:[{originalId:i.propertyId+'-ad',source:'네이버'}];
      return [i.propertyId,rows.map(original=>({...original,propertyId:i.propertyId,active:true,tradeType:'lease',rent:999,deposit:2000,area:10}))];
    }));
    const result=outcome==='failed'?{ok:false,groups:{}}:{ok:true,groups,snapshotRevision:outcome==='mismatched'?'r3':'r2'};
    if(outcome.includes('proof')){
      result.sourceSnapshotKeys=Object.fromEntries(allItems.map(i=>[i.propertyId,'sha256-v1:'+'b'.repeat(64)]));
      result.sourceSnapshotPropertyIds=Object.fromEntries(allItems.map(i=>[i.propertyId,i.propertyId]));
      if(outcome==='wrong-proof')Object.values(groups).forEach(rows=>{rows[0].propertyId='wrong-parent';});
    }
    __finishOriginalsV126(result);
  },outcome);
  await page.evaluate(()=>__stagedWorkV126);
  if(outcome==='matching'||outcome==='proof'){
    expect(await page.evaluate(()=>({rents:allItems.map(i=>i.rent),revision:jsListingsRevisionV682,phase:jsListingsLoadStateV65.phase})))
      .toEqual({rents:[999,999],revision:'r2',phase:'ready'});
  }else{
    expect(await page.evaluate(()=>({same:document.querySelector('#list .item')===__stagedCardV126,memos:allItems.map(i=>i.memo),revision:jsListingsRevisionV682,phase:jsListingsLoadStateV65.phase})))
      .toEqual({same:true,memos:[outcome==='edited'?'사용자가 방금 확정한 메모':'확인된 기존 메모','확인된 기존 메모'],revision:'r1',phase:'error'});
  }
});

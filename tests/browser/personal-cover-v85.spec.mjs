import {test,expect} from '@playwright/test';
test.use({launchOptions:{args:['--auto-accept-this-tab-capture','--allow-http-screen-capture','--enable-usermedia-screen-capturing']}});

async function setup(page,mockCapture=true){
  const state={covers:new Map(),images:new Map(),writes:[],fail:false,lost:false,indexReads:0};
  await page.context().route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.route('**/api/personal-cover?*',async route=>{
    const req=route.request(),url=new URL(req.url()),id=url.searchParams.get('propertyId'),imageId=url.searchParams.get('imageId');
    const json=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(imageId)return route.fulfill({status:200,contentType:'image/jpeg',body:Buffer.from((state.images.get(imageId)||'').split(',')[1]||'','base64')});
    if(req.method()==='POST'){
      const body=req.postDataJSON();state.writes.push(body);
      if(state.fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'저장 실패 검사'})});
      const imageId=body.action==='reset'?'':crypto.randomUUID(),cover={propertyId:body.propertyId,imageId,requestId:body.requestId,version:(state.covers.get(body.propertyId)?.version||0)+1};
      if(imageId){cover.url='/api/personal-cover?propertyId='+body.propertyId+'&imageId='+imageId;cover.thumbnailUrl=cover.url+'&kind=thumb';state.images.set(imageId,body.image);}
      state.covers.set(body.propertyId,cover);if(state.lost){state.lost=false;return route.abort();}return json({ok:true,persisted:true,cover});
    }
    if(id)return json({ok:true,cover:state.covers.get(id)||{propertyId:id,imageId:'',version:0}});
    state.indexReads++;return json({ok:true,covers:[...state.covers.values()],nextCursor:''});
  });
  if(mockCapture)await page.addInitScript(()=>{
    window.__capture={config:null,stops:0,wrong:false,cancel:false,late:false};
    Object.defineProperty(navigator.mediaDevices,'setCaptureHandleConfig',{configurable:true,value:config=>__capture.config=config});
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
      if(__capture.cancel)throw new DOMException('cancel','NotAllowedError');
      if(__capture.late)await new Promise(resolve=>window.__releaseCapture=resolve);
      const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;const c=canvas.getContext('2d');c.fillStyle='#ff0000';c.fillRect(0,0,canvas.width,canvas.height);
      const panel=document.querySelector(currentRoadviewMode==='naver'?'.naver-roadview-panorama-panel-v654':'#roadviewPane'),r=panel.getBoundingClientRect();c.fillStyle='#00aa00';c.fillRect(r.left,r.top,r.width,r.height);
      const stream=canvas.captureStream(10),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{__capture.stops++;stop();};
      track.getSettings=()=>({displaySurface:'browser'});track.getCaptureHandle=()=>({origin:location.origin,handle:__capture.wrong?'wrong-tab':__capture.config.handle});return stream;
    }});
  });
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(()=>document.getElementById('fixtureControls').remove());return state;
}
async function roadview(page,mode='naver',index=0){
  await page.evaluate(({mode,index})=>{
    currentRoadviewItemKey=allItems[index].key;currentRoadviewMode=mode;roadviewOpenSequenceV653++;
    const modal=document.getElementById('roadviewModal');modal.classList.add('open');modal.setAttribute('aria-hidden','false');
    for(const [id,active] of [['naverRoadviewPane',mode==='naver'],['roadviewPane',mode==='kakao'],['roadviewMapPane',mode==='map']])document.getElementById(id).classList.toggle('active',active);
    document.querySelectorAll('#naverRoadviewModalStatus,#roadviewModalStatus').forEach(el=>el.hidden=true);
    JSListingCoverV85.contextChanged();
  },{mode,index});
  await page.locator('#roadviewCoverButtonV85').click();await expect(page.locator('.cover-editor-v85')).toBeVisible();
  await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('미리보기');
}
async function upload(page){
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;const g=c.getContext('2d');g.fillStyle='#00aa00';g.fillRect(0,0,600,400);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('.cover-editor-v85 input').setInputFiles({name:'building.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await expect(page.locator('[data-cover-save-v85]')).toBeEnabled();
}
test('Naver crop contains only building panel, excluding right map/header, Kakao uses its own panel',async({page,isMobile})=>{
  test.skip(isMobile,'Native tab capture is a desktop browser capability; mobile upload tested separately.');
  const state=await setup(page);await roadview(page);
  for(const mode of ['naver','kakao']){
    if(mode==='kakao'){await page.locator('[data-cover-close-v85]').click();await roadview(page,mode);}
    await page.locator('[data-cover-capture-v85]').click();await expect(page.locator('.cover-preview-v85 img')).toBeVisible();
    const pixels=await page.locator('.cover-preview-v85 img').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const values=[[0,0],[c.width-2,2],[c.width-2,c.height-2],[c.width/2,c.height/2]].map(([a,b])=>Array.from(x.getImageData(a,b,1,1).data));return {width:c.width,height:c.height,values};});
    // Video chroma subsampling and JPEG soften the outermost pixel; a red map
    // pixel would remain predominantly red. Every tested edge must stay green.
    for(const color of pixels.values){expect(color[0]).toBeLessThan(60);expect(color[1]).toBeGreaterThan(125);expect(color[2]).toBeLessThan(30);}
    expect(pixels.width).toBeLessThanOrEqual(1280);
    await page.locator('[data-cover-save-v85]').click();await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('저장했습니다');
  }
  expect(state.writes.map(w=>w.source)).toEqual(['naver','kakao']);expect(await page.evaluate(()=>__capture.stops)).toBeGreaterThanOrEqual(2);
});
test('upload persists across reload, affects only exact listing, originals preserved and reset restores',async({page,isMobile},testInfo)=>{
  const state=await setup(page);const before=await page.evaluate(()=>JSON.stringify(allItems));await roadview(page);await upload(page);
  await page.screenshot({path:testInfo.outputPath('cover-preview.png')});await page.locator('[data-cover-save-v85]').click();await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('저장했습니다');
  await page.locator('[data-cover-close-v85]').click();await page.evaluate(()=>closeRoadviewModal());
  await expect(page.locator('img[data-cover-image-v85]')).toHaveCount(1);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await expect(page.locator('img[data-cover-image-v85]')).toHaveCount(1);
  expect(state.indexReads).toBe(2);
  await page.evaluate(()=>openUnifiedFavoritesV7());
  if(isMobile)await page.evaluate(()=>JSPhoneFavoritesV2.showFolder('fixture-favorites'));else await page.evaluate(()=>toggleUnifiedFavoriteFolderV7('fixture-favorites'));
  await expect(page.locator('#unifiedFavoriteModalV7 [data-cover-property-v85="FIXTURE-LEASE-1"] img')).toHaveAttribute('src',/\/api\/personal-cover/);
  await page.evaluate(()=>closeUnifiedFavoritesV7());await page.evaluate(()=>JSUnifiedListingsV8.open(encodeURIComponent(allItems[0].propertyId)));
  await expect(page.locator('.cover-detail-v85>img')).toBeVisible();await page.getByRole('button',{name:'광고사진',exact:true}).click();await expect(page.locator('.cover-detail-v85>img')).toBeHidden();await expect(page.locator('.unified-detail-gallery-v8')).toBeVisible();
  await page.evaluate(()=>JSUnifiedListingsV8.close());await roadview(page);await page.locator('[data-cover-reset-v85]').click();await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('복원했습니다');
  await expect(page.locator('img[data-cover-image-v85]')).toHaveCount(0);
});
test('failed save preserves preview, lost response reconciles without duplicate write',async({page})=>{
  const state=await setup(page);await roadview(page);await upload(page);state.fail=true;
  await page.locator('[data-cover-save-v85]').click();await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('미리보기는 유지');await expect(page.locator('.cover-preview-v85 img')).toBeVisible();
  state.fail=false;state.lost=true;await page.locator('[data-cover-save-v85]').click();await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('저장했습니다');expect(state.covers.size).toBe(1);expect(state.writes[0].requestId).toBe(state.writes[1].requestId);
});
test('wrong tab and capture cancellation are recoverable and never upload a screenshot',async({page,isMobile})=>{
  test.skip(isMobile,'Desktop screen sharing');const state=await setup(page);await roadview(page);await page.evaluate(()=>__capture.wrong=true);await page.locator('[data-cover-capture-v85]').click();
  await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('현재 JS부동산 탭');await expect(page.locator('[data-cover-save-v85]')).toBeDisabled();expect(await page.evaluate(()=>__capture.stops)).toBeGreaterThan(0);
  await page.evaluate(()=>{__capture.wrong=false;__capture.cancel=true;});await page.locator('[data-cover-capture-v85]').click();await expect(page.locator('.cover-editor-v85 [role=status]')).toContainText('취소');expect(state.writes).toHaveLength(0);
});
test('late capture after listing change stops tracks and cannot attach photo to new listing',async({page,isMobile})=>{
  test.skip(isMobile,'Desktop screen sharing');const state=await setup(page);await roadview(page);await page.evaluate(()=>__capture.late=true);await page.locator('[data-cover-capture-v85]').click();
  await page.evaluate(()=>{currentRoadviewItemKey=allItems[1].key;roadviewOpenSequenceV653++;JSListingCoverV85.contextChanged();__releaseCapture();});
  await expect.poll(()=>page.evaluate(()=>__capture.stops)).toBeGreaterThan(0);await expect(page.locator('.cover-editor-v85')).toBeHidden();expect(state.writes).toHaveLength(0);
});
test('map mode cannot capture and a changed account cannot save a prepared image',async({page})=>{
  const state=await setup(page);await roadview(page,'map');await expect(page.locator('[data-cover-capture-v85]')).toBeDisabled();await upload(page);
  await page.evaluate(()=>{window.JSAuthenticatedAccountEmail='different@example.invalid';});await page.locator('[data-cover-save-v85]').click();expect(state.writes).toHaveLength(0);
});

test('delayed clipboard result cannot become another listing photo',async({page})=>{
  const state=await setup(page);await roadview(page);await page.evaluate(()=>{
    navigator.clipboard.read=()=>new Promise(resolve=>window.__clipboardResolve=resolve);
  });await page.locator('[data-cover-paste-v85]').click();await page.locator('[data-cover-close-v85]').click();await roadview(page,'naver',1);
  await page.evaluate(()=>__clipboardResolve([{types:['image/png'],getType:async()=>{const c=document.createElement('canvas');c.width=c.height=50;return new Promise(resolve=>c.toBlob(resolve,'image/png'));}}]));
  await expect(page.locator('[data-cover-save-v85]')).toBeDisabled();await expect(page.locator('.cover-preview-v85 img')).toBeHidden();expect(state.writes).toHaveLength(0);
});

test.describe('native screen sharing in an isolated browser',()=>{
  test('real current-tab capture confirms capture handle and excludes neighboring map',async({page,isMobile})=>{
    test.skip(isMobile,'Desktop native tab capture');await setup(page,false);await roadview(page);
    await page.evaluate(()=>{
      const panel=document.querySelector('.naver-roadview-panorama-panel-v654');panel.style.background='#00aa00';panel.querySelectorAll('*').forEach(el=>el.style.visibility='hidden');
      document.querySelector('.naver-roadview-map-panel-v654').style.background='#ff0000';
    });
    await page.locator('[data-cover-capture-v85]').click();await expect(page.locator('.cover-preview-v85 img')).toBeVisible({timeout:15000});
    const center=await page.locator('.cover-preview-v85 img').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(c.width/2,c.height/2,1,1).data);});
    expect(center[0]).toBeLessThan(15);expect(center[1]).toBeGreaterThan(150);expect(center[2]).toBeLessThan(15);
  });
});

import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV+kAAAAASUVORK5CYII=','base64');
const email='browser-fixture@example.invalid';
function samplePdf(){
 const stream=color=>{const text=color+' rg 0 0 200 300 re f\n0 0 0 rg BT /F1 14 Tf 10 260 Td (LEASE TABLE) Tj ET\n';return '<< /Length '+Buffer.byteLength(text)+' >>\nstream\n'+text+'endstream';};
 const resources='/Resources << /Font << /F1 7 0 R >> >>';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] '+resources+' /Contents 4 0 R >>',stream('0 1 0'),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] '+resources+' /Contents 6 0 R >>',stream('1 0 0'),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let body='%PDF-1.7\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(body));body+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
 const start=Buffer.byteLength(body);body+='xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(body);
}
const pdf=samplePdf();
function item(propertyId,filename='임대현황표.png'){
 const id=crypto.randomUUID(),query=new URLSearchParams({propertyId,file:id,owner:'1'.repeat(64)});
 return {id,propertyId,filename,mediaType:'image/png',byteSize:png.length,uploadedAt:'2026-11-11T03:04:00.000Z',deletedAt:'',version:1,url:'/api/listing-attachments?'+query,downloadUrl:'/api/listing-attachments?'+query+'&download=1'};
}
async function setup(page,context,isMobile,options={}){
 const files=options.files||[],writes=[],fileReads=[],vendorReads=[],held=[];let holdBadges=Boolean(options.holdBadges),heldListing=options.heldListing||'';
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await context.route('**/assets/vendor/pdfjs-6.5.438/**',async route=>{const path=new URL(route.request().url()).pathname;vendorReads.push(path);return route.fulfill({body:await readFile(new URL('../../'+path.slice(1),import.meta.url)),contentType:path.endsWith('.mjs')?'text/javascript':'application/octet-stream'});});
 await context.route('**/api/listing-attachments?**',async route=>{
  const request=route.request(),u=new URL(request.url()),id=u.searchParams.get('propertyId');
  if(request.method()==='GET'&&u.searchParams.has('ids')){
   const counts=Object.fromEntries(u.searchParams.get('ids').split(',').map(id=>[id,files.filter(f=>f.propertyId===id&&!f.deletedAt).length]));
   if(holdBadges){held.push(()=>route.fulfill({json:{ok:true,counts}}));return;}
   return route.fulfill({json:{ok:true,counts}});
  }
  if(request.method()==='GET'&&u.searchParams.has('file')){fileReads.push(u.searchParams.get('file'));if(options.failPreview)return route.fulfill({status:503,body:'Unavailable'});if(options.holdPreview)await new Promise(resolve=>held.push(resolve));const file=files.find(f=>f.id===u.searchParams.get('file'));return route.fulfill({body:file?.mediaType==='application/pdf'?pdf:png,contentType:file?.mediaType||'image/png',headers:{'cache-control':'private, no-store','content-security-policy':"sandbox; default-src 'none'; frame-ancestors 'none'"}});}
  if(request.method()==='GET'){
   const respond=()=>route.fulfill({json:{ok:true,propertyId:id,items:files.filter(f=>f.propertyId===id),maxFileBytes:20971520}});
   if(id===heldListing){held.push(respond);return;}return respond();
  }
  if(request.headers()['content-type']==='application/octet-stream'){
   const fileId=request.headers()['x-attachment-request'];writes.push({propertyId:id,id:fileId,bytes:request.postDataBuffer(),account:request.headers()['x-expected-account']});
   let saved=files.find(f=>f.id===fileId);if(!saved){saved={...item(id,decodeURIComponent(request.headers()['x-attachment-filename'])),id:fileId};const q=new URLSearchParams({propertyId:id,file:fileId,owner:'1'.repeat(64)});saved.url='/api/listing-attachments?'+q;saved.downloadUrl=saved.url+'&download=1';files.push(saved);}
   if(options.lostResponse&&!options.lostOnce){options.lostOnce=true;return route.abort();}
   return route.fulfill({json:{ok:true,persisted:true,item:saved}});
  }
  const body=request.postDataJSON(),saved=files.find(f=>f.id===body.id&&f.propertyId===body.propertyId);
  if(!saved)return route.fulfill({status:404,json:{ok:false,message:'다른 매물'}});
  writes.push(body);saved.deletedAt=body.action==='trash'?'2026-11-11T04:00:00Z':'';saved.version++;
  return route.fulfill({json:{ok:true,persisted:true,item:saved}});
 });
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
 await page.locator('#fixtureControls').evaluate(el=>el.remove());
 return {files,writes,fileReads,vendorReads,held,release:async()=>{holdBadges=false;heldListing='';await Promise.all(held.splice(0).map(run=>run()));}};
}
function button(page,id){return page.locator('#list .item[data-property-id="'+id+'"]').getByRole('button',{name:/^첨부자료 열기/});}
async function upload(page,name='임대현황표.png'){
 const chooser=page.waitForEvent('filechooser');await page.locator('#listingAttachmentsDialogV181 [data-add]').click();
 await (await chooser).setFiles({name,mimeType:'image/png',buffer:png});
 await expect(page.locator('#listingAttachmentsDialogV181 [role=status]')).toContainText('첨부했습니다');
}
test('private upload persists on exact listing, shows red count and Korean upload date, and opens the actual image only on request',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile),id='FIXTURE-LEASE-1',before=await page.evaluate(()=>JSON.stringify(allItems));
 expect(await page.evaluate(()=>Boolean(window.JSListingAttachmentsV181))).toBe(false);
 await button(page,id).click();await expect(page.locator('#listingAttachmentsDialogV181 [data-add]')).toBeEnabled();
 await upload(page);
 expect(f.writes[0].propertyId).toBe(id);expect(f.writes[0].account).toBe(email);expect(f.writes[0].bytes.equals(png)).toBe(true);
 const modal=page.locator('#listingAttachmentsDialogV181');await expect(modal).toContainText('올린 날짜 2026. 11. 11. 12:04');
 await expect(button(page,id)).toHaveClass(/has-files/);expect(await button(page,id).evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(220, 38, 38)');
 expect(f.fileReads).toEqual([]);await expect(button(page,'FIXTURE-LEASE-2')).not.toHaveClass(/has-files/);
 await modal.screenshot({path:'outputs/v181-dialog-'+(isMobile?'mobile':'desktop')+'.png'});
 const pages=context.pages().length;await modal.getByRole('button',{name:'보기',exact:true}).click();const viewer=page.locator('#attachmentPreviewDialogV194');
 await expect(viewer).toBeVisible();await expect.poll(()=>viewer.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);expect(context.pages()).toHaveLength(pages);await viewer.getByRole('button',{name:'자료 보기 닫기'}).click();await expect(modal).toBeVisible();
 expect(f.fileReads).toHaveLength(1);await modal.getByRole('button',{name:'첨부창 닫기'}).click();
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');if(isMobile)await page.evaluate(()=>JSMapListPanelV1.open());
 await expect(button(page,id)).toHaveClass(/has-files/);expect(await page.evaluate(()=>JSON.stringify(allItems))).toBe(before);
 await button(page,id).click();await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('임대현황표.png');
 await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'삭제',exact:true}).click();await expect(button(page,id)).not.toHaveClass(/has-files/);
 await page.locator('#listingAttachmentsDialogV181 summary').click();await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'복원',exact:true}).click();
 await expect(button(page,id)).toHaveClass(/has-files/);await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('12:04');
});
test('late badge zero cannot erase a new receipt and a lost upload response is reconciled without duplicate POSTs',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile,{holdBadges:true,lostResponse:true});
 await expect.poll(()=>f.held.length).toBeGreaterThan(0);
 await button(page,'FIXTURE-LEASE-1').click();await expect(page.locator('#listingAttachmentsDialogV181 [data-add]')).toBeEnabled();await upload(page);
 await f.release();await expect(button(page,'FIXTURE-LEASE-1')).toHaveClass(/has-files/);expect(f.writes).toHaveLength(1);expect(f.files).toHaveLength(1);
});
test('late other-listing results and account changes never reveal or replace the current attachment dialog',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile,{files:[item('FIXTURE-LEASE-1','A표.png'),item('FIXTURE-LEASE-2','B표.png')],heldListing:'FIXTURE-LEASE-1'});
 await button(page,'FIXTURE-LEASE-1').click();await expect.poll(()=>f.held.length).toBeGreaterThan(0);
 await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'첨부창 닫기'}).click();await button(page,'FIXTURE-LEASE-2').click();
 await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('B표.png');await f.release();await expect(page.locator('#listingAttachmentsDialogV181')).not.toContainText('A표.png');
 await page.evaluate(()=>{window.JSAuthenticatedAccountEmail='other@example.invalid';dispatchEvent(new Event('js-auth-restored'));});
 await expect(page.locator('#listingAttachmentsDialogV181')).not.toBeVisible();await expect(page.locator('[data-listing-attachment-v181].has-files')).toHaveCount(0);expect(f.writes).toEqual([]);
});
test('portrait and short landscape dialogs keep upload, filename/date and close inside the visible viewport',async({page,context,isMobile})=>{
 await setup(page,context,isMobile,{files:[item('FIXTURE-LEASE-1','매매표_임대현황표_긴파일이름_2026년11월.pdf')]});
 const initial=page.viewportSize();
 for(const size of [{width:390,height:720},{width:930,height:430}]){
  await page.evaluate(()=>JSMapListPanelV1.open());await button(page,'FIXTURE-LEASE-1').click();await page.setViewportSize(size);
  const modal=page.locator('#listingAttachmentsDialogV181');await expect(modal).toContainText('올린 날짜');
  // Native 1280px landscape fitting uses layout CSS coordinates for both
  // visualViewport and DOM rectangles; physical device pixels differ.
  const visible=await page.evaluate(()=>({x:visualViewport?.offsetLeft||0,y:visualViewport?.offsetTop||0,width:visualViewport?.width||innerWidth,height:visualViewport?.height||innerHeight}));
  const box=await modal.boundingBox();expect(box.x).toBeGreaterThanOrEqual(visible.x);expect(box.x+box.width).toBeLessThanOrEqual(visible.x+visible.width);expect(box.y+box.height).toBeLessThanOrEqual(visible.y+visible.height);
  expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expect(modal.getByRole('button',{name:'첨부창 닫기'})).toBeInViewport();await modal.getByRole('button',{name:'첨부창 닫기'}).click();
  await page.setViewportSize(initial);
 }
});
test('Back on phone or Escape on desktop closes only the attachment dialog over the property detail',async({page,context,isMobile})=>{
 await setup(page,context,isMobile);
 await page.locator('#list .item[data-property-id="FIXTURE-LEASE-1"] .item-building-name').click();
 const drawer=page.locator('#unifiedDetailDrawerV8');await expect(drawer).toBeVisible();
 await drawer.getByRole('button',{name:/^첨부자료 열기/}).click();await expect(page.locator('#listingAttachmentsDialogV181 [data-add]')).toBeEnabled();
 if(isMobile)await page.goBack();else await page.keyboard.press('Escape');
 await expect(page.locator('#listingAttachmentsDialogV181')).not.toBeVisible();await expect(drawer).toBeVisible();
});
test('building sale attachment stays with its master when the representative changes',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile,{files:[item('FIXTURE-BUILDING','매매표.pdf')]});
 await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');showList(allItems.filter(i=>i.propertyId==='FIXTURE-BUILDING'));});
 await expect(button(page,'FIXTURE-BUILDING')).toHaveClass(/has-files/);
 await page.locator('#list .item[data-property-id="FIXTURE-BUILDING"]').screenshot({path:'outputs/v181-building-card-'+(isMobile?'mobile':'desktop')+'.png'});
 await page.evaluate(()=>{const item=allItems.find(i=>i.propertyId==='FIXTURE-BUILDING');item.source='당근';item.name='대표 광고 변경';showList([item]);});
 await expect(button(page,'FIXTURE-BUILDING')).toHaveClass(/has-files/);await button(page,'FIXTURE-BUILDING').click();
 await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('매매표.pdf');await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('12:04');expect(f.writes).toEqual([]);
});
test('a chooser opened for A cannot upload into B after the visible dialog changes',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile);await button(page,'FIXTURE-LEASE-1').click();
 await expect(page.locator('#listingAttachmentsDialogV181 [data-add]')).toBeEnabled();
 const chooserPromise=page.waitForEvent('filechooser');await page.locator('#listingAttachmentsDialogV181 [data-add]').click();const chooser=await chooserPromise;
 await page.locator('#listingAttachmentsDialogV181 [data-close]').click();await button(page,'FIXTURE-LEASE-2').click();
 await expect(page.locator('#listingAttachmentsDialogV181 [data-add]')).toBeEnabled();
 await chooser.setFiles({name:'A의 임대현황표.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('#listingAttachmentsDialogV181 input[type=file]')).toHaveCount(0);
 expect(f.writes).toEqual([]);await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('첨부된 자료가 없습니다');
});

test('v194 building image preview fits portrait and short landscape, zooms and closes to its attachment list without a popup',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile,{files:[item('FIXTURE-BUILDING')]});
 await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');showList(allItems.filter(i=>i.propertyId==='FIXTURE-BUILDING'));});
 const pages=context.pages().length;await button(page,'FIXTURE-BUILDING').click();await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'보기',exact:true}).click();
 const viewer=page.locator('#attachmentPreviewDialogV194');await expect.poll(()=>viewer.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
 for(const dimensions of [{width:390,height:720},{width:930,height:430}]){
  await page.setViewportSize(dimensions);const visible=await page.evaluate(()=>({x:visualViewport?.offsetLeft||0,y:visualViewport?.offsetTop||0,width:visualViewport?.width||innerWidth,height:visualViewport?.height||innerHeight}));
  const box=await viewer.boundingBox();expect(box.x).toBeGreaterThanOrEqual(visible.x);expect(box.y).toBeGreaterThanOrEqual(visible.y);expect(box.x+box.width).toBeLessThanOrEqual(visible.x+visible.width);expect(box.y+box.height).toBeLessThanOrEqual(visible.y+visible.height);
  await expect(viewer.getByRole('button',{name:'자료 보기 닫기'})).toBeInViewport();expect(await viewer.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 }
 for(let i=0;i<4;i++)await viewer.getByRole('button',{name:'확대',exact:true}).click();expect(await viewer.locator('img').evaluate(i=>parseFloat(i.style.width))).toBeGreaterThan(1);
 await viewer.getByRole('button',{name:'화면 맞춤'}).click();expect(context.pages()).toHaveLength(pages);expect(f.fileReads).toHaveLength(1);
 if(isMobile)await page.goBack();else await page.keyboard.press('Escape');await expect(viewer).not.toBeVisible();await expect(page.locator('#listingAttachmentsDialogV181')).toBeVisible();expect(f.writes).toEqual([]);
});

test('v194 PDF is decoded to real pages inside the web with page navigation, fit and no iframe or new tab',async({page,context,isMobile})=>{
 const file={...item('FIXTURE-BUILDING','매매표.pdf'),mediaType:'application/pdf',byteSize:pdf.length},f=await setup(page,context,isMobile,{files:[file]});
 await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');showList(allItems.filter(i=>i.propertyId==='FIXTURE-BUILDING'));});
 const pages=context.pages().length;await button(page,'FIXTURE-BUILDING').click();expect(f.fileReads).toEqual([]);expect(f.vendorReads).toEqual([]);
 await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'보기',exact:true}).click();const viewer=page.locator('#attachmentPreviewDialogV194');
 const pixel=()=>viewer.locator('canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data));
 await expect.poll(pixel).toEqual([0,255,0,255]);await expect(viewer.locator('[data-page]')).toHaveText('1 / 2');
 expect(await viewer.locator('canvas').evaluate(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,Math.floor(c.height/4)).data;let count=0;for(let i=0;i<p.length;i+=4)if(p[i]<60&&p[i+1]<60&&p[i+2]<60&&p[i+3]>200)count++;return count;})).toBeGreaterThan(10);
 await viewer.locator('canvas').evaluate(c=>c.dataset.stablePreview='yes');await page.waitForTimeout(350);await expect(viewer.locator('canvas')).toHaveAttribute('data-stable-preview','yes');expect(f.vendorReads.some(path=>path.endsWith('/pdf.worker.min.mjs'))).toBe(true);
 await viewer.getByRole('button',{name:'다음',exact:true}).click();await expect.poll(pixel).toEqual([255,0,0,255]);await expect(viewer.locator('[data-page]')).toHaveText('2 / 2');
 await viewer.getByRole('button',{name:'확대',exact:true}).click();await expect.poll(pixel).toEqual([255,0,0,255]);await viewer.getByRole('button',{name:'화면 맞춤'}).click();await expect.poll(pixel).toEqual([255,0,0,255]);
 await viewer.getByRole('button',{name:'이전',exact:true}).click();await expect.poll(pixel).toEqual([0,255,0,255]);expect(context.pages()).toHaveLength(pages);await expect(viewer.locator('iframe,object,embed')).toHaveCount(0);expect(f.fileReads).toHaveLength(1);
 await viewer.screenshot({path:'outputs/v194-pdf-'+(isMobile?'mobile':'desktop')+'.png'});await viewer.getByRole('button',{name:'자료 보기 닫기'}).click();await expect(viewer.locator('canvas')).toHaveCount(0);expect(f.writes).toEqual([]);
});

test('v194 reopening a preview immediately and changing accounts never restores the previous private file',async({page,context,isMobile})=>{
 const f=await setup(page,context,isMobile,{files:[item('FIXTURE-LEASE-1','A.png')]});await button(page,'FIXTURE-LEASE-1').click();const modal=page.locator('#listingAttachmentsDialogV181');
 for(let i=0;i<2;i++){await modal.getByRole('button',{name:'보기',exact:true}).click();await expect.poll(()=>page.locator('#attachmentPreviewDialogV194 img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await page.locator('#attachmentPreviewDialogV194').getByRole('button',{name:'자료 보기 닫기'}).click();}
 await modal.getByRole('button',{name:'보기',exact:true}).click();await page.evaluate(()=>{JSAuthenticatedAccountEmail='another-preview@example.invalid';dispatchEvent(new Event('js-auth-restored'));});
 await expect(page.locator('#attachmentPreviewDialogV194')).not.toBeVisible();await expect(page.locator('#attachmentPreviewDialogV194 img, #attachmentPreviewDialogV194 canvas')).toHaveCount(0);expect(f.writes).toEqual([]);
});

test('v194 a failed preview retries inside the same dialog and a late PDF cannot reopen after close',async({page,context,isMobile})=>{
 const options={files:[item('FIXTURE-LEASE-1')],failPreview:true},f=await setup(page,context,isMobile,options);await button(page,'FIXTURE-LEASE-1').click();await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'보기',exact:true}).click();
 const viewer=page.locator('#attachmentPreviewDialogV194');await expect(viewer.locator('[role=status]')).toContainText('자료를 표시하지 못했습니다');options.failPreview=false;
 await viewer.getByRole('button',{name:'다시 보기',exact:true}).click();await expect.poll(()=>viewer.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await viewer.getByRole('button',{name:'자료 보기 닫기'}).click();
 options.files[0].mediaType='application/pdf';options.files[0].filename='늦은 표.pdf';options.holdPreview=true;await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'다시 불러오기',exact:true}).click();await expect(page.locator('#listingAttachmentsDialogV181')).toContainText('늦은 표.pdf');
 await page.locator('#listingAttachmentsDialogV181').getByRole('button',{name:'보기',exact:true}).click();await expect.poll(()=>f.held.length).toBeGreaterThan(0);await viewer.getByRole('button',{name:'자료 보기 닫기'}).click();await f.release();await expect(viewer).not.toBeVisible();await expect(viewer.locator('canvas,img')).toHaveCount(0);expect(f.writes).toEqual([]);
});

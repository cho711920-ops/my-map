import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const ast=ts.createSourceFile('map.js',await readFile('js/map.js','utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['getPremiumClusterSizeClassV635','buildClusterOverlayContentV655','getSaleYieldClusterAppearanceV185','ensureSaleYieldLegendV185']);
const runtime=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
test.beforeEach(async({page,context,isMobile})=>{
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 if(isMobile)await page.setViewportSize({width:930,height:530});
 await page.addScriptTag({content:runtime});
 await page.evaluate(()=>{document.documentElement.classList.add('js-map-design-v1');window.isAdministrativeClusterSelectedV1=()=>false;window.isDone=i=>i.state==='계약완료';document.getElementById('fixtureControls').remove();window.v185Row=rate=>({propertyId:'Y-'+rate,tradeType:'sale',saleCategory:'building',salePrice:12000,saleDetails:{scope:'whole_building',totalDeposit:0,monthlyIncome:rate*10}});});
});
test('building bands and the vertical legend stay readable; selection keeps its band and lease/land retain their colors',async({page})=>{
 const colors=await page.evaluate(()=>{
  JSListingTradeV1.setMode('building_sale');ensureSaleYieldLegendV185();
  const map=document.getElementById('map'),result=[];
  for(const [rate,band] of [[2,'low'],[4,'middle'],[6,'upper'],[8,'high'],[null,'unknown']]){
   for(const mode of ['address','grid','region'])for(const selected of [false,true]){
    const item=v185Row(rate||0);if(rate===null)delete item.saleDetails.monthlyIncome;
    const cluster={key:'v185-'+band,items:[item],worldGrid:mode==='grid',regionMode:mode==='region'?'dong':null,regionLabel:'검수동'};
    const host=document.createElement('div');host.innerHTML=buildClusterOverlayContentV655(cluster,' visit-confirmed-v89'+(selected?' selected admin-region-selected-v1':''));map.append(host);
    const marker=host.firstElementChild,css=getComputedStyle(marker);result.push({band,mode,selected,actual:marker.dataset.saleYieldBandV185,color:css.backgroundColor,outline:css.outlineWidth,count:marker.textContent});host.remove();
   }
  }return result;
 });
 expect(new Set(colors.map(x=>x.color)).size).toBe(5);
 for(const row of colors){expect(row.actual).toBe(row.band);expect(row.count).toContain('1');if(row.selected)expect(row.outline).toBe('2px');}
 for(const band of ['low','middle','upper','high','unknown'])expect(new Set(colors.filter(x=>x.band===band).map(x=>x.color)).size).toBe(1);
 const legend=page.locator('#saleYieldLegendV185');await expect(legend).toBeVisible();await expect(legend.locator('li')).toHaveCount(5);await expect(legend).toContainText('여러 건은 중앙값');
 const geometry=await legend.evaluate(el=>{const box=el.getBoundingClientRect(),map=document.getElementById('map').getBoundingClientRect();return{inside:box.left>=map.left&&box.right<=map.right&&box.top>=map.top&&box.bottom<=map.bottom,pointer:getComputedStyle(el).pointerEvents};});
 expect(geometry).toEqual({inside:true,pointer:'none'});
 for(const mode of ['lease','land_sale']){await page.evaluate(mode=>JSListingTradeV1.setMode(mode),mode);await expect(legend).toBeHidden();}
 const lease=await page.evaluate(()=>{JSListingTradeV1.setMode('lease');const host=document.createElement('div');host.innerHTML=buildClusterOverlayContentV655({key:'lease',items:[{state:'보류'}]},' verification-held-v160');document.getElementById('map').append(host);const result={color:getComputedStyle(host.firstElementChild).backgroundColor,band:host.firstElementChild.dataset.saleYieldBandV185};host.remove();return result;});
 expect(lease.color).toContain('251, 146, 60');expect(lease.band).toBeUndefined();
});
test('changed sale conditions recolor the same cluster immediately without a network read, extra count badges or record mutations',async({page})=>{
 const result=await page.evaluate(()=>{JSListingTradeV1.setMode('building_sale');const item=v185Row(2),unknown=v185Row(0);delete unknown.saleDetails.monthlyIncome;const cluster={key:'v185-current',items:[item,unknown]};const before=JSON.stringify(cluster);const fetchBefore=window.fetch;let reads=0;window.fetch=function(){reads++;throw new Error('Color rendering must not fetch');};const first=getSaleYieldClusterAppearanceV185(cluster);const intact=before===JSON.stringify(cluster);item.saleDetails.monthlyIncome=80;const second=getSaleYieldClusterAppearanceV185(cluster);const html=buildClusterOverlayContentV655(cluster,' selected');window.fetch=fetchBefore;return{intact,first:first.band,second:second.band,title:second.title,html,reads};});
 expect(result.intact).toBe(true);expect(result.first).toBe('low');expect(result.second).toBe('high');expect(result.title).toContain('산정 1/2개');expect(result.html).not.toMatch(/heldCount|held-count|<small/);expect(result.html).toContain('>2</div>');expect(result.reads).toBe(0);
});

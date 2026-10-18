/* Sale-only dossier helpers. Original advertisements are never changed here. */
(function(global){
  'use strict';
  var PY=3.305785,unit='py';
  function ui(){return global.JSListingTradeV1;}
  function text(v){return String(v==null?'':v).trim();}
  function esc(v){return text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){if(v==null||typeof v==='boolean'||!text(v))return null;var n=Number(text(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
  function fmt(v){return Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});}
  function price(v){return global.JSSaleWorkbenchV1.price(v);}
  function date(v){return global.JSSaleReviewV10?global.JSSaleReviewV10.dateText(v):text(v);}
  function active(el){var drawer=el.closest('#unifiedDetailDrawerV8');return el.isConnected&&(!drawer||drawer.getAttribute('aria-hidden')!=='true')&&ui().getMode()!=='lease';}
  function areaHtml(m2,primaryOnly){
    if(!(num(m2)>0))return '미제공';
    return '<span class="sale-unit-value-v9"><span class="sale-unit-py-v9">'+fmt(m2/PY)+'평</span><span class="sale-unit-m2-v9">'+fmt(m2)+'㎡</span>'+(!primaryOnly?'<small class="sale-unit-secondary-v9"><span class="sale-unit-py-v9">'+fmt(m2)+'㎡</span><span class="sale-unit-m2-v9">'+fmt(m2/PY)+'평</span></small>':'')+'</span>';
  }
  function unitButtons(){return '<span class="sale-unit-switch-v9" role="group" aria-label="매매 면적 표시 단위"><button type="button" data-sale-unit="py">평</button><button type="button" data-sale-unit="m2">㎡</button></span>';}
  function refreshUnits(root){
    if(!root||!root.querySelectorAll)return;
    // Convert only our read-only, explicitly paired area labels. No free-form
    // advertisement description, input, price or persisted value is parsed.
    root.querySelectorAll('.sale-public-facts-v6 dd,.sale-review-facts-v8 dd,.sale-fact-group-v2 dd,.sale-compare-scroll td').forEach(function(el){
      if(el.children.length)return;
      var value=text(el.textContent),m=value.match(/^([\d,.]+)㎡\s*(?:·\s*|\(\s*)([\d,.]+)평\)?$/),n=value.match(/^([\d,.]+)평\s*\(\s*([\d,.]+)㎡\s*\)$/);
      if(m||n)el.innerHTML=areaHtml(num(m?m[1]:n[2]));
    });
    root.querySelectorAll('[data-sale-unit]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.saleUnit===unit));});
  }
  function setUnit(value){
    if(!['py','m2'].includes(value))return;unit=value;
    var apply=function(){document.documentElement.setAttribute('data-sale-area-unit-v9',unit);};
    if(ui().getMode()!=='lease'&&global.reflowSaleListDensityV8)global.reflowSaleListDensityV8(apply);else apply();
    refreshUnits(document);
  }
  function modalUnits(dialog){
    if(!dialog||!ui()||ui().getMode()==='lease')return;
    var header=dialog.querySelector('header');if(header&&!header.querySelector('.sale-unit-switch-v9'))header.insertAdjacentHTML('beforeend',unitButtons());refreshUnits(dialog);
  }
  async function read(query){
    var account=text(global.JSAuthenticatedAccountEmail).toLowerCase();
    if(!account||!global.JSDataAccessV6)throw Error('로그인 연결을 확인해 주세요.');
    var action=query.action;query=Object.assign({},query);delete query.action;query.expectedAccountEmail=account;
    var result=await global.JSDataAccessV6.read(action,query);
    if(account!==text(global.JSAuthenticatedAccountEmail).toLowerCase())throw Error('계정이 변경되었습니다. 다시 열어 주세요.');return result;
  }
  function sameOriginal(a,b){return text(a.originalId)===text(b.originalId);}
  function originalsHtml(originals,selected){
    var fields=[['원본 광고',function(o){return o.source||'출처 미제공';}],['광고번호',function(o){return o.providerSourceId||o.sourceListingId||o.sourceId||'미제공';}],['매매가',function(o){return price(o.salePrice??o.sale_price);}],
      ['광고 토지·대지면적',function(o){var d=ui().saleSummary(o);return num(d.landAreaM2)>0?fmt(d.landAreaM2/PY)+'평 ('+fmt(d.landAreaM2)+'㎡)':'미제공';}],
      ['광고 연면적',function(o){var d=ui().saleSummary(o);return num(d.grossAreaM2)>0?fmt(d.grossAreaM2/PY)+'평 ('+fmt(d.grossAreaM2)+'㎡)':'미제공';}],
      ['월 임대수입',function(o){var v=ui().saleSummary(o).monthlyIncome;return num(v)==null?'미제공':fmt(v)+'만원';}],
      ['제공처 확인일',function(o){return date(ui().saleSummary(o).providerCheckedAt)||'미제공';}],['최근 수집 확인',function(o){return date(o.lastSeen||o.lastCheckedAt)||'미제공';}]];
    if(ui().normalizedSaleCategory(selected)==='land')fields=fields.filter(function(f){return !['광고 연면적','월 임대수입'].includes(f[0]);});
    return '<p>현재 묶인 원본 광고를 비교합니다. 면적·매매범위가 다르면 별도 확인하세요. 가격을 섞거나 광고를 합치지 않습니다.</p><div class="sale-original-table-v9 sale-compare-scroll"><table><thead><tr><th>항목</th>'+originals.map(function(o,i){return '<th'+(sameOriginal(o,selected)?' class="selected"':'')+'>'+esc(o.source||'원본')+' '+(i+1)+(sameOriginal(o,selected)?'<small>현재 선택</small>':'')+'</th>';}).join('')+'</tr></thead><tbody>'+fields.map(function(f){var values=originals.map(f[1]),different=new Set(values).size>1;return '<tr'+(different?' class="different"':'')+'><th>'+esc(f[0])+'</th>'+values.map(function(v){return '<td>'+esc(v)+'</td>';}).join('')+'</tr>';}).join('')+'<tr><th>광고 보기</th>'+originals.map(function(o,i){return '<td><button type="button" data-sale-original-open="'+i+'" aria-label="'+esc(o.source||'원본')+' '+(i+1)+' 원본 선택">이 원본 선택</button></td>';}).join('')+'</tr></tbody></table></div>';
  }
  function mountDetail(root,item){
    var drawer=root.closest('#unifiedDetailDrawerV8');if(!drawer)return;
    var old=drawer.querySelector('.sale-fixed-summary-v9');if(old)old.remove();
    if(!ui().isSale(item))return;
    var header=drawer.querySelector(':scope > header > div'),summary=document.createElement('div');summary.className='sale-fixed-summary-v9';
    summary.innerHTML='<strong>'+esc(price(item.salePrice??item.sale_price))+'</strong><span>'+esc(item.source||'원본')+' · '+esc(item.address)+'</span>'+unitButtons();header.append(summary);
    var overview=root.querySelector('[data-sale-section="summary"]'),tools=root.querySelector('.sale-tools-v1');
    var originals=(drawer.__detailPresentationV2&&drawer.__detailPresentationV2.originals||[]).filter(function(o){return ui().isSale(o);});
    if(tools&&originals.length>1){var b=document.createElement('button');b.type='button';b.textContent='원본 광고 조건 비교';b.onclick=function(){
      // Use only already-loaded originals in this group. No cross-address grouping.
      var dialog=global.JSSaleWorkbenchV1.modal('묶인 원본 광고 비교',originalsHtml(originals,item),'sale-original-dialog-v9');
      dialog.querySelectorAll('[data-sale-original-open]').forEach(function(button){button.onclick=function(){var o=originals[Number(button.dataset.saleOriginalOpen)];dialog.close();global.JSUnifiedListingsV8.open(encodeURIComponent(o.propertyId||item.propertyId),encodeURIComponent(o.originalId));};});refreshUnits(dialog);
    };tools.append(b);}
    if(overview){var history=document.createElement('details');history.className='sale-asking-history-v9';history.innerHTML='<summary>선택한 광고의 호가 변경 이력</summary><p>출처·광고번호가 같은 수집 기록만 확인합니다. 기록이 없는 과거 가격은 추정하지 않습니다.</p><button type="button" data-history-load>이력 조회</button><p role="status" data-history-status></p><ol data-history-entries></ol>';
      overview.after(history);var cursor='',seen=new Set(),count=0;
      history.querySelector('[data-history-load]').onclick=async function(){var b=this,status=history.querySelector('[data-history-status]');b.disabled=true;
        try{status.textContent='광고별 수집 기록을 읽고 있습니다…';var data=await read({action:'saleAskingHistory',propertyId:item.propertyId||drawer.__detailPresentationV2.propertyId,originalId:item.originalId,beforeId:cursor});
          if(!active(history))return;if(data.originalId!==item.originalId)throw Error('요청한 원본과 응답이 다릅니다.');
          (data.entries||[]).forEach(function(row){if(seen.has(row.id))return;seen.add(row.id);count++;var li=document.createElement('li');li.innerHTML='<span>'+esc(date(row.at))+'</span><strong>'+esc(row.beforePrice?price(row.beforePrice)+' → '+price(row.price):price(row.price))+'</strong><small>'+esc(row.kind==='conditions_changed'?'면적·주소·매매범위 등 조건도 변경됨':row.kind==='price_changed'?'수집 호가 변경 확인':'수집 기록에서 확인한 호가')+'</small>';history.querySelector('ol').append(li);});
          cursor=data.nextCursor||'';status.textContent=text(data.source||item.source)+' · 광고번호 '+text(data.sourceListingId||'미제공')+' · '+(count?'확인된 이력 '+count+'건':'확인된 호가 이력이 없습니다.')+(data.hasMore?' · 이전 기록이 더 있습니다.':' · 보유 기록 기준');b.textContent=data.hasMore?'이전 기록 더 보기':'조회 완료';b.hidden=!data.hasMore;
        }catch(e){if(active(history))status.textContent=e.message;}finally{b.disabled=false;}
      };
    }
    refreshUnits(root);
  }
  function floorRows(building){
    if(!text(building&&building.managementKey))return [];
    var grouped=new Map();
    (building&&building.floors||[]).forEach(function(row){if(text(building.managementKey)&&text(building.managementKey)!==text(row.managementKey))return;var n=num(Math.abs(Number(row.floorNo))),signed=n==null||!text(row.floorNo)?null:/지하/.test(text(row.floorType))?-n:n;
      var key=signed==null?text(row.floorName):String(signed);if(!key)return;
      if(!grouped.has(key))grouped.set(key,{order:signed,label:row.floorName||(signed<0?'지하 '+Math.abs(signed)+'층':signed+'층'),uses:new Set(),area:0,known:true});
      var g=grouped.get(key),a=num(row.area);if(a==null)g.known=false;else g.area+=a;
      var use=[row.mainUse,row.otherUse].filter(Boolean).join(' · ');if(use)g.uses.add(use);
    });
    return Array.from(grouped.values()).sort(function(a,b){return a.order==null?b.order==null?0:1:b.order==null?-1:b.order-a.order;}).map(function(g){return {label:g.label,uses:Array.from(g.uses).join(' / ')||'용도 미제공',area:g.known?g.area:null};});
  }
  function floorHtml(building,partial){var rows=floorRows(building);return rows.length?'<p>선택 건물의 공적 층별개요입니다. 임대료·공실·실제 점유 현황을 뜻하지 않습니다.</p>'+(global.JSSaleReviewFlowV12?global.JSSaleReviewFlowV12.floorCompositionHtml(building,partial):'')+'<ol class="sale-floor-stack-v9">'+rows.map(function(r){return '<li><b>'+esc(r.label)+'</b><span>'+esc(r.uses)+'</span><strong>'+areaHtml(r.area)+'</strong></li>';}).join('')+'</ol>':'<p>선택한 건물의 층별개요를 확인하지 못했습니다. 다른 동·미제공 자료 여부를 확인해 주세요.</p>';}
  function mountFloors(root,item){
    var panel=root.querySelector('[data-sale-section="register"]');if(!panel||panel.querySelector('.sale-floors-v9'))return;
    var section=document.createElement('section');section.className='sale-floors-v9';section.innerHTML='<h4>층별 구성</h4><p>필요할 때 건축물대장의 층별 자료를 조회합니다.</p><button type="button" data-floors-load>층별 구성 조회</button><p data-floors-status role="status"></p><div data-floors-content></div>';panel.append(section);
    section.querySelector('button').onclick=async function(){var b=this,out=section.querySelector('[data-floors-content]'),status=section.querySelector('[data-floors-status]');b.disabled=true;out.innerHTML='';status.textContent='정확한 지번의 층별 자료를 확인하고 있습니다…';
      try{var parcel=await global.JSParcelExternalLinksV1.resolve(item.address);if(!active(section))return;
        var data=await read({action:'buildingRegister',mode:'full',sigunguCd:parcel.pnu.slice(0,5),bjdongCd:parcel.pnu.slice(5,10),platGbCd:parcel.pnu[10]==='2'?'1':'0',bun:parcel.pnu.slice(11,15),ji:parcel.pnu.slice(15)});if(!active(section))return;
        if(!data.parcel||[data.parcel.sigunguCd,data.parcel.bjdongCd,data.parcel.platGbCd==='1'?'2':'1',data.parcel.bun,data.parcel.ji].join('')!==parcel.pnu)throw Error('요청한 필지와 응답이 다릅니다.');
        var buildings=data.buildings||[];
        function show(index){var b=buildings[Number(index)];out.querySelector('[data-floor-stack]').innerHTML=index===''?'':buildings.length>1&&!text(b&&b.managementKey)?'<p>건물관리번호가 없어 층별 자료를 안전하게 구분하지 못했습니다. 대장 원문에서 확인해 주세요.</p>':floorHtml(b,data.partial||data.incomplete||data.truncated);refreshUnits(out);}
        out.innerHTML=(buildings.length>1?'<label>층별 자료를 볼 건물·동<select aria-label="층별 구성 건물 선택"><option value="">건물·동 선택</option>'+buildings.map(function(v,i){return '<option value="'+i+'">'+esc([v.buildingName,v.dongName,v.mainUse].filter(Boolean).join(' · ')||'건물 '+(i+1))+'</option>';}).join('')+'</select></label>':'')+'<div data-floor-stack></div>';
        var select=out.querySelector('select');if(select)select.onchange=function(){show(this.value);};else show('0');
        status.textContent=parcel.address+' · 조회 '+date(data.queriedAt||data.fetchedAt||'일시 미제공')+(data.partial||data.incomplete||data.truncated?' · 일부 자료, 원문 확인 필요':'');
      }catch(e){if(active(section))status.textContent=e.message;}finally{b.disabled=false;}
    };
  }
  function mountParcelTable(dialog,item){
    var textarea=dialog.querySelector('[data-parcels]');if(!textarea||ui().normalizedSaleCategory(item)!=='land')return;
    var box=document.createElement('div');box.className='sale-parcels-v9';box.innerHTML='<p>개인 검토용 필지표입니다. 합계는 아래 입력 면적 기준이며 광고면적과 별개입니다.</p><div data-parcel-rows></div><button type="button" data-parcel-add>필지 추가</button><div data-parcel-totals aria-live="polite"></div>';
    textarea.closest('label').hidden=true;textarea.closest('label').after(box);dialog.querySelector('[data-parcel-total]').hidden=true;dialog.querySelector('[data-parcel-result]').hidden=true;
    function totals(){var out=box.querySelector('[data-parcel-totals]');try{var rows=global.JSSaleWorkbenchV1.parseParcels(textarea.value),asking=dialog.querySelector('[data-calc="price"]').value,t=global.JSSaleWorkbenchV1.parcelTotals(rows,asking);out.innerHTML='<strong>'+rows.length+'필지 · '+areaHtml(t.areaM2)+'</strong><p>입력 필지 합계 기준 '+(t.pricePerPy==null?'평당가 산정 불가':fmt(t.pricePerPy)+'만원/평')+' · 원본 광고면적 '+areaHtml(ui().saleSummary(item).landAreaM2)+'</p>';refreshUnits(out);}catch(e){out.textContent=e.message;}}
    function sync(){textarea.value=Array.from(box.querySelectorAll('[data-parcel-row]')).map(function(row){return [row.querySelector('[data-parcel-address]').value,row.querySelector('[data-parcel-area]').value];}).filter(function(v){return v.some(text);}).map(function(v){return v[0]+' | '+v[1];}).join('\n');textarea.dispatchEvent(new Event('input',{bubbles:true}));totals();}
    function add(address,area){if(box.querySelectorAll('[data-parcel-row]').length>=30)return;
      var row=document.createElement('div');row.dataset.parcelRow='';row.innerHTML='<label>지번<input data-parcel-address aria-label="필지 지번" maxlength="160" value="'+esc(address)+'" placeholder="대전 서구 도마동 49-38"></label><label>입력 면적 (㎡)<input data-parcel-area aria-label="필지 면적 ㎡" type="number" min="0" step="any" value="'+esc(area)+'"></label><button type="button" data-parcel-check>지번 확인</button><button type="button" data-parcel-remove aria-label="이 필지 삭제">삭제</button><p data-parcel-status role="status"></p>';
      row.addEventListener('input',function(){row.querySelector('[data-parcel-status]').textContent='입력 변경 · 지번 재확인 필요';sync();});
      row.querySelector('[data-parcel-remove]').onclick=function(){row.remove();if(!box.querySelector('[data-parcel-row]'))add('','');sync();};
      row.querySelector('[data-parcel-check]').onclick=async function(){var b=this,field=row.querySelector('[data-parcel-address]'),value=field.value,status=row.querySelector('[data-parcel-status]');b.disabled=true;try{status.textContent='지번 확인 중…';var result=await global.JSParcelExternalLinksV1.resolve(value);if(!row.isConnected||field.value!==value)return;status.innerHTML='확인된 지번 '+esc(result.address)+' <a href="'+esc(result.links.eum)+'" target="_blank" rel="noopener noreferrer">토지이음 열람 ↗</a> · 입력 면적은 유지합니다.';}catch(e){if(row.isConnected&&field.value===value)status.textContent=e.message;}finally{b.disabled=false;}};
      box.querySelector('[data-parcel-rows]').append(row);
    }
    function load(){box.querySelector('[data-parcel-rows]').replaceChildren();var lines=text(textarea.value)?textarea.value.split('\n'):[];lines.forEach(function(line){var p=line.split('|');add(text(p[0]),text(p[1]));});if(!lines.length)add('','');totals();}
    var composition=document.createElement('section');composition.className='sale-parcel-composition-v12';box.append(composition);
    function renderComposition(){if(global.JSSaleReviewFlowV12)composition.innerHTML=global.JSSaleReviewFlowV12.parcelCompositionHtml(Array.from(box.querySelectorAll('[data-parcel-row]')).map(function(row){return {address:row.querySelector('[data-parcel-address]').value,areaM2:row.querySelector('[data-parcel-area]').value};}));refreshUnits(composition);}
    box.addEventListener('input',renderComposition);box.addEventListener('click',function(event){if(event.target.closest('[data-parcel-remove],[data-parcel-add]'))renderComposition();});
    box.querySelector('[data-parcel-add]').onclick=function(){add('','');sync();};
    dialog.querySelector('[data-calc="price"]').addEventListener('input',totals);dialog._saleParcelTableV9={load:function(){load();renderComposition();}};load();renderComposition();
  }
  document.addEventListener('click',function(event){var b=event.target.closest('[data-sale-unit]');if(!b)return;event.stopPropagation();setUnit(b.dataset.saleUnit);});
  var bar=document.getElementById('saleListLayoutV8');if(bar)bar.insertAdjacentHTML('beforeend',unitButtons());
  global.JSSaleDossierV9={areaHtml:areaHtml,refreshUnits:refreshUnits,setUnit:setUnit,modalUnits:modalUnits,mountDetail:mountDetail,mountFloors:mountFloors,mountParcelTable:mountParcelTable,originalsHtml:originalsHtml,floorRows:floorRows,floorHtml:floorHtml};
  setUnit('py');
})(window);

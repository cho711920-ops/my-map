/* Sale-only review aids. Existing advertisements and account records keep their formats. */
(function(global){
  'use strict';
  function text(v){return String(v==null?'':v).trim();}
  function esc(v){return text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){if(v==null||typeof v==='boolean'||!text(v))return null;var n=Number(text(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
  function fmt(v){return Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});}
  function ui(){return global.JSListingTradeV1;}
  function known(v){return num(v)==null?'미제공':fmt(num(v))+'만원';}
  function comparison(saved,latest,land){return (land?['price']:['price','deposit','income']).map(function(key){
    var before=num(saved&&saved[key]),after=num(latest&&latest[key]);
    return {key:key,label:{price:'매매가',deposit:'임대보증금 합계',income:'월 임대수입'}[key],before:before,after:after,different:before!==after};
  });}
  function mountWorksheet(dialog,item){
    var box=document.createElement('section'),baseline=null,found=false;
    box.className='sale-saved-diff-v12';box.setAttribute('aria-label','저장 계산과 현재 광고 비교');
    dialog.querySelector('.sale-review-toolbar-v2').before(box);
    var d=ui().saleSummary(item),p=num(item.salePrice??item.sale_price),latest={price:p>0?p:null,deposit:d.totalDeposit,income:d.monthlyIncome},land=ui().normalizedSaleCategory(item)==='land';
    function render(){
      if(!baseline){box.innerHTML='<p>저장된 계산을 불러오면 현재 선택 광고와 금액을 비교합니다.</p>';return;}
      if(!found){box.innerHTML='<p>저장된 내 계산이 없습니다. 현재 광고에서 시작하며 입력값은 직접 저장할 때 보관됩니다.</p>';return;}
      var rows=comparison(baseline.assumptions,latest,land),changed=rows.filter(function(r){return r.different;}).length;
      box.innerHTML='<h3>저장 계산 ↔ 현재 선택 광고</h3><p>내가 입력한 가정과 광고의 비교입니다. 광고의 과거 가격을 뜻하지 않습니다.</p><small>검토 저장 '+esc(global.JSSaleReviewV10.dateText(baseline.savedAt)||'일시 미제공')+' · '+esc(item.source||'출처 미제공')+'</small><p class="sale-diff-status-v12">'+(changed?'서로 다른 금액 '+changed+'개 · 확인 후 항목별로 적용하세요.':'저장 계산과 광고 금액이 같습니다.')+'</p><div class="sale-diff-scroll-v12"><table><thead><tr><th>항목</th><th>저장한 내 계산</th><th>현재 광고</th><th>적용</th></tr></thead><tbody>'+rows.map(function(row){var input=dialog.querySelector('[data-calc="'+row.key+'"]'),same=input&&num(input.value)===row.after;return '<tr'+(row.different?' class="different"':'')+'><th scope="row">'+row.label+'</th><td>'+known(row.before)+'</td><td>'+known(row.after)+'</td><td><button type="button" data-sale-apply-field="'+row.key+'"'+(row.after==null||same?' disabled':'')+' aria-label="'+row.label+' 현재 광고 금액 적용">'+(row.after==null?'미제공':same?'입력값 같음':'이 금액 적용')+'</button></td></tr>';}).join('')+'</tbody></table></div>';
      box.querySelectorAll('[data-sale-apply-field]').forEach(function(button){button.onclick=function(){
        var key=button.dataset.saleApplyField,value=num(latest[key]),input=dialog.querySelector('[data-calc="'+key+'"]');
        if(value==null||!input)return;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
      };});
    }
    dialog.addEventListener('input',function(e){if(!e.target.matches('[data-calc]'))return;
      box.querySelectorAll('[data-sale-apply-field]').forEach(function(button){var key=button.dataset.saleApplyField,value=num(latest[key]);var same=num(dialog.querySelector('[data-calc="'+key+'"]').value)===value;button.disabled=value==null||same;button.textContent=value==null?'미제공':same?'입력값 같음':'이 금액 적용';});
    });
    render();return {loaded:function(saved,exists){baseline=saved||{};found=!!exists;render();},failed:function(){box.innerHTML='<p>저장 계산을 확인하지 못해 비교할 수 없습니다. 현재 입력값은 유지합니다.</p>';}};
  }
  function floorComposition(building,partial){
    var key=text(building&&building.managementKey),groups=new Map(),missing=0,count=0;
    if(!key)return {groups:[],complete:false,total:0,missing:0};
    (building.floors||[]).forEach(function(row){if(text(row.managementKey)!==key)return;count++;
      var label=[text(row.mainUse),text(row.otherUse)].filter(Boolean).join(' · ')||'용도 미제공',area=num(row.area);
      if(!groups.has(label))groups.set(label,{label:label,area:0,missing:0});var group=groups.get(label);
      if(area==null){missing++;group.missing++;}else group.area+=area;
    });
    var values=Array.from(groups.values()).sort(function(a,b){return b.area-a.area;}),total=values.reduce(function(sum,g){return sum+g.area;},0);
    var finite=Number.isFinite(total)&&values.every(function(g){return Number.isFinite(g.area);});
    return {groups:finite?values:[],total:finite?total:0,missing:missing,complete:!!count&&!partial&&!missing&&finite&&total>0};
  }
  function areaValue(value){return value===0?'0㎡':global.JSSaleDossierV9.areaHtml(value);}
  function barsHtml(rows,total,complete){
    return '<ol class="sale-area-bars-v12">'+rows.map(function(row,index){var width=complete?Math.max(0,Math.min(100,row.area/total*100)):0;return '<li><div><span>'+esc(row.label)+'</span><strong>'+(row.missing?'면적 일부 미제공':areaValue(row.area))+(complete?'<small>'+esc(fmt(width))+'%</small>':'')+'</strong></div>'+(complete?'<div class="sale-area-track-v12" aria-hidden="true"><i class="sale-area-tone-'+index%5+'" style="width:'+width+'%"></i></div>':'')+'</li>';}).join('')+'</ol>';
  }
  function floorCompositionHtml(building,partial){var result=floorComposition(building,partial);if(!result.groups.length)return '';
    return '<section class="sale-use-composition-v12"><h4>용도별 면적 구성</h4><p>'+(result.complete?'선택 건물의 조회된 층별 면적 합계 기준입니다.':'층별 자료가 일부이거나 면적이 빠져 전체 비율은 표시하지 않습니다.')+' 공적 용도 표기를 그대로 묶으며 실제 임차 업종·점유율과 구분합니다.</p>'+barsHtml(result.groups,result.total,result.complete)+'</section>';
  }
  function parcelCompositionHtml(rows){
    if(!rows.length)return '<p>지번과 면적을 입력하면 필지별 면적 구성을 표시합니다.</p>';
    var result=[],incomplete=0,seen=new Set();
    rows.forEach(function(row,index){var address=text(row.address),area=num(row.areaM2);if(!address&&!text(row.areaM2))return;
      var valid=/(?:동|리|읍|면)\s*(?:산\s*)?\d+(?:-\d+)?$/.test(address)&&address.length<=160,duplicate=seen.has(address.replace(/\s/g,''));seen.add(address.replace(/\s/g,''));
      if(!valid||duplicate||!(area>0))incomplete++;
      result.push({label:(address||'필지 '+(index+1))+(duplicate?' · 지번 중복':''),area:area==null?0:area,missing:!(area>0)});
    });
    var total=result.reduce(function(sum,row){return sum+row.area;},0),complete=!!result.length&&!incomplete&&Number.isFinite(total)&&total>0;
    if(!result.length)return '<p>지번과 면적을 입력하면 필지별 면적 구성을 표시합니다.</p>';
    if(!Number.isFinite(total))return '<p>입력 면적이 너무 커 구성 비율을 계산할 수 없습니다.</p>';
    return '<h4>필지별 면적 구성</h4><p>'+(complete?'직접 입력한 필지 면적 합계 기준입니다. 실제 지적 경계·필지 형상을 뜻하지 않습니다.':'지번·면적 누락 또는 중복을 먼저 확인하세요. 전체 구성 비율은 표시하지 않습니다.')+'</p>'+barsHtml(result,total,complete);
  }
  var lastItems=null,lastMode='',navigation=[];
  function navigationItems(){
    var items=global.visibleListItems||[],mode=ui().getMode();if(items===lastItems&&mode===lastMode)return navigation;
    lastItems=items;lastMode=mode;var seen=new Set();navigation=[];
    if(mode==='lease')return navigation;
    items.forEach(function(item){var id=text(item.propertyId);if(!id||seen.has(id)||!ui().isSale(item)||(ui().normalizedSaleCategory(item)==='land')!==(mode==='land_sale'))return;
      seen.add(id);var original=item.unifiedFilterOriginalV2||(item.unifiedDisplayOriginalsV2||[])[0];navigation.push({propertyId:id,originalId:text(original&&original.originalId||item.originalId)});
    });return navigation;
  }
  function mountNavigation(drawer){
    if(!drawer)return;var nav=drawer.querySelector('.sale-detail-pager-v12');
    if(!ui()||ui().getMode()==='lease'||!drawer.hasAttribute('data-sale-presentation-v2')){if(nav)nav.remove();return;}
    if(!nav){nav=document.createElement('nav');nav.className='sale-detail-pager-v12';nav.setAttribute('aria-label','현재 매물목록 순서로 상세 이동');nav.innerHTML='<button type="button" data-sale-step="-1">← 이전 매물</button><span role="status" aria-live="polite"></span><button type="button" data-sale-step="1">다음 매물 →</button>';drawer.querySelector(':scope > header').after(nav);
      nav.querySelectorAll('button').forEach(function(button){button.onclick=function(){
        var saved=drawer.__detailPresentationV2,items=navigationItems(),index=items.findIndex(function(i){return i.propertyId===text(saved&&saved.propertyId);}),target=index>=0&&items[index+Number(button.dataset.saleStep)];
        if(!target){mountNavigation(drawer);return;}
        global.JSUnifiedListingsV8.open(encodeURIComponent(target.propertyId),encodeURIComponent(target.originalId));
        var body=drawer.querySelector('.unified-detail-body-v8');if(body)body.scrollTop=0;
      };});
    }
    var saved=drawer.__detailPresentationV2,items=navigationItems(),index=items.findIndex(function(i){return i.propertyId===text(saved&&saved.propertyId);});
    nav.querySelector('span').textContent=index<0?'현재 목록 밖 · '+items.length+'개':(index+1)+' / '+items.length+' · 현재 목록';
    nav.querySelector('[data-sale-step="-1"]').disabled=index<=0;nav.querySelector('[data-sale-step="1"]').disabled=index<0||index>=items.length-1;
  }
  function refreshNavigation(){var drawer=document.getElementById('unifiedDetailDrawerV8');if(drawer&&drawer.getAttribute('aria-hidden')!=='true')mountNavigation(drawer);}
  global.addEventListener('js-listing-availability-changed',refreshNavigation);
  global.addEventListener('js-listing-trade-mode-change',function(){lastItems=null;refreshNavigation();});
  global.JSSaleReviewFlowV12={comparison:comparison,mountWorksheet:mountWorksheet,floorComposition:floorComposition,floorCompositionHtml:floorCompositionHtml,parcelCompositionHtml:parcelCompositionHtml,mountNavigation:mountNavigation,refreshNavigation:refreshNavigation};
})(window);

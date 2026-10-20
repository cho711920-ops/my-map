/* Public parcel history, loaded only after an explicit public-facts lookup. */
(function(global){
  'use strict';
  var PY=3.305785,cache=new Map();
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(v){return Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});}
  function period(r){return r.baseYear+'.'+String(r.baseMonth).padStart(2,'0');}
  function amount(r,unit){return fmt(r.wonPerM2*(unit==='py'?PY:1))+'원/'+(unit==='py'?'평':'㎡');}
  function visibleRecords(records,range){var end=records[records.length-1].baseYear;return range==='all'?records:records.filter(function(r){return r.baseYear>=end-Number(range)+1;});}
  function annualChange(records,row){var before=records.find(function(r){return r.baseYear===row.baseYear-1&&r.baseMonth===row.baseMonth;});return before?(row.wonPerM2/before.wonPerM2-1)*100:null;}
  function axisTicks(points,small){var ticks=[],gap=small?150:100,last=points[points.length-1];points.forEach(function(p,i){if(!i||i===points.length-1||p.x-ticks[ticks.length-1].x>=gap&&last.x-p.x>=gap)ticks.push(p);});return ticks;}
  function geometry(records,width){
    width=width||720;
    var first=records[0].baseYear+(records[0].baseMonth-1)/12,last=records[records.length-1].baseYear+(records[records.length-1].baseMonth-1)/12;
    var max=Math.max.apply(null,records.map(function(r){return r.wonPerM2;}))*1.1,power=Math.pow(10,Math.floor(Math.log10(max/4))),step=Math.ceil(max/4/power)*power,top=step*4;
    var points=records.map(function(r){var value=r.baseYear+(r.baseMonth-1)/12;return {x:70+(last===first ? .5 : (value-first)/(last-first))*(width-94),y:20+(1-r.wonPerM2/top)*198,row:r};});
    var path=points.map(function(p,i){return (!i||p.row.baseYear-points[i-1].row.baseYear>1?'M':'L')+p.x.toFixed(2)+','+p.y.toFixed(2);}).join(' ');
    return {points:points,path:path,top:top,width:width};
  }
  function validate(data,pnu){
    if(!data||data.ok!==true||data.pnu!==pnu||!Array.isArray(data.records)||!data.records.length||data.records.length>128)throw Error('요청한 필지의 연도별 자료를 확인하지 못했습니다.');
    var last='';data.records.forEach(function(r){var key=period(r);if(!Number.isInteger(r.baseYear)||r.baseYear<1990||!Number.isInteger(r.baseMonth)||r.baseMonth<1||r.baseMonth>12||!Number.isFinite(r.wonPerM2)||r.wonPerM2<=0||key<=last)throw Error('연도별 공시지가 자료 형식을 확인하지 못했습니다.');last=key;});
    return data;
  }
  function mount(target,pnu,read,isActive){
    if(!target||!/^\d{19}$/.test(pnu))return;
    var root=document.createElement('section');root.className='land-price-history-v39';root.setAttribute('aria-label','개별공시지가 추이');
    root.innerHTML='<header><div><h4>개별공시지가 추이</h4><p>해당 필지의 연도별 공시가격 · 실거래가와 구분</p></div><button type="button" data-history-retry>다시 불러오기</button></header><p class="land-history-status-v39" role="status"></p><div data-history-body></div>';
    target.append(root);var status=root.querySelector('[role="status"]'),body=root.querySelector('[data-history-body]'),retry=root.querySelector('[data-history-retry]'),range='10',unit='m2',revision=0,shownData=null,smallLayout=null;
    function active(){return root.isConnected&&isActive();}
    function render(data){
      var records=visibleRecords(data.records,range),small=root.clientWidth<560,chart=geometry(records,small?420:720),latest=data.records[data.records.length-1],change=annualChange(data.records,latest),ratio=unit==='py'?PY:1;
      shownData=data;smallLayout=small;
      body.innerHTML='<div class="land-history-controls-v39"><div role="group" aria-label="공시지가 조회 기간">'+[['5','5년'],['10','10년'],['all','전체']].map(function(r){return '<button type="button" data-history-range="'+r[0]+'" aria-pressed="'+(range===r[0])+'">'+r[1]+'</button>';}).join('')+'</div><div role="group" aria-label="공시지가 표시 단위">'+[['m2','㎡'],['py','평']].map(function(r){return '<button type="button" data-history-unit="'+r[0]+'" aria-pressed="'+(unit===r[0])+'">'+r[1]+'</button>';}).join('')+'</div></div>'+
        '<div class="land-history-summary-v39"><div><span>최근 공시지가 · '+period(latest)+'</span><strong>'+amount(latest,unit)+'</strong></div><div><span>전년 동일 기준 대비</span><strong>'+(change==null?'비교 자료 없음':(change>0?'+':'')+fmt(change)+'%')+'</strong></div></div>'+
        '<div class="land-history-legend-v39"><span>● 해당 필지</span><small>동·구 평균: 집계 자료 미연결</small></div><div class="land-history-plot-v39"><span class="land-history-axis-v39">만원/'+(unit==='py'?'평':'㎡')+'</span><svg viewBox="0 0 '+chart.width+' 260" data-history-small="'+small+'" role="group" aria-label="'+esc(data.address)+' 개별공시지가 그래프">'+
        [0,1,2,3,4].map(function(i){var y=20+i*49.5;return '<line x1="70" x2="'+(chart.width-24)+'" y1="'+y+'" y2="'+y+'" class="history-grid"/><text x="60" y="'+(y+4)+'" text-anchor="end">'+fmt(chart.top*(1-i/4)*ratio/10000)+'</text>';}).join('')+
        axisTicks(chart.points,small).map(function(p,i,all){return '<text x="'+p.x+'" y="245" text-anchor="'+(i===0?'start':i===all.length-1?'end':'middle')+'">'+period(p.row)+'</text>';}).join('')+
        '<path d="'+chart.path+'" class="history-line"/><line data-history-cursor y1="20" y2="218" class="history-cursor" visibility="hidden"/>'+
        chart.points.map(function(p,i){return '<circle cx="'+p.x+'" cy="'+p.y+'" r="4" tabindex="0" role="button" data-history-point="'+i+'" aria-label="'+period(p.row)+' '+amount(p.row,unit)+'"/>';}).join('')+'</svg><div class="land-history-tip-v39" data-history-tip hidden aria-hidden="true"></div></div>'+
        '<p class="land-history-selection-v39" aria-live="polite" data-history-selection>마우스를 올리거나 그래프를 터치하면 해당 시점의 금액을 볼 수 있습니다.</p>'+
        '<details class="land-history-table-v39"><summary>연도별 금액 '+records.length+'건 보기</summary><div><table><thead><tr><th>기준연월</th><th>공시지가 ('+(unit==='py'?'원/평':'원/㎡')+')</th><th>전년 동월 대비</th></tr></thead><tbody>'+records.slice().reverse().map(function(r){var c=annualChange(data.records,r);return '<tr><th scope="row">'+period(r)+'</th><td>'+fmt(r.wonPerM2*ratio)+'</td><td>'+(c==null?'—':(c>0?'+':'')+fmt(c)+'%')+'</td></tr>';}).join('')+'</tbody></table></div></details>'+
        '<p class="land-history-source-v39">'+esc(data.source||'토지이음 공개 열람')+' · 조회 '+esc(new Date(data.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+(data.cached?' · 저장된 조회자료':'')+'</p><p class="land-history-note-v39">제공된 연월만 표시하며 없는 연도는 추정해 연결하지 않습니다. 필지 분할·합병 전후에는 비교 범위를 확인하세요. 공시일자가 아닌 가격 기준연월입니다.</p>';
      var svg=body.querySelector('svg'),tip=body.querySelector('[data-history-tip]'),caption=body.querySelector('[data-history-selection]'),cursor=body.querySelector('[data-history-cursor]');
      function select(index,show){
        var p=chart.points[index];if(!p)return;var r=p.row,c=annualChange(data.records,r);
        body.querySelectorAll('[data-history-point]').forEach(function(el,i){el.setAttribute('r',i===index?'6':'4');});
        cursor.setAttribute('x1',p.x);cursor.setAttribute('x2',p.x);cursor.setAttribute('visibility',show?'visible':'hidden');
        caption.textContent=period(r)+' · '+amount(r,unit)+(c==null?' · 전년 동일 기준 자료 없음':' · 전년 동월 대비 '+(c>0?'+':'')+fmt(c)+'%');
        tip.innerHTML='<b>'+period(r)+' 기준</b><strong>'+amount(r,unit)+'</strong><span>전년 동월 대비 '+(c==null?'자료 없음':(c>0?'+':'')+fmt(c)+'%')+'</span><small>동·구 평균: 집계 자료 미연결</small>';
        tip.hidden=!show;var width=svg.getBoundingClientRect().width;tip.style.left=Math.max(8,Math.min(width-208,p.x/chart.width*width-96))+'px';tip.style.top=Math.max(8,p.y/chart.width*width-96)+'px';
      }
      function nearest(event){var rect=svg.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*chart.width,best=0;chart.points.forEach(function(p,i){if(Math.abs(p.x-x)<Math.abs(chart.points[best].x-x))best=i;});select(best,true);}
      svg.addEventListener('pointermove',nearest);svg.addEventListener('click',nearest);svg.addEventListener('pointerleave',function(){tip.hidden=true;cursor.setAttribute('visibility','hidden');});
      body.querySelectorAll('[data-history-point]').forEach(function(el,i){el.onfocus=function(){select(i,true);};el.onkeydown=function(event){var next=event.key==='ArrowLeft'?i-1:event.key==='ArrowRight'?i+1:event.key==='Home'?0:event.key==='End'?chart.points.length-1:null;if(next==null)return;event.preventDefault();body.querySelector('[data-history-point="'+Math.max(0,Math.min(chart.points.length-1,next))+'"]').focus({preventScroll:true});};});
      body.querySelectorAll('[data-history-range]').forEach(function(el){el.onclick=function(){range=this.dataset.historyRange;render(data);body.querySelector('[data-history-range="'+range+'"]').focus({preventScroll:true});};});
      body.querySelectorAll('[data-history-unit]').forEach(function(el){el.onclick=function(){unit=this.dataset.historyUnit;render(data);body.querySelector('[data-history-unit="'+unit+'"]').focus({preventScroll:true});};});
    }
    async function load(){
      var own=++revision;retry.disabled=true;status.textContent='연도별 공시지가를 확인하고 있습니다…';body.replaceChildren();
      try{var saved=cache.get(pnu),age=saved?Date.now()-Date.parse(saved.fetchedAt):Infinity;
        var data=saved&&age>=0&&age<6*3600000?Object.assign({},saved,{cached:true}):validate(await read({action:'saleLandPriceHistory',pnu:pnu}),pnu);
        if(cache.size>=80&&!cache.has(pnu))cache.delete(cache.keys().next().value);cache.set(pnu,data);
        if(!active()||own!==revision)return;render(data);status.textContent='확인된 필지: '+data.address+' · '+period(data.records[0])+'~'+period(data.records[data.records.length-1]);
      }catch(e){if(active()&&own===revision)status.textContent=e.message||'공시지가 이력을 불러오지 못했습니다.';}
      finally{if(active()&&own===revision)retry.disabled=false;}
    }
    if(global.ResizeObserver){var observer=new global.ResizeObserver(function(){if(!root.isConnected){observer.disconnect();return;}if(shownData&&active()&&smallLayout!==(root.clientWidth<560))render(shownData);});observer.observe(root);}
    retry.onclick=load;load();
  }
  global.JSLandPriceHistoryV39={mount:mount,visibleRecords:visibleRecords,annualChange:annualChange,geometry:geometry,validate:validate,axisTicks:axisTicks};
})(window);

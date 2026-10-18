/* Sale-only reading aids. All facts and calculations retain their existing source. */
(function(global){
  'use strict';
  var layouts={}, sortDirections={}, PY=3.305785;
  function ui(){return global.JSListingTradeV1;}
  function work(){return global.JSSaleWorkbenchV1;}
  function text(v){return String(v==null?'':v).trim();}
  function esc(v){return text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){if(v==null||typeof v==='boolean'||!text(v))return null;var n=Number(text(v).replace(/,/g,''));return Number.isFinite(n)&&n>=0?n:null;}
  function fmt(v){return v==null?'미제공':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});}
  function area(v){return global.JSSaleDossierV9.areaHtml(v,true);}
  function money(v){return v==null||typeof v==='boolean'||!text(v)||!Number.isFinite(Number(v))?'미제공':fmt(v)+'만원';}
  function tag(kind){return '<span class="sale-evidence-tag-v10 '+kind+'">'+({ad:'광고 기재',public:'공적자료',calc:'내 계산'}[kind])+'</span>';}
  function dateText(value){
    var s=text(value),m=s.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if(m){var d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?m.slice(1).join('.'):s;}
    if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)||!Number.isFinite(Date.parse(s)))return s;
    var parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(s));
    function p(k){return parts.find(function(v){return v.type===k;}).value;}
    return p('year')+'.'+p('month')+'.'+p('day')+' '+p('hour')+':'+p('minute')+' KST';
  }
  function columns(land){return land?
    [['주소',''],['매매가','salePriceLow','salePriceHigh'],['토지면적','saleLandHigh','saleLandLow'],['평당가','saleUnitLow','saleUnitHigh'],['지목',''],['용도지역',''],['도로접면',''],['출처','']]:
    [['주소',''],['매매가','salePriceLow','salePriceHigh'],['대지','saleLandHigh','saleLandLow'],['연면적','saleGrossHigh'],['보증금',''],['월수입','saleIncomeHigh'],['단순 연수익률','saleYieldHigh'],['출처','']];}
  function rowValues(item){
    var d=ui().saleSummary(item),land=ui().normalizedSaleCategory(item)==='land',y=ui().saleYield(item),p=work().unitPrice(item);
    var values=[esc(item.address||'주소 미제공'),esc(work().price(item.salePrice??item.sale_price)),area(d.landAreaM2)];
    if(land)values.push(p==null?'미제공':esc(fmt(p))+'<small>만원/평</small>',esc(d.landUse||'미제공'),esc(d.zoning||'미제공'),esc(d.roadAccess||'미제공'));
    else values.push(area(d.grossAreaM2),esc(money(d.totalDeposit)),esc(money(d.monthlyIncome)),y==null?'미제공':esc(fmt(y))+'%');
    values.push(esc(item.source||'미제공'));return values;
  }
  function syncPhone(contact,phone){
    if(!contact||!phone)return;
    contact.className=phone.className;contact.style.cssText=phone.style.cssText;
    contact.title=phone.title||'기존 연락처 확인';contact.setAttribute('aria-label',phone.getAttribute('aria-label')||contact.title);
  }
  function mountCard(card,item){
    if(!ui().isSale(item))return;
    card.querySelectorAll('.sale-card-meta-v5 span,.land-card-meta-v4 .item-reg-date').forEach(function(el){if(/^등록\s/.test(text(el.textContent))&&item.regDate)el.textContent='등록 '+dateText(item.regDate);});
    var row=document.createElement('div');row.className='sale-table-row-v10';row.setAttribute('role','group');row.setAttribute('aria-label','매매 조건 표 행');
    var check=card.querySelector('.action-select-check'),phone=card.querySelector('.item-action-left button'),land=ui().normalizedSaleCategory(item)==='land';
    row.innerHTML='<input type="checkbox" data-table-select aria-label="'+esc(item.address||item.name)+' 비교 선택"'+(check&&check.checked?' checked':'')+'>'+rowValues(item).map(function(value,i){return '<div class="sale-table-cell-v10'+(i>0&&i<(land?4:7)?' numeric':'')+'">'+(i===0?'<button type="button" data-table-open>'+value+'</button><small>'+esc(item.name||item.buildingName||'매매 매물')+'</small>':value)+'</div>';}).join('')+'<button type="button" data-table-phone aria-label="저장 연락처 확인">☎</button>';
    row.querySelector('[data-table-select]').onclick=function(event){event.stopPropagation();if(check)check.click();};
    row.querySelector('[data-table-open]').onclick=function(event){event.stopPropagation();var title=card.querySelector('.item-building-name');if(title)title.click();};
    var contact=row.querySelector('[data-table-phone]');
    if(!land)row.querySelectorAll('.sale-table-cell-v10')[6].title='연 임대수입 ÷ (매매가−임대보증금). 대출이자·취득비용·세금·공실·운영비 미반영.';
    if(phone){syncPhone(contact,phone);contact.onclick=function(event){event.stopPropagation();var current=card.querySelector('.item-action-left button');if(current)current.click();};}
    else {contact.disabled=true;contact.title='연락처 미제공';}
    card.append(row);
  }
  function chooseLayout(value){layouts[ui().getMode()]=value;syncTable();}
  function syncTable(){
    var mode=ui().getMode(),bar=document.getElementById('saleListLayoutV8'),wide=global.matchMedia('(min-width:769px)').matches&&!document.documentElement.classList.contains('js-phone-app-v2');
    var enabled=mode!=='lease'&&wide&&layouts[mode]==='table',old=document.documentElement.hasAttribute('data-sale-table-v10');
    var head=document.getElementById('saleTableHeadV10');if(!head&&bar){head=document.createElement('div');head.id='saleTableHeadV10';head.className='sale-table-head-v10';head.hidden=true;bar.after(head);}
    if(head&&enabled){head.innerHTML='<span>선택</span>'+columns(mode==='land_sale').map(function(c){return '<span>'+(c[1]?'<button type="button" data-table-sort="'+c[1]+'" data-table-sort-alt="'+(c[2]||c[1])+'">'+c[0]+' ↕</button>':c[0])+'</span>';}).join('')+'<span>전화</span>';head.style.top=(parseFloat(getComputedStyle(bar).top)||0)+bar.offsetHeight+'px';}
    // The header belongs to the same geometry change as the rows, so the
    // existing anchor correction accounts for both on entry and exit.
    function apply(){if(enabled)document.documentElement.setAttribute('data-sale-table-v10',mode==='land_sale'?'land':'building');else document.documentElement.removeAttribute('data-sale-table-v10');if(head)head.hidden=!enabled;}
    if(enabled!==old&&global.reflowSaleListDensityV8)global.reflowSaleListDensityV8(apply);else apply();
    if(bar)bar.querySelectorAll('[data-sale-layout]').forEach(function(b){if(enabled||b.dataset.saleLayout==='table')b.setAttribute('aria-pressed',String(enabled&&b.dataset.saleLayout==='table'));});
    if(bar&&bar.querySelector(':scope>span'))bar.querySelector(':scope>span').textContent=enabled?'표 · 가로 스크롤':'목록 보기';
    if(!enabled){var sidebar=document.getElementById('sidebar');if(sidebar)sidebar.scrollLeft=0;}
  }
  function enhanceComparison(dialog){
    var holder=dialog.querySelector('.sale-compare-scroll');if(!holder)return;
    var table=holder.querySelector('table'),rows=Array.from(table.querySelectorAll('tbody>tr'));
    if(!table.querySelector('thead')&&rows.length){var names=Array.from(rows[0].querySelectorAll('td')).map(function(td){return td.textContent;}),head=document.createElement('thead');head.innerHTML='<tr><th scope="col">항목</th>'+names.map(function(n){return '<th scope="col">'+esc(n)+'</th>';}).join('')+'</tr>';table.prepend(head);}
    rows.forEach(function(row){var cells=Array.from(row.querySelectorAll('td'));if(cells.length<2||row.querySelector('button'))return;
      var values=cells.map(function(c){return text(c.textContent);}),missing=values.some(function(v){return /미제공|미확인|산정 불가/.test(v);});
      var labelText=text(row.querySelector('th').firstChild.textContent),numeric=/매매가|면적|대지\/토지|수익률|보증금|수입|단가|평당가/.test(labelText);
      cells.forEach(function(cell){cell.classList.add(numeric?'sale-numeric-v10':'sale-text-v10');});
      row.classList.toggle('sale-compare-missing-v10',missing);row.dataset.compareDifferenceV10=String(new Set(values).size>1);
      if(missing){row.classList.remove('sale-compare-different-v5');row.querySelectorAll('th small').forEach(function(el){if(el.textContent==='조건 차이')el.remove();});var label=document.createElement('small');label.className='sale-compare-missing-label-v10';label.textContent='제공 여부 확인';row.querySelector('th').append(label);}
    });
    var control=dialog.querySelector('[data-compare-differences]');
    if(!control){var label=document.createElement('label');label.className='sale-compare-differences-control-v5';label.innerHTML='<input type="checkbox" data-compare-differences> 서로 다른 항목만 보기';holder.before(label);control=label.querySelector('input');}
    control.addEventListener('change',function(){rows.forEach(function(r){if(r.hasAttribute('data-compare-difference-v10'))r.hidden=control.checked&&r.dataset.compareDifferenceV10==='false';});});
    holder.classList.add('sale-compare-reading-v10');
  }
  function flowHtml(values,land,result){
    if(!result||result.error)return '';
    function step(label,value,kind){return '<li class="'+(kind||'')+'"><span>'+esc(label)+'</span><strong>'+esc(money(value))+'</strong></li>';}
    var p=num(values.price),a=num(values.acquisition),l=num(values.loan),d=num(values.deposit),r=num(values.income),v=num(values.vacancy),o=num(values.expense);
    var html='<section class="sale-money-flow-v10">'+tag('calc')+'<h3>매입자금 흐름</h3><p>현재 입력 가정 기준 · 원금상환·세금 자동 산정 제외</p><ol>'+step('매매가',p)+step('＋ 취득 부대비용',a)+(!land?step('－ 임대보증금',d):'')+step('－ 대출금',l)+step('＝ 필요 자기자금',result.equity,'total')+'</ol>';
    if(land)html+='<div class="sale-flow-note-v10">총 매입비용 <b>'+esc(money(result.total))+'</b> · 월 대출이자 <b>'+esc(money(result.interest))+'</b></div>';
    else html+='<h3>월 현금흐름</h3><ol>'+step('월 임대수입',r)+step('－ 공실 가정 차감',r*v/100)+step('－ 월 대출이자',result.interest)+step('－ 월 운영비',o)+step('＝ 월 현금흐름',result.monthly,result.monthly<0?'total negative':'total')+'</ol>';
    return html+'</section>';
  }
  function renderFlow(dialog,values,result){
    var out=dialog.querySelector('.sale-money-flow-host-v10');if(!out){out=document.createElement('div');out.className='sale-money-flow-host-v10';dialog.querySelector('[data-calc-result]').after(out);}
    out.innerHTML=flowHtml(values,dialog.dataset.saleReview==='land',result);
  }
  function buildingHighlights(building){
    var rows=global.JSSalePublicReviewV6.buildingRows(building),wanted=['주용도','사용승인일','자주식 주차','기계식 주차','승강기'];
    rows=rows.filter(function(r){return wanted.includes(r[0])&&text(r[1]);});
    return rows.length?'<div class="sale-building-highlights-v10" aria-label="선택 건물 핵심 제원">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(dateText(r[1]))+'</strong></div>';}).join('')+'</div>':'';
  }
  function evidenceMatches(detail){
    var description=text(detail.descriptionText),evidence=detail.descriptionEvidence;
    if(!description||!evidence||typeof evidence!=='object'||Array.isArray(evidence))return [];
    return Object.entries(evidence).filter(function(pair){return typeof pair[1]==='string'&&text(pair[1])&&description.includes(text(pair[1]));}).slice(0,20).map(function(pair){return {label:pair[0],quote:text(pair[1])};});
  }
  function mountEvidence(root,item){
    var detail=ui().saleSummary(item),matches=evidenceMatches(detail),description=root.querySelector('.listing-sale-description-v1'),body=description&&description.querySelector('div');
    if(!body||!matches.length)return;
    var section=document.createElement('section');section.className='sale-original-evidence-v10';section.innerHTML=tag('ad')+'<h4>광고 원문 근거</h4><p>선택한 원본의 설명 문구입니다. 기본정보와 다르면 기존 조건을 유지합니다.</p>';
    matches.forEach(function(match){var b=document.createElement('button');b.type='button';b.textContent=match.label+' · 원문 근거';b.onclick=function(){
      var original=text(detail.descriptionText),index=original.indexOf(match.quote);if(index<0)return;
      body.replaceChildren(document.createTextNode(original.slice(0,index)));var mark=document.createElement('mark');mark.textContent=match.quote;body.append(mark,document.createTextNode(original.slice(index+match.quote.length)));description.open=true;
      var nav=root.querySelector('.sale-dossier-nav-v3');root.scrollTo({top:Math.max(0,root.scrollTop+mark.getBoundingClientRect().top-root.getBoundingClientRect().top-(nav?nav.offsetHeight:0)-20),behavior:global.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    };section.append(b);});description.before(section);
  }
  function mountDetail(root,item){
    if(!ui().isSale(item))return;
    var tools=root.querySelector('.sale-tools-v1[data-sale-item]');
    if(tools){var secondary=document.createElement('details');secondary.className='sale-secondary-tools-v10';secondary.innerHTML='<summary>조회·출처·이력</summary>';var lookup=tools.querySelector('[data-sale-action="lookup"]');if(lookup)secondary.append(lookup);
      var source=root.querySelector('.sale-source-details-v1'),history=root.querySelector('.sale-asking-history-v9');if(source)secondary.append(source);if(history)secondary.append(history);tools.after(secondary);
      var compare=document.createElement('button');compare.type='button';compare.textContent='선택 매물 비교';compare.title='목록에서 같은 종류의 매물 2~4개를 선택한 뒤 비교합니다.';compare.onclick=function(){work().compare();};tools.querySelector('[data-sale-action="report"]').before(compare);
      tools.insertAdjacentHTML('beforebegin','<div class="sale-detail-origin-v10">'+tag('ad')+'<span>현재 선택한 원본 광고 기준</span></div>');}
    root.querySelectorAll('.sale-public-panel-v6>header>div').forEach(function(header){header.insertAdjacentHTML('afterbegin',tag('public'));});
    mountEvidence(root,item);
  }
  var bar=document.getElementById('saleListLayoutV8');if(bar){var group=bar.querySelector('div');if(group)group.insertAdjacentHTML('beforeend','<button type="button" data-sale-layout="table" aria-pressed="false">표로 보기</button>');}
  document.addEventListener('click',function(event){var b=event.target.closest('[data-table-sort]');if(!b)return;var key=b.dataset.tableSort,alternate=b.dataset.tableSortAlt;sortDirections[key]=!sortDirections[key];if(global.selectSortOption)global.selectSortOption(sortDirections[key]?key:alternate);});
  var list=document.getElementById('list');if(list&&global.MutationObserver)new global.MutationObserver(function(records){
    records.forEach(function(record){var phone=record.target;if(!phone.matches('.item-action-left>.item-contact-button-v654'))return;var card=phone.closest('.listing-sale-card-v1');if(card)syncPhone(card.querySelector('[data-table-phone]'),phone);});
  }).observe(list,{subtree:true,attributes:true,attributeFilter:['class','style','title','aria-label']});
  global.addEventListener('js-listing-trade-mode-change',syncTable);global.addEventListener('js-phone-device-change',syncTable);global.matchMedia('(min-width:769px)').addEventListener('change',syncTable);
  global.JSSaleReviewV10={dateText:dateText,mountCard:mountCard,chooseLayout:chooseLayout,syncTable:syncTable,enhanceComparison:enhanceComparison,renderFlow:renderFlow,flowHtml:flowHtml,buildingHighlights:buildingHighlights,evidenceMatches:evidenceMatches,mountDetail:mountDetail,tag:tag};
})(window);

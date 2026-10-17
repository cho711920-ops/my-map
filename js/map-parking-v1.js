/* Optional parking layer. It never changes listing overlays, filters or records. */
(function (global) {
  'use strict';
  var button = document.getElementById('mapParkingBtnV1');
  if (!button) return;
  var enabled = false, map = null, snapshot = null, loading = null, generation = 0;
  var overlays = new Map(), extra = [], cache = new Map(), timer = null, pending = false;
  var controls, status, filter, detail, selected = null, lastFocus = null;
  var filterValue = 'all', searchMessage = '', sourceWarning = '';
  var DATA_URL = '/data/daejeon-parking-v1.json?v=20261017';

  function text(node, value) { node.textContent = String(value == null || value === '' ? '미확인' : value); return node; }
  function element(tag, className, value) {
    var node = document.createElement(tag); if (className) node.className = className;
    if (value !== undefined) text(node, value); return node;
  }
  function coordinates(item) { return new global.kakao.maps.LatLng(item.lat, item.lng); }
  function inBounds(item) {
    return Number.isFinite(item.lat) && Number.isFinite(item.lng) && map.getBounds().contain(coordinates(item));
  }
  function closeDetail(restore) {
    if (detail) detail.hidden = true;
    if (selected && overlays.has(selected)) overlays.get(selected).node.classList.remove('is-selected');
    selected = null;
    if (restore && lastFocus && lastFocus.isConnected) lastFocus.focus({preventScroll:true});
  }
  function row(label, value) {
    var line = element('div', 'parking-detail-row-v1');
    line.append(element('dt', '', label), text(element('dd'), value)); return line;
  }
  function money(value) { return Number.isFinite(value) && value > 0 ? value.toLocaleString('ko-KR') + '원' : ''; }
  function hours(value) { return value && value[0] && value[1] ? value[0] + ' ~ ' + value[1] : '미확인'; }
  function showDetail(item, target, group) {
    closeDetail(false); selected = target.dataset.parkingId; lastFocus = target;
    if (overlays.has(selected)) overlays.get(selected).node.classList.add('is-selected');
    detail.replaceChildren();
    var header = element('div', 'parking-detail-head-v1');
    var title = element('h2', '', item.name); title.id = 'parkingDetailTitleV1';
    var close = element('button', 'parking-close-v1', '×'); close.type = 'button';
    close.setAttribute('aria-label','주차장 상세 닫기'); close.onclick = function () { closeDetail(true); };
    header.append(title,close); detail.append(header);
    if(group && group.length>1){
      var chooseLabel=element('label','parking-group-choice-v1','주변 주차장 '+group.length+'곳 ');
      var choose=element('select');choose.setAttribute('aria-label','묶인 주차장 선택');
      group.forEach(function(member){var option=element('option','',member.name);option.value=member.id;choose.append(option);});
      choose.value=item.id;
      choose.onchange=function(){var next=group.find(function(member){return member.id===choose.value;});if(next)showDetail(next,target,group);};
      chooseLabel.append(choose);detail.append(chooseLabel);
    }
    detail.append(element('p','parking-kind-v1',item.kind + (item.type ? ' · '+item.type : '')));
    var fields = element('dl');
    fields.append(row('총 주차면수', Number.isInteger(item.capacity) && item.capacity > 0 ? item.capacity+'면' : '미확인'),
      row('요금 구분', item.charge),
      row('기본 요금', item.basicMinutes > 0 && money(item.basicFee) ? item.basicMinutes+'분 / '+money(item.basicFee) : (item.charge === '무료' ? '무료 (자료 기준)' : '미확인')),
      row('추가 요금', item.extraMinutes > 0 && money(item.extraFee) ? item.extraMinutes+'분 / '+money(item.extraFee) : '미확인'));
    if (money(item.dayFee)) fields.append(row('1일 주차권', money(item.dayFee)));
    if (money(item.monthFee)) fields.append(row('월 정기권', money(item.monthFee)));
    fields.append(row('운영요일', item.days), row('평일', hours(item.weekday)), row('토요일', hours(item.saturday)), row('공휴일', hours(item.holiday)),
      row('주소', item.address), row('연락처', item.phone), row('관리기관', item.operator), row('자료 기준일', item.referenceDate));
    detail.append(fields);
    if (item.note) detail.append(element('p','parking-note-v1',item.note));
    detail.append(element('p','parking-note-v1','총 면수는 실시간 빈자리가 아닙니다. 외부 차량 이용 가능 여부·현재 요금은 현장에서 확인하세요.'));
    var links = element('div','parking-links-v1');
    var route = element('a','','길찾기 ↗');
    route.href = 'https://map.kakao.com/link/to/'+encodeURIComponent(item.name)+','+item.lat+','+item.lng;
    route.target='_blank'; route.rel='noopener noreferrer'; links.append(route);
    var source = element('a','','자료 출처 ↗');
    source.href = item.sourceUrl || snapshot.sourceUrl; source.target='_blank'; source.rel='noopener noreferrer'; links.append(source);
    detail.append(links); detail.hidden=false; detail.scrollTop=0; close.focus({preventScroll:true});
  }
  function setup() {
    if (!controls) {
      controls = element('section','parking-controls-v1'); controls.setAttribute('aria-label','주차장 표시');
      var label=element('label','','주차장 '); filter=element('select'); filter.setAttribute('aria-label','주차장 구분');
      [['all','전체'],['공영','공영'],['민영','민영'],['미확인','구분 미확인']].forEach(function (entry) {
        var option=element('option','',entry[1]); option.value=entry[0]; filter.append(option);
      });
      filter.onchange=function () { filterValue=filter.value; closeDetail(false); render(); };
      label.append(filter); status=element('span','parking-status-v1'); status.setAttribute('role','status');
      var hide=element('button','parking-hide-v1','숨기기'); hide.type='button'; hide.onclick=function(){ setEnabled(false); button.focus(); };
      controls.append(label,hide,status);
      detail=element('section','parking-detail-v1'); detail.hidden=true; detail.setAttribute('role','dialog');
      detail.setAttribute('aria-modal','false'); detail.setAttribute('aria-labelledby','parkingDetailTitleV1');
      [controls,detail].forEach(function(node){
        ['click','dblclick','pointerdown','mousedown','touchstart','wheel'].forEach(function(type){
          node.addEventListener(type,function(event){event.stopPropagation();},{passive:true});
        });
      });
    }
    document.getElementById('map').append(controls,detail);
    controls.hidden=false; text(status,'주차장 자료를 불러오는 중…');
  }
  function canonical(value) { return String(value || '').replace(/대전광역시|대전시|대전/g,'').replace(/[\s,()\-]/g,''); }
  function merged() {
    var records=(snapshot ? snapshot.items : []).slice();
    extra.forEach(function(item){
      var match=records.find(function(known){
        var sameAddress = canonical(known.address) && (canonical(known.address)===canonical(item.address) ||
          canonical(known.parcelAddress)===canonical(item.address) || canonical(known.parcelAddress)===canonical(item.parcelAddress));
        var sameName = canonical(known.name)===canonical(item.name);
        var veryClose = Math.abs(known.lat-item.lat)<.00002 && Math.abs(known.lng-item.lng)<.00002;
        return sameName && (sameAddress || veryClose) && Math.abs(known.lat-item.lat)<.0005 && Math.abs(known.lng-item.lng)<.0006;
      });
      // Collapse only the same name plus address/near-identical coordinates.
      // Different named facilities at one building address remain separate.
      if (!match) records.push(item);
    });
    return records;
  }
  function render() {
    if (!enabled || !map) return;
    var center=map.getCenter(), lat=center.getLat(), lng=center.getLng();
    var visible=merged().filter(function(item){return inBounds(item) && (filterValue==='all' || item.kind===filterValue);});
    visible.sort(function(a,b){return ((a.lat-lat)**2+(a.lng-lng)**2)-((b.lat-lat)**2+(b.lng-lng)**2);});
    var groups=new Map(),projection=map.getLevel()>=6 && map.getProjection && map.getProjection();
    visible.forEach(function(item){
      var point=projection && projection.containerPointFromCoords(coordinates(item));
      var key=point ? 'group:'+Math.floor(point.x/72)+':'+Math.floor(point.y/72) : item.id;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
    });
    var shown=[...groups.entries()].slice(0,160), keep=new Set(shown.map(function(entry){return entry[0];}));
    overlays.forEach(function(entry,id){ if(!keep.has(id)){entry.overlay.setMap(null);overlays.delete(id);} });
    shown.forEach(function(entry){
      var key=entry[0],group=entry[1],item=group[0],signature=group.map(function(p){return p.id;}).join('|');
      var existing=overlays.get(key),node=existing && existing.node;
      if(existing && existing.signature===signature)return;
      if(!node){node=element('button','parking-pin-v1');node.type='button';node.dataset.parkingId=key;node.addEventListener('mousedown',function(event){event.stopPropagation();});}
      node.replaceChildren(document.createTextNode('P'));
      if(group.length>1)node.append(element('span','parking-group-count-v1',group.length));
      node.title=group.length>1 ? '주변 주차장 '+group.length+'곳 · 눌러서 상세 보기' : item.name+' · '+item.kind+' · '+(item.capacity ? item.capacity+'면' : '대수 미확인');
      node.setAttribute('aria-label',node.title);
      node.onclick=function(event){event.stopPropagation();showDetail(item,node,group);};
      if(existing){existing.signature=signature;existing.overlay.setPosition(coordinates(item));if(selected===key)closeDetail(false);return;}
      var overlay=new global.kakao.maps.CustomOverlay({map:map,position:coordinates(item),content:node,xAnchor:.5,yAnchor:.5,zIndex:850,clickable:true});
      overlays.set(key,{node:node,overlay:overlay,signature:signature});
    });
    if(selected && !keep.has(selected))closeDetail(false);
    var message='대전 · 현재 지도 '+visible.length+'곳'+(groups.size>160 ? ' · 가까운 160개 표시, 확대해 주세요' :
      groups.size<visible.length ? ' · 묶음 포함 '+groups.size+'개 표시' : ' 표시');
    text(status,message+(sourceWarning ? ' · '+sourceWarning : '')+(searchMessage ? ' · '+searchMessage : ''));
  }
  function viewportKey() {
    var bounds=map.getBounds(),sw=bounds.getSouthWest(),ne=bounds.getNorthEast();
    return [sw.getLat(),sw.getLng(),ne.getLat(),ne.getLng()].map(function(v){return v.toFixed(5);}).join(',');
  }
  function queryPlaces() {
    if(!enabled || !map)return;
    render();
    var services=global.kakao.maps.services;
    if(!services || !services.Places){searchMessage='추가 장소검색 사용 불가 · 공공자료 표시';render();return;}
    var bounds=map.getBounds(), key=viewportKey();
    if(cache.has(key)){extra=cache.get(key).items;searchMessage=cache.get(key).message;render();return;}
    if(pending)return;
    pending=true;
    var token=generation, places=new services.Places(), found=[], page=1, settled=false;
    var timeout=global.setTimeout(function(){finish('추가검색 지연 · 공공자료 표시');},12000);
    function finish(message){
      if(settled)return;settled=true;global.clearTimeout(timeout);
      if(token!==generation || !enabled)return;
      pending=false;
      extra=found;searchMessage=message;
      if(!message.includes('실패') && !message.includes('지연')){
        cache.set(key,{items:found,message:message});if(cache.size>20)cache.delete(cache.keys().next().value);
      }
      render(); if(viewportKey()!==key)schedule();
    }
    function next(){
      places.categorySearch('PK6',function(items,result,pagination){
        if(settled || token!==generation || !enabled)return;
        if(result===services.Status.ZERO_RESULT)return finish('');
        if(result!==services.Status.OK || !Array.isArray(items))return finish('추가검색 실패 · 다시 켜서 재시도');
        items.forEach(function(item){
          var lat=Number(item.y),lng=Number(item.x);
          if(!Number.isFinite(lat)||!Number.isFinite(lng)||!/^대전(?:광역시)?\s/.test(item.address_name || item.road_address_name || ''))return;
          var id='kakao:'+item.id;if(found.some(function(p){return p.id===id;}))return;
          found.push({id:id,name:String(item.place_name||'주차장'),kind:/민영/.test(item.category_name||'')?'민영':/공영/.test(item.category_name||'')?'공영':'미확인',
            address:String(item.road_address_name||item.address_name||''),parcelAddress:String(item.address_name||''),lat:lat,lng:lng,
            phone:String(item.phone||''),sourceUrl:'https://place.map.kakao.com/'+encodeURIComponent(item.id)});
        });
        if(pagination && pagination.hasNextPage && page<3){page++;next();}
        else finish((pagination && (pagination.hasNextPage || Number(pagination.totalCount)>45)) || found.length>=45 ? '추가 장소검색 최대 45곳 · 확대해 확인' : '');
      },{bounds:bounds,size:15,page:page});
    }
    next();
  }
  function schedule(){
    global.clearTimeout(timer);
    if(!enabled)return;
    timer=global.setTimeout(queryPlaces,500);
  }
  async function load(){
    if(snapshot)return snapshot;
    if(loading)return loading;
    loading=(async function(){
      var response=await global.fetch(DATA_URL,{credentials:'same-origin',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Parking data HTTP '+response.status);
      var value=await response.json();
      if(value.schemaVersion!==1 || !Array.isArray(value.items) || !value.items.length)throw new Error('Invalid parking data');
      snapshot=value;return value;
    })();
    try{return await loading;}finally{loading=null;}
  }
  async function setEnabled(value){
    enabled=!!value;generation++; global.clearTimeout(timer); pending=false; extra=[];searchMessage='';sourceWarning='';
    [button,document.getElementById('mapParkingPhoneBtnV1')].filter(Boolean).forEach(function(node){
      node.classList.toggle('on',enabled);node.setAttribute('aria-pressed',String(enabled));
    });
    if(map && global.kakao?.maps?.event)global.kakao.maps.event.removeListener(map,'idle',schedule);
    closeDetail(false); overlays.forEach(function(entry){entry.overlay.setMap(null);});overlays.clear();
    if(!enabled){if(controls)controls.hidden=true;return;}
    map=global.map;
    if(!map || !global.kakao?.maps?.CustomOverlay)return setEnabled(false);
    setup();var token=generation;
    global.kakao.maps.event.addListener(map,'idle',schedule);
    try{await load();if(token!==generation || !enabled)return;render();queryPlaces();}
    catch(error){if(token===generation && enabled){sourceWarning='공공자료 로드 실패 · 다시 켜서 재시도';text(status,sourceWarning);queryPlaces();}}
  }
  function toggle(){
    if(global.closeMapQuickPopoversV657)global.closeMapQuickPopoversV657();
    setEnabled(!enabled);
  }
  button.addEventListener('click',toggle);
  var phoneButton=document.getElementById('mapParkingPhoneBtnV1');
  if(phoneButton)phoneButton.addEventListener('click',toggle);
  document.addEventListener('keydown',function(event){if(event.key==='Escape' && detail && !detail.hidden){event.stopPropagation();closeDetail(true);}});
  global.JSMapParkingV1={hide:function(){return setEnabled(false);}};
})(window);

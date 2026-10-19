/* Land sale only. Exact parcel outlines, never estimated from listing pins. */
(function(global){
  'use strict';
  var generation=0,overlays=[],bar=null,controller=null,capability=null;
  var text=function(v){return String(v==null?'':v).trim();};
  var owner=function(){return text(global.JSAuthenticatedAccountEmail).toLowerCase();};
  var isLand=function(){return global.JSListingTradeV1&&global.JSListingTradeV1.getMode()==='land_sale';};
  function clear(){
    generation++;if(controller)controller.abort();controller=null;
    overlays.forEach(function(overlay){overlay.setMap(null);});overlays=[];
    if(bar)bar.remove();bar=null;
  }
  async function read(action,params,account,signal){
    if(!account||!global.JSDataAccessV6)throw Error('로그인 연결을 확인해 주세요.');
    var data=await global.JSDataAccessV6.read(action,Object.assign({},params,{expectedAccountEmail:account}),{signal:signal,timeoutMs:action==='saleParcelFacts'?30000:15000});
    if(owner()!==account)throw Error('계정이 변경되었습니다. 다시 열어 주세요.');return data;
  }
  function available(account){
    if(capability&&capability.owner===account&&Date.now()-capability.at<60000)return capability.promise;
    var value={owner:account,at:Date.now()};
    value.promise=read('saleParcelBoundaryConfig',{},account).then(function(data){return data.available===true;}).catch(function(){if(capability===value)capability=null;return false;});
    capability=value;return value.promise;
  }
  function active(panel,account,token){
    var drawer=panel.closest('#unifiedDetailDrawerV8');
    return token===generation&&panel.isConnected&&isLand()&&owner()===account&&(!drawer||drawer.getAttribute('aria-hidden')!=='true');
  }
  function area(value){var n=Number(value);return value!=null&&text(value)&&Number.isFinite(n)&&n>0?n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'㎡ · '+(n/3.305785).toLocaleString('ko-KR',{maximumFractionDigits:2})+'평':'미제공';}
  function polygons(data,pnu){
    if(data.pnu!==pnu||data.geometry?.type!=='MultiPolygon')throw Error('요청한 필지와 경계 응답이 다릅니다.');
    var result=data.geometry.coordinates,vertices=0,rings=0;
    if(!Array.isArray(result)||!result.length||result.length>32)throw Error('필지 경계 형식을 확인하지 못했습니다.');
    result.forEach(function(polygon){
      if(!Array.isArray(polygon)||!polygon.length||(rings+=polygon.length)>64)throw Error('필지 경계 형식을 확인하지 못했습니다.');
      polygon.forEach(function(ring){
        if(!Array.isArray(ring)||ring.length<4||(vertices+=ring.length)>10000)throw Error('필지 경계 좌표 수를 확인하지 못했습니다.');
        ring.forEach(function(p){if(!Array.isArray(p)||p.length!==2||!p.every(function(n){return typeof n==='number'&&Number.isFinite(n);})||p[0]<123||p[0]>133||p[1]<32||p[1]>40)throw Error('필지 경계 좌표계를 확인하지 못했습니다.');});
        if(ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1])throw Error('닫히지 않은 필지 경계입니다.');
      });
    });return result;
  }
  // Scan the polygon including its holes: a concave lot's bounding-box centre
  // can be outside the lot and must not be presented as its location.
  function labelPoint(polygon){
    var outer=polygon[0],ys=outer.map(function(p){return p[1];}),min=Math.min.apply(null,ys),max=Math.max.apply(null,ys),best=null;
    for(var s=1;s<10;s++){
      var y=min+(max-min)*s/10,xs=[];
      polygon.forEach(function(ring){for(var i=1;i<ring.length;i++){var a=ring[i-1],b=ring[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}});
      xs.sort(function(a,b){return a-b;});for(var j=0;j+1<xs.length;j+=2){var width=xs[j+1]-xs[j];if(!best||width>best.width)best={point:[(xs[j]+xs[j+1])/2,y],width:width};}
    }return best?best.point:outer[0];
  }
  function makeBounds(rows,maps){
    var bounds=new maps.LatLngBounds();rows.forEach(function(row){row.polygons.forEach(function(p){p[0].forEach(function(v){bounds.extend(new maps.LatLng(v[1],v[0]));});});});return bounds;
  }
  function show(rows){
    var maps=global.kakao&&global.kakao.maps,map=global.map;
    if(!isLand()||!map||!maps||!maps.Polygon||!maps.CustomOverlay||!maps.LatLngBounds||typeof map.setBounds!=='function')throw Error('지도가 준비되지 않았습니다. 잠시 후 다시 눌러 주세요.');
    var next=[],nextBar=document.createElement('section'),account=owner(),token=generation;nextBar.className='sale-parcel-map-v23';nextBar.setAttribute('aria-label','선택 필지 경계');
    var heading=document.createElement('strong');heading.textContent='선택 필지 '+rows.length+'개';
    var close=document.createElement('button');close.type='button';close.textContent='경계 숨기기';close.onclick=clear;
    var header=document.createElement('header');header.append(heading,close);nextBar.append(header);
    var details=document.createElement('details');details.open=rows.length===1;
    var summary=document.createElement('summary');summary.textContent='번호별 필지·면적 보기';details.append(summary);
    var list=document.createElement('ol');
    function focus(row){
      details.open=true;
      nextBar.querySelectorAll('[data-boundary-row]').forEach(function(el){el.classList.toggle('selected',Number(el.dataset.boundaryRow)===row.index);});
      rows.forEach(function(r){r.shapes.forEach(function(shape){shape.setOptions({strokeWeight:r===row?4:2,fillOpacity:r===row?0.19:0.08});});});
      map.setBounds(makeBounds([row],maps),45,45,100,45);
    }
    try{
      rows.forEach(function(row,index){
        row.index=index+1;row.shapes=[];
        row.polygons.forEach(function(polygon,part){
          var shape=new maps.Polygon({path:polygon.map(function(ring){return ring.map(function(p){return new maps.LatLng(p[1],p[0]);});}),strokeWeight:3,strokeColor:'#0f766e',strokeOpacity:0.95,strokeStyle:'solid',fillColor:'#2dd4bf',fillOpacity:0.12,zIndex:8});
          row.shapes.push(shape);next.push(shape);
          if(part===0){var point=labelPoint(polygon),badge=document.createElement('button');badge.type='button';badge.className='sale-parcel-badge-v23';badge.textContent=String(index+1);badge.setAttribute('aria-label',(index+1)+'번 필지 '+row.address);badge.onclick=function(event){event.stopPropagation();focus(row);};next.push(new maps.CustomOverlay({position:new maps.LatLng(point[1],point[0]),content:badge,zIndex:9,xAnchor:0.5,yAnchor:0.5}));}
        });
        var li=document.createElement('li');li.dataset.boundaryRow=String(index+1);
        var button=document.createElement('button');button.type='button';button.textContent=(index+1)+'. '+row.address;button.onclick=function(){focus(row);};
        var meta=document.createElement('small');meta.textContent=row.areaLabel+' '+area(row.areaM2);
        var publicButton=document.createElement('button');publicButton.type='button';publicButton.className='sale-parcel-area-check-v23';publicButton.textContent='공부 면적 확인';
        var publicStatus=document.createElement('small');publicStatus.setAttribute('role','status');
        publicButton.onclick=async function(){
          publicButton.disabled=true;publicStatus.textContent='공부 면적 확인 중…';
          try{
            var data=await read('saleParcelFacts',{pnu:row.pnu},account);
            if(token!==generation||owner()!==account||!nextBar.isConnected||!isLand())return;
            if(data.pnu!==row.pnu||!(typeof data.areaM2==='number'&&Number.isFinite(data.areaM2)&&data.areaM2>0))throw Error('같은 필지의 공부 면적을 확인하지 못했습니다.');
            var entered=Number(row.areaM2),different=Number.isFinite(entered)&&entered>0&&Math.abs(entered-data.areaM2)>1;
            publicStatus.textContent='공부 면적 '+area(data.areaM2)+' · 토지이음'+(different?' · '+row.areaLabel+'과 다름: 매매 범위 확인':'');publicButton.hidden=true;
          }catch(error){if(token===generation&&nextBar.isConnected)publicStatus.textContent=error.message;}
          finally{publicButton.disabled=false;}
        };
        li.append(button,meta,publicButton,publicStatus);list.append(li);
      });
      details.append(list);nextBar.append(details);
      var note=document.createElement('small');note.textContent='경계: 필지 전체 참고도 · 면적: 광고/내 입력 기준. 지분·부분 매매 범위와 측량 경계는 별도 확인.';nextBar.append(note);
      var source=document.createElement('small');source.textContent='국토교통부 · 브이월드 연속지적도';nextBar.append(source);
      var mapElement=document.getElementById('map');if(!mapElement?.parentElement)throw Error('지도 표시 영역을 확인하지 못했습니다.');
      next.forEach(function(overlay){overlay.setMap(map);});mapElement.parentElement.append(nextBar);overlays=next;bar=nextBar;
      if(global.JSUnifiedListingsV8)global.JSUnifiedListingsV8.close({preserveParcelBoundary:true});
      if(global.JSPhoneDeviceV1?.isMobileLayout()&&global.JSMobileAppV1)global.JSMobileAppV1.setView('map');
      if(typeof map.relayout==='function')map.relayout();map.setBounds(makeBounds(rows,maps),65,70,rows.length===1?170:100,30);
    }catch(error){next.forEach(function(overlay){overlay.setMap(null);});nextBar.remove();if(bar===nextBar){bar=null;overlays=[];}throw error;}
  }
  function mount(root,item){
    clear();
    if(!root||!isLand()||!global.JSListingTradeV1?.isSale(item)||global.JSListingTradeV1.normalizedSaleCategory(item)!=='land')return;
    var account=owner(),token=generation,panel=document.createElement('section');panel.className='sale-parcel-panel-v23';panel.dataset.saleSection='parcelboundary';panel.hidden=true;
    panel.innerHTML='<h3>선택 필지 경계</h3><p>지번이 확인된 필지 전체의 참고 경계입니다. 광고의 실제 매매 범위와 구분합니다.</p><div><button type="button" data-boundary-single>이 필지 지도에서 보기</button><button type="button" data-boundary-group>저장한 필지 함께 보기</button></div><p role="status" aria-live="polite" data-boundary-status></p>';
    var target=root.querySelector('[data-sale-section="publicland"]')||root.querySelector('[data-sale-section="land"]');if(target)target.after(panel);else root.append(panel);
    available(account).then(function(ok){if(ok&&active(panel,account,token))panel.hidden=false;});
    async function load(group){
      if(!active(panel,account,token))return;
      controller=new AbortController();var signal=controller.signal,status=panel.querySelector('[data-boundary-status]'),buttons=panel.querySelectorAll('button');
      buttons.forEach(function(b){b.disabled=true;});status.textContent='정확한 지번과 필지 경계를 확인하고 있습니다…';
      try{
        var input=[{address:item.address,areaM2:global.JSListingTradeV1.saleSummary(item).landAreaM2,areaLabel:'광고 면적'}];
        if(group){
          var key=text(item.originalId||item.propertyId);if(!key)throw Error('매물 식별자를 확인할 수 없습니다.');
          var saved=await read('loadCloudState',{scope:'saleWorksheetV1',recordKey:key},account,signal);
          if(!active(panel,account,token))return;
          if(!saved.data?.parcels?.length)throw Error('매입검토에서 포함 필지를 입력·저장한 뒤 함께 볼 수 있습니다.');
          if(!Array.isArray(saved.data.parcels)||saved.data.parcels.length>30)throw Error('저장한 필지표를 확인해 주세요. 최대 30필지까지 표시합니다.');
          input=saved.data.parcels.map(function(row){return {address:row.address,areaM2:row.areaM2,areaLabel:'내 입력 면적'};});
        }
        var rows=new Array(input.length),next=0,seen=new Set(),error=null;
        async function work(){while(!error&&next<input.length){var index=next++;try{
          var row=input[index],resolved=await global.JSParcelExternalLinksV1.resolve(row.address);
          if(!active(panel,account,token))return;
          if(seen.has(resolved.pnu))throw Error('같은 필지가 중복되어 있습니다. 저장한 필지표를 확인해 주세요.');seen.add(resolved.pnu);
          var data=await read('saleParcelBoundary',{pnu:resolved.pnu},account,signal);
          if(!active(panel,account,token))return;
          rows[index]={address:resolved.address,pnu:resolved.pnu,areaM2:row.areaM2,areaLabel:row.areaLabel,polygons:polygons(data,resolved.pnu)};
        }catch(e){error=Error((index+1)+'번 필지: '+e.message);}}}
        await Promise.all([work(),work()]);
        if(!active(panel,account,token))return;if(error)throw error;
        var vertices=rows.reduce(function(total,row){return total+row.polygons.reduce(function(sum,p){return sum+p.reduce(function(n,ring){return n+ring.length;},0);},0);},0);
        if(vertices>30000)throw Error('필지 경계가 복잡해 한 번에 표시할 수 없습니다. 필지를 나누어 확인해 주세요.');
        show(rows);
      }catch(error){if(active(panel,account,token))status.textContent=error.message;}
      finally{if(active(panel,account,token))buttons.forEach(function(b){b.disabled=false;});}
    }
    panel.querySelector('[data-boundary-single]').onclick=function(){load(false);};panel.querySelector('[data-boundary-group]').onclick=function(){load(true);};
  }
  global.addEventListener('js-listing-trade-mode-change',clear);global.addEventListener('pagehide',clear);
  global.JSSaleParcelBoundaryV23={mount:mount,clear:clear,labelPoint:labelPoint};
})(window);

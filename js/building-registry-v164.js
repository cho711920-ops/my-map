/* Account-owned building display groups and independent confirmed landlord rules.
 * Neither operation mutates a listing, advertisement, memo or asking price. */
(function(global){
  'use strict';
  var core=global.JSBuildingRegistryCoreV164;if(!core)return;
  var account='',data={schema:164,buildings:[],contacts:[]},view=core.index(data),version=0,loaded=false,loadTask=null,sequence=0,dialog=null,edit=null,busy=false,bar=null,lastLoad=0;
  function owner(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function cacheKey(who){return 'js-building-registry-v164:'+who;}
  function cleanAccount(){var who=owner();if(who===account)return !!who;account=who;data={schema:164,buildings:[],contacts:[]};view=core.index(data);version=0;loaded=false;lastLoad=0;loadTask=null;sequence++;if(dialog?.open)dialog.close();edit=null;
    if(who)try{var saved=JSON.parse(localStorage.getItem(cacheKey(who))||'null');if(saved?.account===who&&Number.isSafeInteger(saved.version)&&saved.version>=0){data=core.validate(saved.data);view=core.index(data);version=saved.version;}}catch{}return !!who;
  }
  function parcelOf(item){return core.parcel(item?.address)||core.parcel(global.JSMapAddressRegionV1?.read(item?.address));}
  function manualPhone(item){
    var fields=(item?.manualFinancialFieldsV106||[]).slice();
    (item?.unifiedAllOriginalsV1||[]).forEach(function(row){if(String(row.propertyId)===String(item.propertyId))fields=fields.concat(String(row.manualDisplayFields||'').split(','));});
    var external=/네이버|naver|당근|daangn|danggeun/i.test(String(item?.source||''));
    return fields.includes('landlord_phone')||!external&&!!item?.landlordPhone;
  }
  function locationMeta(item){return{id:String(item?.propertyId||''),parcel:parcelOf(item)};}
  function meta(item){var manual=manualPhone(item);return Object.assign(locationMeta(item),{phone:manual?core.phone(item.landlordPhone):'',manual:manual});}
  function reviewPhone(item){var own=meta(item).phone;if(own)return own;var contact=global.extractListContactsV650?.(item,{withoutBuilding:true}).find(function(row){return row.role==='임'||row.role==='주';});return core.phone(contact?.phone?.tel);}
  function building(item){cleanAccount();if(!data.buildings.length)return null;return core.buildingFor(view.buildings,locationMeta(item));}
  function contact(item){cleanAccount();if(!data.contacts.length)return null;return core.contactFor(view,meta(item));}
  function contactRecord(item){var m=meta(item);return view.contacts.members.get(m.id)||view.contacts.knownParcels.get(m.parcel)||null;}
  function items(){var source=global.JSQueryListingsV152?.active?.()?global.JSQueryListingsV152.navigationItems():(global.allItems||[]),found=new Map();source.concat(global.allItems||[]).forEach(function(item){if(core.id(String(item?.propertyId||''))&&parcelOf(item))found.set(String(item.propertyId),item);});return Array.from(found.values());}
  function esc(value){return String(value??'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function mapSignature(value){return JSON.stringify(value.buildings);}
  function patchContacts(){
    if(!global.buildListContactButtonV654)return;
    document.querySelectorAll('#list .item[data-property-id]').forEach(function(card){
      var item=card.__listItemV132;if(!item||String(item.propertyId)!==card.dataset.propertyId)return;
      var old=card.querySelector('.item-contact-button-v654');if(!old||old.contains(document.activeElement))return;
      var template=document.createElement('template');template.innerHTML=global.buildListContactButtonV654(item,encodeURIComponent('id:'+item.propertyId),false);
      var next=template.content.firstElementChild;if(next&&old.outerHTML!==next.outerHTML)old.replaceWith(next);
    });
    if(global.propertyEditTargetV630&&document.getElementById('propertyEditModalV630')?.classList.contains('open'))decorateEdit(global.propertyEditTargetV630,true);
  }
  function publish(next,nextVersion){
    var before=mapSignature(data);data=core.validate(next);version=nextVersion;view=core.index(data);
    try{localStorage.setItem(cacheKey(account),JSON.stringify({account:account,version:version,data:data}));}catch{}
    patchContacts();syncMapControls();
    if(before!==mapSignature(data)&&global.map&&typeof global.drawMapClustersOnlyV639==='function')global.drawMapClustersOnlyV639(global.jsLastRenderedItemsV639||global.currentItems||[]);
  }
  function load(force){
    if(!cleanAccount()||!global.JSDataAccessV6)return Promise.resolve(false);
    if(loadTask)return loadTask;if(!force&&loaded&&Date.now()-lastLoad<30000)return Promise.resolve(true);
    var who=account;
    var task=global.JSDataAccessV6.read('loadCloudState',{scope:core.scope,recordKey:core.key,expectedAccountEmail:who},{cache:'no-store'}).then(function(result){
      if(owner()!==who||account!==who)return false;
      if(result?.ok!==true||result.scope!==core.scope||result.recordKey!==core.key||!Number.isSafeInteger(result.version)||result.version<0)throw new Error('건물 설정 응답을 확인하지 못했습니다.');
      var next=result.found?core.validate(result.data):{schema:164,buildings:[],contacts:[]};
      if(result.version>=version)publish(next,result.version);loaded=true;lastLoad=Date.now();return true;
    }).finally(function(){if(loadTask===task)loadTask=null;});loadTask=task;return task;
  }
  async function save(next,context){
    if(!context||context.account!==owner()||context.account!==account||context.version!==version)throw new Error('다른 창에서 건물 설정이 바뀌었습니다. 입력은 유지됩니다. 닫은 뒤 최신 범위를 다시 확인해 주세요.');
    next=core.validate(next);var who=account,expected=version;
    var result=await global.JSDataAccessV6.mutate('saveCloudState',{scope:core.scope,recordKey:core.key,data:next,expectedVersion:expected,expectedAccountEmail:who,requestId:context.requestId});
    if(owner()!==who||account!==who)return false;
    if(result?.persisted!==true||result.queued||result.scope!==core.scope||result.recordKey!==core.key||result.version!==expected+1)throw new Error('건물 설정 저장 결과를 확인하지 못했습니다.');
    loaded=true;lastLoad=Date.now();publish(next,result.version);return true;
  }
  function selectedClusters(){return(global.overlays||[]).map(function(o){return o.__cluster;}).filter(function(c){return c&&(global.selectedGroupKeys||[]).includes(c.key);});}
  function selectedRows(){var byId=new Map();selectedClusters().forEach(function(c){(c.items||[]).forEach(function(item){if(core.id(String(item.propertyId||'')))byId.set(String(item.propertyId),item);});});return Array.from(byId.values());}
  function syncMapControls(){
    if(!global.document||!cleanAccount())return;
    if(!bar){var status=document.getElementById('listToolbar');if(!status)return;bar=document.createElement('div');bar.id='buildingMapActionsV164';bar.hidden=true;status.after(bar);}
    var clusters=selectedClusters(),one=(global.overlays||[]).find(function(o){return o.__cluster?.key===global.selectedGroupKey;})?.__cluster;
    var record=one?.buildingIdV164?view.buildings.records.get(one.buildingIdV164):null;
    if(!record&&one){var candidates=Array.from(new Set((one.items||[]).map(function(item){return building(item)?.id;}).filter(Boolean)));if(candidates.length===1)record=view.buildings.records.get(candidates[0]);}
    var canCreate=global.multiClusterMode&&clusters.length>=2&&!clusters.some(function(c){return c.regionMode;})&&selectedRows().length<=200;
    var html=canCreate?'<button type="button" data-building-create>같은 건물로 묶기</button><span>선택한 지번과 매물을 확인합니다.</span>':record?'<button type="button" data-building-manage="'+esc(record.id)+'">건물 묶음 관리</button>':'';
    bar.hidden=!html;if(bar.innerHTML===html)return;bar.innerHTML=html;
    bar.querySelector('[data-building-create]')?.addEventListener('click',function(){openGroup();});
    bar.querySelector('[data-building-manage]')?.addEventListener('click',function(){openGroup(record.id);});
  }
  function groupAddressGroups(groups){
    cleanAccount();if(!data.buildings.length)return groups;
    var merged=new Map(),out=[];
    (groups||[]).forEach(function(group){var own=[];(group.items||[]).forEach(function(item){
      var b=core.buildingFor(view.buildings,locationMeta(item));if(!b){own.push(item);return;}
      if(!merged.has(b.id))merged.set(b.id,{key:'building-v164:'+b.id,address:b.parcels[0],latlng:new global.kakao.maps.LatLng(b.anchor.lat,b.anchor.lng),items:[],buildingIdV164:b.id,seen:new Set()});
      var target=merged.get(b.id),id=String(item.propertyId);if(!target.seen.has(id)){target.seen.add(id);target.items.push(item);}
    });if(own.length)out.push(Object.assign({},group,{items:own}));});
    merged.forEach(function(group){delete group.seen;out.push(group);});return out;
  }
  function ensureDialog(){
    if(dialog)return;dialog=document.createElement('dialog');dialog.id='buildingRegistryDialogV164';dialog.setAttribute('aria-labelledby','buildingRegistryTitleV164');
    dialog.innerHTML='<header><h2 id="buildingRegistryTitleV164"></h2><button type="button" data-close aria-label="건물 설정 닫기">×</button></header><div class="building-registry-body-v164"></div><p data-status role="status"></p><footer><button type="button" data-delete hidden></button><span></span><button type="button" data-close>취소</button><button type="button" data-save>저장</button></footer>';
    document.body.append(dialog);dialog.querySelectorAll('[data-close]').forEach(function(button){button.onclick=function(){if(!busy){sequence++;dialog.close();edit=null;}};});
    dialog.addEventListener('keydown',function(event){if(event.key==='Escape')event.stopPropagation();});
    dialog.addEventListener('cancel',function(event){if(busy)event.preventDefault();else{sequence++;edit=null;}});
    dialog.addEventListener('change',function(event){if(event.target.matches('[data-member],[data-parcel]'))syncAutoScope();});
    dialog.querySelector('[data-save]').onclick=submit;dialog.querySelector('[data-delete]').onclick=removeRecord;
  }
  function status(message){dialog.querySelector('[data-status]').textContent=message;}
  function syncAutoScope(){
    if(!edit||!dialog)return;var body=dialog.querySelector('.building-registry-body-v164'),automatic=body.querySelector('[data-auto]');if(!automatic)return;
    var parcels=Array.from(body.querySelectorAll('[data-parcel]:checked')).map(function(node){return node.dataset.parcel;}),chosen=new Set(Array.from(body.querySelectorAll('[data-member]:checked')).map(function(node){return node.dataset.member;}));
    var excluded=edit.rows.some(function(row){return parcels.includes(parcelOf(row))&&!chosen.has(String(row.propertyId));})||edit.records.some(function(record){return record.excludedIds.some(function(id){return!chosen.has(id);});});
    automatic.disabled=busy||excluded;if(excluded)automatic.checked=false;
    body.querySelector('[data-auto-hint]').textContent=excluded?'일부 매물을 제외하여 신규 자동 연결을 껐습니다.':'';
  }
  function setBusy(value){busy=value;dialog.querySelectorAll('button,input').forEach(function(node){node.disabled=value;});dialog.querySelector('[data-save]').textContent=value?'저장 확인 중…':'저장';if(!value)syncAutoScope();}
  function begin(kind){ensureDialog();sequence++;edit=null;busy=false;dialog.querySelector('.building-registry-body-v164').replaceChildren();dialog.querySelector('#buildingRegistryTitleV164').textContent=kind==='map'?'같은 건물로 묶기':'건물 공통 임대인 번호';dialog.querySelector('[data-delete]').hidden=true;setBusy(false);dialog.querySelector('[data-save]').disabled=true;status('저장된 건물 설정을 확인하고 있습니다.');if(!dialog.open)dialog.showModal();return sequence;}
  function candidateRows(parcels,seed){var found=new Map();items().concat(seed||[]).forEach(function(item){if(parcels.includes(parcelOf(item)))found.set(String(item.propertyId),item);});return Array.from(found.values());}
  function rowHtml(item,checked,contactMode){var m=meta(item),known=core.displayPhone(reviewPhone(item));return '<label class="building-scope-row-v164"><input type="checkbox" data-member="'+esc(m.id)+'"'+(checked?' checked':'')+'><span><strong>'+esc(item.name||item.type||'매물')+'</strong><span>'+esc(item.address)+' · '+esc(global.formatListingRoomForCardV653?.(item.sourceFloorVerifiedV1?item.advertisedRoomV1:item.room,item.floor)||'층수 미확인')+'</span>'+(contactMode&&known?'<small>개별 임대인 '+esc(known)+'</small>':'')+'</span></label>';}
  function scopeHtml(rows,selected,parcels){return '<div class="building-scope-list-v164">'+rows.map(function(item){return rowHtml(item,selected.has(String(item.propertyId)),edit.kind==='contact');}).join('')+'</div><fieldset><legend>포함할 지번</legend>'+parcels.map(function(p){return'<label><input type="checkbox" data-parcel="'+esc(p)+'" checked>'+esc(p)+'</label>';}).join('')+'</fieldset><label class="building-future-v164"><input type="checkbox" data-auto checked>선택 지번의 다른 매물·신규 광고도 자동 연결</label><p data-auto-hint class="building-help-v164"></p><p class="building-help-v164">일부 매물을 제외하면 신규 자동 연결을 끕니다. 주소가 불명확하거나 아직 확인하지 않은 다른 지번에는 자동 연결하지 않습니다.</p>';}
  async function openGroup(recordId){
    var seed=recordId?[]:selectedRows(),clusterKeys=(global.selectedGroupKeys||[]).join('|'),token=begin('map');
    try{if(!await load(true))throw new Error('계정의 건물 설정을 확인하지 못했습니다.');if(token!==sequence||!dialog.open)return;
      if(!recordId&&clusterKeys!==(global.selectedGroupKeys||[]).join('|'))throw new Error('지도 선택이 바뀌었습니다. 다시 선택해 주세요.');
      var records=recordId?[view.buildings.records.get(recordId)].filter(Boolean):data.buildings.filter(function(b){return seed.some(function(item){return core.buildingFor(view.buildings,locationMeta(item))?.id===b.id;});});
      var parcels=Array.from(new Set(records.flatMap(function(b){return b.parcels;}).concat(seed.map(parcelOf).filter(Boolean))));
      if(!parcels.length||parcels.length>30||seed.length>200)throw new Error('가까운 건물의 지번과 매물만 선택해 주세요.');
      var rows=candidateRows(parcels,seed),chosen=new Set(records.flatMap(function(b){return b.memberIds;}).concat(seed.map(function(item){return String(item.propertyId);})));
      if(!rows.length)throw new Error('현재 조회 범위에서 포함할 매물을 확인해 주세요.');
      edit={kind:'map',account:account,version:version,requestId:crypto.randomUUID(),rows:rows,records:records,recordId:recordId||records[0]?.id||'b-'+crypto.randomUUID(),parcels:parcels};
      var body=dialog.querySelector('.building-registry-body-v164');body.innerHTML='<p>개별 매물·주소·메모·조건은 그대로 두고 지도 위치만 묶습니다.</p><label>건물 이름 <input data-label maxlength="100" value="'+esc(records[0]?.label||seed[0]?.name||'건물 묶음')+'"></label>'+scopeHtml(rows,chosen,parcels)+
        '<fieldset><legend>지도에 표시할 기준 위치</legend>'+(records[0]?.anchor?'<label><input type="radio" name="building-anchor-v164" value="saved" checked>기존 저장 위치 유지</label>':'')+rows.filter(function(item){return item.latlng||Number.isFinite(item.latitude)&&Number.isFinite(item.longitude);}).map(function(item,i){return'<label><input type="radio" name="building-anchor-v164" value="'+esc(item.propertyId)+'"'+(!records[0]?.anchor&&!i?' checked':'')+'>'+esc(item.address)+'</label>';}).join('')+'</fieldset>';
      if(recordId)body.querySelector('[data-auto]').checked=records.every(function(b){return b.autoParcels.length===b.parcels.length;});
      var del=dialog.querySelector('[data-delete]');del.hidden=!recordId;del.textContent='묶음 해제';setBusy(false);status('확인한 지번과 매물만 선택한 뒤 저장해 주세요.');
    }catch(error){if(token===sequence){setBusy(false);dialog.querySelector('[data-save]').disabled=true;status(error.message);}}
  }
  async function openContact(item){
    var identity=String(item?.propertyId||''),token=begin('contact');
    try{if(!await load(true))throw new Error('계정의 건물 설정을 확인하지 못했습니다.');if(token!==sequence||!dialog.open||owner()!==account)return;
      var p=parcelOf(item);if(!p||!core.id(identity))throw new Error('정확한 지번과 매물 ID를 확인한 뒤 지정해 주세요.');
      var existing=contactRecord(item),mapBuilding=building(item),parcels=existing?existing.parcels:mapBuilding?mapBuilding.parcels:[p],rows=candidateRows(parcels,[item]);
      if(rows.length>200)throw new Error('적용 범위가 큽니다. 현재 조회 조건을 좁힌 뒤 매물 범위를 확인해 주세요.');
      var reviewedVersion=version;
      if(global.JSQueryListingsV152?.active?.())rows=await global.JSQueryListingsV152.readMastersForBuildingV164(rows.map(function(row){return String(row.propertyId);}));
      if(token!==sequence||!dialog.open||owner()!==account)return;
      if(version!==reviewedVersion)throw new Error('건물 설정이 바뀌었습니다. 닫은 뒤 다시 확인해 주세요.');
      var current=rows.find(function(row){return String(row.propertyId)===identity;});if(!current||rows.some(function(row){return!parcels.includes(parcelOf(row));}))throw new Error('매물의 지번이 바뀌었습니다. 최신 매물에서 다시 확인해 주세요.');
      var input=document.getElementById('peLandlordPhoneV630'),typed=global.propertyEditTargetV630===item&&global.propertyEditTouchedFieldsV131?.landlordPhone&&!input?.dataset.buildingCommonV164?core.phone(input?.value):'',number=existing?.phone||typed||reviewPhone(current);
      var selected=new Set(rows.filter(function(row){if(existing)return !!core.contactFor(view,meta(row));var own=reviewPhone(row);return!own||own===number;}).map(function(row){return String(row.propertyId);}));
      if(!existing)selected.add(identity);
      edit={kind:'contact',account:account,version:version,requestId:crypto.randomUUID(),rows:rows,records:existing?[existing]:[],recordId:existing?.id||'c-'+crypto.randomUUID(),parcels:parcels,item:item};
      var body=dialog.querySelector('.building-registry-body-v164');body.innerHTML='<p>직접 확인한 임대인이 같은 매물만 연결합니다. 일반 매물 수정과 별도로 저장됩니다.</p>'+(existing&&contact(item)?'<button type="button" data-individual>이 매물은 개별번호</button>':'')+'<label>공통 임대인 전화번호 <input type="tel" inputmode="tel" data-phone value="'+esc(core.displayPhone(number))+'" placeholder="임대인 번호 입력"></label><label>관리 이름 <input data-label maxlength="100" value="'+esc(existing?.label||mapBuilding?.label||item.name||'건물 공통번호')+'"></label>'+scopeHtml(rows,selected,parcels);
      body.querySelector('[data-individual]')?.addEventListener('click',function(){if(busy)return;sequence++;dialog.close();edit=null;individual(item);});
      if(existing)body.querySelector('[data-auto]').checked=existing.autoParcels.length===existing.parcels.length;
      var del=dialog.querySelector('[data-delete]');del.hidden=!existing;del.textContent='공통번호 해제';setBusy(false);status('다른 개별번호가 있는 매물은 기본 선택에서 제외했습니다. 포함하려면 직접 확인해 체크해 주세요.');
    }catch(error){if(token===sequence){setBusy(false);dialog.querySelector('[data-save]').disabled=true;status(error.message);}}
  }
  function draft(){
    if(!edit)throw new Error('적용 범위를 다시 확인해 주세요.');var body=dialog.querySelector('.building-registry-body-v164'),parcels=Array.from(body.querySelectorAll('[data-parcel]:checked')).map(function(node){return node.dataset.parcel;}),chosen=new Set(Array.from(body.querySelectorAll('[data-member]:checked')).map(function(node){return node.dataset.member;}));
    var selected=edit.rows.filter(function(row){return chosen.has(String(row.propertyId))&&parcels.includes(parcelOf(row));});if(!selected.length)throw new Error('적용할 매물을 선택해 주세요.');
    var selectedIds=selected.map(function(row){return String(row.propertyId);}),excluded=edit.rows.filter(function(row){return parcels.includes(parcelOf(row))&&!chosen.has(String(row.propertyId));}).map(function(row){return String(row.propertyId);});
    var auto=body.querySelector('[data-auto]').checked?parcels.filter(function(p){return!edit.rows.some(function(row){return parcelOf(row)===p&&!chosen.has(String(row.propertyId));});}):[];
    var oldIds=edit.records.flatMap(function(record){return record.memberIds;}),known=new Set(edit.rows.map(function(row){return String(row.propertyId);})),history=oldIds.filter(function(id){return!known.has(id);});
    var record={id:edit.recordId,label:body.querySelector('[data-label]').value.trim(),parcels:parcels,memberIds:Array.from(new Set(history.concat(selectedIds))),excludedIds:Array.from(new Set(edit.records.flatMap(function(record){return record.excludedIds;}).concat(excluded))).filter(function(id){return!selectedIds.includes(id);}),autoParcels:auto};
    if(record.excludedIds.length)record.autoParcels=[];
    var next=clone(data);
    if(edit.kind==='map'){
      var anchorId=body.querySelector('[name="building-anchor-v164"]:checked')?.value,anchor=edit.rows.find(function(row){return String(row.propertyId)===anchorId;});
      if(anchorId!=='saved'&&(!anchor||!chosen.has(anchorId)||!parcels.includes(parcelOf(anchor))))throw new Error('포함한 지번의 기준 위치를 선택해 주세요.');
      record.anchor=anchorId==='saved'?clone(edit.records[0].anchor):{lat:anchor.latlng?anchor.latlng.getLat():anchor.latitude,lng:anchor.latlng?anchor.latlng.getLng():anchor.longitude};
      var removing=new Set(edit.records.map(function(b){return b.id;}));next.buildings=next.buildings.filter(function(b){return!removing.has(b.id);});next.buildings.push(record);
    }else{
      record.phone=core.phone(body.querySelector('[data-phone]').value);if(!record.phone)throw new Error('유효한 임대인 전화번호를 입력해 주세요.');
      var prior=new Map(edit.records.flatMap(function(b){return b.baselines;} ).map(function(row){return[row.id,row];}));
      record.baselines=record.memberIds.map(function(id){var row=selected.find(function(item){return String(item.propertyId)===id;});return row?{id:id,phone:meta(row).phone,manual:meta(row).manual}:prior.get(id)||{id:id,phone:'',manual:false};});
      next.contacts=next.contacts.filter(function(b){return b.id!==record.id;});next.contacts.push(record);
    }
    return core.validate(next);
  }
  async function submit(){if(busy||!edit)return;var context=edit;try{var next=draft();setBusy(true);status('건물 설정을 저장하고 있습니다.');if(await save(next,context)){if(context.kind==='contact'&&global.propertyEditTargetV630===context.item&&contact(context.item)){if(global.propertyEditTouchedFieldsV131)delete global.propertyEditTouchedFieldsV131.landlordPhone;decorateEdit(context.item,false);}dialog.close();edit=null;}}catch(error){setBusy(false);status((error.status===409?'다른 기기에서 설정이 바뀌었습니다. 입력은 유지됩니다. 닫은 뒤 다시 열어 비교해 주세요.':error.message));}}
  async function removeRecord(){if(busy||!edit||!edit.records.length)return;var context=edit,next=clone(data);next[edit.kind==='map'?'buildings':'contacts']=next[edit.kind==='map'?'buildings':'contacts'].filter(function(b){return b.id!==edit.recordId;});try{setBusy(true);status('설정을 해제하고 있습니다. 개별 매물은 유지됩니다.');if(await save(next,context)){dialog.close();edit=null;}}catch(error){setBusy(false);status(error.message);}}
  async function individual(item){
    var phoneInput=document.getElementById('peLandlordPhoneV630'),keepDraft=global.propertyEditTouchedFieldsV131?.landlordPhone&&!phoneInput?.dataset.buildingCommonV164,draftPhone=phoneInput?.value;
    var record=contactRecord(item);if(!record)return;var who=account,context={account:account,version:version,requestId:crypto.randomUUID()},next=clone(data),id=String(item.propertyId);
    var rule=next.contacts.find(function(b){return b.id===record.id;});rule.excludedIds=Array.from(new Set(rule.excludedIds.concat(id)));rule.autoParcels=rule.autoParcels.filter(function(p){return p!==parcelOf(item);});
    try{if(await save(next,context)&&owner()===who&&global.propertyEditTargetV630===item){var input=document.getElementById('peLandlordPhoneV630');input.readOnly=false;delete input.dataset.buildingCommonV164;input.value=keepDraft?draftPhone:item.landlordPhone||'';decorateEdit(item,true);input.focus();}}
    catch(error){if(global.propertyEditTargetV630===item)document.getElementById('propertyEditStatusV630').textContent=error.message;}
  }
  function decorateEdit(item,preserve){
    cleanAccount();var input=document.getElementById('peLandlordPhoneV630');if(!input||!item)return;
    var helper=document.getElementById('buildingContactControlsV164');if(!helper){helper=document.createElement('span');helper.id='buildingContactControlsV164';input.after(helper);}
    var c=contact(item),dirty=global.propertyEditTouchedFieldsV131?.landlordPhone||document.activeElement===input;
    if(!preserve||!dirty){var wasCommon=!!input.dataset.buildingCommonV164;input.readOnly=!!c;if(c){input.value=c.display;input.dataset.buildingCommonV164=c.buildingId;input.title='건물 공통 임대인 번호';}else{delete input.dataset.buildingCommonV164;input.removeAttribute('title');if(!preserve||wasCommon)input.value=item.landlordPhone||'';}}
    input.parentElement.classList.add('building-contact-field-v164');
    helper.innerHTML='<button type="button" data-common aria-label="'+(c?'공통번호 변경':'건물 공통으로 사용')+'" title="'+(c?'건물 공통번호 사용 중 · 변경/개별번호 설정':'이 건물에 공통 임대인 번호 지정')+'">'+(c?'공통 설정':'건물 공통')+'</button>';
    helper.querySelector('[data-common]').onclick=function(event){event.preventDefault();event.stopPropagation();openContact(item);};
  }
  function ownPhoneForSave(item,value){var input=document.getElementById('peLandlordPhoneV630');return input?.dataset.buildingCommonV164?item.landlordPhone||'':value;}
  function canSaveEdit(item){var input=document.getElementById('peLandlordPhoneV630');if(global.propertyEditTouchedFieldsV131?.landlordPhone&&contact(item)&&!input?.dataset.buildingCommonV164){document.getElementById('propertyEditStatusV630').textContent='건물 공통번호가 있습니다. 이 매물의 번호를 따로 쓰려면 “이 매물은 개별번호”를 먼저 선택해 주세요.';return false;}return true;}
  global.JSBuildingRegistryV164={load:load,buildingFor:building,contactFor:contact,groupAddressGroups:groupAddressGroups,syncMapControls:syncMapControls,openGroup:openGroup,openContact:openContact,decorateEdit:decorateEdit,ownPhoneForSave:ownPhoneForSave,canSaveEdit:canSaveEdit};
  cleanAccount();if(owner())setTimeout(function(){load(false).catch(function(){/* Existing listings remain usable; explicit edits retry the small read. */});},0);
  global.addEventListener('js-auth-required',function(){account='';data={schema:164,buildings:[],contacts:[]};view=core.index(data);version=0;loaded=false;sequence++;if(dialog?.open)dialog.close();edit=null;if(bar)bar.hidden=true;});
  global.addEventListener('storage',function(event){if(event.key===cacheKey(owner()))load(true).catch(function(){});});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&Date.now()-lastLoad>30000)load(true).catch(function(){});});
})(window);

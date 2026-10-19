/* Manual sale management values. Original advertisements remain untouched. */
(function(global){
  'use strict';
  var active=null;
  var money=[['totalDeposit','임대보증금 합계'],['monthlyIncome','월 임대수입'],['loanAmount','광고 융자금'],['investmentAmount','광고 실투자금'],['monthlyNetIncome','광고 월수익 · 이자 차감'],['statedMonthlyIncome','광고 월수익 · 기준 미확인']];
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function json(v){try{return JSON.parse(v||'{}')||{};}catch(_){return {};}}
  function account(){return String(global.JSAuthenticatedAccountEmail||'').toLowerCase();}
  function valid(c){return c.dialog.isConnected&&c.dialog.open&&active===c&&account()===c.account;}
  function normalized(f,v){if(f.type==='number')return v==null||String(v).trim()===''?null:Number(v);return String(v==null?'':v).trim();}
  function fields(land){
    var list=[{key:'name',label:land?'매물명':'건물명',common:true},{key:'salePrice',label:'매매가',type:'number',unit:'만원'}];
    [['landAreaM2',land?'토지면적':'대지면적']].concat(land?[]:[['grossAreaM2','연면적'],['exclusiveAreaM2','전용면적'],['buildingAreaM2','건축면적']]).forEach(function(p){list.push({key:p[0],label:p[1],type:'number',unit:'㎡'});});
    (land?[['landUse','지목'],['zoning','용도지역'],['roadAccess','도로접면'],['parcelShape','형상']]:money).forEach(function(p){list.push({key:p[0],label:p[1],type:land?'text':'number',unit:land?'':'만원'});});
    if(!land){list.push({key:'advertisedYield',label:'광고 연 수익률 · 계산 기준 확인',type:'number',unit:'%'});list.push({key:'buildingUse',label:'건물 용도'});}
    list.push({key:'landlordPhone',label:'소유자 연락처',type:'tel',common:true});
    if(!land)list.push({key:'tenantPhone',label:'임차인 연락처',type:'tel',common:true});
    list.push({key:'state',label:'관리 상태',type:'state',common:true},{key:'memo',label:'관리 메모',type:'memo',common:true});return list;
  }
  function common(row){return {name:row.title||'',room:row.room||'',landlordPhone:row.landlord_phone||'',tenantPhone:row.tenant_phone||'',state:row.status==='active'?'':row.status||'',memo:row.operating_memo||''};}
  function originalValues(row){return [row.title||'',row.address||'',row.room||'',row.listing_type||'',row.deposit||0,row.monthly_rent||0,row.maintenance_fee||0,row.premium||0,row.area_m2||0,row.landlord_phone||'',row.tenant_phone||'',row.operating_memo||'',row.status==='active'?'':row.status||'',row.first_collected_at||'',row.main_source||''];}
  function stored(c,row,f){return f.common?common(row)[f.key]:f.key==='salePrice'?row.sale_price:json(row.sale_details_json)[f.key];}
  async function readRow(c){
    var result=await global.JSDataAccessV6.read('listingChanges',{ids:c.item.propertyId,expectedAccountEmail:c.account});
    if(!valid(c))throw Error('수정창 또는 계정이 변경되었습니다.');
    var row=(result.items||[]).find(function(r){return r.property_id===c.item.propertyId;});
    if(!row||row.status==='deleted'||row.trade_type!=='sale'||(row.sale_category==='land')!==c.land)throw Error('매물의 거래유형·상태가 변경되었습니다. 다시 열어 주세요.');return row;
  }
  function input(c,f){return c.dialog.querySelector('[data-sale-edit="'+f.key+'"]');}
  function status(c,message){var el=c.dialog.querySelector('[data-sale-edit-status]');if(el)el.textContent=message;}
  function controls(c,busy){c.busy=busy;c.dialog.querySelectorAll('button').forEach(function(b){b.disabled=busy;});c.dialog.querySelectorAll('input,textarea,select').forEach(function(el){el.disabled=busy;});}
  function dirty(c){var updated={},patch={};c.fields.forEach(function(f){var value=normalized(f,input(c,f).value);if(value!==normalized(f,c.initial[f.key]))(f.common?updated:patch)[f.key]=value;});return {updated:updated,patch:patch};}
  function render(c){
    var shown=(global.currentItems||[]).find(function(i){return i.propertyId===c.item.propertyId;})||c.item;
    var saved=json(c.row.sale_details_json),hint=global.JSListingTradeV1.saleSummary(shown),manual=saved.manualSaleFieldsV1||[];
    c.initial={};var html='<p class="sale-edit-identity-v1">'+esc(c.row.address)+'</p><p class="sale-edit-notice-v1">대표 관리값을 수정합니다. 원본 광고·사진은 보존됩니다. 금액은 만원, 면적은 ㎡입니다. 빈 칸은 미제공이며 0원과 구분합니다.</p><form data-sale-edit-form><div class="sale-edit-grid-v1">';
    c.fields.forEach(function(f){var value=stored(c,c.row,f),reference=!f.common&&f.key!=='salePrice'&&(value==null||value==='')&&!manual.includes(f.key)&&hint[f.key]!=null;
      if(reference)value=hint[f.key];c.initial[f.key]=normalized(f,value);
      html+='<label class="'+(f.type==='memo'?'sale-edit-wide-v1':'')+'"><span>'+esc(f.label)+(f.unit?' <small>('+esc(f.unit)+')</small>':'')+'</span>';
      var attr=' data-sale-edit="'+f.key+'" aria-label="'+esc(f.label)+'"';
      if(f.type==='memo')html+='<textarea'+attr+' rows="4">'+esc(value)+'</textarea>';
      else if(f.type==='state')html+='<select'+attr+'><option value="">계약가능</option><option value="계약완료"'+(value==='계약완료'?' selected':'')+'>계약완료</option>'+(value&&value!=='계약완료'?'<option value="'+esc(value)+'" selected>'+esc(value)+'</option>':'')+'</select>';
      else html+='<input'+attr+' type="'+(f.type||'text')+'" value="'+esc(value)+'"'+(f.type==='number'?' min="'+(f.key==='salePrice'||/AreaM2$/.test(f.key)?'0.000001':'0')+'" step="any" inputmode="decimal"'+(f.key==='salePrice'?' required':''):' maxlength="'+(f.common?'2000':'160')+'"')+'>';
      if(f.unit==='㎡')html+='<small data-sale-edit-py="'+f.key+'"></small>';
      if(reference)html+='<small class="sale-edit-reference-v1">원본 참고값 · 변경한 경우에만 관리값 저장</small>';
      html+='</label>';
    });
    html+='</div><p data-sale-edit-status role="status" aria-live="polite"></p><div data-sale-edit-conflict></div><footer class="sale-edit-actions-v1"><button type="button" data-sale-edit-delete>매물삭제</button><span></span><button type="button" data-sale-edit-cancel>취소</button><button type="submit" data-sale-edit-save>저장</button></footer></form>';
    c.dialog.querySelector('.sale-workbench-body').innerHTML=html;
    function areas(){c.fields.filter(function(f){return f.unit==='㎡';}).forEach(function(f){var n=Number(input(c,f).value);c.dialog.querySelector('[data-sale-edit-py="'+f.key+'"]').textContent=n>0?(n/3.305785).toLocaleString('ko-KR',{maximumFractionDigits:2})+'평':'';});}
    c.dialog.querySelector('form').addEventListener('input',areas);areas();
    c.dialog.querySelector('form').onsubmit=function(e){e.preventDefault();save(c);};
    c.dialog.querySelector('[data-sale-edit-cancel]').onclick=function(){c.dialog.close();};
    c.dialog.querySelector('[data-sale-edit-delete]').onclick=function(){remove(c);};
  }
  async function compare(c){
    try{var row=await readRow(c);if(!valid(c))return;var panel=c.dialog.querySelector('[data-sale-edit-conflict]');panel.replaceChildren();
      var p=document.createElement('p');p.textContent='아직 저장하지 않았습니다. 체크한 항목만 내 입력을 유지하고 나머지는 최신 값을 사용합니다.';panel.append(p);var choices={};
      c.fields.forEach(function(f){var mine=normalized(f,input(c,f).value),latest=normalized(f,stored(c,row,f));if(mine===latest)return;
        var label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',f.label+' 내 입력 유지');check.checked=mine!==normalized(f,c.initial[f.key])&&latest===normalized(f,stored(c,c.row,f));choices[f.key]=check;
        label.append(check,document.createTextNode(' '+f.label+' · 최신: '+(latest==null||latest===''?'미제공':latest)+' / 내 입력: '+(mine==null||mine===''?'미제공':mine)));panel.append(label);
      });
      var apply=document.createElement('button');apply.type='button';apply.textContent='선택한 값으로 편집 계속 (아직 저장 안 함)';apply.onclick=function(){
        c.fields.forEach(function(f){var el=input(c,f),mine=el.value,latest=normalized(f,stored(c,row,f));c.initial[f.key]=latest;el.value=choices[f.key]&&choices[f.key].checked?mine:latest==null?'':latest;});
        c.row=row;c.conflict=false;panel.replaceChildren();status(c,'최신 값 비교를 반영했습니다. 확인 후 저장을 눌러 주세요.');c.dialog.querySelector('form').dispatchEvent(new Event('input'));
      };panel.append(apply);status(c,'다른 작업에서 값이 변경되어 저장을 중단했습니다. 입력 내용은 유지했습니다.');
    }catch(error){if(valid(c))status(c,error.message+' 입력 내용은 유지됩니다.');else if(c.dialog.isConnected)c.dialog.close();}
  }
  async function save(c){
    if(c.busy||!valid(c))return;if(c.conflict){status(c,'먼저 최신 값 비교를 반영해 주세요.');return;}if(!c.dialog.querySelector('form').reportValidity())return;
    var change=dirty(c),view=typeof global.captureAutoUpdateViewState==='function'?global.captureAutoUpdateViewState():null;
    var baseline=json(c.row.sale_details_json);Object.keys(change.patch).forEach(function(k){if(k!=='salePrice'&&!Object.prototype.hasOwnProperty.call(baseline,k))baseline[k]=null;});
    controls(c,true);status(c,'매매 관리값 저장 중…');
    try{var result=await global.postSafeMutationV654('updateProperty',{key:{propertyId:c.item.propertyId},originalValues:originalValues(c.row),updated:change.updated,
        saleEdit:{saleCategory:c.row.sale_category||'',original:{salePrice:c.row.sale_price,saleDetails:baseline},patch:change.patch}});
      if(!valid(c)){c.busy=false;if(c.dialog.isConnected)c.dialog.close();return;}if(!result||result.queued||result.persisted!==true)throw Error('저장 확정 결과를 확인하지 못했습니다. 입력을 유지합니다.');
      var value=result.updated||{},oldKey=c.item.key;
      ['name','landlordPhone','tenantPhone','memo','state','salePrice','saleDetails'].forEach(function(k){if(Object.prototype.hasOwnProperty.call(value,k))c.item[k]=value[k];});
      if(value.contacts)c.item.contactListRaw=JSON.stringify(value.contacts);c.item.key=global.itemKey(c.item);
      var aliases=global.mergeEditAliasesV634(oldKey,c.item.key,c.item);global.pendingPropertyEditStateV634={aliases:aliases,newKey:c.item.key,address:c.item.address,type:c.item.type,viewState:global.remapEditViewStateV634(view,aliases,c.item.key)};
      global.pendingPropertyEditNewKeyV633=c.item.key;
      if(global.selectedItemKey===oldKey)global.selectedItemKey=c.item.key;
      c.busy=false;c.dialog.close();global.schedulePropertyEditReloadV634();
    }catch(error){if(!valid(c)){c.busy=false;if(c.dialog.isConnected)c.dialog.close();return;}controls(c,false);
      if(Number(error.status)===409||Number(error.statusCode)===409||/PROPERTY_EDIT_CONFLICT|HTTP 409/.test(error.message||'')){c.conflict=true;await compare(c);}else status(c,(error.message||'저장에 실패했습니다.')+' 입력 내용은 유지됩니다.');}
  }
  async function remove(c){
    if(c.busy||!valid(c)||!global.confirm('이 매물을 삭제하시겠습니까?\n'+c.row.address+'\n매매 '+Number(c.row.sale_price||0).toLocaleString('ko-KR')+'만원'))return;
    controls(c,true);status(c,'매물ID를 확인해 삭제 중…');
    try{var r=await global.postSafeMutationV654('deleteProperty',{key:{propertyId:c.item.propertyId},originalValues:originalValues(c.row)});if(!valid(c)){c.busy=false;if(c.dialog.isConnected)c.dialog.close();return;}if(!r||r.queued||r.persisted!==true)throw Error('삭제 확정 결과를 확인하지 못했습니다.');c.busy=false;c.dialog.close();global.loadSheet(true,true);}
    catch(e){if(valid(c)){controls(c,false);status(c,e.message||'삭제하지 못했습니다.');}else {c.busy=false;if(c.dialog.isConnected)c.dialog.close();}}
  }
  async function open(item){
    if(active&&active.busy)return;
    var land=global.JSListingTradeV1.normalizedSaleCategory(item)==='land',dialog=global.JSSaleWorkbenchV1.modal(land?'토지매매 정보 수정':'건물매매 정보 수정','<p role="status">최신 관리값을 불러오는 중…</p>','sale-property-edit-v1');
    var c={dialog:dialog,item:item,land:land,fields:fields(land),account:account(),busy:false};active=c;
    dialog.querySelectorAll('.sale-unit-switch-v9').forEach(function(el){el.remove();});
    dialog.addEventListener('cancel',function(e){if(c.busy)e.preventDefault();});dialog.addEventListener('close',function(){if(active===c)active=null;});
    try{c.row=await readRow(c);if(valid(c)){if(!land&&global.JSListingTradeV1.buildingSaleExtent(item)==='unit')c.fields.splice(2,0,{key:'room',label:'매매 대상 층·호실',common:true});render(c);}}
    catch(e){if(valid(c))dialog.querySelector('.sale-workbench-body').textContent=e.message+' 저장하지 않았습니다.';else if(dialog.isConnected)dialog.close();}
  }
  global.JSSalePropertyEditV1={open:open};
})(window);

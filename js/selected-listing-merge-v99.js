(function(global) {
  'use strict';
  var dialog, choices, message, submit, cancel, snapshot = [], requestId = '', busy = false, account = '', primary = '';
  function selected() { return typeof global.getSelectedPrintItems === 'function' ? global.getSelectedPrintItems() : []; }
  function email() { return String(global.JSAuthenticatedAccountEmail || global.JSListAccountEmail || '').trim().toLowerCase(); }
  function signature(item) { return JSON.stringify([item.propertyId,item.key,item.memo,item.tradeType,item.saleCategory,item.deposit,item.rent,item.area,item.salePrice]); }
  function sync() {
    var button = document.getElementById('mergeSelectedListingsBtnV99');
    if (button) button.disabled = busy || selected().length < 2;
  }
  function setBusy(value) {
    busy = value; submit.disabled = value; cancel.disabled = value;
    choices.querySelectorAll('input').forEach(function(input) { input.disabled = value; });
    submit.textContent = value ? '병합 저장 중…' : snapshot.length + '개 매물 병합'; sync();
  }
  function ensure() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.id = 'selectedMergeDialogV99';
    dialog.setAttribute('aria-labelledby','selectedMergeTitleV99');
    dialog.innerHTML = '<h2 id="selectedMergeTitleV99">남길 대표매물 선택</h2><p>체크한 매물을 하나로 합칩니다. 원본 광고와 메모는 보존하며, 이후 광고관리에서 원본을 다시 분리할 수 있습니다.</p><div class="merge-choices-v99"></div><p class="merge-message-v99" role="status" aria-live="polite"></p><footer><button type="button" data-cancel>취소</button><button type="button" data-submit></button></footer>';
    choices = dialog.querySelector('.merge-choices-v99'); message = dialog.querySelector('.merge-message-v99');
    submit = dialog.querySelector('[data-submit]'); cancel = dialog.querySelector('[data-cancel]');
    cancel.addEventListener('click',function() { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel',function(event) { if (busy) event.preventDefault(); });
    choices.addEventListener('change',function(event) { primary = event.target.value; requestId = ''; message.textContent = ''; });
    submit.addEventListener('click',save); document.body.appendChild(dialog);
  }
  function open() {
    ensure(); if (busy) return;
    var items = selected();
    if (items.length < 2 || items.length > 51) { global.alert('매물을 2~51개 선택해 주세요.'); return; }
    if (items.some(function(item) { return !item.propertyId; }) || new Set(items.map(function(item) { return item.propertyId; })).size !== items.length) {
      global.alert('저장된 서로 다른 대표매물을 선택해 주세요.'); return;
    }
    if (items.some(function(item) {
      var drafts = global.memoDraftValuesV655 || {}, pending = global.memoSavePendingKeysV655 || {};
      return pending[item.key] || Object.prototype.hasOwnProperty.call(drafts,item.key) && drafts[item.key] !== String(item.memo || '');
    })) { global.alert('작성 중인 메모를 먼저 저장한 뒤 병합해 주세요.'); return; }
    var market = function(item) { return (item.tradeType || 'lease') + ':' + (item.tradeType === 'sale' ? item.saleCategory || '' : ''); };
    if (items.some(function(item) { return market(item) !== market(items[0]); })) { global.alert('같은 거래유형의 매물끼리 선택해 주세요.'); return; }
    snapshot = items.map(function(item) { return {id:item.propertyId,signature:signature(item)}; });
    account = email(); primary = snapshot[0].id; requestId = ''; choices.replaceChildren();
    items.forEach(function(item,index) {
      var label = document.createElement('label'), radio = document.createElement('input'), text = document.createElement('span');
      radio.type = 'radio'; radio.name = 'mergePrimaryV99'; radio.value = item.propertyId; radio.checked = index === 0;
      var price = item.tradeType === 'sale' ? '매매 ' + Number(item.salePrice || 0).toLocaleString() + '만원' : '보 ' + Number(item.deposit || 0).toLocaleString() + ' / 월 ' + Number(item.rent || 0).toLocaleString();
      text.textContent = [item.name || item.type,item.address,item.room,price].filter(Boolean).join(' · ');
      label.append(radio,text); choices.appendChild(label);
    });
    message.textContent = ''; setBusy(false); dialog.showModal();
  }
  async function save() {
    if (busy) return;
    var current = selected();
    if (!account || email() !== account || current.length !== snapshot.length || snapshot.some(function(row) {
      return !current.some(function(item) { return item.propertyId === row.id && signature(item) === row.signature; });
    })) { message.textContent = '선택 매물이나 계정이 변경됐습니다. 창을 닫고 다시 선택해 주세요.'; return; }
    requestId = requestId || 'selected-merge-' + global.crypto.randomUUID();
    setBusy(true); message.textContent = '원본 광고를 보존하며 한 번에 저장하고 있습니다.';
    var saved;
    try {
      saved = await global.JSDataAccessV6.mutate('consolidateExistingMasters', {
        selectedMerge:true,expectedAccountEmail:account,requestId:requestId,primaryMasterId:primary,
        duplicateMasterIds:snapshot.map(function(row) { return row.id; }).filter(function(id) { return id !== primary; })
      }, {errorMessage:'선택매물 병합 저장 실패'});
      if (!saved || saved.ok !== true || saved.persisted !== true) throw new Error(saved && saved.message || '병합 저장 결과를 확인하지 못했습니다.');
    } catch (error) {
      // A disconnected response is ambiguous. Read this exact receipt; never
      // issue a second write automatically. Manual retry keeps the same ID.
      try {
        var receipt = await global.JSDataAccessV6.read('mutationStatus',{requestId:requestId},{cache:'no-store'});
        var result = receipt && receipt.result;
        saved = result && (result.result || result);
        if (!receipt.ready || !saved || saved.persisted !== true) throw error;
      } catch (_) { message.textContent = (error.message || '저장 응답이 지연됩니다.') + ' 다시 누르면 같은 요청의 결과를 확인합니다.'; setBusy(false); return; }
    }
    // Clear before publishing any success; another tab/reload must reject the
    // pre-merge IndexedDB snapshot even if local deletion finishes later.
    if (global.JSInitialListingsCacheV1) Promise.resolve(global.JSInitialListingsCacheV1.clear()).catch(function() {});
    if (email() !== account) { setBusy(false); dialog.close(); return; }
    if (global.JSRemapMergedListReferencesV99) global.JSRemapMergedListReferencesV99(saved.keyMap || {});
    if (typeof global.clearSelectedPrintItems === 'function') global.clearSelectedPrintItems();
    else global.selectedPrintKeys = [];
    setBusy(false); dialog.close(); sync();
    global.JSUnifiedListingsV8.finishSelectedMerge(saved);
    if (global.JSListingCoverV85 && global.JSListingCoverV85.reload) global.JSListingCoverV85.reload().catch(function() {});
  }
  global.JSSelectedListingMergeV99 = {open:open,sync:sync}; sync();
})(window);

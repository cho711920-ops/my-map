(function(global) {
  'use strict';
  var dialog, choices, message, submit, cancel, snapshot = [], requestId = '', busy = false, account = '', primary = '';
  function selected() { return typeof global.getSelectedPrintItems === 'function' ? global.getSelectedPrintItems() : []; }
  function email() { return String(global.JSAuthenticatedAccountEmail || global.JSListAccountEmail || '').trim().toLowerCase(); }
  function signature(item) { return JSON.stringify([item.propertyId,item.key,item.memo,item.tradeType,item.saleCategory,item.deposit,item.rent,item.area,item.salePrice]); }
  function selectionKey(item) { return typeof global.actionSelectionKeyV660 === 'function' ? global.actionSelectionKeyV660(item) : item.propertyId; }
  function orderedChoices(items) {
    var remaining = new Map(items.map(function(item) { return [selectionKey(item),item]; })), rows = [];
    // visibleListItems includes the entire sorted list, including virtual rows
    // outside the DOM. Keep display terms separate from the saved master IDs.
    (Array.isArray(global.visibleListItems) ? global.visibleListItems : []).forEach(function(item,index) {
      var key = selectionKey(item), master = remaining.get(key);
      if (!master) return;
      rows.push({master:master,item:item,position:index + 1}); remaining.delete(key);
    });
    remaining.forEach(function(item) { rows.push({master:item,item:item,position:0}); });
    return rows;
  }
  function number(item,key) {
    var value = item[key];
    if (item.displayValuePresence && item.displayValuePresence[key] === false || value == null || value === '') return '미확인';
    return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2}) : '미확인';
  }
  function plain(markup) { var template = document.createElement('template'); template.innerHTML = markup || ''; return template.content.textContent.trim(); }
  function photoUrl(value) {
    try { var url = new URL(value,global.location.href); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; }
  }
  function choice(row,index) {
    var item = row.item, label = document.createElement('label'), radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'mergePrimaryV99'; radio.value = row.master.propertyId; radio.checked = index === 0;
    var photo = document.createElement('span'); photo.className = 'merge-photo-v102'; photo.textContent = '사진 없음';
    var parts = global.JSUnifiedListingsV8 && global.JSUnifiedListingsV8.cardParts ? global.JSUnifiedListingsV8.cardParts(item) : {};
    var template = document.createElement('template'); template.innerHTML = parts.thumbnail || '';
    var existing = template.content.querySelector('img'), url = existing && photoUrl(existing.getAttribute('src') || existing.getAttribute('data-thumbnail-pending-v69'));
    if (url) {
      var img = document.createElement('img'); img.alt = '매물 사진'; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.onerror = function() { photo.textContent = '사진 없음'; }; img.src = url; photo.replaceChildren(img);
    }
    var info = document.createElement('span'); info.className = 'merge-info-v102';
    function line(className,text) { var node = document.createElement('span'); node.className = className; node.textContent = text; info.appendChild(node); }
    line('merge-position-v102',row.position ? '목록 ' + row.position + '번' : '현재 목록 밖 선택');
    line('merge-title-v102',[item.name || item.type,item.address].filter(Boolean).join(' · '));
    var room = item.sourceFloorVerifiedV1 ? item.advertisedRoomV1 : item.room;
    if (typeof global.formatListingRoomForCardV653 === 'function') room = global.formatListingRoomForCardV653(room,item.floor);
    var price = item.tradeType === 'sale' ? '매매 ' + number(item,'salePrice') + '만원' : '보 ' + number(item,'deposit') + ' / 월 ' + number(item,'rent');
    var area = item.tradeType === 'sale' && global.JSListingTradeV1 && global.JSListingTradeV1.saleAreaHtml
      ? plain(global.JSListingTradeV1.saleAreaHtml(item)) : number(item,'area') === '미확인' ? '면적 미확인' : number(item,'area') + '평';
    line('merge-condition-v102',[room,area,price].filter(Boolean).join(' · '));
    var verification = typeof global.isFieldVisitItem === 'function' && global.isFieldVisitItem(item) ? '미확인'
      : typeof global.isConfirmedVisitItem === 'function' && global.isConfirmedVisitItem(item) || typeof global.isGongsilBoxItem === 'function' && global.isGongsilBoxItem(item) ? '확인' : '';
    var source = plain(parts.sourceButton);
    line('merge-source-v102',[verification,/^(동일매물|원본 광고|미노출|원본 확인|사진|다시)/.test(source) ? source : ''].filter(Boolean).join(' · '));
    label.append(radio,photo,info); return label;
  }
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
    dialog.innerHTML = '<h2 id="selectedMergeTitleV99">남길 대표매물 선택</h2><p>현재 매물목록의 위에서 아래 순서입니다. 남길 카드를 선택해 주세요. 원본 광고와 메모는 보존하며, 이후 광고관리에서 원본을 다시 분리할 수 있습니다.</p><div class="merge-choices-v99"></div><p class="merge-message-v99" role="status" aria-live="polite"></p><footer><button type="button" data-cancel>취소</button><button type="button" data-submit></button></footer>';
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
    var rows = orderedChoices(items);
    snapshot = rows.map(function(row) { return {id:row.master.propertyId,signature:signature(row.master)}; });
    account = email(); primary = snapshot[0].id; requestId = ''; choices.replaceChildren();
    rows.forEach(function(row,index) { choices.appendChild(choice(row,index)); });
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

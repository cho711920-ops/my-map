/* Lease-only controls. Reuse the exact card's handlers and existing state CAS. */
(function(global){
  'use strict';
  var currentDialog=null;
  function account(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function leaseMode(){return document.documentElement.getAttribute('data-listing-trade-mode')==='lease';}
  function close(){if(currentDialog?.open)currentDialog.close();}
  function popup(card,anchor,title){
    close();
    var dialog=document.createElement('dialog');dialog.className='lease-popup-v283';
    var heading=document.createElement('h2');heading.textContent=title;
    var dismiss=document.createElement('button');dismiss.type='button';dismiss.className='lease-popup-close-v283';dismiss.textContent='×';dismiss.setAttribute('aria-label','닫기');
    var header=document.createElement('header');header.append(heading,dismiss);dialog.append(header);
    var address=document.createElement('p');address.textContent=card.querySelector('.item-address-text')?.textContent||'선택 매물';dialog.append(address);
    dialog.setAttribute('aria-label',title);document.body.append(dialog);
    dismiss.addEventListener('click',function(){dialog.close();});
    dialog.addEventListener('click',function(event){if(event.target===dialog){var r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    var observer=new MutationObserver(function(){if(!anchor.isConnected||!leaseMode())dialog.close();});
    observer.observe(document.getElementById('list'),{childList:true,subtree:true});
    dialog.addEventListener('close',function(){observer.disconnect();if(currentDialog===dialog)currentDialog=null;dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true});},{once:true});
    currentDialog=dialog;return dialog;
  }
  function openState(card,anchor){
    var item=card.__listItemV132,id=String(item?.propertyId||''),who=account();
    if(!id||!leaseMode()||global.isDone?.(item))return;
    var dialog=popup(card,anchor,'매물 상태 변경');
    var choices=document.createElement('div');choices.className='lease-state-choices-v283';
    [['확인','임장완료'],['보류','보류'],['미확인','미확인으로 변경']].forEach(function(entry){
      var button=document.createElement('button');button.type='button';button.textContent=entry[1];button.dataset.stateV283=entry[0];
      button.addEventListener('click',function(){
        if(!card.isConnected||card.inert||card.__listItemV132?.propertyId!==item.propertyId||account()!==who||!leaseMode()){dialog.close();return;}
        choices.querySelectorAll('button').forEach(function(b){b.disabled=true;});dialog.close();
        Promise.resolve(global.markSelectedVerificationV160(entry[0],[id])).catch(function(error){console.warn('매물 상태 변경 확인 필요',error.message);global.alert('상태 저장 결과를 확인해 주세요.');});
      });choices.append(button);
    });dialog.append(choices);dialog.showModal();
  }
  function openMore(card,anchor,menu){
    var who=account(),id=card.dataset.propertyId,dialog=popup(card,anchor,'매물 더보기');
    var choices=document.createElement('div');choices.className='lease-more-actions-v283';
    Array.from(menu.children).forEach(function(original){
      var label=original.classList.contains('item-building-register-btn')?'건축물대장':original.classList.contains('item-list-add-btn')?'찜 폴더':original.textContent;
      var button=makeButton('',label);button.disabled=original.disabled;
      button.addEventListener('click',function(){
        dialog.close();
        if(card.isConnected&&!card.inert&&original.isConnected&&!original.disabled&&original.getAttribute('aria-disabled')!=='true'&&card.dataset.propertyId===id&&account()===who&&leaseMode())original.click();
      });choices.append(button);
    });dialog.append(choices);
    dialog.showModal();
  }
  function makeButton(className,label){var button=document.createElement('button');button.type='button';button.className=className;button.textContent=label;return button;}
  function decorate(card,item){
    if(!item||card.classList.contains('listing-sale-card-v1')||global.JSListingTradeV1?.isSale(item))return;
    var actions=card.querySelector('.item-action-row'),left=actions?.querySelector('.item-action-left'),head=card.querySelector('.item-compact-head-v650');
    var text=card.querySelector('.item-address-text'),check=card.querySelector('.item-head-select-v650');
    if(!left||!head||!text||!check)return;
    card.classList.add('lease-actions-card-v283');
    var line=head.querySelector('.lease-address-line-v283');
    if(!line){line=document.createElement('span');line.className='lease-address-line-v283';head.prepend(line);}
    if(check.parentElement!==line)line.prepend(check);if(text.parentElement!==line)line.append(text);
    if(head.firstElementChild!==line)head.prepend(line);
    var room=card.querySelector('.item-address-room-v650'),area=card.querySelector('.price-area'),values=card.querySelector('.item-price-values-v652');
    var money=values?.querySelector('.price-main'),facts=values?.querySelector('.lease-facts-v280');
    if(values&&!facts){facts=document.createElement('span');facts.className='lease-facts-v280';values.append(facts);}
    if(facts){
      var fee=values.querySelector('.price-fee'),premium=values.querySelector('.price-premium');
      if(premium&&premium.parentElement!==facts)facts.append(premium);
      if(fee&&(fee.parentElement!==facts||fee.nextElementSibling!==premium))facts.insertBefore(fee,premium);
      if(area&&(area.parentElement!==facts||area.nextElementSibling!==fee))facts.insertBefore(area,fee);
      if(fee)fee.title='관리비';if(premium)premium.title='권리금';
    }
    if(room&&room.parentElement!==line)line.append(room);
    if(money){
      var rentLine=values.querySelector('.lease-rent-line-v284');
      if(!rentLine){rentLine=document.createElement('span');rentLine.className='lease-rent-line-v284';}
      if(values.firstElementChild!==rentLine)values.prepend(rentLine);
      if(money.parentElement!==rentLine)rentLine.append(money);
    }
    var state=left.querySelector('.lease-state-button-v283');
    if(!state){state=makeButton('lease-state-button-v283','미확인');left.append(state);state.addEventListener('click',function(event){event.stopPropagation();openState(card,state);});}
    var done=!!global.isDone?.(item),held=!!global.isHeldListingV160?.(item),confirmed=!!global.isConfirmedVisitItem?.(item)||(!global.isFieldVisitItem?.(item)&&!!global.isGongsilBoxItem?.(item));
    state.textContent=done?'계약완료':held?'보류':confirmed?'확인':'미확인';state.dataset.stateV283=state.textContent;state.disabled=done;
    state.setAttribute('aria-label',state.textContent+' · 매물 상태 변경');state.setAttribute('aria-haspopup','dialog');
    var menu=left.querySelector('.lease-more-actions-v283');
    if(!menu){menu=document.createElement('div');menu.className='lease-more-actions-v283';menu.hidden=true;left.append(menu);}
    ['.item-nav-btn','.item-building-register-btn','.item-edit-btn-v630','.item-list-add-btn'].forEach(function(selector){var button=left.querySelector(':scope > '+selector);if(button)menu.append(button);});
    var more=left.querySelector('.lease-more-button-v283');
    if(!more){more=makeButton('lease-more-button-v283','더보기 ⋯');left.append(more);more.setAttribute('aria-haspopup','dialog');more.addEventListener('click',function(event){event.stopPropagation();openMore(card,more,menu);});}
  }
  global.addEventListener('js-listing-trade-mode-change',close);
  global.JSLeaseCardActionsV283={decorate:decorate,close:close};
})(window);

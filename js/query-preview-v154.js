/* Authenticated, read-only first paint. Never a writable model or a claim of
 * latest server data. Account/receipt/build/viewport and own-parent proofs are
 * checked again before any cached markup is inserted. */
(function(global){
  'use strict';
  var templates=['jsAuthenticatedHeadAssets','jsAuthenticatedBodyAssets'];
  var urls=[];templates.forEach(function(id){document.getElementById(id)?.content.querySelectorAll('script[src],link[href]').forEach(function(node){urls.push(node.getAttribute('src')||node.getAttribute('href'));});});
  var build=urls.length?urls.join('|'):document.currentScript?.src||'preview-fixture-v154';
  function owner(){return String(global.JSAuthenticatedAccountEmail||'').trim().toLowerCase();}
  function epoch(){try{return localStorage.getItem('js-query-epoch-v152:'+owner())||'';}catch{return '';}}
  function sanitize(html){
    var template=document.createElement('template');template.innerHTML=html;
    template.content.querySelectorAll('script,iframe,object,embed,link,style,form,video,audio,source,input,select,textarea,[class*="memo"]').forEach(function(node){node.remove();});
    template.content.querySelectorAll('*').forEach(function(node){
      Array.from(node.attributes).forEach(function(attr){if(/^on/i.test(attr.name)||['srcdoc','srcset','style','href','xlink:href','formaction'].includes(attr.name))node.removeAttribute(attr.name);});
      if(node.tagName==='BUTTON'){node.disabled=true;node.removeAttribute('title');}
      if(node.tagName==='IMG'){
        try{var url=new URL(node.getAttribute('src')||'',location.href);if(url.origin!==location.origin&&url.protocol!=='https:')node.removeAttribute('src');}
        catch{node.removeAttribute('src');}
      }
      node.classList.remove('selected');
    });
    return template;
  }
  function validate(value){
    if(!value||value.kind!=='query-scope-v152'||value.completeCatalog!==false||value.account!==owner()||value.cacheEpochV152!==epoch()||!Array.isArray(value.points)||value.points.length>144)return null;
    var view=global.JSQueryCollectionV152.decode(value.packet),expected=new Map(),parts=[];
    value.points.forEach(function(saved){var id=String(saved.row?.property_id||saved.row?.id||'');
      if(!view.byId.has(id)||expected.has(id))throw new Error('Preview point scope');
      expected.set(id,view.byId.get(id).sourceSnapshotKey);parts.push({ok:true,requestedIds:[id],missingIds:[],items:[saved.row],unified:saved.unified});});
    global.JSQueryCollectionV152.combine(parts,expected);return {view:view,ids:new Set(expected.keys())};
  }
  function capture(value){
    try{
      var spec=JSON.parse(value.signature),center=global.map?.getCenter?.();
      if(spec.mode!=='lease'||spec.doneOnly||spec.gongsilOnly||spec.newListingDays||spec.hideDone===false||global.favoriteOnly||
        global.selectedGroupKey||(global.selectedGroupKeys||[]).length||global.jsAdministrativeListSelectionV6570||global.jsPinnedClusterSelectionV6515||
        Object.entries(spec.filters||{}).some(function(pair){return pair[1]&&!(pair[0]==='sortFilter'&&pair[1]==='latest');})){
        document.documentElement.dataset.queryPreviewCaptureV154='filtered';return null;}
      // Kakao's initial projection/relayout rounds the supplied center by a
      // few metres (22 microdegrees observed). Never accept a user-navigated
      // map, but allow that sub-pixel SDK rounding on the default overview.
      if(!center||Number(global.jsMapUserNavigationIntentUntilV6525||0)>0||
        Math.abs(center.getLat()-36.3504)>0.0001||Math.abs(center.getLng()-127.3845)>0.0001||global.map.getLevel()!==7){
        document.documentElement.dataset.queryPreviewCaptureV154='map-not-default';return null;}
      var savedIds=new Set((value.points||[]).map(function(saved){return String(saved.row?.property_id||saved.row?.id||'');}));
      var cards=Array.from(document.querySelectorAll('#list .item[data-property-id]')).filter(function(card){return savedIds.has(card.dataset.propertyId);}).slice(0,18),ids=[];
      var container=document.createElement('div');
      cards.forEach(function(card){ids.push(card.dataset.propertyId);container.appendChild(card.cloneNode(true));});
      if(!ids.length||new Set(ids).size!==ids.length){document.documentElement.dataset.queryPreviewCaptureV154='cards-missing';return null;}
      var clean=sanitize(container.innerHTML),html=clean.innerHTML;
      if(html.length>512*1024){document.documentElement.dataset.queryPreviewCaptureV154='size';return null;}
      document.documentElement.dataset.queryPreviewCaptureV154='ready';
      return {build:build,ids:ids,html:html,width:global.innerWidth,height:global.innerHeight,count:(global.visibleListItems||[]).length};
    }catch{document.documentElement.dataset.queryPreviewCaptureV154='invalid';return null;}
  }
  function show(value,signature,current){
    try{
      document.documentElement.dataset.queryPreviewReadV154=value?.preview?'available':'missing';
      if(!current()||!document.documentElement.classList.contains('auth-pending')||!document.getElementById('wrap')?.inert||
        value?.signature!==signature||value.preview?.build!==build||value.preview.width!==global.innerWidth||value.preview.height!==global.innerHeight||
        typeof value.preview.html!=='string'||value.preview.html.length>512*1024||!Array.isArray(value.preview.ids)||value.preview.ids.length>18)return false;
      var verified=validate(value);if(!verified||!value.preview.ids.length||value.preview.ids.some(function(id){return!verified.ids.has(id);}))return false;
      var clean=sanitize(value.preview.html),cards=Array.from(clean.content.children);
      if(cards.length!==value.preview.ids.length||cards.some(function(card,index){return!card.classList.contains('item')||card.dataset.propertyId!==value.preview.ids[index];}))return false;
      cards.forEach(function(card){card.inert=true;card.setAttribute('data-query-preview-v154','');});
      var list=document.getElementById('list');if(!list||list.querySelector('.item')||!current())return false;
      list.replaceChildren(clean.content);
      var title=document.getElementById('mapListTitleV1');if(title)title.textContent='매물 목록';
      var count=document.getElementById('mapListingCountValueV825');
      if(count&&Number.isSafeInteger(value.preview.count)&&value.preview.count>=cards.length&&value.preview.count<=verified.view.rows.length)
        count.textContent=value.preview.count.toLocaleString('ko-KR')+'개';
      document.documentElement.classList.add('query-cache-preview-v154');
      document.documentElement.dataset.firstCachedPreviewMs=String(Math.round(global.performance?.now?.()||0));
      return true;
    }catch{return false;}
  }
  global.JSQueryPreviewV154={capture:capture,show:show,clear:function(){document.documentElement.classList.remove('query-cache-preview-v154');}};
})(window);

/* SDK-managed map resources. Never read, construct, cache or reassign tile URLs.
 * Container resize remains owned by setupMapViewportRelayoutV690. This adapter
 * only restores layout after returning online/to a visible page, using public
 * Map methods; it does not claim to retry failed or stalled network resources. */
(function(global){
 'use strict';
 var active=null;
 function attach(viewport,map){
  if(active)active.destroy();active=null;
  if(!viewport||!map||typeof map.relayout!=='function'||!global.kakao?.maps?.event)return null;
  var events=global.kakao.maps.event,timer=null,pending=false,moving=false,paused=false,disposed=false;
  var budgetAt=0,budgetUsed=0,relayouts=0,bindings=[];
  function cancel(){if(timer!==null)global.clearTimeout(timer);timer=null;}
  function blocked(){return disposed||paused||moving||document.visibilityState==='hidden'||global.navigator.onLine===false;}
  function flush(){
   timer=null;if(!pending||blocked()||!viewport.isConnected)return;
   var box=viewport.getBoundingClientRect();if(!box.width||!box.height||global.getComputedStyle(viewport).visibility==='hidden')return;
   var now=Date.now();if(!budgetAt||now-budgetAt>=60000){budgetAt=now;budgetUsed=0;}
   if(budgetUsed>=2){timer=global.setTimeout(flush,Math.max(0,budgetAt+60000-now));return;}
   pending=false;budgetUsed++;var center=map.getCenter?.();
   map.relayout();relayouts++;
   var after=map.getCenter?.();
   if(center&&after&&typeof center.equals==='function'&&!center.equals(after))map.setCenter?.(center);
  }
  function schedule(){if(!pending||blocked()||timer!==null)return;timer=global.setTimeout(flush,40);}
  function restore(){pending=true;schedule();}
  function start(){moving=true;cancel();}
  function idle(){moving=false;schedule();}
  function hide(){paused=true;cancel();}
  function show(){paused=false;moving=false;restore();}
  function visibility(){if(document.visibilityState==='hidden')cancel();else{moving=false;restore();}}
  ['dragstart','zoom_start'].forEach(function(name){events.addListener(map,name,start);bindings.push([name,start]);});
  ['idle','dragend'].forEach(function(name){events.addListener(map,name,idle);bindings.push([name,idle]);});
  global.addEventListener('online',restore);global.addEventListener('pagehide',hide);global.addEventListener('pageshow',show);document.addEventListener('visibilitychange',visibility);
  var controller={stats:function(){return {mode:'sdk-managed-v195',relayouts:relayouts,pending:pending};},destroy:function(){
   if(disposed)return;disposed=true;cancel();pending=false;bindings.forEach(function(binding){events.removeListener(map,binding[0],binding[1]);});
   global.removeEventListener('online',restore);global.removeEventListener('pagehide',hide);global.removeEventListener('pageshow',show);document.removeEventListener('visibilitychange',visibility);
  }};
  active=controller;return controller;
 }
 global.JSMapTileRecoveryV105={attach:attach,stats:function(){return active?active.stats():{mode:'sdk-managed-v195',relayouts:0,pending:false};}};
})(window);

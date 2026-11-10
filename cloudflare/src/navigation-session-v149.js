import {requireSession, SESSION_COOKIE} from './security.js';
import {queryUiEnabledV152} from './query-bridge-v152.js';

export function sessionNavigationV149(request) {
  const path=new URL(request.url).pathname;
  return request.method==='GET' && (path==='/' || path==='/index.html') &&
    String(request.headers.get('cookie') || '').split(';').some(value=>value.trim().startsWith(SESSION_COOKIE+'='));
}

export function navigationSessionJsonV149(user,checkedAt=Date.now(),queryEnabled=false) {
  const email=String(user?.email || '').trim().toLowerCase();
  if(!email || email.length>320) return null;
  // Only the already-verified account identity, never a token/credential or
  // listing payload. Escape raw-text script terminators and JS separators.
  return JSON.stringify({version:149,email,checkedAt,...(queryEnabled?{queryListingsV152:true}:{})}).replace(/[<>&\u2028\u2029]/g,
    value=>'\\u'+value.charCodeAt(0).toString(16).padStart(4,'0'));
}

export async function assetsWithSessionV149(request,env) {
  if(!sessionNavigationV149(request) || typeof HTMLRewriter!=='function') return env.ASSETS.fetch(request);
  let timer;
  // Asset delivery and the same existing session/account verification run in
  // parallel. Slow account storage falls back to the existing client check;
  // it cannot strand the HTML request or authorize an unverified identity.
  const verified=Promise.resolve().then(()=>requireSession(request,env))
    .then(user=>({user,checkedAt:Date.now()})).catch(()=>null);
  const bounded=Promise.race([verified,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),600);})]);
  const response=await env.ASSETS.fetch(request);
  const verification=await bounded,user=verification?.user;clearTimeout(timer);
  if(!user || response.status!==200 || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return response;
  // Slow asset delivery must not make an older verification look new. The
  // client falls back to its fresh session check once this timestamp expires.
  const payload=navigationSessionJsonV149(user,verification.checkedAt,queryUiEnabledV152(env));
  if(!payload)return response;
  const headers=new Headers(response.headers);
  headers.set('cache-control','private, no-store, must-revalidate');
  headers.append('vary','Cookie');headers.delete('etag');headers.delete('last-modified');
  headers.set('x-js-session-bootstrap','verified-navigation-v149');
  return new HTMLRewriter().on('head',{element(element){
    element.prepend('<script type="application/json" id="jsNavigationSessionV149">'+payload+'</script>',{html:true});
  }}).transform(new Response(response.body,{status:response.status,statusText:response.statusText,headers}));
}

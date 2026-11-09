import {requireSession, SESSION_COOKIE} from './security.js';

export function sessionNavigationV149(request) {
  const path=new URL(request.url).pathname;
  return request.method==='GET' && (path==='/' || path==='/index.html') &&
    String(request.headers.get('cookie') || '').split(';').some(value=>value.trim().startsWith(SESSION_COOKIE+'='));
}

export function navigationSessionJsonV149(user,checkedAt=Date.now()) {
  const email=String(user?.email || '').trim().toLowerCase();
  if(!email || email.length>320) return null;
  // Only the already-verified account identity, never a token/credential or
  // listing payload. Escape raw-text script terminators and JS separators.
  return JSON.stringify({version:149,email,checkedAt}).replace(/[<>&\u2028\u2029]/g,
    value=>'\\u'+value.charCodeAt(0).toString(16).padStart(4,'0'));
}

export async function assetsWithSessionV149(request,env) {
  if(!sessionNavigationV149(request) || typeof HTMLRewriter!=='function') return env.ASSETS.fetch(request);
  let timer;
  // Asset delivery and the same existing session/account verification run in
  // parallel. Slow account storage falls back to the existing client check;
  // it cannot strand the HTML request or authorize an unverified identity.
  const verified=Promise.resolve().then(()=>requireSession(request,env)).catch(()=>null);
  const bounded=Promise.race([verified,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),600);})]);
  const response=await env.ASSETS.fetch(request);
  const user=await bounded;clearTimeout(timer);
  if(!user || response.status!==200 || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return response;
  const payload=navigationSessionJsonV149(user);
  if(!payload)return response;
  const headers=new Headers(response.headers);
  headers.set('cache-control','private, no-store, must-revalidate');
  headers.append('vary','Cookie');headers.delete('etag');headers.delete('last-modified');
  headers.set('x-js-session-bootstrap','verified-navigation-v149');
  return new HTMLRewriter().on('head',{element(element){
    element.prepend('<script type="application/json" id="jsNavigationSessionV149">'+payload+'</script>',{html:true});
  }}).transform(new Response(response.body,{status:response.status,statusText:response.statusText,headers}));
}

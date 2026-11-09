import {test,expect} from '@playwright/test';

async function setup(page,context,value,{hold=false,deny=false}={}) {
  let checks=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await context.route('**/api/session',r=>{checks++;return r.fulfill({status:deny?401:200,json:deny?{ok:false}:{ok:true,email:'fixture@example.invalid'}});});
  await context.route('**/fixture-hold-v149.js',async r=>{await gate;return r.fulfill({contentType:'text/javascript',body:'document.documentElement.setAttribute("data-hold-loaded","true");'});});
  await context.route('**/',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html class="auth-pending"><head>
    <script type="application/json" id="jsNavigationSessionV149">${typeof value==='string'?value:JSON.stringify(value)}</script>
    <script type="module" src="/js/auth-gate-v1.js"></script></head><body>
    <template id="jsAuthenticatedHeadAssets">${hold?'<script src="/fixture-hold-v149.js"></script>':''}</template>
    <template id="jsAuthenticatedApplication"><main id="wrap">Account-bound application</main></template>
    <template id="jsAuthenticatedBodyAssets"></template></body></html>`}));
  await page.goto('/',{waitUntil:'domcontentloaded'});return{checks:()=>checks,release};
}

test('a fresh server-verified navigation avoids the second session round trip without changing account isolation',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()});
  await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  await expect(page.locator('html')).toHaveAttribute('data-session-check-source-v149','navigation');
  expect(state.checks()).toBe(0);
  expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(false);
  expect(await page.locator('#jsNavigationSessionV149').count()).toBe(0);
});
for(const kind of ['stale','future','malformed','missing-account']) test('invalid navigation bootstrap falls back to the normal session check: '+kind,async({page,context})=>{
  const value=kind==='malformed'?'{invalid':{version:149,email:kind==='missing-account'?'':'fixture@example.invalid',
    checkedAt:Date.now()+(kind==='future'?60000:kind==='stale'?-60000:0)};
  const state=await setup(page,context,value);
  await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  await expect(page.locator('html')).toHaveAttribute('data-session-check-source-v149','api');
  expect(state.checks()).toBe(1);
});

test('a 401 while critical assets load cannot be undone by a late bootstrap unlock',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()},{hold:true,deny:true});
  try {
    await expect(page.locator('#wrap')).toHaveCount(1);
    await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));
    state.release();
    await expect(page.locator('html')).toHaveAttribute('data-hold-loaded','true');
    await expect(page.locator('#jsAuthGate')).toBeVisible();
    expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(true);
    await expect(page.locator('html')).toHaveClass(/auth-pending/);
  }finally{state.release();}
});

test('authentication loss after a bootstrap still performs a fresh server check',async({page,context})=>{
  const state=await setup(page,context,{version:149,email:'fixture@example.invalid',checkedAt:Date.now()},{deny:true});
  await expect(page.locator('html')).not.toHaveClass(/auth-pending/);
  await page.evaluate(()=>window.dispatchEvent(new Event('js-auth-required')));
  await expect(page.locator('#jsAuthGate')).toBeVisible();
  await expect.poll(state.checks).toBe(1);
  expect(await page.locator('#wrap').evaluate(el=>el.inert)).toBe(true);
});

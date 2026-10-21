import {test, expect} from '@playwright/test';

test.beforeEach(async ({context}) => context.route('**/*', route =>
  new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));

async function setup(page, {initiallyExpired = false, refuseCookie = false} = {}) {
  const state = {expired: initiallyExpired, sessionStatus: 200, gets: 0, writes: 0, navigations: 0};
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) state.navigations++; });
  await page.route('**/', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html class="auth-pending"><body>
    <div id="wrap" inert><textarea id="draft">작성 중 메모</textarea></div>
    <script src="/js/data-access-v6.js"></script><script type="module" src="/js/auth-gate-v1.js"></script></body></html>`}));
  await page.route('**/api/session', route => {
    if (route.request().method() === 'POST') {
      if (!refuseCookie) state.expired = false;
      return route.fulfill({json: {ok: true, email: 'owner@example.com'}});
    }
    state.gets++;
    return route.fulfill({status: state.expired ? 401 : state.sessionStatus,
      json: state.expired ? {ok: false, message: '세션 만료'} : {ok: true, email: 'owner@example.com'}});
  });
  await page.route('**/api/auth-config', route => route.fulfill({json: {localLoginEnabled: true}}));
  await page.route('**/api/data?**', route => route.fulfill({status: 401, json: {ok: false, message: '만료'}}));
  await page.route('**/api/data', route => { state.writes++; return route.fulfill({status: 401, json: {ok: false, message: '만료'}}); });
  await page.goto('/');
  if (initiallyExpired) await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
  else await expect(page.locator('#wrap')).not.toHaveAttribute('inert');
  return state;
}

async function login(page) {
  await page.getByLabel('아이디', {exact: true}).fill('myowner');
  await page.getByLabel('비밀번호', {exact: true}).fill('fixture-password');
  await page.getByRole('button', {name: '아이디로 로그인'}).click();
}

test('expired API reads and writes reopen login once and same-account recovery preserves the open draft without replay', async ({page}) => {
  const state = await setup(page);
  await page.locator('#draft').fill('아직 저장하지 않은 메모');
  await page.evaluate(() => { window.originalDraft = document.querySelector('#draft'); localStorage.setItem('v62-favorites', 'keep'); });
  state.expired = true;
  const before = state.gets;
  await page.evaluate(() => Promise.allSettled([
    JSDataAccessV6.read('userProfile'), JSDataAccessV6.read('loadCloudState'), JSDataAccessV6.mutate('updatePropertyMemo', {memo: 'draft'})
  ]));
  await expect(page.locator('#jsAuthStatus')).toContainText('다시 로그인');
  await expect(page.locator('#wrap')).toHaveAttribute('inert');
  expect(state.gets - before).toBe(1);
  await login(page);
  await expect(page.locator('#jsAuthGate')).toHaveCount(0);
  await expect(page.locator('#draft')).toHaveValue('아직 저장하지 않은 메모');
  expect(await page.evaluate(() => document.querySelector('#draft') === window.originalDraft)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('v62-favorites'))).toBe('keep');
  expect(state.writes).toBe(1);
  expect(state.navigations).toBe(1);
});

test('restoring a tablet page from the back-forward cache rechecks an expired session', async ({page}) => {
  const state = await setup(page);
  state.expired = true;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
  await expect(page.locator('#jsAuthStatus')).toContainText('만료');
  await expect(page.locator('#wrap')).toHaveAttribute('inert');
  await expect(page.locator('#jsLocalLoginForm')).toBeVisible();
});

test('a temporary server failure on tablet resume leaves the current screen and draft available', async ({page}) => {
  const state = await setup(page);
  state.sessionStatus = 503;
  const count = state.gets;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
  await expect.poll(() => state.gets).toBe(count + 1);
  await expect(page.locator('#jsAuthGate')).toHaveCount(0);
  await expect(page.locator('#wrap')).not.toHaveAttribute('inert');
});

test('a login response without an accepted session cookie gives a recoverable message instead of a reload loop', async ({page}) => {
  const state = await setup(page, {initiallyExpired: true, refuseCookie: true});
  await login(page);
  await expect(page.locator('#jsAuthStatus')).toContainText('쿠키 허용');
  await expect(page.getByRole('button', {name: '아이디로 로그인'})).toBeEnabled();
  expect(state.navigations).toBe(1);
});

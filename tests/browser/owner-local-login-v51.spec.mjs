import {test, expect} from "@playwright/test";

test.beforeEach(async ({context}) => context.route("**/*", route =>
  new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));

test("operations user management links the owner's existing identity and does not offer another owner", async ({page}) => {
  await page.route("**/", route => route.fulfill({contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body>
    <button id="operationsTabUsers" hidden onclick="switchOperationsTab('users')">사용자 관리</button>
    <div id="operationsCenterMessage"></div><div id="operationsUsersPanel"></div>
    <script>
      window.switchOperationsTab=()=>{};window.issued=null;
      window.JSDataAccessV6={read:async action=>action==='userProfile'
        ?{email:'owner@example.com',role:'owner',canManageUsers:true,canManageLocalAccounts:true}
        :{users:[{email:'owner@example.com',role:'owner',active:true},{email:'other@example.com',role:'owner',active:true},
          {email:'friend@example.com',role:'member',active:true}],localAccounts:window.issued?[{...window.issued,linkedEmail:'owner@example.com',role:'owner',active:true}]:[]},
        mutate:async(action,payload)=>{window.issued={username:payload.username,linkedEmail:payload.linkedEmail};return {ok:true};}};
    </script><script src="/js/operations-admin-v1.js"></script></body></html>`}));
  await page.goto("/");
  await page.getByRole("button", {name: "사용자 관리"}).click();
  const form = page.locator(".operations-local-user-form-v1");
  await expect(form.locator('select option[value="owner@example.com"]')).toHaveText(/내 계정/);
  await expect(form.locator('select option[value="other@example.com"]')).toHaveCount(0);
  await form.getByLabel("로그인 아이디").fill("myowner");
  await form.locator("select").selectOption("owner@example.com");
  await form.locator('[name="password"]').fill("fixture-private-password");
  await form.getByRole("button", {name: "아이디 발급"}).click();
  await expect(page.locator("#operationsCenterMessage")).toContainText("기존 계정에 로그인 아이디를 연결");
  expect(await page.evaluate(() => window.issued)).toEqual({username: "myowner", linkedEmail: "owner@example.com"});
  await expect(page.locator(".operations-local-user-list-v1")).toContainText("소유자");
  await expect(page.locator('.operations-local-user-form-v1 select option[value="owner@example.com"]')).toHaveCount(0);
  await expect(page.locator('[data-local-password="myowner"]')).toHaveValue("");
});

test("expired session and unavailable Google library still allow local login and retain same-account storage", async ({page}) => {
  let loggedIn = false;
  let submitted;
  await page.route("**/", route => route.fulfill({contentType: "text/html; charset=utf-8", body: `<!doctype html><html class="auth-pending"><body>
    <script type="module" src="/js/auth-gate-v1.js"></script><div id="wrap" inert>접속 완료</div></body></html>`}));
  await page.route("**/api/session", route => {
    if (route.request().method() === "POST") { submitted = route.request().postDataJSON(); loggedIn = true; }
    return route.fulfill({status: loggedIn ? 200 : 401, contentType: "application/json", body: JSON.stringify(loggedIn
      ? {ok: true, email: "owner@example.com", role: "owner", authType: "local"}
      : {ok: false, message: "로그인 세션이 만료되었습니다."})});
  });
  await page.route("**/api/auth-config", route => route.fulfill({json: {localLoginEnabled: true, googleClientId: "fixture"}}));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("v51-fixture-initialized")) return;
    sessionStorage.setItem("v51-fixture-initialized", "1");
    sessionStorage.setItem("js_authenticated_account_v1", "owner@example.com");
    localStorage.setItem("js_list_account_email_v6", "owner@example.com");
    localStorage.setItem("v51-record-preservation-fixture", "favorites-and-memo");
  });
  await page.goto("/");
  await expect(page.locator("#jsAuthStatus")).toContainText("연결한 아이디로 로그인할 수 있습니다");
  await page.getByLabel("아이디", {exact: true}).fill("myowner");
  await page.getByLabel("비밀번호", {exact: true}).fill("fixture-private-password");
  await page.getByRole("button", {name: "아이디로 로그인"}).click();
  await expect(page.locator("#jsAuthGate")).toHaveCount(0);
  await expect(page.locator("#wrap")).not.toHaveAttribute("inert");
  expect(submitted.loginType).toBe("local");
  expect(submitted.username).toBe("myowner");
  expect(await page.evaluate(() => window.JSAuthenticatedAccountEmail)).toBe("owner@example.com");
  expect(await page.evaluate(() => localStorage.getItem("v51-record-preservation-fixture"))).toBe("favorites-and-memo");
});

let googleClientId = "";
let authenticatedAssetsPromise = null;
let deferredAuthenticatedAssetsPromise = null;
let sessionRetryTimer = 0;

function setApplicationIsolation(locked) {
  const application = document.getElementById("wrap");
  if (!application) return;
  application.inert = !!locked;
  if (locked) application.setAttribute("aria-hidden", "true");
  else application.removeAttribute("aria-hidden");
}

function authGate() {
  let gate = document.getElementById("jsAuthGate");
  if (gate) return gate;
  gate = document.createElement("section");
  gate.id = "jsAuthGate";
  gate.className = "js-auth-gate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-labelledby", "jsAuthTitle");
  gate.setAttribute("aria-describedby", "jsAuthDescription");
  gate.innerHTML = `
    <div class="js-auth-card">
      <div class="js-auth-logo">J S</div>
      <h1 id="jsAuthTitle">JS부동산</h1>
      <p class="js-auth-subtitle">대전 상가 매물지도</p>
      <p id="jsAuthDescription">관리자는 Google 계정으로,<br>발급받은 사용자는 아이디로 로그인합니다.</p>
      <div id="jsGoogleLogin" class="js-auth-google"></div>
      <div class="js-auth-divider"><span>또는 발급받은 계정</span></div>
      <form id="jsLocalLoginForm" class="js-auth-local" autocomplete="on">
        <label><span>아이디</span><input name="username" autocomplete="username" autocapitalize="none" required></label>
        <label><span>비밀번호</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">아이디로 로그인</button>
      </form>
      <p id="jsAuthStatus" class="js-auth-status" role="alert"></p>
    </div>`;
  document.body.appendChild(gate);
  gate.querySelector("#jsLocalLoginForm")?.addEventListener("submit", loginWithLocal);
  setApplicationIsolation(true);
  return gate;
}

function status(message) {
  const element = document.getElementById("jsAuthStatus");
  if (element) element.textContent = message || "";
}

async function appendAuthenticatedHeadAssets() {
  const template = document.getElementById("jsAuthenticatedHeadAssets");
  if (!template) return;
  const nodes = Array.from(template.content.childNodes);
  const scripts = [];
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT") {
      scripts.push(node);
    } else {
      document.head.appendChild(node.cloneNode(true));
    }
  }
  for (const script of scripts) {
    await loadScriptInOrder(script, document.head);
    warmInitialDataAfterScript(script);
  }
  template.remove();
}

function appendAuthenticatedApplication() {
  const template = document.getElementById("jsAuthenticatedApplication");
  if (!template) return;
  document.body.insertBefore(template.content.cloneNode(true), template);
  template.remove();
  setApplicationIsolation(true);
}

function loadScriptInOrder(sourceScript, target = document.body) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    for (const attribute of sourceScript.attributes) {
      script.setAttribute(attribute.name, attribute.value);
    }
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`앱 구성요소를 불러오지 못했습니다: ${sourceScript.src}`)), { once: true });
    target.appendChild(script);
  });
}

function warmInitialDataAfterScript(script) {
  if (
    /(?:^|\/)data-access-v6\.js(?:\?|$)/.test(script.getAttribute("src") || "") &&
    window.JSDataAccessV6 &&
    typeof window.JSDataAccessV6.warmInitialData === "function"
  ) {
    window.JSDataAccessV6.warmInitialData();
  }
}

async function appendAuthenticatedBodyAssets() {
  const template = document.getElementById("jsAuthenticatedBodyAssets");
  if (!template) return;
  const nodes = Array.from(template.content.childNodes);
  const scripts = nodes.filter((node) => (
    node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT" && node.getAttribute("src")
  ));
  const criticalScripts = scripts.filter((script) => script.hasAttribute("data-auth-critical"));
  const deferredScripts = scripts.filter((script) => !script.hasAttribute("data-auth-critical"));
  // Do not compete with the map and the complete-list snapshot for bandwidth.
  // Only startup-critical files are preloaded; secondary panels begin once the
  // first screen has yielded to the browser.
  const preloadLinks = criticalScripts.map((node) => {
    const preload = document.createElement("link");
    preload.rel = "preload";
    preload.as = "script";
    preload.href = node.getAttribute("src");
    document.head.appendChild(preload);
    return preload;
  });
  nodes.forEach((node) => {
    if (!(node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT")) {
      document.body.appendChild(node.cloneNode(true));
    }
  });

  for (const script of criticalScripts) {
    await loadScriptInOrder(script);
    warmInitialDataAfterScript(script);
  }
  template.remove();

  deferredAuthenticatedAssetsPromise = new Promise((resolve) => {
    const loadDeferred = async () => {
      for (const script of deferredScripts) {
        await loadScriptInOrder(script);
        warmInitialDataAfterScript(script);
      }
      resolve(true);
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => loadDeferred().catch(() => resolve(false)), { timeout: 600 });
    } else {
      setTimeout(() => loadDeferred().catch(() => resolve(false)), 120);
    }
  }).catch((error) => {
    console.error("지연 앱 구성요소 로딩 실패", error);
    return false;
  }).finally(() => {
    preloadLinks.forEach((preload) => preload.remove());
  });
}

function loadAuthenticatedAssets() {
  if (authenticatedAssetsPromise) return authenticatedAssetsPromise;
  authenticatedAssetsPromise = (async () => {
    appendAuthenticatedApplication();
    await appendAuthenticatedHeadAssets();
    await appendAuthenticatedBodyAssets();
  })();
  return authenticatedAssetsPromise;
}

async function unlock(email) {
  status("앱을 준비하고 있습니다…");
  await loadAuthenticatedAssets();
  setApplicationIsolation(false);
  document.documentElement.classList.remove("auth-pending");
  document.getElementById("jsAuthGate")?.remove();
  document.getElementById("jsAuthUser")?.remove();
}

async function sessionRequest(payload) {
  const response = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "로그인 승인에 실패했습니다.");
  return result;
}

function loadGoogleLibrary() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-js-google-identity]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client?hl=ko";
    script.async = true;
    script.defer = true;
    script.dataset.jsGoogleIdentity = "true";
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error("Google 로그인 모듈을 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });
}

async function loadLoginOptions() {
  const configResponse = await fetch("/api/auth-config", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("로그인 설정을 불러오지 못했습니다.");
  const config = await configResponse.json();
  const localForm = document.getElementById("jsLocalLoginForm");
  const divider = document.querySelector(".js-auth-divider");
  const localEnabled = config.localLoginEnabled === true;
  if (localForm) localForm.hidden = !localEnabled;
  if (divider) divider.hidden = !localEnabled;
  googleClientId = String(config.googleClientId || "");
  if (!googleClientId) {
    document.getElementById("jsGoogleLogin")?.setAttribute("hidden", "");
    if (!localEnabled) throw new Error("로그인 설정이 아직 완료되지 않았습니다.");
    return;
  }
  await loadGoogleLibrary();
  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: loginWithGoogle,
    auto_select: false,
    cancel_on_tap_outside: false
  });
  window.google.accounts.id.renderButton(
    document.getElementById("jsGoogleLogin"),
    { type: "standard", theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: Math.min(340, document.getElementById("jsGoogleLogin").clientWidth || 340) }
  );
}

async function loginWithGoogle(response) {
  status("승인된 계정인지 확인하고 있습니다…");
  try {
    await sessionRequest({ loginType: "google", credential: response && response.credential });
    location.reload();
  } catch (error) {
    status(error.message || "로그인에 실패했습니다.");
  }
}

async function loginWithLocal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  status("아이디와 비밀번호를 확인하고 있습니다…");
  if (submit) submit.disabled = true;
  try {
    await sessionRequest({
      loginType: "local",
      username: form.username.value,
      password: form.password.value
    });
    form.password.value = "";
    location.reload();
  } catch (error) {
    form.password.value = "";
    form.password.focus();
    status(error.message || "로그인에 실패했습니다.");
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function logout(trigger) {
  const button = trigger && trigger.nodeType === 1 ? trigger : null;
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const label = button.querySelector("span");
    if (label) label.textContent = "종료 중";
  }
  try {
    if (window.JSInitialListingsCacheV1 && typeof window.JSInitialListingsCacheV1.clear === "function") {
      await window.JSInitialListingsCacheV1.clear();
    }
    await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
    if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
  } finally {
    location.reload();
  }
}

async function start() {
  authGate();
  try {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (response.ok) {
      if (sessionRetryTimer) clearTimeout(sessionRetryTimer);
      sessionRetryTimer = 0;
      const result = await response.json();
      await unlock(result.email);
      return;
    }
    if (response.status !== 401 && response.status !== 403) {
      throw new Error("인터넷 연결을 기다리는 중입니다.");
    }
    await loadLoginOptions();
    status("");
  } catch (error) {
    status(error.message || "인터넷 연결을 기다리는 중입니다.");
    if (!sessionRetryTimer) {
      sessionRetryTimer = setTimeout(function () {
        sessionRetryTimer = 0;
        start();
      }, 3000);
    }
  }
}

window.jsSecureLogout = logout;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

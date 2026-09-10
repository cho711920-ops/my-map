let googleClientId = "";
let authenticatedAssetsPromise = null;
let deferredAuthenticatedAssetsPromise = null;
let sessionRetryTimer = 0;
let authenticatedHeadStaticAssetsAppended = false;
let authenticatedBodyStaticAssetsAppended = false;
let deferredAuthenticatedScripts = [];
const authenticatedScriptLoads = new Map();
const AUTH_ACCOUNT_SESSION_KEY = "js_authenticated_account_v1";
const PRECISE_LOCATION_KEYS = [
  "js_kakao_navigation_location_v1",
  "js_ai_visit_location_v6"
];
const AI_VISIT_DEVICE_CACHE_KEYS = [
  "js_ai_visit_sessions_v6",
  "js_ai_visit_session_v6"
];

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
    } else if (!authenticatedHeadStaticAssetsAppended) {
      document.head.appendChild(node.cloneNode(true));
    }
  }
  authenticatedHeadStaticAssetsAppended = true;
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
  const source = sourceScript.getAttribute("src") || "";
  const key = new URL(source, document.baseURI).href;
  if (authenticatedScriptLoads.has(key)) return authenticatedScriptLoads.get(key);

  const pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    for (const attribute of sourceScript.attributes) {
      script.setAttribute(attribute.name, attribute.value);
    }
    script.dataset.jsAuthenticatedAsset = "true";
    script.addEventListener("load", () => {
      script.dataset.jsAuthenticatedAssetLoaded = "true";
      resolve(true);
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error(`앱 구성요소를 불러오지 못했습니다: ${source}`));
    }, { once: true });
    target.appendChild(script);
  }).catch((error) => {
    // Keep already loaded scripts, but allow only the failed URL to be retried.
    authenticatedScriptLoads.delete(key);
    throw error;
  });
  authenticatedScriptLoads.set(key, pending);
  return pending;
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
    if (!authenticatedBodyStaticAssetsAppended && !(node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT")) {
      document.body.appendChild(node.cloneNode(true));
    }
  });
  authenticatedBodyStaticAssetsAppended = true;

  try {
    for (const script of criticalScripts) {
      await loadScriptInOrder(script);
      warmInitialDataAfterScript(script);
    }
  } catch (error) {
    preloadLinks.forEach((preload) => preload.remove());
    throw error;
  }
  template.remove();
  deferredAuthenticatedScripts = deferredScripts.slice();
  setDeferredFeatureReadiness("loading");
  startDeferredAuthenticatedAssets(preloadLinks);
}

function globalFunctionExists(path) {
  const parts = String(path || "").replace(/^window\./, "").split(".").filter(Boolean);
  let value = window;
  for (const part of parts) {
    if (value == null || !(part in value)) return false;
    value = value[part];
  }
  return typeof value === "function";
}

function hasUnavailableInlineAction(control) {
  const handler = String(control.getAttribute("onclick") || "");
  const ignored = new Set(["if", "for", "while", "switch", "function", "return"]);
  const calls = handler.matchAll(/(?:^|[^\w$.])((?:window\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g);
  for (const match of calls) {
    const path = match[1];
    if (!ignored.has(path) && !globalFunctionExists(path)) return true;
  }
  return false;
}

function refreshDeferredControls() {
  document.querySelectorAll("button[onclick]").forEach((button) => {
    const unavailable = hasUnavailableInlineAction(button);
    if (unavailable) {
      if (!button.hasAttribute("data-js-auth-deferred-control")) {
        button.dataset.jsAuthDeferredOriginalAriaDisabled = button.getAttribute("aria-disabled") || "";
        button.dataset.jsAuthDeferredOriginalTitle = button.getAttribute("title") || "";
      }
      button.dataset.jsAuthDeferredControl = "true";
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-busy", "true");
      button.title = "이 기능을 준비하고 있습니다.";
      return;
    }
    if (!button.hasAttribute("data-js-auth-deferred-control")) return;
    const originalAriaDisabled = button.dataset.jsAuthDeferredOriginalAriaDisabled || "";
    if (originalAriaDisabled) button.setAttribute("aria-disabled", originalAriaDisabled);
    else button.removeAttribute("aria-disabled");
    button.removeAttribute("aria-busy");
    const originalTitle = button.dataset.jsAuthDeferredOriginalTitle || "";
    if (originalTitle) button.title = originalTitle;
    else button.removeAttribute("title");
    delete button.dataset.jsAuthDeferredControl;
    delete button.dataset.jsAuthDeferredOriginalAriaDisabled;
    delete button.dataset.jsAuthDeferredOriginalTitle;
  });
}

document.addEventListener("click", (event) => {
  const blocked = event.target && typeof event.target.closest === "function"
    ? event.target.closest("[data-js-auth-deferred-control]")
    : null;
  if (!blocked) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

function authenticatedFeatureStatus() {
  let element = document.getElementById("jsAuthenticatedFeatureStatus");
  if (element) return element;
  element = document.createElement("aside");
  element.id = "jsAuthenticatedFeatureStatus";
  element.className = "js-auth-feature-status";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.innerHTML = '<span data-js-auth-feature-message></span><button type="button" hidden>다시 시도</button>';
  element.querySelector("button").addEventListener("click", () => {
    retryDeferredAuthenticatedAssets();
  });
  document.body.appendChild(element);
  return element;
}

function showAuthenticatedFeatureStatus(message, options = {}) {
  const element = authenticatedFeatureStatus();
  const messageElement = element.querySelector("[data-js-auth-feature-message]");
  const retryButton = element.querySelector("button");
  element.dataset.tone = options.tone || "info";
  element.setAttribute("role", options.tone === "error" ? "alert" : "status");
  if (messageElement) messageElement.textContent = message || "";
  if (retryButton) retryButton.hidden = options.retry !== true;
  element.hidden = !message;
}

function setDeferredFeatureReadiness(state, error) {
  refreshDeferredControls();
  const application = document.getElementById("wrap");
  if (application) {
    if (state === "loading") application.setAttribute("aria-busy", "true");
    else application.removeAttribute("aria-busy");
  }
  if (state === "loading") {
    showAuthenticatedFeatureStatus("부가 기능을 준비하고 있습니다…");
  } else if (state === "error") {
    showAuthenticatedFeatureStatus("일부 기능을 불러오지 못했습니다. 사용할 기능만 다시 불러올 수 있습니다.", { tone: "error", retry: true });
    console.error("지연 앱 구성요소 로딩 실패", error);
  } else {
    showAuthenticatedFeatureStatus("");
  }
}

function scheduleDeferredLoad(load) {
  return new Promise((resolve, reject) => {
    const run = () => Promise.resolve().then(load).then(resolve, reject);
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 600 });
    else setTimeout(run, 120);
  });
}

function startDeferredAuthenticatedAssets(preloadLinks = []) {
  if (deferredAuthenticatedAssetsPromise) return deferredAuthenticatedAssetsPromise;
  deferredAuthenticatedAssetsPromise = scheduleDeferredLoad(async () => {
    const failures = [];
    for (const script of deferredAuthenticatedScripts) {
      try {
        await loadScriptInOrder(script);
        warmInitialDataAfterScript(script);
      } catch (error) {
        failures.push(error);
      } finally {
        refreshDeferredControls();
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, `${failures.length}개 부가 기능을 불러오지 못했습니다.`);
    }
    return true;
  }).finally(() => {
    preloadLinks.forEach((preload) => preload.remove());
  });

  // Observe the rejection for UI feedback while retaining a rejected promise
  // for callers that need an explicit readiness result.
  deferredAuthenticatedAssetsPromise.then(
    () => setDeferredFeatureReadiness("ready"),
    (error) => {
      deferredAuthenticatedAssetsPromise = null;
      setDeferredFeatureReadiness("error", error);
    }
  );
  return deferredAuthenticatedAssetsPromise;
}

function retryDeferredAuthenticatedAssets() {
  if (!deferredAuthenticatedScripts.length) return Promise.resolve(true);
  setDeferredFeatureReadiness("loading");
  return startDeferredAuthenticatedAssets();
}

function loadAuthenticatedAssets() {
  if (authenticatedAssetsPromise) return authenticatedAssetsPromise;
  const pending = (async () => {
    appendAuthenticatedApplication();
    await appendAuthenticatedHeadAssets();
    await appendAuthenticatedBodyAssets();
  })();
  authenticatedAssetsPromise = pending.catch((error) => {
    // Templates and successfully loaded URLs are retained, so a later session
    // retry resumes at only the failed critical asset.
    authenticatedAssetsPromise = null;
    throw error;
  });
  return authenticatedAssetsPromise;
}

async function unlock(email) {
  status("앱을 준비하고 있습니다…");
  syncLocationPrivacyForAccount(email);
  await loadAuthenticatedAssets();
  setApplicationIsolation(false);
  document.documentElement.classList.remove("auth-pending");
  document.getElementById("jsAuthGate")?.remove();
  document.getElementById("jsAuthUser")?.remove();
}

function removeStorageKeys(storage, keys) {
  if (!storage) return;
  for (const key of keys) {
    try { storage.removeItem(key); } catch (error) {}
  }
}

function clearPreciseLocationCaches(options = {}) {
  removeStorageKeys(window.sessionStorage, PRECISE_LOCATION_KEYS);
  removeStorageKeys(window.localStorage, PRECISE_LOCATION_KEYS);
  if (options.clearVisitDeviceCache) {
    removeStorageKeys(window.localStorage, AI_VISIT_DEVICE_CACHE_KEYS);
  }
  if (options.clearAccountMarker) {
    removeStorageKeys(window.sessionStorage, [AUTH_ACCOUNT_SESSION_KEY]);
  }
  if (window.JSKakaoNavigation && typeof window.JSKakaoNavigation.clearLocationCache === "function") {
    window.JSKakaoNavigation.clearLocationCache();
  }
  if (window.JSAiVisitRouteV6 && typeof window.JSAiVisitRouteV6.clearLocationCache === "function") {
    window.JSAiVisitRouteV6.clearLocationCache();
  }
  if (window.JSAiVisitV6 && typeof window.JSAiVisitV6.clearLocationCache === "function") {
    window.JSAiVisitV6.clearLocationCache();
  }
}

function syncLocationPrivacyForAccount(email) {
  const normalized = String(email || "").trim().toLowerCase();
  let previous = "";
  try { previous = String(window.sessionStorage.getItem(AUTH_ACCOUNT_SESSION_KEY) || "").trim().toLowerCase(); } catch (error) {}

  // Persistent caches from older releases are never reused. A new tab/account
  // also starts without inheriting another signed-in user's precise position.
  removeStorageKeys(window.localStorage, PRECISE_LOCATION_KEYS);
  if (!previous || previous !== normalized) {
    clearPreciseLocationCaches({ clearVisitDeviceCache: true });
  }
  try { window.sessionStorage.setItem(AUTH_ACCOUNT_SESSION_KEY, normalized); } catch (error) {}
  window.JSAuthenticatedAccountEmail = normalized;
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
    clearPreciseLocationCaches({ clearVisitDeviceCache: true, clearAccountMarker: true });
    if (window.JSInitialListingsCacheV1 && typeof window.JSInitialListingsCacheV1.clear === "function") {
      await window.JSInitialListingsCacheV1.clear();
    }
    const response = await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "로그아웃 요청을 완료하지 못했습니다.");
    }
    if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
    location.reload();
  } catch (error) {
    showAuthenticatedFeatureStatus(error.message || "로그아웃에 실패했습니다. 잠시 후 다시 시도해주세요.", { tone: "error" });
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      const label = button.querySelector("span");
      if (label) label.textContent = "로그아웃";
    }
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

let googleClientId = "";
let authenticatedAssetsPromise = null;

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
      <p id="jsAuthDescription">승인된 Google 계정으로 로그인해야<br>매물 정보를 확인할 수 있습니다.</p>
      <div id="jsGoogleLogin" class="js-auth-google"></div>
      <p id="jsAuthStatus" class="js-auth-status" role="alert"></p>
    </div>`;
  document.body.appendChild(gate);
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
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT") {
      await loadScriptInOrder(node, document.head);
    } else {
      document.head.appendChild(node.cloneNode(true));
    }
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

async function appendAuthenticatedBodyAssets() {
  const template = document.getElementById("jsAuthenticatedBodyAssets");
  if (!template) return;
  const nodes = Array.from(template.content.childNodes);
  const preloadLinks = nodes.filter((node) => (
    node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT" && node.getAttribute("src")
  )).map((node) => {
    const preload = document.createElement("link");
    preload.rel = "preload";
    preload.as = "script";
    preload.href = node.getAttribute("src");
    document.head.appendChild(preload);
    return preload;
  });
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "SCRIPT") {
      await loadScriptInOrder(node);
    } else {
      document.body.appendChild(node.cloneNode(true));
    }
  }
  preloadLinks.forEach((preload) => preload.remove());
  template.remove();
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

async function sessionRequest(credential) {
  const response = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential })
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
    script.onerror = () => reject(new Error("Google 로그인 모듈을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

async function loadGoogleLogin() {
  const configResponse = await fetch("/api/auth-config", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("Google 로그인 설정을 불러오지 못했습니다.");
  const config = await configResponse.json();
  googleClientId = String(config.googleClientId || "");
  if (!googleClientId) throw new Error("Google 로그인 설정이 아직 완료되지 않았습니다.");
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
    await sessionRequest(response && response.credential);
    location.reload();
  } catch (error) {
    status(error.message || "로그인에 실패했습니다.");
  }
}

async function logout() {
  try {
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
      const result = await response.json();
      await unlock(result.email);
      return;
    }
    await loadGoogleLogin();
    status("");
  } catch (error) {
    status(error.message || "로그인 설정을 확인해 주세요.");
  }
}

window.jsSecureLogout = logout;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

let googleClientId = "";

function authGate() {
  let gate = document.getElementById("jsAuthGate");
  if (gate) return gate;
  gate = document.createElement("section");
  gate.id = "jsAuthGate";
  gate.className = "js-auth-gate";
  gate.innerHTML = `
    <div class="js-auth-card">
      <div class="js-auth-logo">J S</div>
      <h1>JS부동산 매물지도</h1>
      <p>승인된 Google 계정으로 로그인해야<br>매물 정보를 확인할 수 있습니다.</p>
      <div id="jsGoogleLogin" class="js-auth-google"></div>
      <p id="jsAuthStatus" class="js-auth-status" role="alert"></p>
    </div>`;
  document.body.appendChild(gate);
  return gate;
}

function status(message) {
  const element = document.getElementById("jsAuthStatus");
  if (element) element.textContent = message || "";
}

function unlock(email) {
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
      unlock(result.email);
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

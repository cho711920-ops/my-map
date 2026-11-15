(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  function prepareNextNavigation() {
    navigator.serviceWorker.controller?.postMessage({type: "CHECK_PUBLIC_RELEASE_V240"});
  }

  function register() {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(prepareNextNavigation)
      .catch(function () {
        // Installation is optional; the online application remains usable.
      });
  }

  // An update waits for existing pages to close. Do not force a reload while
  // someone is editing a memo, collecting listings, or saving an inspection.
  // A slow map SDK or image can hold window.load for a long time. Start the
  // small public update check after parsing, retaining the one-second delay
  // and the normal waiting-worker lifecycle for open editing pages.
  // Refresh only the next navigation's public shell. Never reload a page,
  // replace its scripts, activate a waiting worker or discard an editor draft.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") prepareNextNavigation();
  });
  if (document.readyState !== "loading") setTimeout(register, 1000);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(register, 1000); }, { once: true });
})();

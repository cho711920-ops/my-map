(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  function register() {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(function () {
        // Installation is optional; the online application remains usable.
      });
  }

  // An update waits for existing pages to close. Do not force a reload while
  // someone is editing a memo, collecting listings, or saving an inspection.
  // A slow map SDK or image can hold window.load for a long time. Start the
  // small public update check after parsing, retaining the one-second delay
  // and the normal waiting-worker lifecycle for open editing pages.
  if (document.readyState !== "loading") setTimeout(register, 1000);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(register, 1000); }, { once: true });
})();

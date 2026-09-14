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
  if (document.readyState === "complete") setTimeout(register, 1000);
  else window.addEventListener("load", function () { setTimeout(register, 1000); }, { once: true });
})();

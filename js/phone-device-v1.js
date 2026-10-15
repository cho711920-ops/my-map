/* Handheld layout opt-in. Viewport width alone never classifies a device. */
(function (global) {
  "use strict";
  var root = document.documentElement;
  var lastState = "";
  var originalViewport = null;
  var lastAvailableWidth = 0;

  function syncDesktopViewport(landscape) {
    var meta = typeof document.querySelector === "function" && document.querySelector('meta[name="viewport"]');
    if (!meta) return null;
    var visual = global.visualViewport;
    // Multiplying by scale yields the available device CSS width both before
    // and after the native page-fit zoom, including user pinch zoom. Using
    // innerWidth here would flip between the phone width and 1280 indefinitely.
    var availableWidth = visual && Number(visual.width) * Number(visual.scale);
    if (!(availableWidth > 0)) {
      availableWidth = Number(global.outerWidth) || (originalViewport === null ? Number(global.innerWidth) : lastAvailableWidth);
    }
    if (availableWidth > 0) lastAvailableWidth = availableWidth;
    var fitted = !!(landscape && availableWidth > 0 && Math.round(availableWidth) < 1280);
    if (fitted) {
      if (originalViewport === null) originalViewport = meta.getAttribute("content") || "width=device-width,initial-scale=1";
      // Native viewport fitting scales layout, text and hit testing together.
      // Do not use CSS transforms/zoom or disable the user's pinch zoom.
      if (meta.getAttribute("content") !== "width=1280") meta.setAttribute("content", "width=1280");
    } else if (originalViewport !== null) {
      meta.setAttribute("content", originalViewport);
      originalViewport = null;
    }
    return fitted;
  }

  function isPhone() {
    var nav = global.navigator || {};
    var ua = String(nav.userAgent || "");
    var display = global.screen || {};
    var shortSide = Math.min(Number(display.width) || 0, Number(display.height) || 0);
    // Physical CSS screen dimensions survive a software keyboard, split-screen
    // resizing and rotation. Unknown/large displays are not physical phones.
    if (shortSide <= 0 || shortSide >= 600) return false;
    if (/iPad|Tablet|SM-T\w*|SM-X\w*|Galaxy Tab|Kindle|Silk\//i.test(ua)) return false;
    if (/Windows NT|Macintosh|MacIntel/i.test(ua + " " + String(nav.platform || ""))) return false;
    var phoneUA = /iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
    var hints = nav.userAgentData;
    // Preserve the physical-phone classification; tablets have their own opt-in.
    if (hints && hints.mobile === false) return false;
    var touch = Number(nav.maxTouchPoints) > 0 || !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);
    return touch && (phoneUA || !!(hints && hints.mobile === true));
  }

  function isHandheld() {
    var nav = global.navigator || {};
    var ua = String(nav.userAgent || "");
    var platform = String(nav.platform || "");
    var display = global.screen || {};
    if (!(Number(display.width) > 0 && Number(display.height) > 0)) return false;
    if (/Windows NT/i.test(ua + " " + platform)) return false;
    if (isPhone()) return true;
    var touch = Number(nav.maxTouchPoints) > 0 || !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);
    if (!touch) return false;
    // iPadOS Safari can use the full desktop Mac user agent. Multi-touch is
    // required here so a normal Mac desktop never opts into the handheld layout.
    if (/Macintosh|MacIntel/i.test(ua + " " + platform)) return Number(nav.maxTouchPoints) > 1;
    // UAData.mobile=false is normal for Android tablets, including desktop mode.
    // Desktop-site mode can remove Android from the UA while retaining the
    // low-entropy Android platform hint. Touch evidence is still required.
    return /iPad|Android|Tablet|SM-T\w*|SM-X\w*|Galaxy Tab|Kindle|Silk\//i.test(ua) ||
      /^Android$/i.test(String(nav.userAgentData && nav.userAgentData.platform || ""));
  }

  function isLandscape() {
    if (!isHandheld()) return false;
    var display = global.screen || {};
    var type = String(display.orientation && display.orientation.type || "");
    if (/^landscape/.test(type)) return true;
    if (/^portrait/.test(type)) return false;
    // iOS Safari exposes window.orientation on versions without ScreenOrientation.
    if (typeof global.orientation === "number") return Math.abs(global.orientation) % 180 === 90;
    // Never use innerHeight or the CSS orientation query: the keyboard can make
    // a portrait viewport wider than it is tall without rotating the handheld.
    return Number(display.width) > Number(display.height);
  }

  function isMobileLayout() {
    return isHandheld() && !isLandscape();
  }

  function sync() {
    var phone = isPhone();
    var handheld = isHandheld();
    var landscape = handheld && isLandscape();
    var mobileLayout = handheld && !landscape;
    var desktopFit = syncDesktopViewport(landscape);
    var display = global.screen || {};
    var shortSide = Math.min(Number(display.width) || 0, Number(display.height) || 0);
    // A phone requesting the desktop site can have a >=900px layout viewport.
    // Keep its split view proportional to the physical screen, including when
    // Android reports a desktop UA/mobile=false. An unfolded foldable may have
    // no short side below 600px, so include medium-width handheld viewports too.
    // The 640px touch sidebar otherwise consumes most of a 900-1199px viewport.
    var compactLandscape = desktopFit === null && landscape && (phone || (shortSide > 0 && shortSide < 600) || Number(global.innerWidth) < 1200);
    root.classList.toggle("js-phone-app-v2", mobileLayout);
    root.classList.toggle("js-handheld-landscape-v1", landscape);
    root.classList.toggle("js-compact-handheld-landscape-v1", compactLandscape);
    root.classList.toggle("js-landscape-desktop-fit-v1", !!desktopFit);
    if (landscape) root.setAttribute("data-js-phone-landscape", "true");
    else root.removeAttribute("data-js-phone-landscape");
    var state = String(phone) + ":" + String(handheld) + ":" + String(landscape) + ":" + String(mobileLayout) + ":" + String(desktopFit);
    if (state !== lastState) {
      lastState = state;
      global.dispatchEvent(new CustomEvent("js-phone-device-change", {detail: {phone: phone, landscape: landscape, handheld: handheld, mobileLayout: mobileLayout}}));
    }
    return {phone: phone, landscape: landscape, handheld: handheld, mobileLayout: mobileLayout};
  }

  global.JSPhoneDeviceV1 = {layoutVersion: "2.0.0-desktop-fit", isPhone: isPhone, isHandheld: isHandheld, isLandscape: isLandscape, isMobileLayout: isMobileLayout, sync: sync};
  global.addEventListener("resize", sync);
  global.addEventListener("orientationchange", sync);
  global.addEventListener("pageshow", sync);
  if (global.visualViewport && typeof global.visualViewport.addEventListener === "function") {
    global.visualViewport.addEventListener("resize", sync);
  }
  if (global.screen && global.screen.orientation && typeof global.screen.orientation.addEventListener === "function") {
    global.screen.orientation.addEventListener("change", sync);
  }
  sync();
})(window);

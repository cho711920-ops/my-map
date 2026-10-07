/* Handheld layout opt-in. Viewport width alone never classifies a device. */
(function (global) {
  "use strict";
  var root = document.documentElement;
  var lastState = "";

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
    return /iPad|Android|Tablet|SM-T\w*|SM-X\w*|Galaxy Tab|Kindle|Silk\//i.test(ua);
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
    root.classList.toggle("js-phone-app-v2", mobileLayout);
    root.classList.toggle("js-handheld-landscape-v1", landscape);
    if (landscape) root.setAttribute("data-js-phone-landscape", "true");
    else root.removeAttribute("data-js-phone-landscape");
    var state = String(phone) + ":" + String(handheld) + ":" + String(landscape) + ":" + String(mobileLayout);
    if (state !== lastState) {
      lastState = state;
      global.dispatchEvent(new CustomEvent("js-phone-device-change", {detail: {phone: phone, landscape: landscape, handheld: handheld, mobileLayout: mobileLayout}}));
    }
    return {phone: phone, landscape: landscape, handheld: handheld, mobileLayout: mobileLayout};
  }

  global.JSPhoneDeviceV1 = {isPhone: isPhone, isHandheld: isHandheld, isLandscape: isLandscape, isMobileLayout: isMobileLayout, sync: sync};
  global.addEventListener("resize", sync);
  global.addEventListener("orientationchange", sync);
  global.addEventListener("pageshow", sync);
  if (global.screen && global.screen.orientation && typeof global.screen.orientation.addEventListener === "function") {
    global.screen.orientation.addEventListener("change", sync);
  }
  sync();
})(window);

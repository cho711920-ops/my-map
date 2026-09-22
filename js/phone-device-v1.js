/* Phone-only opt-in. Viewport width alone never classifies a device. */
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
    // resizing and rotation. Unknown/large displays retain the existing UI.
    if (shortSide <= 0 || shortSide >= 600) return false;
    if (/iPad|Tablet|SM-T\w*|SM-X\w*|Galaxy Tab|Kindle|Silk\//i.test(ua)) return false;
    if (/Macintosh|MacIntel/i.test(ua + " " + String(nav.platform || ""))) return false;
    var phoneUA = /iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
    var hints = nav.userAgentData;
    // An explicit non-mobile client hint must not be overridden by viewport or
    // touch capability (touch laptops and tablet desktop mode remain unchanged).
    if (hints && hints.mobile === false) return false;
    var touch = Number(nav.maxTouchPoints) > 0 || !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches);
    return touch && (phoneUA || !!(hints && hints.mobile === true));
  }

  function isLandscape() {
    if (!isPhone()) return false;
    var display = global.screen || {};
    var type = String(display.orientation && display.orientation.type || "");
    if (/^landscape/.test(type)) return true;
    if (/^portrait/.test(type)) return false;
    // iOS Safari exposes window.orientation on versions without ScreenOrientation.
    if (typeof global.orientation === "number") return Math.abs(global.orientation) % 180 === 90;
    // Never use innerHeight or the CSS orientation query: the keyboard can make
    // a portrait viewport wider than it is tall without rotating the phone.
    return Number(display.width) > Number(display.height);
  }

  function sync() {
    var phone = isPhone();
    var landscape = phone && isLandscape();
    root.classList.toggle("js-phone-app-v2", phone);
    if (landscape) root.setAttribute("data-js-phone-landscape", "true");
    else root.removeAttribute("data-js-phone-landscape");
    var state = String(phone) + ":" + String(landscape);
    if (state !== lastState) {
      lastState = state;
      global.dispatchEvent(new CustomEvent("js-phone-device-change", {detail: {phone: phone, landscape: landscape}}));
    }
    return {phone: phone, landscape: landscape};
  }

  global.JSPhoneDeviceV1 = {isPhone: isPhone, isLandscape: isLandscape, sync: sync};
  global.addEventListener("resize", sync);
  global.addEventListener("orientationchange", sync);
  global.addEventListener("pageshow", sync);
  if (global.screen && global.screen.orientation && typeof global.screen.orientation.addEventListener === "function") {
    global.screen.orientation.addEventListener("change", sync);
  }
  sync();
})(window);

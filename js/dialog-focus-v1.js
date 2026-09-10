/* JS부동산 - 공통 대화상자 키보드·포커스 관리 */
(function (global) {
  "use strict";

  var FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function focusableElements(container) {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(function (element) {
      return isRestorable(element);
    });
  }

  function safelyFocus(element) {
    if (!element || typeof element.focus !== "function") return false;
    try {
      element.focus({preventScroll: true});
    } catch (error) {
      element.focus();
    }
    return true;
  }

  function isConnected(element) {
    if (!element) return false;
    if (typeof element.isConnected === "boolean") return element.isConnected;
    return !!(global.document && global.document.documentElement &&
      global.document.documentElement.contains(element));
  }

  function attribute(element, name) {
    return element && typeof element.getAttribute === "function" ? element.getAttribute(name) : null;
  }

  function isRestorable(element) {
    if (!isConnected(element) || element.disabled) return false;
    var current = element;
    var depth = 0;
    while (current && depth < 100) {
      if (current.hidden || current.inert || attribute(current, "hidden") !== null ||
          attribute(current, "inert") !== null || attribute(current, "aria-hidden") === "true") {
        return false;
      }
      if (typeof global.getComputedStyle === "function") {
        try {
          var style = global.getComputedStyle(current);
          if (style && (style.display === "none" || style.visibility === "hidden" ||
              style.visibility === "collapse")) return false;
        } catch (error) {
          /* Detached test doubles and older browsers may not expose computed styles. */
        }
      }
      current = current.parentElement || null;
      depth += 1;
    }
    return true;
  }

  function activate(container, initialFocus, options) {
    if (!container || !global.document) return;
    var requestedReturnFocus = options && options.returnFocus;
    var active = isRestorable(requestedReturnFocus) ? requestedReturnFocus : global.document.activeElement;
    if (!container.__jsReturnFocusV1 && isRestorable(active) && active !== global.document.body &&
        !container.contains(active)) {
      container.__jsReturnFocusV1 = active;
    }
    global.setTimeout(function () {
      if (container.getAttribute("aria-hidden") === "true") return;
      var target = typeof initialFocus === "string" ? container.querySelector(initialFocus) : initialFocus;
      if (!isRestorable(target)) {
        target = focusableElements(container)[0] || container;
      }
      if (target === container && !container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      safelyFocus(target);
    }, 0);
  }

  function deactivate(container, options) {
    if (!container) return;
    var returnFocus = container.__jsReturnFocusV1;
    container.__jsReturnFocusV1 = null;
    if (options && options.restore === false) return;
    global.setTimeout(function () {
      if (isRestorable(returnFocus)) safelyFocus(returnFocus);
    }, 0);
  }

  function trap(container, event) {
    if (!container || !event || event.key !== "Tab") return false;
    var focusable = focusableElements(container);
    if (!focusable.length) {
      event.preventDefault();
      safelyFocus(container);
      return true;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var active = global.document && global.document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      safelyFocus(last);
      return true;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      safelyFocus(first);
      return true;
    }
    return false;
  }

  function handleKeydown(container, event, onEscape) {
    if (!event) return false;
    if (event.key === "Escape" && typeof onEscape === "function") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return true;
    }
    return trap(container, event);
  }

  global.JSDialogFocusV1 = {
    activate: activate,
    deactivate: deactivate,
    trap: trap,
    handleKeydown: handleKeydown,
    focusableElements: focusableElements,
    isRestorable: isRestorable
  };
})(window);

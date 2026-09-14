(function(global) {
  "use strict";
  var PREFIX = "js_customer_draft_v1_", TTL = 12 * 60 * 60 * 1000;
  var account = String(global.JSAuthenticatedAccountEmail || "").trim().toLowerCase();
  var entries = {}, stack = [], locked = false;
  function storageKey(record) { return PREFIX + encodeURIComponent(account) + ":" + encodeURIComponent(record); }
  function accountOK() { return !locked && account && account === String(global.JSAuthenticatedAccountEmail || "").trim().toLowerCase(); }
  function values(entry) {
    var result = {};
    entry.modal.querySelectorAll(entry.selector).forEach(function(input) {
      result[input.id || input.getAttribute("data-customer-field")] = String(input.value || "").slice(0, 20000);
    });
    return result;
  }
  function dirty(entry) { return !!entry && JSON.stringify(values(entry)) !== entry.baseline; }
  function remove(key) { try { global.sessionStorage.removeItem(key); } catch (_) {} }
  function read(key) {
    try {
      var item = JSON.parse(global.sessionStorage.getItem(key) || "null");
      if (!item || item.account !== account || Date.now() - item.at > TTL || item.at > Date.now() || !item.values || typeof item.values !== "object") {
        remove(key); return null;
      }
      return item;
    } catch (_) { return null; }
  }
  function persist(entry) {
    if (!entry || !accountOK()) return false;
    if (!dirty(entry)) { if (!entry.keepPrevious) remove(entry.key); return false; }
    try {
      global.sessionStorage.setItem(entry.key, JSON.stringify({account: account, at: Date.now(), values: values(entry)}));
      return true;
    } catch (_) { return false; }
  }
  function begin(id, record, selector) {
    var modal = global.document.getElementById(id);
    if (!modal || !accountOK()) return;
    var entry = {modal: modal, selector: selector, key: storageKey(record), baseline: ""};
    entry.baseline = JSON.stringify(values(entry));
    entries[id] = entry;
    stack = stack.filter(function(value) { return value !== id; }); stack.push(id);
    var saved = read(entry.key);
    entry.keepPrevious = !!saved;
    if (saved && JSON.stringify(saved.values) !== entry.baseline && global.confirm("이 고객의 미저장 초안이 이 탭에 있습니다. 복원할까요?\n현재 불러온 고객자료와 다를 수 있으며, 복원한 초안은 저장 버튼을 눌러야 반영됩니다.")) {
      modal.querySelectorAll(selector).forEach(function(input) {
        var key = input.id || input.getAttribute("data-customer-field");
        if (Object.prototype.hasOwnProperty.call(saved.values, key)) input.value = String(saved.values[key] || "");
      });
      entry.keepPrevious = false;
    }
    if (!modal._draftSafetyBoundV1) {
      modal._draftSafetyBoundV1 = true;
      var changed = function() { if (entries[id]) entries[id].keepPrevious = false; persist(entries[id]); };
      modal.addEventListener("input", changed);
      modal.addEventListener("change", changed);
    }
    var dialog = modal.querySelector("form, .customer-crm-dialog") || modal;
    dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true");
    var heading = dialog.querySelector("h3[id]");
    if (heading) dialog.setAttribute("aria-labelledby", heading.id);
    if (global.JSDialogFocusV1) global.JSDialogFocusV1.activate(modal, modal.querySelector("input, textarea, button"));
  }
  function canClose(id) {
    var entry = entries[id];
    if (!entry || !dirty(entry)) return true;
    var kept = persist(entry);
    return global.confirm("아직 서버에 저장하지 않은 내용이 있습니다. 닫을까요?\n" +
      (kept ? "초안은 이 계정·이 탭에서 최대 12시간 보관되며, 다시 열면 복원할 수 있습니다." : "이 기기에 초안을 보관하지 못했습니다. 닫으면 입력 내용을 잃을 수 있습니다."));
  }
  function closed(id) {
    stack = stack.filter(function(value) { return value !== id; });
    var entry = entries[id];
    if (entry && global.JSDialogFocusV1) global.JSDialogFocusV1.deactivate(entry.modal);
  }
  function resume(id) {
    if (!entries[id] || !accountOK()) return;
    stack = stack.filter(function(value) { return value !== id; }); stack.push(id);
    if (global.JSDialogFocusV1) global.JSDialogFocusV1.activate(entries[id].modal, entries[id].modal.querySelector("input, textarea, button"));
  }
  function saved(id) {
    var entry = entries[id];
    if (!entry) return;
    remove(entry.key); entry.baseline = JSON.stringify(values(entry));
  }
  function clearAll() {
    Object.keys(entries).forEach(function(id) {
      var entry = entries[id];
      entry.modal.querySelectorAll(entry.selector).forEach(function(input) { input.value = ""; });
      entry.modal.hidden = true;
    });
    try {
      for (var i = global.sessionStorage.length - 1; i >= 0; i--) {
        var key = global.sessionStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) remove(key);
      }
    } catch (_) {}
    entries = {}; stack = []; locked = true;
    if (global.document.body && global.document.body.classList) global.document.body.classList.remove("customer-crm-open");
  }
  function top() {
    return stack.slice().reverse().find(function(id) { var entry = entries[id]; return entry && !entry.modal.hidden; }) || "";
  }
  global.addEventListener("beforeunload", function(event) {
    if (!accountOK()) return;
    var pending = Object.keys(entries).some(function(id) { var entry = entries[id], kept = persist(entry); return dirty(entry) && (!entry.modal.hidden || !kept); });
    if (pending) { event.preventDefault(); event.returnValue = ""; }
  });
  global.addEventListener("pagehide", function() { Object.keys(entries).forEach(function(id) { persist(entries[id]); }); });
  global.JSCustomerDraftSafetyV1 = { begin: begin, canClose: canClose, closed: closed, resume: resume, saved: saved, clearAll: clearAll, top: top };
})(window);

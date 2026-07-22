(function() {
  "use strict";

  var latestAnnouncement = null;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function(character) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character];
    });
  }

  function dismissalKey(notice) {
    return "js_notice_closed_" + text(notice.id) + "_" + text(notice.updatedAt);
  }

  function closeAnnouncement() {
    var modal = document.getElementById("jsAnnouncementModal");
    if (modal) modal.hidden = true;
    if (latestAnnouncement) {
      try { localStorage.setItem(dismissalKey(latestAnnouncement), "1"); } catch (_) {}
    }
  }

  function showAnnouncement(notice, force) {
    if (!notice || !notice.active) return;
    if (!force) {
      try { if (localStorage.getItem(dismissalKey(notice))) return; } catch (_) {}
    }
    latestAnnouncement = notice;
    var modal = document.getElementById("jsAnnouncementModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "jsAnnouncementModal";
      modal.className = "js-announcement-modal";
      document.body.appendChild(modal);
    }
    modal.innerHTML = '<div class="js-announcement-backdrop"></div>' +
      '<section class="js-announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="jsAnnouncementTitle">' +
        '<button type="button" class="js-announcement-close" aria-label="공지 닫기">×</button>' +
        '<span class="js-announcement-label">JS부동산 공지사항</span>' +
        '<h2 id="jsAnnouncementTitle">' + escapeHtml(notice.title || "공지사항") + '</h2>' +
        '<div class="js-announcement-content">' + escapeHtml(notice.content).replace(/\r?\n/g, "<br>") + '</div>' +
        '<button type="button" class="js-announcement-confirm">확인</button>' +
      '</section>';
    modal.hidden = false;
    Array.prototype.forEach.call(modal.querySelectorAll(".js-announcement-close,.js-announcement-confirm,.js-announcement-backdrop"), function(button) {
      button.addEventListener("click", closeAnnouncement);
    });
  }

  function loadAnnouncement() {
    if (typeof saveApiURL !== "string" || !saveApiURL) return;
    var separator = saveApiURL.indexOf("?") >= 0 ? "&" : "?";
    fetch(saveApiURL + separator + "action=announcement&_=" + Date.now(), {cache: "no-store"})
      .then(function(response) { return response.json(); })
      .then(function(result) {
        if (result && result.ok !== false && result.active) showAnnouncement(result, false);
      }).catch(function() {});
  }

  window.closeAnnouncement = closeAnnouncement;
  window.openLatestAnnouncement = function() { if (latestAnnouncement) showAnnouncement(latestAnnouncement, true); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadAnnouncement);
  else loadAnnouncement();
})();

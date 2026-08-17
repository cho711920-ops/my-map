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

  function formatAnnouncementContent(value) {
    return escapeHtml(value)
      .replace(/\r?\n/g, "<br>")
      .replace(/(^| )([1-9][0-9]*)\. ([^:]{2,24}):/g, function(_, prefix, number, heading) {
        return (prefix ? "<br><br>" : "") + '<strong class="js-announcement-step">' + number + ". " + heading + "</strong>:";
      });
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
        '<div class="js-announcement-content">' + formatAnnouncementContent(notice.content) + '</div>' +
        '<button type="button" class="js-announcement-confirm">확인</button>' +
      '</section>';
    modal.hidden = false;
    Array.prototype.forEach.call(modal.querySelectorAll(".js-announcement-close,.js-announcement-confirm,.js-announcement-backdrop"), function(button) {
      button.addEventListener("click", closeAnnouncement);
    });
  }

  function normalizeAnnouncement(result) {
    if (!result || result.ok === false) return null;
    var wrapped = Object.prototype.hasOwnProperty.call(result, "announcement");
    var source = wrapped ? result.announcement : result;
    if (!source) return null;
    var active = source.active;
    if (active == null) active = wrapped;
    active = active === true || active === 1 || text(active).toLowerCase() === "true";
    return Object.assign({}, source, {
      id: text(source.id),
      title: text(source.title),
      content: text(source.content || source.body),
      updatedAt: text(source.updatedAt || source.updated_at),
      active: active
    });
  }

  function readAnnouncement() {
    var access = window.JSDataAccessV6;
    if (access && typeof access.read === "function") {
      return access.read("announcement", {}, {
        cache: "no-store",
        errorMessage: "공지사항을 불러오지 못했습니다."
      });
    }
    if (typeof saveApiURL !== "string" || !saveApiURL) return Promise.resolve(null);
    var separator = saveApiURL.indexOf("?") >= 0 ? "&" : "?";
    return fetch(saveApiURL + separator + "action=announcement&_=" + Date.now(), {
      cache: "no-store",
      credentials: "same-origin"
    }).then(function(response) { return response.json(); });
  }

  function loadAnnouncement() {
    readAnnouncement()
      .then(function(result) {
        var notice = normalizeAnnouncement(result);
        if (notice && notice.active) showAnnouncement(notice, false);
      }).catch(function() {});
  }

  window.closeAnnouncement = closeAnnouncement;
  window.openLatestAnnouncement = function() { if (latestAnnouncement) showAnnouncement(latestAnnouncement, true); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadAnnouncement);
  else loadAnnouncement();
})();

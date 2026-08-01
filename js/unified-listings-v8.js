(function(global) {
  "use strict";

  var API = "/api/apps-script";
  var state = { groups: {}, detailCache: {}, pendingMove: null, loaded: false };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function esc(value) {
    return text(value).replace(/[&<>"']/g, function(character) {
      return {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character];
    });
  }
  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString("ko-KR", {maximumFractionDigits: 2}) : "-";
  }
  function desktop() { return global.innerWidth > 768; }
  function sourcePriority(original) {
    return sourceKey(original && original.source) === "danggeun" ? 0 : 1;
  }
  function orderOriginals(originals) {
    return (originals || []).map(function(original, index) {
      return {original: original, index: index};
    }).sort(function(left, right) {
      return sourcePriority(left.original) - sourcePriority(right.original) || left.index - right.index;
    }).map(function(entry) { return entry.original; });
  }
  function group(propertyId) { return orderOriginals(state.groups[text(propertyId)] || []); }
  function originalImage(original) {
    return text(original && (original.thumbnail || (original.images && original.images[0])));
  }

  function apiGet(action, params) {
    var query = new URLSearchParams(Object.assign({action: action, _: Date.now()}, params || {}));
    return fetch(API + "?" + query.toString(), {credentials: "same-origin", cache: "no-store"})
      .then(function(response) {
        if (!response.ok) throw new Error("운영자료 조회 실패 (HTTP " + response.status + ")");
        return response.json();
      }).then(function(result) {
        if (!result || result.ok === false) throw new Error(result && result.message || "운영자료 조회 실패");
        return result;
      });
  }

  function load(force) {
    if (state.loaded && !force) return Promise.resolve({groups: state.groups});
    return apiGet("unifiedListings").then(function(result) {
      state.groups = result.groups || {};
      state.loaded = true;
      return result;
    }).catch(function(error) {
      console.error("통합매물 원본 조회 실패", error);
      state.groups = {};
      state.loaded = true;
      return {ok: false, groups: {}};
    });
  }

  function attach(items, result) {
    if (result && result.groups) {
      state.groups = result.groups;
      state.loaded = true;
    }
    (items || []).forEach(function(item) {
      var originals = group(item.propertyId);
      item.unifiedOriginalsV8 = originals;
      item.unifiedOriginalCountV8 = originals.length || 1;
      item.thumbnailV8 = originals.length && originals[0].thumbnail || "";
      item.sourceTypesV8 = originals.map(function(original) { return sourceKey(original.source); });
    });
    return items;
  }

  function sourceKey(value) {
    value = text(value).toLowerCase();
    if (/당근|daangn|karrot/.test(value)) return "danggeun";
    if (/네이버|naver/.test(value)) return "naver";
    if (/공실|gongsil/.test(value)) return "gongsil";
    if (/직접/.test(value)) return "direct";
    return "unknown";
  }

  function matchesSource(item, selectedSource) {
    if (!selectedSource) return true;
    var sources = item && item.sourceTypesV8 || [];
    return sources.length ? sources.indexOf(selectedSource) >= 0 : false;
  }

  function cardParts(item) {
    if (!desktop()) return {thumbnail: "", badge: "", sourceButton: ""};
    var originals = group(item && item.propertyId);
    var count = originals.length || 1;
    var thumbnail = originals.length ? text(originals[0].thumbnail) : "";
    var encodedId = encodeURIComponent(text(item && item.propertyId));
    var thumbnailMarkup = '<button type="button" class="unified-thumb-v8 ' +
      (thumbnail ? 'has-photo' : 'no-photo') + '" title="사진 크게 보기" ' +
      'onclick="event.stopPropagation(); JSUnifiedListingsV8.open(\'' + encodedId + '\')">' +
      (thumbnail ? '<img src="' + esc(thumbnail) + '" alt="매물 사진" loading="lazy" referrerpolicy="no-referrer" ' +
        'onerror="JSUnifiedListingsV8.imageError(this, true)">' : '<span>사진 없음</span>') +
      '</button>';
    var badge = count > 1
      ? '<span class="unified-badge-v8">동일매물 ' + count + '개</span>'
      : '';
    var button;
    if (count > 1) {
      button = '<button type="button" class="item-source-link-btn active unified-expand-btn-v8" ' +
        'onclick="event.stopPropagation(); JSUnifiedListingsV8.toggle(\'' + encodedId + '\', this)">' +
        '원본 ' + count + '개 펼치기</button>';
    } else {
      var link = originals.length ? text(originals[0].link) : text(item && item.sourceLink);
      button = link
        ? '<button type="button" class="item-source-link-btn active" onclick="event.stopPropagation(); window.open(\'' +
          esc(link) + '\', \'_blank\', \'noopener,noreferrer\')">링크</button>'
        : '<button type="button" class="item-source-link-btn disabled" disabled>링크</button>';
    }
    return {thumbnail: thumbnailMarkup, badge: badge, sourceButton: button};
  }

  function conditionLine(original) {
    return '<span><b>보</b> ' + number(original.deposit) + ' / <b>월</b> ' + number(original.rent) +
      ' · <b>관</b> ' + number(original.fee) + ' · <b>권</b> ' + number(original.premium) +
      ' · <b>평</b> ' + number(original.area) + '</span>';
  }

  function originalRow(original, selected) {
    var encodedPropertyId = encodeURIComponent(text(original.propertyId));
    var encodedOriginalId = encodeURIComponent(text(original.originalId));
    var thumbnail = originalImage(original);
    return '<button type="button" class="unified-original-row-v8' + (selected ? ' selected' : '') + '" ' +
      'data-original-id="' + esc(original.originalId) + '" onclick="event.stopPropagation(); ' +
      'JSUnifiedListingsV8.open(\'' + encodedPropertyId + '\', \'' + encodedOriginalId + '\')">' +
      '<span class="unified-original-thumb-v8 ' + (thumbnail ? 'has-photo' : 'no-photo') + '">' +
        (thumbnail ? '<img src="' + esc(thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
          'onerror="JSUnifiedListingsV8.imageError(this, false)">' : '') + '</span>' +
      '<span class="unified-original-body-v8"><span class="unified-original-head-v8"><b class="source-' +
        sourceKey(original.source) + '">' + esc(original.source) + '</b><em>' + esc(original.room || '호실 -') + '</em></span>' +
        conditionLine(original) + '<small>' + esc(original.buildingName || original.address) + '</small></span>' +
      '</button>';
  }

  function toggle(encodedPropertyId, button) {
    if (!desktop()) return;
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var card = button && button.closest(".item");
    if (!card) return;
    var existing = card.querySelector(".unified-inline-originals-v8");
    if (existing) {
      existing.remove();
      card.classList.remove("unified-expanded-v8");
      button.textContent = "원본 " + group(propertyId).length + "개 펼치기";
      return;
    }
    var wrapper = document.createElement("div");
    wrapper.className = "unified-inline-originals-v8";
    wrapper.innerHTML = group(propertyId).map(function(original) { return originalRow(original, false); }).join("");
    card.appendChild(wrapper);
    card.classList.add("unified-expanded-v8");
    button.textContent = "원본 닫기";
  }

  function ensureDrawer() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (drawer) return drawer;
    drawer = document.createElement("aside");
    drawer.id = "unifiedDetailDrawerV8";
    drawer.className = "unified-detail-drawer-v8";
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML = '<header><div><strong id="unifiedDetailTitleV8">매물 상세</strong><span id="unifiedDetailSubtitleV8"></span></div>' +
      '<button type="button" aria-label="상세매물보기 닫기">×</button></header>' +
      '<div id="unifiedDetailBodyV8" class="unified-detail-body-v8"></div>';
    drawer.querySelector("header button").onclick = function(event) {
      event.preventDefault();
      event.stopPropagation();
      closeDetail();
    };
    document.body.appendChild(drawer);
    return drawer;
  }

  function positionDrawer(drawer) {
    var sidebar = document.getElementById("sidebar");
    drawer.style.right = (sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 620) + "px";
  }

  function renderDetail(propertyId, originals, selectedOriginalId) {
    originals = orderOriginals(originals);
    var selected = originals.filter(function(original) {
      return text(original.originalId) === text(selectedOriginalId);
    })[0] || originals[0];
    var drawer = ensureDrawer();
    positionDrawer(drawer);
    document.getElementById("unifiedDetailTitleV8").textContent = selected
      ? (selected.buildingName || selected.address || "매물 상세") : "매물 상세";
    document.getElementById("unifiedDetailSubtitleV8").textContent = originals.length > 1
      ? "동일 공간 원본 " + originals.length + "개" : "원본매물 1개";
    var images = selected && selected.images || (selected && selected.thumbnail ? [selected.thumbnail] : []);
    var body = document.getElementById("unifiedDetailBodyV8");
    body.innerHTML = !selected ? '<div class="unified-empty-v8">원본매물 정보가 없습니다.</div>' :
      '<section class="unified-detail-gallery-v8">' +
        (images.length ? '<button type="button" class="unified-detail-hero-v8" ' +
          'onclick="JSUnifiedListingsV8.openDetailGallery(this)">' +
            '<img alt="매물 대표 사진" referrerpolicy="no-referrer" ' +
              'onerror="JSUnifiedListingsV8.detailImageError(this)">' +
            '<span class="unified-detail-photo-count-v8" aria-live="polite"></span>' +
          '</button>' +
          '<button type="button" class="unified-detail-photo-nav-v8 prev" aria-label="이전 사진" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.stepDetailPhoto(this, -1)">‹</button>' +
          '<button type="button" class="unified-detail-photo-nav-v8 next" aria-label="다음 사진" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.stepDetailPhoto(this, 1)">›</button>' :
          '<div class="unified-gallery-empty-v8">등록된 사진 없음</div>') +
      '</section>' +
      '<section class="unified-detail-summary-v8"><div><span class="source-' + sourceKey(selected.source) + '">' +
        esc(selected.source) + '</span><strong>' + esc(selected.address) + ' ' + esc(selected.room) + '</strong></div>' +
        '<p>' + conditionLine(selected) + '</p>' +
        '<div class="unified-detail-actions-v8">' +
          (selected.link ? '<button type="button" onclick="window.open(\'' + esc(selected.link) +
            '\', \'_blank\', \'noopener,noreferrer\')">이 원본 링크 열기</button>' : '') +
          (originals.length > 1 ? '<button type="button" class="separate" onclick="JSUnifiedListingsV8.separate(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">다른 공간으로 분리</button>' : '') +
          '<button type="button" class="move" onclick="JSUnifiedListingsV8.startMove(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">다른 통합매물로 이동</button>' +
        '</div>' +
        (selected.memo ? '<div class="unified-detail-memo-v8">' + esc(selected.memo) + '</div>' : '') +
      '</section>' +
      (originals.length > 1 ? '<section class="unified-detail-originals-v8"><h4>이 공간의 원본매물</h4>' +
        originals.map(function(original) { return originalRow(original, original.originalId === selected.originalId); }).join("") +
      '</section>' : '');
    var detailGallery = body.querySelector(".unified-detail-gallery-v8");
    if (detailGallery && images.length) {
      detailGallery._imagesV8 = images.slice();
      detailGallery._propertyIdV8 = propertyId;
      detailGallery._originalIdV8 = selected.originalId;
      detailGallery._failedImagesV8 = {};
      renderDetailPhoto(detailGallery, 0);
    }
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }

  function renderDetailPhoto(gallery, index) {
    var images = gallery && gallery._imagesV8 || [];
    if (!gallery || !images.length) return;
    var safeIndex = ((Number(index) || 0) % images.length + images.length) % images.length;
    gallery._indexV8 = safeIndex;
    var image = gallery.querySelector(".unified-detail-hero-v8 img");
    if (image) {
      image.style.display = "block";
      image.src = images[safeIndex];
      image.alt = "매물 사진 " + (safeIndex + 1) + " / " + images.length;
    }
    var counter = gallery.querySelector(".unified-detail-photo-count-v8");
    if (counter) counter.textContent = (safeIndex + 1) + " / " + images.length;
    gallery.querySelectorAll(".unified-detail-photo-nav-v8").forEach(function(button) {
      button.hidden = images.length < 2;
    });
  }

  function stepDetailPhoto(button, direction) {
    var gallery = button && button.closest(".unified-detail-gallery-v8");
    if (!gallery) return;
    renderDetailPhoto(gallery, Number(gallery._indexV8 || 0) + Number(direction || 0));
  }

  function openDetailGallery(button) {
    var gallery = button && button.closest(".unified-detail-gallery-v8");
    if (!gallery) return;
    openGallery(encodeURIComponent(text(gallery._propertyIdV8)),
      encodeURIComponent(text(gallery._originalIdV8)), Number(gallery._indexV8 || 0));
  }

  function detailImageError(image) {
    var gallery = image && image.closest(".unified-detail-gallery-v8");
    var images = gallery && gallery._imagesV8 || [];
    if (!gallery || !images.length) return imageError(image, false);
    var failed = gallery._failedImagesV8 || (gallery._failedImagesV8 = {});
    failed[images[Number(gallery._indexV8 || 0)]] = true;
    var nextIndex = -1;
    for (var step = 1; step <= images.length; step += 1) {
      var candidate = (Number(gallery._indexV8 || 0) + step) % images.length;
      if (!failed[images[candidate]]) { nextIndex = candidate; break; }
    }
    if (nextIndex >= 0) return renderDetailPhoto(gallery, nextIndex);
    gallery.innerHTML = '<div class="unified-gallery-empty-v8">사진을 불러오지 못했습니다.</div>';
  }

  function open(encodedPropertyId, encodedOriginalId) {
    if (!desktop()) return;
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var cached = state.detailCache[propertyId];
    if (cached) return renderDetail(propertyId, cached, originalId);
    renderDetail(propertyId, group(propertyId), originalId);
    apiGet("unifiedListingDetail", {propertyId: propertyId}).then(function(result) {
      state.detailCache[propertyId] = result.originals || [];
      renderDetail(propertyId, state.detailCache[propertyId], originalId);
    }).catch(function(error) { console.error(error); });
  }

  function closeDetail() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!drawer) return;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }

  function imageError(image, showLabel) {
    if (!image) return;
    var parent = image.parentElement;
    image.remove();
    if (!parent) return;
    parent.classList.remove("has-photo");
    parent.classList.add("no-photo");
    if (showLabel && !parent.querySelector("span")) parent.insertAdjacentHTML("beforeend", "<span>사진 없음</span>");
  }

  function setSaving(active, failed) {
    var indicator = document.getElementById("asyncMutationStatusV1");
    if (!indicator) return;
    indicator.classList.toggle("working", !!active && !failed);
    indicator.classList.toggle("failed", !!failed);
    indicator.classList.toggle("idle", !active && !failed);
  }

  function move(originalId, targetMasterId, revision) {
    var requestId = "move-original-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    setSaving(true, false);
    return fetch(API, {
      method: "POST", credentials: "same-origin", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({action:"moveOriginalListing", requestId:requestId, originalId:originalId,
        targetMasterId:targetMasterId, expectedRevision:revision})
    }).then(function(response) {
      if (!response.ok) throw new Error("저장 요청 실패 (HTTP " + response.status + ")");
      return response.json();
    }).then(function(result) {
      if (!result || result.ok === false || result.persisted !== true) throw new Error(result && result.message || "시트 저장 확인 실패");
      setSaving(false, false);
      state.loaded = false;
      state.detailCache = {};
      state.pendingMove = null;
      closeDetail();
      return load(true).then(function() {
        if (typeof global.loadSheet === "function") global.loadSheet(true);
        return result;
      });
    }).catch(function(error) {
      setSaving(false, true);
      alert(error.message || "통합매물 변경에 실패했습니다.");
      throw error;
    });
  }

  function separate(encodedOriginalId, revision) {
    var originalId = decodeURIComponent(encodedOriginalId || "");
    if (!confirm("이 원본매물을 별도의 실제 공간으로 분리할까요?")) return;
    move(originalId, "NEW", revision);
  }

  function startMove(encodedOriginalId, revision) {
    state.pendingMove = {originalId: decodeURIComponent(encodedOriginalId || ""), revision: revision};
    closeDetail();
    var banner = ensureMoveBanner();
    banner.hidden = false;
  }

  function ensureMoveBanner() {
    var banner = document.getElementById("unifiedMoveBannerV8");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "unifiedMoveBannerV8";
    banner.className = "unified-move-banner-v8";
    banner.innerHTML = '<strong>이동할 통합매물 카드를 클릭하세요.</strong><button type="button">취소</button>';
    banner.querySelector("button").onclick = function() { state.pendingMove = null; banner.hidden = true; };
    document.body.appendChild(banner);
    return banner;
  }

  function handleCardClick(item, event) {
    if (!desktop() || (event && event.target && event.target.closest("button,input,label,a,textarea,select"))) return false;
    var propertyId = text(item && item.propertyId);
    if (state.pendingMove) {
      var pending = state.pendingMove;
      if (confirm("선택한 원본매물을 이 통합매물로 이동할까요?")) move(pending.originalId, propertyId, pending.revision);
      return true;
    }
    open(encodeURIComponent(propertyId));
    return true;
  }

  function openGallery(encodedPropertyId, encodedOriginalId, startIndex) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var originals = state.detailCache[propertyId] || group(propertyId);
    var original = originals.filter(function(entry) { return entry.originalId === originalId; })[0];
    var images = original && original.images || [];
    if (!images.length && original && original.thumbnail) images = [original.thumbnail];
    if (!images.length) return;
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "unifiedGalleryV8";
      modal.className = "unified-gallery-modal-v8";
      modal.innerHTML = '<button class="close" type="button" aria-label="사진 크게 보기 닫기">×</button>' +
        '<button class="unified-gallery-nav-v8 prev" type="button" aria-label="이전 사진">‹</button>' +
        '<img alt="매물 사진" referrerpolicy="no-referrer">' +
        '<button class="unified-gallery-nav-v8 next" type="button" aria-label="다음 사진">›</button>' +
        '<span></span>';
      modal.querySelector(".close").onclick = function(event) {
        event.stopPropagation();
        closeGallery();
      };
      modal.querySelector(".prev").onclick = function(event) {
        event.stopPropagation();
        stepGallery(-1);
      };
      modal.querySelector(".next").onclick = function(event) {
        event.stopPropagation();
        stepGallery(1);
      };
      modal.onclick = function(event) { if (event.target === modal) closeGallery(); };
      document.body.appendChild(modal);
    }
    var index = Math.max(0, Math.min(Number(startIndex) || 0, images.length - 1));
    modal._imagesV8 = images.slice();
    renderGalleryImage(modal, index);
    modal.classList.add("open");
  }

  function renderGalleryImage(modal, index) {
    var images = modal && modal._imagesV8 || [];
    if (!modal || !images.length) return;
    var safeIndex = Math.max(0, Math.min(Number(index) || 0, images.length - 1));
    modal._indexV8 = safeIndex;
    modal.querySelector("img").src = images[safeIndex];
    modal.querySelector("span").textContent = (safeIndex + 1) + " / " + images.length;
    modal.querySelector(".prev").disabled = safeIndex === 0;
    modal.querySelector(".next").disabled = safeIndex === images.length - 1;
  }

  function stepGallery(direction) {
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal || !modal.classList.contains("open")) return;
    renderGalleryImage(modal, Number(modal._indexV8 || 0) + Number(direction || 0));
  }

  function closeGallery() {
    var modal = document.getElementById("unifiedGalleryV8");
    if (modal) modal.classList.remove("open");
  }

  function openTell() {
    if (!desktop()) return;
    var modal = document.getElementById("tellModalV8");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "tellModalV8";
      modal.className = "tell-modal-v8";
      modal.innerHTML = '<div class="tell-backdrop-v8"></div><section><header><div><strong>Tell 주소 연락처</strong>' +
        '<span>공실박스에서 수집된 번호를 매물 상태와 관계없이 조회합니다.</span></div><button type="button">×</button></header>' +
        '<form><input type="search" placeholder="예: 월평동 1197" autocomplete="off"><button type="submit">검색</button></form>' +
        '<div class="tell-results-v8"><p>주소를 입력해 주세요.</p></div></section>';
      modal.querySelector("header button").onclick = function() { modal.classList.remove("open"); };
      modal.querySelector(".tell-backdrop-v8").onclick = function() { modal.classList.remove("open"); };
      modal.querySelector("form").onsubmit = function(event) {
        event.preventDefault();
        var query = text(modal.querySelector("input").value);
        var results = modal.querySelector(".tell-results-v8");
        if (!query) return;
        results.innerHTML = '<p>조회 중…</p>';
        apiGet("tellContacts", {query: query}).then(function(result) {
          var contacts = result.contacts || [];
          results.innerHTML = contacts.length ? contacts.map(function(contact) {
            return '<a href="tel:' + esc(contact.phone) + '"><span><b>' + esc(contact.address) + ' ' +
              esc(contact.room) + '</b><small>' + esc(contact.buildingName) + ' · ' + esc(contact.role) +
              '</small></span><strong>' + esc(contact.phone) + '</strong></a>';
          }).join("") : '<p>검색되는 연락처가 없습니다.</p>';
        }).catch(function(error) { results.innerHTML = '<p>' + esc(error.message) + '</p>'; });
      };
      document.body.appendChild(modal);
    }
    modal.classList.add("open");
    setTimeout(function() { modal.querySelector("input").focus(); }, 0);
  }

  global.addEventListener("resize", function() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (drawer && drawer.classList.contains("open")) positionDrawer(drawer);
  });

  global.addEventListener("keydown", function(event) {
    var gallery = document.getElementById("unifiedGalleryV8");
    if (gallery && gallery.classList.contains("open")) {
      if (event.key === "ArrowLeft") stepGallery(-1);
      if (event.key === "ArrowRight") stepGallery(1);
      if (event.key === "Escape") closeGallery();
      return;
    }
    var detailDrawer = document.getElementById("unifiedDetailDrawerV8");
    if (detailDrawer && detailDrawer.classList.contains("open") &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      var detailGallery = detailDrawer.querySelector(".unified-detail-gallery-v8");
      if (detailGallery && detailGallery._imagesV8 && detailGallery._imagesV8.length > 1) {
        event.preventDefault();
        renderDetailPhoto(detailGallery, Number(detailGallery._indexV8 || 0) +
          (event.key === "ArrowLeft" ? -1 : 1));
      }
      return;
    }
    if (event.key === "Escape") closeDetail();
  });

  global.JSUnifiedListingsV8 = {
    load: load, attach: attach, cardParts: cardParts, matchesSource: matchesSource,
    toggle: toggle, open: open, close: closeDetail, handleCardClick: handleCardClick,
    openGallery: openGallery, separate: separate, startMove: startMove, openTell: openTell,
    imageError: imageError, renderDetailPhoto: renderDetailPhoto, stepDetailPhoto: stepDetailPhoto,
    openDetailGallery: openDetailGallery, detailImageError: detailImageError
  };
})(window);

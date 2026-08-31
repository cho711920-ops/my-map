(function(global) {
  "use strict";

  var state = { groups: {}, detailCache: {}, detailPending: {}, contactCache: {}, contactPending: {},
    tellCache: {}, tellPending: {}, masterMeta: {}, sourceSearchIds: {}, pendingMove: null,
    loaded: false, openPropertyId: "", openOriginalId: "", detailRequestToken: 0,
    detailWarmupTimer: 0, detailWarmupIds: [], contactWarmupTimer: 0,
    contactWarmupIds: [], tellInputTimer: 0, tellRequestToken: 0,
    photoPreloads: {}, pendingDetailSteps: {} };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function encodedExternalLink(value) {
    return encodeURIComponent(text(value)).replace(/'/g, "%27");
  }
  function esc(value) {
    return text(value).replace(/[&<>"']/g, function(character) {
      return {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character];
    });
  }
  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString("ko-KR", {maximumFractionDigits: 2}) : "-";
  }
  function detailDate(value) {
    var raw = text(value);
    if (!raw) return "";
    return typeof global.formatListRegistrationDate === "function"
      ? text(global.formatListRegistrationDate(raw))
      : raw;
  }
  function desktop() { return global.innerWidth > 768; }
  function sourcePriority(original, hasDaangn) {
    var key = sourceKey(original && original.source);
    var hasPhoto = originalImages(original).length > 0;
    if (hasDaangn) {
      if (key === "danggeun") return hasPhoto ? 0 : 1;
      return hasPhoto ? 2 : 3;
    }
    if (key === "naver" && hasPhoto) return 0;
    if (hasPhoto) return 1;
    if (key === "naver") return 2;
    return 3;
  }
  function orderOriginals(originals) {
    var values = originals || [];
    var hasDaangn = values.some(function(original) {
      return sourceKey(original && original.source) === "danggeun";
    });
    return values.map(function(original, index) {
      return {original: original, index: index};
    }).sort(function(left, right) {
      return sourcePriority(left.original, hasDaangn) - sourcePriority(right.original, hasDaangn) ||
        left.index - right.index;
    }).map(function(entry) { return entry.original; });
  }
  function group(propertyId) { return orderOriginals(state.groups[text(propertyId)] || []); }
  function originalImages(original) {
    var values = [];
    if (original && Array.isArray(original.images)) values = original.images.slice();
    if (original && original.thumbnail && values.indexOf(original.thumbnail) < 0) values.unshift(original.thumbnail);
    values = values.map(text).filter(function(url, index, all) {
      return url && !/\/origin\/profile\//i.test(url) && !/\/avatars\//i.test(url) &&
        !/[?&]service=karrotauth(?:&|$)/i.test(url) &&
        all.indexOf(url) === index;
    });
    if (sourceKey(original && original.source) === "danggeun") {
      var hasInside = values.some(function(url) {
        return /\/realty\/realty\/articles\//i.test(url) && /[?&]t=inside(?:&|$)/i.test(url);
      });
      if (hasInside) values = values.filter(function(url) {
        return !(/\/realty\/realty\/articles\//i.test(url) && /[?&]t=crop(?:&|$)/i.test(url));
      });
    }
    return values;
  }
  function originalImage(original) {
    return text(originalImages(original)[0]);
  }

  /*
   * 상세창 폭보다 훨씬 큰 당근 1440px 원본은 전환할 때마다 수신 시간이 길었습니다.
   * 상세/확대 보기에는 선명도가 충분한 960px 이미지를 사용하고 원본 링크는 그대로 보존합니다.
   */
  function detailDisplayImageUrl(url) {
    var value = text(url);
    if (!value) return "";
    if (/img\.kr\.gcp-karroter\.net/i.test(value)) {
      value = value.replace(/([?&])q=\d+/i, "$1q=88");
      value = value.replace(/([?&])s=\d+x\d+/i, "$1s=960x960");
    }
    try {
      var parsed = new URL(value, global.location && global.location.href || undefined);
      if (parsed.protocol === "https:" && /^(?:img\.kr\.gcp-karroter\.net|landthumb-phinf\.pstatic\.net|dnvefa72aowie\.cloudfront\.net|file1\.gongsilbox\.com)$/i.test(parsed.hostname)) {
        return "/api/listing-image?url=" + encodeURIComponent(parsed.toString());
      }
    } catch (ignore) {}
    return value;
  }

  function preloadDetailImage(url, highPriority) {
    var source = detailDisplayImageUrl(url);
    if (!source) return null;
    if (state.photoPreloads[source]) return null;

    var preload = new Image();
    preload.decoding = "async";
    preload.referrerPolicy = "no-referrer";
    try { preload.fetchPriority = highPriority ? "high" : "low"; } catch (ignore) {}
    /*
     * Image DOM 객체를 전역 캐시에 보관하면 압축된 파일 크기와 별개로
     * 디코딩 비트맵이 수십~수백 MB까지 남을 수 있습니다. 요청 중복만
     * boolean으로 막고 실제 Image 객체는 로드가 끝난 뒤 GC에 맡깁니다.
     */
    state.photoPreloads[source] = true;
    preload.onload = function() {
      delete state.photoPreloads[source];
      preload.onload = null;
      preload.onerror = null;
    };
    preload.onerror = function() {
      delete state.photoPreloads[source];
      preload.onload = null;
      preload.onerror = null;
    };
    preload.src = source;
    return preload;
  }

  function apiGet(action, params) {
    if (!global.JSDataAccessV6 || typeof global.JSDataAccessV6.read !== "function") {
      return Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    }
    return global.JSDataAccessV6.read(action, params, { errorMessage: "운영자료 조회 실패" });
  }

  function needsDetail(originals, originalId) {
    originals = orderOriginals(originals);
    var selected = originals.filter(function(original) {
      return text(original.originalId) === text(originalId);
    })[0] || originals[0];
    if (!selected) return false;
    if (selected.tradeType === "sale" && !selected.saleDetails && !selected.masterFallback) return true;
    var imageCount = originalImages(selected).length;
    var declaredCount = Math.max(0, Number(selected.photoCount) || 0);
    if (!imageCount && !declaredCount) return false;
    return imageCount < Math.max(1, declaredCount);
  }

  function primeDetailImages(originals) {
    if (global.navigator && global.navigator.connection && global.navigator.connection.saveData) return;
    var selected = orderOriginals(originals)[0];
    var images = originalImages(selected);
    if (images.length < 2) return;
    /* 상세를 열기 전 다음 장과 순환 이전 장을 함께 준비합니다. */
    [images[1], images[images.length - 1]].forEach(function(url, index, values) {
      if (url && values.indexOf(url) === index) preloadDetailImage(url, true);
    });
  }

  function wrapPhotoIndexV8141(index, length) {
    var total = Math.max(0, Number(length) || 0);
    if (!total) return 0;
    return ((Number(index) || 0) % total + total) % total;
  }

  function preloadAdjacentDetailImages(images, index) {
    if (!Array.isArray(images) || images.length < 2) return;
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    var candidates = [
      images[(safeIndex + 1) % images.length],
      images[(safeIndex - 1 + images.length) % images.length]
    ];
    candidates.forEach(function(url, candidateIndex) {
      if (url && candidates.indexOf(url) === candidateIndex) preloadDetailImage(url, true);
    });
  }

  function bindPhotoSwipe(element, onStep) {
    if (!element || element._photoSwipeBoundV8 || typeof onStep !== "function") return;
    element._photoSwipeBoundV8 = true;
    var gesture = null;

    function resetGesture(immediate) {
      var image = element.querySelector("img");
      if (image) {
        image.style.transition = immediate ? "none" : "transform 180ms cubic-bezier(.22,.8,.35,1)";
        image.style.transform = "";
        image.style.opacity = "";
        global.setTimeout(function() {
          if (image) image.style.transition = "";
        }, immediate ? 0 : 200);
      }
      element.classList.remove("is-photo-dragging-v8");
      gesture = null;
    }

    element.addEventListener("pointerdown", function(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target && event.target.closest(".unified-detail-photo-nav-v8,.unified-gallery-nav-v8,.close")) return;
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        deltaX: 0,
        horizontal: false,
        captureTarget: event.target
      };
      /* 부모가 포인터를 잡으면 실제 사진 button의 click 대상이 부모로 바뀌므로 누른 요소가 직접 잡습니다. */
      var captureTarget = event.target && typeof event.target.setPointerCapture === "function"
        ? event.target : element;
      gesture.captureTarget = captureTarget;
      if (typeof captureTarget.setPointerCapture === "function") {
        try { captureTarget.setPointerCapture(event.pointerId); } catch (ignore) {}
      }
    });

    element.addEventListener("pointermove", function(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      var deltaX = event.clientX - gesture.startX;
      var deltaY = event.clientY - gesture.startY;
      if (!gesture.horizontal && Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (!gesture.horizontal && Math.abs(deltaY) > Math.abs(deltaX)) {
        resetGesture();
        return;
      }
      gesture.horizontal = true;
      gesture.deltaX = deltaX;
      event.preventDefault();
      element.classList.add("is-photo-dragging-v8");
      var image = element.querySelector("img");
      if (image) {
        image.style.transition = "none";
        image.style.transform = "translate3d(" + Math.round(deltaX * 0.32) + "px,0,0)";
        image.style.opacity = String(Math.max(.68, 1 - Math.abs(deltaX) / 420));
      }
    });

    function finish(event) {
      if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
      var deltaX = gesture.deltaX;
      var changed = gesture.horizontal && Math.abs(deltaX) >= 42;
      if (changed) {
        /* 드래그 직후 브라우저가 만드는 합성 click 한 번만 막고, 다음 실제 클릭은 즉시 허용합니다. */
        element._suppressNextPhotoClickV8140 = true;
        if (element._photoClickReleaseTimerV8140) global.clearTimeout(element._photoClickReleaseTimerV8140);
        element._photoClickReleaseTimerV8140 = global.setTimeout(function() {
          element._suppressNextPhotoClickV8140 = false;
          element._photoClickReleaseTimerV8140 = null;
        }, 180);
        resetGesture(true);
        onStep(deltaX < 0 ? 1 : -1);
        return;
      }
      resetGesture();
    }

    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", resetGesture);
    element.addEventListener("lostpointercapture", function() {
      if (gesture) resetGesture();
    });
    element.addEventListener("click", function(event) {
      if (!element._suppressNextPhotoClickV8140) return;
      element._suppressNextPhotoClickV8140 = false;
      if (element._photoClickReleaseTimerV8140) {
        global.clearTimeout(element._photoClickReleaseTimerV8140);
        element._photoClickReleaseTimerV8140 = null;
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);
    element.addEventListener("dragstart", function(event) { event.preventDefault(); });
  }

  function transitionPhotoV8140(container, direction, commit) {
    var image = container && container.querySelector("img");
    var step = Number(direction || 0) < 0 ? -1 : 1;
    var reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!image || typeof image.animate !== "function" || reduceMotion) {
      commit();
      return;
    }
    var token = Number(container._photoTransitionTokenV8140 || 0) + 1;
    container._photoTransitionTokenV8140 = token;
    if (typeof image.getAnimations === "function") {
      image.getAnimations().forEach(function(animation) { animation.cancel(); });
    }
    image.style.transition = "none";
    image.style.transform = "";
    image.style.opacity = "";
    var outgoing = image.animate([
      {transform: "translate3d(0,0,0)", opacity: 1},
      {transform: "translate3d(" + (-step * 54) + "px,0,0)", opacity: .18}
    ], {duration: 115, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards"});
    Promise.resolve(outgoing.finished).catch(function() {}).then(function() {
      if (container._photoTransitionTokenV8140 !== token) return;
      commit();
      if (typeof image.getAnimations === "function") {
        image.getAnimations().forEach(function(animation) { animation.cancel(); });
      }
      var incoming = image.animate([
        {transform: "translate3d(" + (step * 54) + "px,0,0)", opacity: .18},
        {transform: "translate3d(0,0,0)", opacity: 1}
      ], {duration: 210, easing: "cubic-bezier(.22,.8,.35,1)", fill: "both"});
      Promise.resolve(incoming.finished).catch(function() {}).then(function() {
        if (container._photoTransitionTokenV8140 !== token) return;
        if (typeof image.getAnimations === "function") {
          image.getAnimations().forEach(function(animation) { animation.cancel(); });
        }
        image.style.transform = "";
        image.style.opacity = "";
      });
    });
  }

  function loadDetail(propertyId) {
    propertyId = text(propertyId);
    if (!propertyId) return Promise.resolve([]);
    if (Object.prototype.hasOwnProperty.call(state.detailCache, propertyId)) {
      return Promise.resolve(state.detailCache[propertyId]);
    }
    if (state.detailPending[propertyId]) return state.detailPending[propertyId];
    var request = apiGet("unifiedListingDetail", {propertyId: propertyId}).then(function(result) {
      var originals = orderOriginals(result.originals || []);
      state.detailCache[propertyId] = originals;
      delete state.detailPending[propertyId];
      primeDetailImages(originals);
      return originals;
    }, function(error) {
      delete state.detailPending[propertyId];
      throw error;
    });
    state.detailPending[propertyId] = request;
    return request;
  }

  function prefetch(encodedPropertyId, encodedOriginalId) {
    if (!desktop()) return Promise.resolve([]);
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var originals = group(propertyId);
    if (!needsDetail(originals, originalId)) return Promise.resolve(originals);
    return loadDetail(propertyId).catch(function(error) {
      console.warn("상세 사진 선행 조회 실패", propertyId, error);
      return [];
    });
  }

  function scheduleDetailWarmup(items) {
    if (state.detailWarmupTimer && typeof global.clearTimeout === "function") {
      global.clearTimeout(state.detailWarmupTimer);
    }
    state.detailWarmupTimer = 0;
    state.detailWarmupIds = [];
    /*
     * 초기 목록 진입만으로 상세 8건과 사진 수십 장을 받지 않습니다.
     * 카드 hover/focus/pointerdown과 실제 상세 열기만 loadDetail을 시작합니다.
     */
    return items || [];
  }

  function scheduleContactWarmup(items) {
    var seen = {};
    state.contactWarmupIds = (items || []).filter(function(item) {
      var propertyId = text(item && item.propertyId);
      if (!propertyId || seen[propertyId] || Number(item && item.gongsilContactCountV8) <= 0 ||
          state.contactCache[propertyId] || state.contactPending[propertyId]) return false;
      seen[propertyId] = true;
      return true;
    }).map(function(item) { return text(item.propertyId); }).slice(0, 4);
    if (typeof global.setTimeout !== "function") return;
    if (state.contactWarmupTimer && typeof global.clearTimeout === "function") {
      global.clearTimeout(state.contactWarmupTimer);
    }
    if (!state.contactWarmupIds.length) return;
    state.contactWarmupTimer = global.setTimeout(function() {
      var ids = state.contactWarmupIds.slice();
      var cursor = 0;
      function worker() {
        if (cursor >= ids.length) return;
        var propertyId = ids[cursor++];
        loadContacts(propertyId).catch(function(error) {
          console.warn("연락처 유휴 조회 실패", propertyId, error);
        }).then(worker);
      }
      worker();
      if (ids.length > 1) global.setTimeout(worker, 140);
    }, 450);
  }

  function load(force) {
    if (state.loaded && !force) return Promise.resolve({groups: state.groups});
    return apiGet("unifiedListings").then(function(result) {
      if (result && /^compact-v\d+$/.test(result.format || "") && Array.isArray(result.fields)) {
        var fields = result.fields;
        var expanded = {};
        Object.keys(result.groups || {}).forEach(function(propertyId) {
          expanded[propertyId] = (result.groups[propertyId] || []).map(function(values) {
            var original = {propertyId: propertyId};
            fields.forEach(function(field, index) { original[field] = values[index]; });
            return original;
          });
        });
        result.groups = expanded;
      }
      state.groups = result.groups || {};
      state.sourceSearchIds = result.sourceSearchIds || {};
      state.loaded = true;
      return result;
    }).catch(function(error) {
      console.error("통합매물 원본 조회 실패", error);
      state.groups = {};
      state.sourceSearchIds = {};
      state.loaded = true;
      return {ok: false, groups: {}};
    });
  }

  function attach(items, result) {
    if (result && result.groups) {
      state.groups = result.groups;
      state.sourceSearchIds = result.sourceSearchIds || state.sourceSearchIds || {};
      state.loaded = true;
    }
    (items || []).forEach(function(item) {
      var originals = group(item.propertyId);
      originals.forEach(function(original) {
        if (!original.buildingName) original.buildingName = item.name || "";
        if (!original.address) original.address = item.address || "";
        if (!original.type) original.type = item.type || "";
      });
      var locatedOriginal = originals.filter(function(original) {
        return original.latitude != null && original.latitude !== "" &&
          original.longitude != null && original.longitude !== "" &&
          Number.isFinite(Number(original.latitude)) && Number.isFinite(Number(original.longitude));
      })[0];
      if (locatedOriginal && (item.latitude == null || item.latitude === "" ||
          item.longitude == null || item.longitude === "")) {
        item.latitude = Number(locatedOriginal.latitude);
        item.longitude = Number(locatedOriginal.longitude);
      }
      state.masterMeta[text(item.propertyId)] = {
        regDate: text(item.regDate),
        buildingYear: text(item.buildingYear || item.approvalYear)
      };
      item.unifiedOriginalsV8 = originals;
      item.sourceListingSearchV6579 = (state.sourceSearchIds[text(item.propertyId)] || []).slice();
      item.unifiedOriginalCountV8 = originals.length || 1;
      item.thumbnailV8 = originals.length ? originalImage(originals[0]) : "";
      item.sourceTypesV8 = originals.map(function(original) { return sourceKey(original.source); });
      item.transactionCheckCandidateV8135 = originals.length > 0 && originals.every(function(original) {
        return Boolean(original && original.sourceUnavailable);
      });
      item.transactionCheckMissingCountV8135 = item.transactionCheckCandidateV8135
        ? originals.reduce(function(maximum, original) {
            return Math.max(maximum, Number(original && original.missingCount) || 0);
          }, 0)
        : 0;
      item.gongsilContactCountV8 = originals.reduce(function(total, original) {
        return total + (sourceKey(original.source) === "gongsil" ? Math.max(0, Number(original.contactCount) || 0) : 0);
      }, 0);
    });
    /* 자주 여는 상단 매물 사진은 기존처럼 선조회해 첫 클릭 속도를 유지합니다. */
    scheduleDetailWarmup(items);
    /* 연락처는 사용자가 카드나 전화 버튼을 가리킬 때만 선조회합니다. */
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
    var originals = group(item && item.propertyId);
    var count = originals.length || 1;
    var sourceUnavailable = originals.length > 0 && originals.every(function(original) {
      return Boolean(original && original.sourceUnavailable);
    });
    var thumbnail = originals.length ? originalImage(originals[0]) : "";
    var encodedId = encodeURIComponent(text(item && item.propertyId));
    var thumbnailMarkup = '<button type="button" class="unified-thumb-v8 ' +
      (thumbnail ? 'has-photo' : 'no-photo') + '" title="사진 크게 보기" ' +
      'onpointerenter="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onfocus="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onpointerdown="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onclick="event.stopPropagation(); JSUnifiedListingsV8.open(\'' + encodedId + '\')">' +
      (thumbnail ? '<img src="' + esc(thumbnail) + '" alt="매물 사진" loading="lazy" referrerpolicy="no-referrer" ' +
        'onerror="JSUnifiedListingsV8.imageError(this, true)">' : '<span>사진 없음</span>') +
      (sourceUnavailable
        ? '<em class="transaction-check-ribbon-v8135">광고 미노출<b>확인 필요</b></em>'
        : '') +
      '</button>';
    var badge = sourceUnavailable
      ? '<span class="unified-badge-v8 source-unavailable">광고 미노출 · 확인 필요</span>'
      : count > 1
        ? '<span class="unified-badge-v8">동일매물 ' + count + '개</span>'
        : '';
    var button;
    if (sourceUnavailable) {
      button = '<button type="button" class="item-source-link-btn active transaction-check-button-v8135" ' +
        'title="3회 연속 광고 미노출 · 거래 여부 확인" ' +
        'onclick="event.stopPropagation(); if(window.openTransactionCandidateFromListingV1){' +
          'openTransactionCandidateFromListingV1(\'' + encodedId + '\');}">계약완료</button>';
    } else if (count > 1) {
      button = '<button type="button" class="item-source-link-btn active unified-expand-btn-v8" ' +
        'onclick="event.stopPropagation(); JSUnifiedListingsV8.toggle(\'' + encodedId + '\', this)">' +
        '동일매물 ' + count + '개</button>';
    } else {
      var link = originals.length ? text(originals[0].link) : text(item && item.sourceLink);
      button = link
        ? '<button type="button" class="item-source-link-btn active" onclick="event.stopPropagation(); ' +
          'JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(link) + '\')">링크</button>'
        : '<button type="button" class="item-source-link-btn disabled" disabled>링크</button>';
    }
    return {thumbnail: thumbnailMarkup, badge: badge, sourceButton: button, sourceUnavailable: sourceUnavailable};
  }

  function conditionLine(original) {
    if (text(original && original.tradeType).toLowerCase() === "sale") {
      return '<span class="listing-sale-condition-v1"><b>매매</b> ' + (global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.price(original.salePrice) : number(original.salePrice)) + ' · ' +
        (global.JSListingTradeV1 ? global.JSListingTradeV1.saleAreaHtml(original) : '면적 미확인') + '</span>';
    }
    return '<span><b>보</b> ' + number(original.deposit) + ' / <b>월</b> ' + number(original.rent) +
      ' · <b>관</b> ' + number(original.fee) + ' · <b>권</b> ' + number(original.premium) +
      ' · <b>평</b> ' + number(original.area) + '</span>';
  }

  function openExternalLink(encodedLink) {
    var link = "";
    try {
      link = decodeURIComponent(text(encodedLink));
    } catch (_) {
      return;
    }
    if (!/^https?:\/\//i.test(link)) return;
    var popup = global.open(link, "_blank", "noopener,noreferrer");
    if (popup) popup.opener = null;
  }

  function resolveMasterItem(propertyId) {
    propertyId = text(propertyId);
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    return items.filter(function(item) {
      return text(item && item.propertyId) === propertyId;
    })[0] || null;
  }

  function runDetailAction(action, encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var item = resolveMasterItem(propertyId);
    if (!item) {
      alert("현재 매물목록에서 해당 매물ID를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }
    var encodedKey = encodeURIComponent(text(item.key));
    if (action === "navigation" && typeof global.openKakaoNavigation === "function") {
      global.openKakaoNavigation(encodedKey);
      return;
    }
    if (action === "roadview" && typeof global.openKakaoRoadview === "function") {
      global.openKakaoRoadview(encodedKey);
      return;
    }
    if (action === "register" && typeof global.openBuildingRegisterV640 === "function") {
      global.openBuildingRegisterV640(encodedKey);
      return;
    }
    if (action === "edit" && typeof global.openPropertyEditModalV630 === "function") {
      global.openPropertyEditModalV630(encodeURIComponent("id:" + propertyId));
      return;
    }
    alert("선택한 기능을 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  function originalRow(original, selected) {
    var encodedPropertyId = encodeURIComponent(text(original.propertyId));
    var encodedOriginalId = encodeURIComponent(text(original.originalId));
    var thumbnail = originalImage(original);
    return '<button type="button" class="unified-original-row-v8' + (selected ? ' selected' : '') + '" ' +
      'data-original-id="' + esc(original.originalId) + '" ' +
      'onpointerenter="JSUnifiedListingsV8.prefetch(\'' + encodedPropertyId + '\', \'' + encodedOriginalId + '\')" ' +
      'onfocus="JSUnifiedListingsV8.prefetch(\'' + encodedPropertyId + '\', \'' + encodedOriginalId + '\')" ' +
      'onclick="event.stopPropagation(); ' +
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
      button.textContent = "동일매물 " + group(propertyId).length + "개";
      return;
    }
    var wrapper = document.createElement("div");
    wrapper.className = "unified-inline-originals-v8";
    wrapper.innerHTML = group(propertyId).map(function(original) { return originalRow(original, false); }).join("");
    card.appendChild(wrapper);
    card.classList.add("unified-expanded-v8");
    button.textContent = "동일매물 닫기";
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

  var detailCloseTimerV827 = null;

  function showDetailDrawerV827(drawer) {
    if (!drawer) return;
    if (detailCloseTimerV827) {
      global.clearTimeout(detailCloseTimerV827);
      detailCloseTimerV827 = null;
    }
    drawer.classList.remove("closing-v827");
    drawer.setAttribute("aria-hidden", "false");
    if (drawer.classList.contains("open") || drawer.classList.contains("opening-v827")) return;
    drawer.classList.add("opening-v827");
    void drawer.offsetWidth;
    global.requestAnimationFrame(function() {
      if (!drawer.classList.contains("opening-v827") || !state.openPropertyId) return;
      drawer.classList.add("open");
      drawer.classList.remove("opening-v827");
    });
  }

  function positionDrawer(drawer) {
    var sidebar = document.getElementById("sidebar");
    var toolbar = document.querySelector(".filters");
    drawer.style.right = (sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 620) + "px";
    drawer.style.top = Math.max(0, toolbar ? Math.round(toolbar.getBoundingClientRect().bottom) : 68) + "px";
  }

  function renderDetail(propertyId, originals, selectedOriginalId) {
    originals = orderOriginals(originals);
    var selected = originals.filter(function(original) {
      return text(original.originalId) === text(selectedOriginalId);
    })[0] || originals[0];
    var masterMeta = state.masterMeta[text(propertyId)] || {};
    var registrationDate = detailDate(masterMeta.regDate);
    var drawer = ensureDrawer();
    positionDrawer(drawer);
    document.getElementById("unifiedDetailTitleV8").textContent = selected
      ? (selected.buildingName || selected.address || "매물 상세") : "매물 상세";
    document.getElementById("unifiedDetailSubtitleV8").textContent = originals.length > 1
      ? "동일 공간 원본 " + originals.length + "개" : "원본매물 1개";
    var images = originalImages(selected);
    var photoCount = selected ? Math.max(images.length, Number(selected.photoCount) || 0) : 0;
    var encodedActionPropertyId = encodeURIComponent(text(propertyId));
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
      '<section class="unified-detail-summary-v8"><div class="unified-detail-source-address-v827">' +
        '<div class="unified-detail-source-row-v827"><span class="source-' + sourceKey(selected.source) + '">' +
          esc(selected.source) + '</span>' +
          (selected.link ? '<button type="button" class="unified-detail-source-link-v827" ' +
            'aria-label="선택한 원본 링크 열기" title="' + esc(selected.source) + ' 추출 원본 열기" ' +
            'onclick="JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(selected.link) + '\')">원본 링크 ↗</button>' : '') +
        '</div><strong>' + esc(selected.address) + ' ' + esc(selected.room) + '</strong></div>' +
        '<p>' + conditionLine(selected) + '</p>' +
        (global.JSListingTradeV1 ? global.JSListingTradeV1.saleDetailsHtml(selected) : '') +
        (global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.detailTools(selected, propertyId) : '') +
        '<div class="unified-detail-utility-actions-v8" aria-label="매물 바로가기">' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'navigation\', \'' + encodedActionPropertyId + '\')">내비</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'roadview\', \'' + encodedActionPropertyId + '\')">로드뷰</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'register\', \'' + encodedActionPropertyId + '\')">대장</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'edit\', \'' + encodedActionPropertyId + '\')">수정</button>' +
        '</div>' +
        (registrationDate ? '<div class="unified-detail-meta-v8"><span>등록일</span><b>' + esc(registrationDate) + '</b></div>' : '') +
        '<div class="unified-detail-actions-v8" aria-label="원본매물 정리 작업">' +
          (!selected.masterFallback && originals.length > 1 ? '<button type="button" class="separate" onclick="JSUnifiedListingsV8.separate(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">별도 매물 분리</button>' : '') +
          (!selected.masterFallback ? '<button type="button" class="move" onclick="JSUnifiedListingsV8.startMove(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">원본 1개 합치기</button>' : '') +
          '<button type="button" class="move whole-master" onclick="JSUnifiedListingsV8.startWholeMasterMove(\'' +
            encodedActionPropertyId + '\')">대표 전체 합치기</button>' +
        '</div>' +
        (selected.memo ? '<div class="unified-detail-memo-v8">' + esc(selected.memo) + '</div>' : '') +
      '</section>' +
      (originals.length > 1 ? '<section class="unified-detail-originals-v8"><h4>이 공간의 원본매물</h4>' +
        originals.map(function(original) { return originalRow(original, original.originalId === selected.originalId); }).join("") +
      '</section>' : '');
    var detailGallery = body.querySelector(".unified-detail-gallery-v8");
    if (detailGallery && images.length) {
      detailGallery._imagesV8 = images.slice();
      detailGallery._photoCountV8 = photoCount;
      detailGallery._propertyIdV8 = propertyId;
      detailGallery._originalIdV8 = selected.originalId;
      detailGallery._failedImagesV8 = {};
      bindPhotoSwipe(detailGallery, function(direction) {
        transitionPhotoV8140(detailGallery, direction, function() {
          renderDetailPhoto(detailGallery, Number(detailGallery._indexV8 || 0) + direction);
        });
      });
      renderDetailPhoto(detailGallery, 0);
      var pendingStep = state.pendingDetailSteps[text(propertyId)];
      if (images.length > 1 && Number.isFinite(Number(pendingStep))) {
        delete state.pendingDetailSteps[text(propertyId)];
        renderDetailPhoto(detailGallery, Number(pendingStep));
      }
    }
    showDetailDrawerV827(drawer);
  }

  function renderDetailPhoto(gallery, index) {
    var images = gallery && gallery._imagesV8 || [];
    if (!gallery || !images.length) return;
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    gallery._indexV8 = safeIndex;
    var image = gallery.querySelector(".unified-detail-hero-v8 img");
    if (image) {
      image.style.display = "block";
      /* 대표 썸네일은 이미 목록에서 받은 동일 URL을 써서 중복 다운로드를 피합니다. */
      var displaySource = safeIndex === 0 ? text(images[safeIndex]) : detailDisplayImageUrl(images[safeIndex]);
      try { image.fetchPriority = "high"; } catch (ignore) {}
      if (image.getAttribute("src") !== displaySource) image.src = displaySource;
      image.alt = "매물 사진 " + (safeIndex + 1) + " / " + images.length;
    }
    var counter = gallery.querySelector(".unified-detail-photo-count-v8");
    if (counter) counter.textContent = (safeIndex + 1) + " / " +
      Math.max(images.length, Number(gallery._photoCountV8) || 0);
    var photoCount = Math.max(images.length, Number(gallery._photoCountV8) || 0);
    gallery.querySelectorAll(".unified-detail-photo-nav-v8").forEach(function(button) {
      button.hidden = photoCount < 2;
      button.disabled = photoCount < 2;
    });
    preloadAdjacentDetailImages(images, safeIndex);
  }

  function stepDetailPhoto(button, direction) {
    var gallery = button && button.closest(".unified-detail-gallery-v8");
    if (!gallery) return;
    var images = gallery._imagesV8 || [];
    var photoCount = Math.max(images.length, Number(gallery._photoCountV8) || 0);
    if (images.length < 2 && photoCount > 1) {
      var propertyId = text(gallery._propertyIdV8);
      state.pendingDetailSteps[propertyId] = Number(direction || 0) < 0
        ? Math.max(0, photoCount - 1)
        : 1;
      var counter = gallery.querySelector(".unified-detail-photo-count-v8");
      if (counter) counter.textContent = "다음 사진 불러오는 중…";
      return;
    }
    transitionPhotoV8140(gallery, direction, function() {
      renderDetailPhoto(gallery, Number(gallery._indexV8 || 0) + Number(direction || 0));
    });
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
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var requestToken = ++state.detailRequestToken;
    state.openPropertyId = propertyId;
    var cached = state.detailCache[propertyId];
    if (cached) {
      cached = orderOriginals(cached);
      state.detailCache[propertyId] = cached;
      state.openOriginalId = originalId || text(cached[0] && cached[0].originalId);
      return renderDetail(propertyId, cached, state.openOriginalId);
    }
    var initial = group(propertyId);
    if (!originalId && initial[0]) originalId = text(initial[0].originalId);
    state.openOriginalId = originalId;
    var selected = initial.filter(function(original) {
      return text(original.originalId) === text(originalId);
    })[0] || initial[0];
    renderDetail(propertyId, initial, originalId);
    if (selected && Array.isArray(selected.images) && selected.images.length &&
        selected.images.length >= Math.max(1, Number(selected.photoCount) || 0)) return;
    loadDetail(propertyId).then(function(originals) {
      if (requestToken !== state.detailRequestToken || state.openPropertyId !== propertyId ||
          state.openOriginalId !== originalId) return;
      renderDetail(propertyId, originals, originalId);
    }).catch(function(error) { console.error(error); });
  }

  function loadContacts(propertyId) {
    propertyId = text(propertyId);
    if (!propertyId) return Promise.resolve({ok: true, propertyId: "", contactCount: 0, contacts: []});
    if (Object.prototype.hasOwnProperty.call(state.contactCache, propertyId)) {
      return Promise.resolve(state.contactCache[propertyId]);
    }
    if (state.contactPending[propertyId]) return state.contactPending[propertyId];
    var request = apiGet("unifiedListingContacts", {propertyId: propertyId}).then(function(result) {
      state.contactCache[propertyId] = result;
      delete state.contactPending[propertyId];
      return result;
    }, function(error) {
      delete state.contactPending[propertyId];
      throw error;
    });
    state.contactPending[propertyId] = request;
    return request;
  }

  function getCachedContacts(propertyId) {
    propertyId = text(propertyId);
    return Object.prototype.hasOwnProperty.call(state.contactCache, propertyId)
      ? state.contactCache[propertyId]
      : null;
  }

  function tellCacheKey(query) {
    return text(query).toLowerCase().replace(/\s+/g, " ");
  }

  function getCachedTellContacts(query) {
    var key = tellCacheKey(query);
    var cached = state.tellCache[key];
    if (!cached || Date.now() - cached.at > 300000) {
      if (cached) delete state.tellCache[key];
      return null;
    }
    return cached.result;
  }

  function loadTellContacts(query) {
    query = text(query);
    var key = tellCacheKey(query);
    if (!key) return Promise.resolve({ok: true, query: "", contacts: []});
    var cached = getCachedTellContacts(query);
    if (cached) return Promise.resolve(cached);
    if (state.tellPending[key]) return state.tellPending[key];
    var request = apiGet("tellContacts", {query: query}).then(function(result) {
      state.tellCache[key] = {at: Date.now(), result: result};
      delete state.tellPending[key];
      var keys = Object.keys(state.tellCache);
      if (keys.length > 20) {
        keys.sort(function(left, right) { return state.tellCache[left].at - state.tellCache[right].at; })
          .slice(0, keys.length - 20).forEach(function(oldKey) { delete state.tellCache[oldKey]; });
      }
      return result;
    }, function(error) {
      delete state.tellPending[key];
      throw error;
    });
    state.tellPending[key] = request;
    return request;
  }

  function renderTellResults(results, result) {
    var contacts = result && result.contacts || [];
    results.innerHTML = contacts.length ? contacts.map(function(contact) {
      return '<a href="tel:' + esc(contact.phone) + '"><span><b>' + esc(contact.address) + ' ' +
        esc(contact.room) + '</b><small>' + esc(contact.buildingName) + ' · ' + esc(contact.role) +
        '</small></span><strong>' + esc(contact.phone) + '</strong></a>';
    }).join("") : '<p>검색되는 연락처가 없습니다.</p>';
  }

  function closeDetail() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!drawer) return;
    if (detailCloseTimerV827) global.clearTimeout(detailCloseTimerV827);
    drawer.classList.remove("opening-v827");
    drawer.classList.add("closing-v827");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    detailCloseTimerV827 = global.setTimeout(function() {
      drawer.classList.remove("closing-v827");
      detailCloseTimerV827 = null;
    }, 300);
    state.openPropertyId = "";
    state.openOriginalId = "";
    state.detailRequestToken += 1;
  }

  function closeDetailForOverlay() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (detailCloseTimerV827) {
      global.clearTimeout(detailCloseTimerV827);
      detailCloseTimerV827 = null;
    }
    if (drawer) {
      drawer.classList.remove("open", "opening-v827", "closing-v827");
      drawer.setAttribute("aria-hidden", "true");
    }
    closeGallery();
    state.openPropertyId = "";
    state.openOriginalId = "";
    state.detailRequestToken += 1;
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
    if (global.JSAsyncMutations && typeof global.JSAsyncMutations.setExternalState === "function") {
      global.JSAsyncMutations.setExternalState(!!active, !!failed);
      return;
    }
    var indicator = document.getElementById("asyncMutationStatusV1");
    if (indicator) indicator.className = "async-mutation-status-v1 " +
      (failed ? "failed" : (active ? "working" : "idle"));
  }

  var mergeNoticeTimerV8139 = null;
  function showMergeNoticeV8139(message, stateName, persistent) {
    var notice = document.getElementById("unifiedMergeNoticeV8139");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "unifiedMergeNoticeV8139";
      notice.className = "unified-merge-notice-v8139";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.appendChild(notice);
    }
    if (mergeNoticeTimerV8139) {
      global.clearTimeout(mergeNoticeTimerV8139);
      mergeNoticeTimerV8139 = null;
    }
    notice.className = "unified-merge-notice-v8139 " + text(stateName || "working");
    notice.textContent = text(message);
    notice.hidden = false;
    if (!persistent) {
      mergeNoticeTimerV8139 = global.setTimeout(function() {
        notice.hidden = true;
        mergeNoticeTimerV8139 = null;
      }, 4200);
    }
    return notice;
  }

  function refreshAfterMoveV8139(result, consolidateWholeMaster) {
    return Promise.resolve().then(function() {
      return load(true);
    }).then(function() {
      if (typeof global.loadSheet !== "function") return result;
      return Promise.resolve(global.loadSheet(true)).then(function() { return result; });
    }).then(function() {
      showMergeNoticeV8139(consolidateWholeMaster
        ? "대표매물 통합 완료 · 최신 목록 반영도 끝났습니다."
        : "매물 변경 완료 · 최신 목록 반영도 끝났습니다.", "success", false);
      return result;
    }).catch(function(error) {
      console.warn("[대표매물] 저장 후 목록 동기화 실패", error);
      showMergeNoticeV8139("저장은 완료됐지만 최신 목록 동기화가 지연됩니다. 잠시 후 새로고침해 주세요.", "warning", false);
      return result;
    });
  }

  function removeConsolidatedMasterFromView(sourceMasterId, targetMasterId) {
    sourceMasterId = text(sourceMasterId);
    targetMasterId = text(targetMasterId);
    if (!sourceMasterId || !targetMasterId || sourceMasterId === targetMasterId) return;

    var sourceOriginals = state.groups[sourceMasterId] || [];
    var targetOriginals = state.groups[targetMasterId] || [];
    var seenOriginals = {};
    state.groups[targetMasterId] = targetOriginals.concat(sourceOriginals).filter(function(original) {
      var key = text(original && original.originalId) || [
        text(original && original.source), text(original && original.sourceId)
      ].join(":");
      if (!key || seenOriginals[key]) return false;
      seenOriginals[key] = true;
      if (original) original.propertyId = targetMasterId;
      return true;
    });
    delete state.groups[sourceMasterId];

    ["allItems", "currentItems", "visibleListItems"].forEach(function(name) {
      if (!Array.isArray(global[name])) return;
      global[name] = global[name].filter(function(item) {
        return text(item && item.propertyId) !== sourceMasterId;
      });
    });
    if (text(global.selectedItemKey) || text(global.selectedListCardIdV845)) {
      var selectedStillExists = (global.allItems || []).some(function(item) {
        if (text(global.selectedListCardIdV845) && typeof global.getLinkedSelectionCardIdV845 === "function") {
          return text(global.getLinkedSelectionCardIdV845(item)) === text(global.selectedListCardIdV845);
        }
        return text(item && item.key) === text(global.selectedItemKey);
      });
      if (!selectedStillExists) {
        if (typeof global.clearLinkedListingSelectionV845 === "function") {
          global.clearLinkedListingSelectionV845();
        } else {
          global.selectedItemKey = null;
          global.selectedListCardIdV845 = null;
        }
      }
    }
    attach(global.allItems || [], {groups: state.groups});
    if (typeof global.applyFilter === "function") global.applyFilter();
  }

  function move(originalId, targetMasterId, revision, sourceMasterId) {
    var requestId = "move-original-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    var consolidateWholeMaster = text(sourceMasterId) && targetMasterId !== "NEW";
    setSaving(true, false);
    var action = consolidateWholeMaster ? "consolidateExistingMasters" : "moveOriginalListing";
    var payload = consolidateWholeMaster
      ? {requestId:requestId, primaryMasterId:targetMasterId, duplicateMasterIds:[sourceMasterId]}
      : {requestId:requestId, originalId:originalId, targetMasterId:targetMasterId, expectedRevision:revision};
    var request = global.JSDataAccessV6 && typeof global.JSDataAccessV6.mutate === "function"
      ? global.JSDataAccessV6.mutate(action, payload, { errorMessage: "저장 요청 실패" })
      : Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    return request.then(function(result) {
      var persisted = consolidateWholeMaster
        ? Number(result && result.consolidated || 0) > 0
        : result && result.persisted === true;
      if (!result || result.ok === false || !persisted) throw new Error(result && result.message || "D1 저장 확인 실패");
      setSaving(false, false);
      if (consolidateWholeMaster) removeConsolidatedMasterFromView(sourceMasterId, targetMasterId);
      state.loaded = false;
      state.detailCache = {};
      state.pendingMove = null;
      setMoveBannerSaving(false);
      var moveBanner = document.getElementById("unifiedMoveBannerV8");
      if (moveBanner) moveBanner.hidden = true;
      closeDetail();
      showMergeNoticeV8139(result && result.separated
        ? "별도 매물 분리 완료 · 최신 목록을 동기화하고 있습니다."
        : (consolidateWholeMaster
          ? "대표매물 통합 완료 · 이전 카드를 제거했고 최신 목록을 동기화하고 있습니다."
          : "원본매물 이동 완료 · 최신 목록을 동기화하고 있습니다."), "success syncing", true);
      /*
       * 서버가 저장과 캐시 무효화를 확인한 순간 사용자에게 완료를 알린다.
       * 전체 통합정보와 전체 CSV 재조회는 수 초 걸릴 수 있으므로 안내를
       * 지연시키지 않고 백그라운드에서 이어 간다.
       */
      refreshAfterMoveV8139(result, consolidateWholeMaster);
      return result;
    }).catch(function(error) {
      setSaving(false, true);
      setMoveBannerSaving(false);
      showMergeNoticeV8139(error.message || "통합매물 변경에 실패했습니다.", "failed", false);
      throw error;
    });
  }

  function separate(encodedOriginalId, revision) {
    var originalId = decodeURIComponent(encodedOriginalId || "");
    if (!confirm("이 원본매물을 별도의 실제 공간으로 분리할까요?")) return;
    move(originalId, "NEW", revision);
  }

  function startMove(encodedOriginalId, revision) {
    if (!confirm("현재 상세창의 원본매물 1개만 다른 대표매물에 합치시겠습니까?\n\n같은 묶음의 나머지 원본매물은 그대로 유지됩니다.")) return;
    state.pendingMove = {mode: "original", originalId: decodeURIComponent(encodedOriginalId || ""), revision: revision,
      sourcePropertyId: text(state.openPropertyId)};
    closeDetail();
    var banner = ensureMoveBanner();
    setMoveBannerSaving(false);
    banner.hidden = false;
  }

  function startWholeMasterMove(encodedPropertyId) {
    var sourcePropertyId = decodeURIComponent(encodedPropertyId || "") || text(state.openPropertyId);
    if (!sourcePropertyId) return;
    if (!confirm("현재 대표매물 전체를 다른 대표매물에 합치시겠습니까?\n\n현재 매물의 모든 원본·사진·연결정보가 이동하고 현재 대표카드는 제거됩니다. 대상 매물의 대표정보와 임대조건은 그대로 유지됩니다.")) return;
    state.pendingMove = {mode: "whole", sourcePropertyId: sourcePropertyId};
    closeDetail();
    var banner = ensureMoveBanner();
    setMoveBannerSaving(false);
    banner.hidden = false;
  }

  function setMoveBannerSaving(saving) {
    var banner = document.getElementById("unifiedMoveBannerV8");
    if (!banner) return;
    var message = banner.querySelector("strong");
    var cancel = banner.querySelector("button");
    banner.classList.toggle("saving", !!saving);
    if (message) message.textContent = saving
      ? "통합 저장·D1 확인 중입니다."
      : (state.pendingMove && state.pendingMove.mode === "whole"
        ? "전체를 합칠 대상 대표매물 카드 또는 체크박스를 클릭하세요."
        : "원본 1개를 합칠 대상 매물 카드 또는 체크박스를 클릭하세요.");
    if (cancel) cancel.disabled = !!saving;
  }

  function ensureMoveBanner() {
    var banner = document.getElementById("unifiedMoveBannerV8");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "unifiedMoveBannerV8";
    banner.className = "unified-move-banner-v8";
    banner.innerHTML = '<strong>이동할 통합매물 카드 또는 체크박스를 클릭하세요.</strong><button type="button">취소</button>';
    banner.querySelector("button").onclick = function() { state.pendingMove = null; banner.hidden = true; };
    document.body.appendChild(banner);
    return banner;
  }

  function handleCardClick(item, event) {
    var propertyId = text(item && item.propertyId);
    if (state.pendingMove) {
      var pending = state.pendingMove;
      if (!propertyId) return false;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (pending.sourcePropertyId && pending.sourcePropertyId === propertyId) {
        alert("이미 이 통합매물에 연결된 원본입니다. 다른 통합매물을 선택해 주세요.");
        return true;
      }
      var wholeMaster = pending.mode === "whole";
      var confirmed = wholeMaster
        ? confirm("선택한 매물을 대표로 유지하고 현재 대표매물 전체를 합칠까요?\n\n현재 대표카드는 제거되며 이 작업은 화면에서 되돌릴 수 없습니다.")
        : confirm("선택한 원본매물 1개만 이 매물에 합칠까요?\n\n기존 묶음의 나머지 원본매물은 이동하지 않습니다.");
      if (confirmed) {
        setMoveBannerSaving(true);
        if (wholeMaster) move("", propertyId, 1, pending.sourcePropertyId);
        else move(pending.originalId, propertyId, pending.revision);
      }
      return true;
    }
    if (event && event.target && event.target.closest("button,input,label,a,textarea,select")) return false;
    if (typeof global.selectListingOnMapV844 === "function") {
      global.selectListingOnMapV844(item);
    }
    open(encodeURIComponent(propertyId));
    return true;
  }

  function openGallery(encodedPropertyId, encodedOriginalId, startIndex) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var originals = state.detailCache[propertyId] || group(propertyId);
    var original = originals.filter(function(entry) { return entry.originalId === originalId; })[0];
    var images = originalImages(original);
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
      modal.onclick = function(event) {
        if (event.target === modal) closeGallery();
      };
      document.body.appendChild(modal);
    }
    var index = wrapPhotoIndexV8141(startIndex, images.length);
    modal._imagesV8 = images.slice();
    bindPhotoSwipe(modal, function(direction) { stepGallery(direction); });
    renderGalleryImage(modal, index);
    modal.classList.add("open");
  }

  function renderGalleryImage(modal, index) {
    var images = modal && modal._imagesV8 || [];
    if (!modal || !images.length) return;
    var safeIndex = wrapPhotoIndexV8141(index, images.length);
    modal._indexV8 = safeIndex;
    var displaySource = safeIndex === 0 ? text(images[safeIndex]) : detailDisplayImageUrl(images[safeIndex]);
    var modalImage = modal.querySelector("img");
    try { modalImage.fetchPriority = "high"; } catch (ignore) {}
    if (modalImage.getAttribute("src") !== displaySource) modalImage.src = displaySource;
    modal.querySelector("span").textContent = (safeIndex + 1) + " / " + images.length;
    modal.querySelector(".prev").disabled = images.length < 2;
    modal.querySelector(".next").disabled = images.length < 2;
    preloadAdjacentDetailImages(images, safeIndex);
  }

  function stepGallery(direction) {
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal || !modal.classList.contains("open")) return;
    transitionPhotoV8140(modal, direction, function() {
      renderGalleryImage(modal, Number(modal._indexV8 || 0) + Number(direction || 0));
    });
  }

  function closeGallery() {
    var modal = document.getElementById("unifiedGalleryV8");
    if (modal) modal.classList.remove("open");
  }

  function openTell() {
    if (!desktop()) return;
    closeDetailForOverlay();
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
      modal.querySelector("input").oninput = function() {
        var query = text(this.value);
        if (state.tellInputTimer && typeof global.clearTimeout === "function") {
          global.clearTimeout(state.tellInputTimer);
        }
        if (query.length < 2 || typeof global.setTimeout !== "function") return;
        state.tellInputTimer = global.setTimeout(function() {
          loadTellContacts(query).catch(function() {});
        }, 320);
      };
      modal.querySelector("form").onsubmit = function(event) {
        event.preventDefault();
        var query = text(modal.querySelector("input").value);
        var results = modal.querySelector(".tell-results-v8");
        if (!query) return;
        var cached = getCachedTellContacts(query);
        var requestToken = ++state.tellRequestToken;
        if (cached) renderTellResults(results, cached);
        else results.innerHTML = '<p>조회 중…</p>';
        loadTellContacts(query).then(function(result) {
          if (requestToken !== state.tellRequestToken || text(modal.querySelector("input").value) !== query) return;
          renderTellResults(results, result);
        }).catch(function(error) {
          if (requestToken === state.tellRequestToken) results.innerHTML = '<p>' + esc(error.message) + '</p>';
        });
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

  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("click", function(event) {
    var button = event.target && event.target.closest
      ? event.target.closest("button, [role='button']") : null;
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!button || !drawer || drawer.contains(button) ||
        (!drawer.classList.contains("open") && !drawer.classList.contains("opening-v827"))) return;
    var action = text(button.getAttribute("onclick"));
    var opensOtherMenu = /(?:openOperationsCenter|openListManager|openQuickAddModal|startAiVisitPreview|JSUnifiedListingsV8\.openTell|toggleDetailFilter|toggleV6ActionMenu|toggleSortDropdown)/.test(action) ||
      button.matches("[data-mobile-view='customers'], [data-mobile-action='quick-add'], [data-mobile-action='favorites'], [data-mobile-action='dashboard'], [data-mobile-action='filter']");
    if (opensOtherMenu) {
      closeDetailForOverlay();
      /*
       * 상세 매물과 함께 열린 AI 브리핑 패널도 다른 전역 메뉴보다
       * 위에 남지 않게 함께 닫습니다. 매물/클러스터 선택 자체는
       * closeAiSidePanel()에서 보존하므로 지도 상태에는 영향을 주지 않습니다.
       */
      if (typeof global.closeAiSidePanel === "function") {
        global.closeAiSidePanel();
      }
    }
  }, true);

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
    toggle: toggle, open: open, prefetch: prefetch, close: closeDetail,
    closeForOverlay: closeDetailForOverlay, handleCardClick: handleCardClick,
    openGallery: openGallery, separate: separate, startMove: startMove,
    startWholeMasterMove: startWholeMasterMove, openTell: openTell,
    loadContacts: loadContacts, getCachedContacts: getCachedContacts,
    imageError: imageError, renderDetailPhoto: renderDetailPhoto, stepDetailPhoto: stepDetailPhoto,
    openDetailGallery: openDetailGallery, detailImageError: detailImageError,
    runDetailAction: runDetailAction, openExternalLink: openExternalLink
  };
})(window);

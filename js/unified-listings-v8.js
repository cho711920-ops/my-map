(function(global) {
  "use strict";

  var DETAIL_CACHE_TTL = 5 * 60 * 1000;
  var DETAIL_RETRY_DELAY = 30 * 1000;
  var state = { groups: {}, detailCache: {}, detailCachedAt: {}, detailRetryAt: {}, detailGeneration: 0,
    detailPending: {}, detailPendingForced: {}, contactCache: {}, contactPending: {},
    tellCache: {}, tellPending: {}, masterMeta: {}, sourceSearchIds: {}, pendingMove: null,
    loaded: false, originalLoadPhase: "pending", loadPending: null, loadGeneration: 0, snapshotRevision: "", detailPropertyGeneration: {},
    openPropertyId: "", openOriginalId: "", openOriginalIdentity: "", detailRequestToken: 0,
    detailWarmupTimer: 0, detailWarmupIds: [], contactWarmupTimer: 0,
    contactWarmupIds: [], tellInputTimer: 0, tellRequestToken: 0,
    photoPreloads: {}, pendingDetailSteps: {}, detailPhotoRetryCount: 0,
    detailStatus: {}, detailRefreshRetries: {},
    masterItemsArray: null, masterItemsById: Object.create(null),
    metadataCoverage: Object.create(null), sourceSnapshotProofKeys: Object.create(null),
    pendingProofIds: Object.create(null), pendingProofCount: 0, lastPendingProofCount: 0,
    displayItemsArray: null, displayItemsById: Object.create(null) };

  function text(value) { return String(value == null ? "" : value).trim(); }
  function isPhoneDetailV2() {
    var device = global.JSPhoneDeviceV1;
    return !!(device && (typeof device.isMobileLayout === "function" ? device.isMobileLayout() :
      typeof device.isPhone === "function" && device.isPhone()));
  }
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
  function isSourceUnavailable(original) {
    if (original && (original.active === 1 || original.active === "1")) return false;
    return !!(original && (original.sourceUnavailable === true || original.sourceUnavailable === 1 ||
      original.sourceUnavailable === "true" || original.active === 0 || original.active === "0"));
  }
  function isCandidateOriginal(original) {
    return isSourceUnavailable(original) && /^(?:legacy_candidate|census_missing)$/.test(text(original && original.availabilityKind)) && !!(original &&
      (original.candidateEligible === true || original.candidateEligible === 1 || original.candidateEligible === "true"));
  }
  function absenceConfirmationTime(original) {
    if (!isCandidateOriginal(original) || text(original.availabilityKind) !== "census_missing") return 0;
    var raw = text(original.absenceConfirmedAt);
    // Only the server-validated census timestamp is an absence confirmation.
    // Provider end dates, ordinary updates and legacy flags cannot stand in for it.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return 0;
    var parsed = Date.parse(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function absenceConfirmationDate(original) {
    var timestamp = absenceConfirmationTime(original);
    if (!timestamp) return "";
    // Explicit KST conversion keeps the displayed day stable on overseas devices.
    var date = new Date(timestamp + 9 * 60 * 60 * 1000);
    return String(date.getUTCFullYear()).slice(-2) + "." +
      String(date.getUTCMonth() + 1).padStart(2, "0") + "." + String(date.getUTCDate()).padStart(2, "0");
  }
  function detailDateMetadata(masterMeta, selected) {
    var registrationDate = detailDate(masterMeta && masterMeta.regDate);
    var candidate = isCandidateOriginal(selected);
    if (!registrationDate && !candidate) return "";
    return '<div class="unified-detail-meta-v8">' +
      (registrationDate ? '<span class="unified-detail-date-v1"><span>등록일</span><b>' + esc(registrationDate) + '</b></span>' : '') +
      (candidate ? '<span class="unified-detail-date-v1 absence-confirmed-date-v1"><span>미노출 확인일</span><b>' +
        esc(absenceConfirmationDate(selected) || "미확인") + '</b></span>' : '') + '</div>';
  }
  function publicOriginals(originals) {
    return (originals || []).filter(function(original) {
      return !isSourceUnavailable(original) || isCandidateOriginal(original);
    });
  }
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
      return Number(isSourceUnavailable(left.original)) - Number(isSourceUnavailable(right.original)) ||
        sourcePriority(left.original, hasDaangn) - sourcePriority(right.original, hasDaangn) ||
        left.index - right.index;
    }).map(function(entry) { return entry.original; });
  }
  function allOriginals(propertyId) { return orderOriginals(state.groups[text(propertyId)] || []); }
  function originalMetadataReady(propertyId) {
    var id = text(propertyId);
    return Object.prototype.hasOwnProperty.call(state.groups, id) || !!state.metadataCoverage[id];
  }
  function getOriginalMetadataStatus(propertyId) {
    var id = text(propertyId);
    var ready = id ? originalMetadataReady(id) : state.loaded;
    var phase = state.originalLoadPhase;
    if (phase === "ready" && !ready) phase = "stale";
    return {status: phase, ready: ready, hasKnownData: ready, pendingCount: state.pendingProofCount,
      retryable: phase === "error" || phase === "stale"};
  }
  function setOriginalLoadPhase(phase) {
    var pendingCount = state.pendingProofCount;
    if (state.originalLoadPhase === phase && state.lastPendingProofCount === pendingCount) return;
    state.originalLoadPhase = phase;
    state.lastPendingProofCount = pendingCount;
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new global.CustomEvent("js-original-metadata-status", {detail: getOriginalMetadataStatus()}));
    }
  }
  function missingOriginalLabel(propertyId) {
    var metadata = getOriginalMetadataStatus(propertyId);
    return metadata.status === "error" ? "사진 불러오기 실패" : metadata.status === "stale" ? "사진 불러오기 지연" : "사진 불러오는 중";
  }
  function sourceIdentity(original) {
    if (!original) return "";
    var provider = sourceKey(original.source);
    var id = text(original.providerSourceId || original.sourceListingId || original.sourceId)
      .replace(/::(?:lease|sale)$/, "").replace(/^네이버-/i, "");
    return id && /^(?:naver|danggeun|gongsil)$/.test(provider)
      ? provider + ":" + (text(original.tradeType) || "lease") + ":" + id : "";
  }
  function visibleOriginalsFrom(originals, propertyId, masterItem, alreadyOrdered) {
    var values = alreadyOrdered ? originals : orderOriginals(originals || []);
    if (global.doneOnly) {
      var master = masterItem || resolveMasterItem(propertyId);
      return master && text(master.state) === "계약완료" ? publicOriginals(values) : values.filter(isCandidateOriginal);
    }
    return global.hideDone !== false ? values.filter(function(original) { return !isSourceUnavailable(original); }) : publicOriginals(values);
  }
  function group(propertyId) { return visibleOriginalsFrom(allOriginals(propertyId), propertyId, null, true); }

  function displayedOriginalProjection(propertyId) {
    var items = Array.isArray(global.currentItems) ? global.currentItems : [];
    if (state.displayItemsArray !== items) {
      state.displayItemsArray = items;
      state.displayItemsById = Object.create(null);
      items.forEach(function(item) { state.displayItemsById[text(item.propertyId)] = item; });
    }
    var displayed = state.displayItemsById[text(propertyId)];
    return displayed && Array.isArray(displayed.unifiedDisplayOriginalsV2)
      ? displayed.unifiedDisplayOriginalsV2 : null;
  }

  function displayedOriginals(propertyId) {
    return displayedOriginalProjection(propertyId) || group(propertyId);
  }

  function detailOriginals(originals, propertyId) {
    var visible = visibleOriginalsFrom(originals, propertyId);
    var projection = displayedOriginalProjection(propertyId);
    // Direct/manual listings can obtain their first original only from detail.
    // Without a rendered subset, keep the valid detail instead of deleting it.
    if (!projection || !projection.length) return visible;
    if (global.doneOnly) {
      var byId = Object.create(null), byIdentity = Object.create(null);
      visible.forEach(function(original) {
        byId[text(original.originalId)] = original;
        var identity = sourceIdentity(original);
        if (identity) byIdentity[identity] = Object.prototype.hasOwnProperty.call(byIdentity, identity) ? null : original;
      });
      return projection.map(function(original) {
        return byId[text(original.originalId)] || byIdentity[sourceIdentity(original)];
      }).filter(Boolean);
    }
    var allowed = new Set(projection.map(function(original) { return text(original.originalId); }));
    var identities = new Set(projection.map(sourceIdentity).filter(Boolean));
    return visible.filter(function(original) {
      return allowed.has(text(original.originalId)) || !!sourceIdentity(original) && identities.has(sourceIdentity(original));
    });
  }
  function originalRoomLabel(original) {
    return typeof global.formatListingRoomForCardV653 === "function"
      ? global.formatListingRoomForCardV653(original && original.room, original && original.floor)
      : text(original && original.room);
  }
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

  function thumbnailProxyUrl(url) {
    try {
      var parsed = new URL(text(url));
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port &&
          /^(?:img\.kr\.gcp-karroter\.net|landthumb-phinf\.pstatic\.net|dnvefa72aowie\.cloudfront\.net|file1\.gongsilbox\.com)$/i.test(parsed.hostname)) {
        return "/api/listing-image?url=" + encodeURIComponent(parsed.toString());
      }
    } catch (ignore) {}
    return "";
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

  function apiGet(action, params, force) {
    if (!global.JSDataAccessV6 || typeof global.JSDataAccessV6.read !== "function") {
      return Promise.reject(new Error("공통 데이터 연결이 준비되지 않았습니다."));
    }
    var options = { errorMessage: "운영자료 조회 실패" };
    if (force) {
      options.cache = "reload";
      options.headers = {"X-JS-Force-Refresh": "1"};
    }
    return global.JSDataAccessV6.read(action, params, options).catch(function(error) {
      if (global.JSLocalMetricsV1) global.JSLocalMetricsV1.error("read");
      throw error;
    });
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

  function detailIsFresh(propertyId) {
    return Object.prototype.hasOwnProperty.call(state.detailCache, propertyId) &&
      Number.isFinite(state.detailCachedAt[propertyId]) &&
      Date.now() - state.detailCachedAt[propertyId] >= 0 &&
      Date.now() - state.detailCachedAt[propertyId] < DETAIL_CACHE_TTL;
  }

  function invalidateDetails() {
    state.detailGeneration += 1;
    state.detailRequestToken += 1;
    state.detailCache = {};
    state.detailCachedAt = {};
    state.detailRetryAt = {};
    state.detailPending = {};
    state.detailPendingForced = {};
    state.detailStatus = {};
    state.detailRefreshRetries = {};
  }

  function loadDetail(propertyId, force) {
    propertyId = text(propertyId);
    if (!propertyId) return Promise.resolve([]);
    if (!force && detailIsFresh(propertyId)) {
      return Promise.resolve(state.detailCache[propertyId]);
    }
    if (state.detailPending[propertyId]) {
      if (!force || state.detailPendingForced[propertyId]) return state.detailPending[propertyId];
      // A normal hover prefetch may still be using R2. Its promise is not a
      // cache-bypassing verification, so wait and send one actual forced read.
      return state.detailPending[propertyId].catch(function() {}).then(function() { return loadDetail(propertyId, true); });
    }
    if (!force && state.detailCache[propertyId] && Date.now() < Number(state.detailRetryAt[propertyId] || 0)) {
      return Promise.resolve(state.detailCache[propertyId]);
    }
    var generation = state.detailGeneration;
    var propertyGeneration = Number(state.detailPropertyGeneration[propertyId]) || 0;
    var request = apiGet("unifiedListingDetail", {propertyId: propertyId}, force).then(function(result) {
      if (!result || result.ok === false || !Array.isArray(result.originals)) {
        throw new Error(result && result.message || "매물 상세 응답을 확인하지 못했습니다.");
      }
      var originals = orderOriginals(result.originals || []);
      if (generation !== state.detailGeneration || propertyGeneration !== (Number(state.detailPropertyGeneration[propertyId]) || 0)) return originals;
      if (originals.length) {
        state.detailCache[propertyId] = originals;
        state.detailCachedAt[propertyId] = Date.now();
      } else {
        // An empty response does not prove that a CSV card has no sources.
        // Do not turn a transient mismatch into a five-minute empty cache.
        delete state.detailCache[propertyId];
        delete state.detailCachedAt[propertyId];
      }
      delete state.detailRetryAt[propertyId];
      if (state.detailPending[propertyId] === request) {
        delete state.detailPending[propertyId];
        delete state.detailPendingForced[propertyId];
      }
      primeDetailImages(visibleOriginalsFrom(originals, propertyId));
      return originals;
    }).catch(function(error) {
      if (generation === state.detailGeneration && propertyGeneration === (Number(state.detailPropertyGeneration[propertyId]) || 0)) {
        state.detailRetryAt[propertyId] = Date.now() + DETAIL_RETRY_DELAY;
      }
      if (state.detailPending[propertyId] === request) {
        delete state.detailPending[propertyId];
        delete state.detailPendingForced[propertyId];
      }
      throw error;
    });
    state.detailPending[propertyId] = request;
    state.detailPendingForced[propertyId] = !!force;
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

  function placeOriginalLoadStatus(banner) {
    var chips = document.getElementById("activeFilterChipsV844");
    var list = document.getElementById("list");
    var status = document.getElementById("status");
    var anchor = chips && chips.parentNode ? chips : list && list.parentNode ? list : status;
    if (!anchor || !anchor.parentNode) return false;
    var next = anchor === list ? list : anchor.nextSibling;
    if (banner && next !== banner) anchor.parentNode.insertBefore(banner, next);
    return true;
  }

  function originalLoadStatus(failed, explanation) {
    if (typeof document === "undefined") return;
    var banner = document.getElementById("unifiedOriginalLoadStatusV1");
    if (!failed) { if (banner) banner.remove(); return; }
    if (banner) {
      var existingMessage = banner.querySelector("span");
      if (existingMessage) existingMessage.textContent = explanation || (state.loaded
        ? "사진·링크 정보 업데이트가 지연되어 마지막 확인 자료를 표시합니다. " : "사진·링크 정보를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요. ");
      placeOriginalLoadStatus(banner);
      return;
    }
    if (!placeOriginalLoadStatus()) return;
    banner = document.createElement("div");
    banner.id = "unifiedOriginalLoadStatusV1";
    banner.className = "operations-center-message error";
    banner.setAttribute("role", "status");
    var message = document.createElement("span");
    message.textContent = explanation || (state.loaded ? "사진·링크 정보 업데이트가 지연되어 마지막 확인 자료를 표시합니다. " : "사진·링크 정보를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요. ");
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "다시 불러오기";
    retry.onclick = function() {
      retry.disabled = true;
      var refresh = global.JSListingRefreshV1;
      if (state.pendingProofCount && refresh && typeof refresh.recoverOriginals === "function") {
        return Promise.resolve().then(function() { return refresh.recoverOriginals(); }).catch(function(error) {
          console.warn("변경 매물 원본 연결 재확인 실패", error);
        }).finally(function() { retry.disabled = false; });
      }
      var generation = refresh && typeof refresh.generation === "function" ? refresh.generation() : null;
      var revision = text(global.jsListingsRevisionV682);
      load(true, {deferCommit: !!refresh}).then(function(result) {
        if (result.ok === false) return;
        if (refresh && typeof refresh.applyOriginals === "function") {
          if (!refresh.applyOriginals(result, revision, generation) &&
              typeof refresh.generation === "function" && refresh.generation() === generation &&
              typeof global.loadSheet === "function") {
            return global.loadSheet(true, true);
          }
          return;
        }
        attach(global.allItems || [], result);
        if (typeof global.applyFilter === "function") global.applyFilter();
      }).finally(function() { retry.disabled = false; });
    };
    banner.appendChild(message);
    banner.appendChild(retry);
    placeOriginalLoadStatus(banner);
  }

  function expandUnifiedResult(result) {
    if (!result || result.ok === false || !result.groups || typeof result.groups !== "object" || Array.isArray(result.groups)) {
      throw new Error(result && result.message || "원본 매물 응답을 확인하지 못했습니다.");
    }
    var compact = /^compact-v\d+$/.test(result.format || "");
    if (compact && !Array.isArray(result.fields)) throw new Error("원본 매물 항목을 확인하지 못했습니다.");
    var expanded = {};
    Object.keys(result.groups).forEach(function(propertyId) {
      if (!Array.isArray(result.groups[propertyId])) throw new Error("원본 매물 목록을 확인하지 못했습니다.");
      expanded[propertyId] = result.groups[propertyId].map(function(values) {
        if (!compact) {
          if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("원본 매물 항목을 확인하지 못했습니다.");
          return values;
        }
        if (!Array.isArray(values)) throw new Error("원본 매물 항목을 확인하지 못했습니다.");
        var original = {propertyId: propertyId};
        result.fields.forEach(function(field, index) { original[field] = values[index]; });
        return original;
      });
    });
    return Object.assign({}, result, {groups: expanded, format: compact ? "expanded-v2" : result.format});
  }

  function invalidatePendingLoad() {
    state.loadGeneration += 1;
    state.loadPending = null;
    if (global.JSDataAccessV6 && typeof global.JSDataAccessV6.invalidateRead === "function") {
      global.JSDataAccessV6.invalidateRead("unifiedListings");
    }
  }

  function mergeScoped(result) {
    var expanded;
    try { expanded = expandUnifiedResult(result); } catch (_) { return false; }
    invalidatePendingLoad();
    var merged = Object.assign({}, state.groups);
    var searchIds = Object.assign({}, state.sourceSearchIds);
    Object.keys(expanded.groups).forEach(function(propertyId) {
      merged[propertyId] = expanded.groups[propertyId];
      delete state.sourceSnapshotProofKeys[propertyId];
      searchIds[propertyId] = (expanded.sourceSearchIds && expanded.sourceSearchIds[propertyId] || []).slice();
      state.detailPropertyGeneration[propertyId] = (Number(state.detailPropertyGeneration[propertyId]) || 0) + 1;
      delete state.detailCache[propertyId];
      delete state.detailCachedAt[propertyId];
      delete state.detailRetryAt[propertyId];
      delete state.detailPending[propertyId];
      delete state.contactCache[propertyId];
      delete state.contactPending[propertyId];
      if (state.openPropertyId === propertyId) state.detailRequestToken += 1;
    });
    state.groups = merged;
    state.sourceSearchIds = searchIds;
    // A scoped response is not a complete snapshot; never advertise its revision
    // as the revision of all original groups or mark a partial first load full.
    state.snapshotRevision = "";
    return true;
  }

  function attachCompatible(items, result, options) {
    var expanded = null;
    try { expanded = expandUnifiedResult(result); } catch (_) {}
    var keys = expanded && expanded.sourceSnapshotKeys;
    var propertyIds = expanded && expanded.sourceSnapshotPropertyIds;
    var supported = !!(keys && typeof keys === "object" && !Array.isArray(keys) &&
      propertyIds && typeof propertyIds === "object" && !Array.isArray(propertyIds));
    var own = Object.prototype.hasOwnProperty;
    var byPublicId = Object.create(null), duplicatePublicIds = Object.create(null), itemCounts = Object.create(null);
    var inputItems = Array.isArray(items) ? items : [];
    var matchedIds = [], inputIds = [], rejected = Object.create(null), accepted = [];
    inputItems.forEach(function(item) {
      var id = text(item && item.propertyId);
      if (!id) return;
      if (!itemCounts[id]) inputIds.push(id);
      itemCounts[id] = (itemCounts[id] || 0) + 1;
    });
    if (supported) Object.keys(propertyIds).forEach(function(internalId) {
      var publicId = propertyIds[internalId];
      if (!internalId || internalId !== text(internalId) || typeof publicId !== "string" || !publicId || publicId !== text(publicId)) return;
      if (own.call(byPublicId, publicId)) duplicatePublicIds[publicId] = true;
      else byPublicId[publicId] = internalId;
    });
    var merged = Object.assign(Object.create(null), state.groups), searchIds = Object.assign(Object.create(null), state.sourceSearchIds);
    inputItems.forEach(function(item) {
      var publicId = text(item && item.propertyId), internalId = byPublicId[publicId];
      if (!publicId || rejected[publicId]) return;
      var proof = item && item.sourceSnapshotKey;
      var rows = supported && internalId && own.call(expanded.groups, internalId) ? expanded.groups[internalId] : null;
      var search = supported && internalId && expanded.sourceSearchIds && expanded.sourceSearchIds[internalId];
      var valid = supported && itemCounts[publicId] === 1 && !duplicatePublicIds[publicId] &&
        typeof proof === "string" && /^sha256-v1:[a-f0-9]{64}$/.test(proof) &&
        own.call(keys, internalId) && keys[internalId] === proof && Array.isArray(rows) &&
        (search == null || Array.isArray(search) && search.every(function(value) { return typeof value === "string"; })) &&
        rows.every(function(original) {
          return typeof original.propertyId === "string" && (original.propertyId === internalId || original.propertyId === publicId);
        });
      if (valid) {
        var incomingIndex = sourceOriginalIndex(rows);
        var missingKnownSource = (state.groups[publicId] || []).some(function(original) {
          return !sameSourceOriginal(incomingIndex, original);
        });
        // A full read can be an older R2 snapshot even if it matches its CSV.
        // Only the uncached scoped inventory may establish a removed source;
        // no response is allowed to regress an existing source's checked time.
        valid = !detailResponseIsOlder(publicId, rows) &&
          (!missingKnownSource || !!(options && options.scoped && options.scopedFresh));
      }
      if (!valid) { rejected[publicId] = true; return; }
      matchedIds.push(publicId);
      accepted.push({publicId: publicId, proof: proof, rows: rows, search: search});
    });
    var nextPending = options && options.scoped ? Object.assign(Object.create(null), state.pendingProofIds) : Object.create(null);
    inputIds.forEach(function(id) {
      if (rejected[id]) nextPending[id] = true;
      else delete nextPending[id];
    });
    var pendingIds = Object.keys(nextPending);
    var unknownIds = pendingIds.filter(function(id) { return !originalMetadataReady(id); });
    var complete = supported && !pendingIds.length && inputIds.length === inputItems.length;
    var outcome = {proofSupported: supported, matchedCount: matchedIds.length, matchedIds: matchedIds,
      pendingIds: pendingIds, unknownIds: unknownIds, complete: complete};
    if (options && options.validateOnly) return outcome;
    if (options && options.supersedePending && matchedIds.length) invalidatePendingLoad();
    accepted.forEach(function(entry) {
      var publicId = entry.publicId, proof = entry.proof, rows = entry.rows, search = entry.search;
      if (state.sourceSnapshotProofKeys[publicId] !== proof || !originalMetadataReady(publicId)) {
        merged[publicId] = rows.map(function(original) { return Object.assign({}, original, {propertyId: publicId}); });
        searchIds[publicId] = (search || []).slice();
        state.detailPropertyGeneration[publicId] = (Number(state.detailPropertyGeneration[publicId]) || 0) + 1;
        delete state.detailCache[publicId];
        delete state.detailCachedAt[publicId];
        delete state.detailRetryAt[publicId];
        delete state.detailPending[publicId];
        delete state.detailPendingForced[publicId];
        delete state.contactCache[publicId];
        delete state.contactPending[publicId];
        if (state.openPropertyId === publicId) state.detailRequestToken += 1;
      }
      state.sourceSnapshotProofKeys[publicId] = proof;
      state.metadataCoverage[publicId] = true;
    });
    state.groups = merged;
    state.sourceSearchIds = searchIds;
    // Per-property proofs cannot certify the revision of the entire dataset.
    state.snapshotRevision = "";
    state.pendingProofIds = nextPending;
    state.pendingProofCount = pendingIds.length;
    var preserveGlobalStatus = !!(options && options.preserveGlobalStatus);
    if (complete && !preserveGlobalStatus) state.loaded = true;
    // The compatibility transaction publishes its final phase/count once.
    attach(inputItems, null, true);
    setOriginalLoadPhase(preserveGlobalStatus ? state.originalLoadPhase : complete ? "ready" : "pending");
    if (!preserveGlobalStatus) {
      if (complete) originalLoadStatus(false);
      else originalLoadStatus(true, "변경된 매물 " + pendingIds.length + "건의 사진·링크 정보 업데이트 중 · 마지막 확인 자료를 유지합니다. ");
    }
    return outcome;
  }

  function canCacheCompatible(items) {
    if (!state.loaded || state.originalLoadPhase !== "ready" || state.pendingProofCount || !Array.isArray(items)) return false;
    var seen = Object.create(null);
    return items.every(function(item) {
      var id = text(item && item.propertyId), proof = item && item.sourceSnapshotKey;
      if (!id || seen[id] || typeof proof !== "string" || !/^sha256-v1:[a-f0-9]{64}$/.test(proof) ||
          state.sourceSnapshotProofKeys[id] !== proof || !originalMetadataReady(id)) return false;
      seen[id] = true;
      return true;
    });
  }

  function load(force, options) {
    if (state.loadPending) return state.loadPending;
    if (state.loaded && !force && (!(options && options.deferCommit) || state.snapshotRevision)) {
      return Promise.resolve({groups: state.groups, sourceSearchIds: state.sourceSearchIds, snapshotRevision: state.snapshotRevision});
    }
    var generation = state.loadGeneration;
    setOriginalLoadPhase("pending");
    var deferredCommit = !!(options && options.deferCommit);
    var pending = apiGet("unifiedListings", {}, force).then(function(result) {
      result = expandUnifiedResult(result);
      if (generation !== state.loadGeneration) return {ok: false, superseded: true, groups: {}, snapshotRevision: ""};
      if (deferredCommit) return result;
      if (force) invalidateDetails();
      state.groups = result.groups || {};
      state.sourceSearchIds = result.sourceSearchIds || {};
      state.snapshotRevision = result.snapshotRevision || "";
      state.loaded = true;
      state.pendingProofIds = Object.create(null);
      state.pendingProofCount = 0;
      state.sourceSnapshotProofKeys = Object.create(null);
      setOriginalLoadPhase("ready");
      originalLoadStatus(false);
      return result;
    }).catch(function(error) {
      if (generation !== state.loadGeneration) return {ok: false, superseded: true, groups: {}, snapshotRevision: ""};
      console.error("통합매물 원본 조회 실패", error);
      setOriginalLoadPhase("error");
      originalLoadStatus(true);
      return {ok: false, stale: state.loaded, groups: state.groups, sourceSearchIds: state.sourceSearchIds, snapshotRevision: state.snapshotRevision};
    }).finally(function() { if (state.loadPending === pending) state.loadPending = null; });
    state.loadPending = pending;
    return pending;
  }

  function attach(items, result, deferStatus) {
    if (result && result.groups) {
      if (state.groups !== result.groups) invalidateDetails();
      state.groups = result.groups;
      state.sourceSearchIds = result.sourceSearchIds || state.sourceSearchIds || {};
      if (result.ok !== false) {
        state.loaded = true;
        state.metadataCoverage = Object.create(null);
        state.pendingProofIds = Object.create(null);
        state.pendingProofCount = 0;
        state.sourceSnapshotProofKeys = Object.create(null);
        (items || []).forEach(function(item) {
          var id = text(item && item.propertyId);
          if (id) state.metadataCoverage[id] = true;
        });
        if (Object.prototype.hasOwnProperty.call(result, "snapshotRevision")) state.snapshotRevision = result.snapshotRevision || "";
        originalLoadStatus(false);
      }
    }
    indexMasterItems(items || []);
    (items || []).forEach(function(item) {
      var propertyId = text(item && item.propertyId);
      // A new CSV/master item can arrive after a scoped Today response. Track
      // its missing metadata even when the previous global phase was ready;
      // otherwise revision polling has no pending ID to recover. Explicit
      // full-snapshot empty coverage is known data, not an unknown source.
      if (propertyId && !originalMetadataReady(propertyId)) state.pendingProofIds[propertyId] = true;
      var all = allOriginals(item.propertyId);
      var originals = visibleOriginalsFrom(all, item.propertyId, item, true);
      // The master room is also a legacy favorite key. Overlay the currently
      // advertised floor/display room without rewriting that persisted key.
      var activeOriginals = all.filter(function(original) { return !isSourceUnavailable(original); });
      var sourceLink = text(item.sourceLink);
      var floorOriginal = activeOriginals.filter(function(original) {
        return sourceLink && text(original.link) === sourceLink;
      })[0] || activeOriginals[0];
      var saleFloor = text(item.tradeType).toLowerCase() === "sale" ||
        text(floorOriginal && floorOriginal.tradeType).toLowerCase() === "sale";
      if (!saleFloor && floorOriginal && Object.prototype.hasOwnProperty.call(floorOriginal, "floor")) {
        if (!item.sourceFloorVerifiedV1) {
          item.sourceFloorFallbackV1 = { present: Object.prototype.hasOwnProperty.call(item, "floor"), value: item.floor };
        }
        item.sourceFloorVerifiedV1 = true;
        item.floor = floorOriginal.floor;
        item.advertisedRoomV1 = text(floorOriginal.room);
      } else if (item.sourceFloorVerifiedV1) {
        if (item.sourceFloorFallbackV1 && item.sourceFloorFallbackV1.present) item.floor = item.sourceFloorFallbackV1.value;
        else delete item.floor;
        delete item.sourceFloorVerifiedV1;
        delete item.sourceFloorFallbackV1;
        delete item.advertisedRoomV1;
      }
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
      item.unifiedAllOriginalsV1 = all;
      item.unifiedOriginalMetadataPendingV1 = !originalMetadataReady(item.propertyId);
      item.unifiedActiveOriginalCountV1 = activeOriginals.length;
      item.unifiedEndedOriginalCountV1 = all.length - item.unifiedActiveOriginalCountV1;
      item.unifiedCandidateOriginalCountV2 = all.filter(isCandidateOriginal).length;
      item.sourceAllUnavailableV1 = all.length > 0 && item.unifiedActiveOriginalCountV1 === 0;
      item.unifiedOriginalsV8 = originals;
      item.sourceListingSearchV6579 = (state.sourceSearchIds[text(item.propertyId)] || []).slice();
      item.unifiedOriginalCountV8 = originals.length || (all.length || item.unifiedOriginalMetadataPendingV1 ? 0 : 1);
      item.thumbnailV8 = originals.length ? originalImage(originals[0]) : "";
      item.sourceTypesV8 = originals.map(function(original) { return sourceKey(original.source); });
      item.transactionCheckCandidateV8135 = isTransactionCandidate(item);
      item.transactionCheckMissingCountV8135 = item.transactionCheckCandidateV8135
        ? all.reduce(function(maximum, original) {
            return isSourceUnavailable(original) ? Math.max(maximum, Number(original && original.missingCount) || 1) : maximum;
          }, 0)
        : 0;
      item.gongsilContactCountV8 = originals.reduce(function(total, original) {
        return total + (sourceKey(original.source) === "gongsil" ? Math.max(0, Number(original.contactCount) || 0) : 0);
      }, 0);
    });
    state.pendingProofCount = Object.keys(state.pendingProofIds).length;
    if (!deferStatus) setOriginalLoadPhase(result && result.groups && result.ok !== false ? "ready" : state.originalLoadPhase);
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

  function matchesSource(item, selectedSource, options) {
    if (!selectedSource) return true;
    if (item && item.unifiedFilterOriginalV2) return sourceKey(item.unifiedFilterOriginalV2.source) === selectedSource;
    var sources = options && options.includeUnavailable
      ? (item && item.unifiedAllOriginalsV1 || []).map(function(original) { return sourceKey(original.source); })
      : item && item.sourceTypesV8 || [];
    return sources.length ? sources.indexOf(selectedSource) >= 0
      : !(item && (item.unifiedAllOriginalsV1 || []).length) && sourceKey(item && item.source) === selectedSource;
  }

  function isTransactionCandidate(item) {
    return !!(item && Number(item.unifiedCandidateOriginalCountV2 || 0) > 0 && text(item.state) !== "계약완료");
  }

  function originalDisplayItem(master, original) {
    var item = Object.assign({}, master);
    var manual = !isCandidateOriginal(original) ? text(original.manualDisplayFields).split(",") : [];
    item.displayValuePresence = Object.assign({}, master.displayValuePresence || {});
    var fields = {deposit:"deposit", rent:"monthly_rent", fee:"maintenance_fee", premium:"premium",
      area:"area_m2", salePrice:"sale_price", type:"listing_type", saleCategory:"sale_category"};
    Object.keys(fields).forEach(function(key) {
      if (manual.indexOf(fields[key]) >= 0) return;
      if (/^(?:deposit|rent|fee|premium|area|salePrice)$/.test(key)) {
        var known = original[key] != null && original[key] !== "" && Number.isFinite(Number(original[key]));
        item[key] = known ? Number(original[key]) : 0;
        item.displayValuePresence[key] = known;
      } else if (original[key] != null && original[key] !== "") item[key] = original[key];
    });
    if (original.saleSummary && manual.indexOf("sale_details_json") < 0) item.saleDetails = original.saleSummary;
    item.name = manual.indexOf("title") >= 0 || manual.indexOf("building_name") >= 0
      ? master.name : original.buildingName || master.name;
    item.source = original.source || master.source;
    item.sourceLink = original.link || master.sourceLink;
    item.sourceListingSearchV6579 = [original.sourceListingId, original.providerSourceId, original.sourceId]
      .map(text).filter(Boolean);
    item.advertisedRoomV1 = Object.prototype.hasOwnProperty.call(original, "floor")
      ? text(original.room) : original.room || master.advertisedRoomV1 || master.room;
    if (Object.prototype.hasOwnProperty.call(original, "floor")) {
      item.floor = original.floor;
      item.sourceFloorVerifiedV1 = true;
    }
    item.unifiedFilterOriginalV2 = original;
    item.unifiedOriginalsV8 = [original];
    item.sourceTypesV8 = [sourceKey(original.source)];
    return item;
  }

  function filterItemForView(master, matches, view) {
    var all = master.unifiedAllOriginalsV1 || [];
    var manual = text(master.state) === "계약완료";
    if (manual && view === "active") return null;
    var originals = view === "completed" && !manual ? all.filter(isCandidateOriginal)
      : view === "active" ? all.filter(function(original) { return !isSourceUnavailable(original); }) : publicOriginals(all);
    var today = Number(global.newListingDays || 0) === 1 && global.JSTodayListingsV1;
    if (today && typeof today.matchesOriginal === "function") {
      originals = originals.filter(function(original) { return today.matchesOriginal(master, original); });
    }
    // Preserve explicit manual completion and source-less manual listings.
    if (manual && !today || !all.length) {
      if (!manual && view === "completed" || !matches(master)) return null;
      return Object.assign({}, master, {unifiedDisplayOriginalsV2: originals, unifiedAbsenceConfirmedTimeV1: 0});
    }
    var selected = null, matched = [], latestAbsenceTime = 0, latestAbsenceIndex = -1;
    originals.forEach(function(original) {
      var probe = originalDisplayItem(master, original);
      if (!matches(probe)) return;
      matched.push(original);
      if (!selected) selected = probe;
      if (view === "completed") {
        var absenceTime = absenceConfirmationTime(original);
        if (absenceTime > latestAbsenceTime) {
          latestAbsenceTime = absenceTime;
          latestAbsenceIndex = matched.length - 1;
          selected = probe;
        }
      }
    });
    if (!selected) return null;
    // Put only the newest matching candidate first. Keep equal/unknown dates
    // stable and never reorder the stored original group or its favorite key.
    if (latestAbsenceIndex > 0) matched.unshift(matched.splice(latestAbsenceIndex, 1)[0]);
    selected.unifiedDisplayOriginalsV2 = matched;
    selected.unifiedOriginalsV8 = matched;
    selected.unifiedOriginalCountV8 = matched.length;
    selected.sourceTypesV8 = matched.map(function(original) { return sourceKey(original.source); });
    selected.unifiedCandidateOriginalCountV2 = matched.filter(isCandidateOriginal).length;
    selected.transactionCheckCandidateV8135 = isTransactionCandidate(selected);
    selected.thumbnailV8 = originalImage(matched[0]);
    selected.unifiedAbsenceConfirmedTimeV1 = latestAbsenceTime;
    return selected;
  }

  function candidateSummary(options) {
    var ready = state.loaded && !global.jsInitialFullListingsLoadingV1 &&
      !!global.map && typeof global.getFilteredItems === "function";
    var summary = {ready: ready, candidateCount: 0, candidateAdCount: 0, manualCompletedCount: 0,
      doneCount: 0, scopeLabel: "현재 지도·검색조건"};
    if (!ready) return summary;
    var includeRows = !!(options && options.includeRows);
    if (includeRows) summary.candidates = [];
    // Only the completion toggle is ignored. Market, price, favorites, source,
    // map bounds and the other search conditions remain the same as the map.
    var items = global.getFilteredItems({ignoreDone: true, availabilityView: "completed"});
    (items || []).forEach(function(item) {
      if (text(item.state) === "계약완료") {
        summary.manualCompletedCount += 1;
        return;
      }
      if (!isTransactionCandidate(item)) return;
      summary.candidateCount += 1;
      var originals = (item.unifiedDisplayOriginalsV2 || item.unifiedAllOriginalsV1 || []).filter(isCandidateOriginal);
      summary.candidateAdCount += originals.length;
      if (!includeRows) return;
      var first = originals[0] || {};
      var sources = [];
      originals.forEach(function(original) {
        var source = text(original.source);
        if (source && sources.indexOf(source) < 0) sources.push(source);
      });
      summary.candidates.push({
        propertyId: text(item.propertyId), title: item.name, address: item.address,
        room: item.advertisedRoomV1 || item.room, floor: item.floor, type: item.type,
        tradeType: item.tradeType || "lease", salePrice: item.salePrice,
        deposit: item.deposit, rent: item.rent, fee: item.fee, premium: item.premium, area: item.area,
        displayValuePresence: Object.assign({}, item.displayValuePresence || {}),
        mainSource: item.source, memo: item.memo, sourceUrl: text(item.sourceLink || first.link),
        thumbnail: originalImage(first), sourceCount: publicOriginals(item.unifiedAllOriginalsV1 || []).length, sources: sources,
        activeSourceCount: Number(item.unifiedActiveOriginalCountV1) || 0, sourceUnavailable: true,
        missingCount: item.transactionCheckMissingCountV8135 || 0,
        candidateKind: "source-candidates", candidateOriginalCount: originals.length,
        candidateOriginals: originals.map(function(original) {
          return Object.assign({}, original, {sourceId: original.providerSourceId || original.sourceListingId,
            sourceUrl: original.link});
        })
      });
    });
    summary.doneCount = summary.candidateCount + summary.manualCompletedCount;
    return summary;
  }

  function cardParts(item) {
    var all = allOriginals(item && item.propertyId);
    var originals = item && Array.isArray(item.unifiedDisplayOriginalsV2) ? item.unifiedDisplayOriginalsV2
      : visibleOriginalsFrom(all, item && item.propertyId, item, true);
    var pending = !all.length && !originalMetadataReady(item && item.propertyId);
    var pendingLabel = pending ? missingOriginalLabel(item && item.propertyId) : "";
    var pendingRetryable = pending && getOriginalMetadataStatus(item && item.propertyId).retryable;
    var count = originals.length || (all.length || pending ? 0 : 1);
    var sourceUnavailable = originals.length > 0 && originals.every(function(original) {
      return isCandidateOriginal(original);
    });
    var thumbnail = originals.length ? originalImage(originals[0]) : "";
    var photoPending = !thumbnail && originals.some(function(original) { return Number(original.photoCount) > 0; });
    var encodedId = encodeURIComponent(text(item && item.propertyId));
    var thumbnailMarkup = '<button type="button" class="unified-thumb-v8 ' +
      (thumbnail ? 'has-photo' : 'no-photo') + '" title="' + (pending ? pendingLabel + (pendingRetryable ? ' · 다시 불러오기' : '') : photoPending ? '사진 확인 중' : '사진 크게 보기') + '" ' +
      'onpointerenter="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onfocus="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onpointerdown="JSUnifiedListingsV8.prefetch(\'' + encodedId + '\')" ' +
      'onclick="event.stopPropagation(); JSUnifiedListingsV8.toggleCardDetail(\'' + encodedId + '\')">' +
      (thumbnail ? '<img src="' + esc(thumbnail) + '" data-thumbnail-source-v8144="' + esc(thumbnail) +
        '" alt="매물 사진" loading="lazy" referrerpolicy="no-referrer" ' +
        'onload="JSUnifiedListingsV8.thumbnailImageLoaded(this)" ' +
        'onerror="JSUnifiedListingsV8.thumbnailImageError(this)">' : '<span>' + (pending ? pendingLabel : photoPending ? '사진 확인 중' : '사진 없음') + '</span>') +
      (sourceUnavailable
        ? '<em class="transaction-check-ribbon-v8135">원본 광고 미노출<b>거래완료 후보</b></em>'
        : '') +
      '</button>';
    var badge = pending ? '<span class="unified-badge-v8">' + pendingLabel + (pendingRetryable ? ' · 다시 불러오기' : '') + '</span>' : sourceUnavailable
      ? '<span class="unified-badge-v8 source-unavailable">원본 광고 미노출 · 거래완료 후보</span>'
      : count > 1
        ? '<span class="unified-badge-v8">동일매물 ' + count + '개</span>'
        : '';
    var button;
    if (pending) {
      button = '<button type="button" class="item-source-link-btn" onclick="event.stopPropagation(); ' +
        'JSUnifiedListingsV8.open(\'' + encodedId + '\')">' + (pendingRetryable ? '다시 불러오기' : '사진·링크') + '</button>';
    } else if (sourceUnavailable) {
      button = '<button type="button" class="item-source-link-btn active transaction-check-button-v8135" ' +
        'title="원본 광고 미노출 내역 확인 · 실제 계약완료와 별도" ' +
        'onclick="event.stopPropagation(); if(window.openTransactionCandidateFromListingV1){' +
          'openTransactionCandidateFromListingV1(\'' + encodedId + '\');}">미노출 내역</button>';
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

  function conditionLine(original, hideArea) {
    if (text(original && original.tradeType).toLowerCase() === "sale") {
      return '<span class="listing-sale-condition-v1"><b>매매</b> ' + (global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.price(original.salePrice) : number(original.salePrice)) +
        (hideArea ? '' : ' · ' + (global.JSListingTradeV1 ? global.JSListingTradeV1.saleAreaHtml(original) : '면적 미확인')) + '</span>';
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

  function indexMasterItems(items) {
    state.masterItemsArray = items;
    state.masterItemsById = Object.create(null);
    items.forEach(function(item) {
      var propertyId = text(item && item.propertyId);
      if (propertyId && !state.masterItemsById[propertyId]) state.masterItemsById[propertyId] = item;
    });
  }

  function resolveMasterItem(propertyId) {
    var items = Array.isArray(global.allItems) ? global.allItems : [];
    if (state.masterItemsArray !== items) indexMasterItems(items);
    return state.masterItemsById[text(propertyId)] || null;
  }

  function runDetailAction(action, encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var item = resolveMasterItem(propertyId);
    if (!item) {
      alert("현재 매물목록에서 해당 매물ID를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }
    var encodedKey = encodeURIComponent(text(item.key));
    if (isPhoneDetailV2() && action === "contact" && typeof global.openListContactPopupV654 === "function") {
      global.openListContactPopupV654(encodeURIComponent("id:" + propertyId));
      return;
    }
    if (isPhoneDetailV2() && action === "favorite" && typeof global.openItemListDestinationPicker === "function") {
      // The phone folder picker is an app page beneath the full-screen detail.
      // Replace the detail only for this explicit save action; ordinary folder
      // browsing still keeps its detail above the folder for back navigation.
      closeDetailForOverlay();
      global.openItemListDestinationPicker(encodeURIComponent("property:" + propertyId));
      return;
    }
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
    var buildingSale = global.JSListingTradeV1 && global.JSListingTradeV1.isBuildingSale && global.JSListingTradeV1.isBuildingSale(original);
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
        sourceKey(original.source) + '">' + esc(original.source) + '</b>' +
        (buildingSale ? '' : '<em>' + esc((global.JSListingTradeV1 && global.JSListingTradeV1.landUseLabel ? global.JSListingTradeV1.landUseLabel(original) : '') || originalRoomLabel(original) || '호실 -') + '</em>') + '</span>' +
        (isSourceUnavailable(original) ? '<small class="source-unavailable">원본 광고 미노출 · 거래완료 후보</small>' : '') +
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
      button.textContent = "동일매물 " + displayedOriginals(propertyId).length + "개";
      return;
    }
    var wrapper = document.createElement("div");
    wrapper.className = "unified-inline-originals-v8";
    wrapper.innerHTML = displayedOriginals(propertyId).map(function(original) { return originalRow(original, false); }).join("");
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
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-labelledby", "unifiedDetailTitleV8");
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
    var wasVisible = drawer.getAttribute("aria-hidden") !== "true";
    if (detailCloseTimerV827) {
      global.clearTimeout(detailCloseTimerV827);
      detailCloseTimerV827 = null;
    }
    drawer.classList.remove("closing-v827");
    drawer.setAttribute("aria-hidden", "false");
    if (drawer.classList.contains("open") || drawer.classList.contains("opening-v827")) return;
    drawer.classList.add("opening-v827");
    void drawer.offsetWidth;
    if (!wasVisible && global.JSDialogFocusV1) {
      global.JSDialogFocusV1.activate(drawer, drawer.querySelector("header button"));
    }
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

  function phoneDetailFactsV2(selected) {
    var sale = text(selected.tradeType).toLowerCase() === "sale";
    function value(field) {
      return selected[field] == null || selected[field] === '' ? '미확인' : number(selected[field]);
    }
    var price = sale
      ? '매매 ' + esc(selected.salePrice == null || selected.salePrice === '' ? '미확인' :
        (global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.price(selected.salePrice) : number(selected.salePrice)))
      : '보 ' + esc(value('deposit')) + ' / 월 ' + esc(value('rent'));
    var typeLabel = global.JSListingTradeV1 ? global.JSListingTradeV1.displayType(selected) : selected.type;
    var buildingSale = global.JSListingTradeV1 && global.JSListingTradeV1.isBuildingSale && global.JSListingTradeV1.isBuildingSale(selected);
    var landLabel = global.JSListingTradeV1 && global.JSListingTradeV1.landUseLabel
      ? global.JSListingTradeV1.landUseLabel(selected) : "";
    var facts = [['구분', typeLabel || '미확인']];
    if (landLabel) facts.push(['지목', landLabel.replace(/^지목(?::\s*|\s+)/, '')]);
    else if (!buildingSale) facts.push(['층·호실', selected.room || '미확인']);
    if (!sale) facts = facts.concat([
      ['면적', selected.area == null || selected.area === '' ? '미확인' : number(selected.area) + '평'],
      ['관리비', selected.fee == null || selected.fee === '' ? '미확인' : number(selected.fee) + '만원'],
      ['권리금', selected.premium == null || selected.premium === '' ? '미확인' : number(selected.premium) + '만원']
    ]);
    return '<div class="phone-detail-price-v2">' + price + '</div>' +
      '<dl class="phone-detail-facts-v2">' + facts.map(function(fact) {
        return '<div><dt>' + esc(fact[0]) + '</dt><dd>' + esc(fact[1]) + '</dd></div>';
      }).join('') + '</dl>';
  }

  function phoneDetailActionsV2(propertyId, selected) {
    var encodedId = encodeURIComponent(text(propertyId)).replace(/'/g, '%27');
    return '<nav class="phone-detail-actions-v2" aria-label="매물 상세 바로가기">' +
      '<button type="button" class="phone-detail-contact-v2" onclick="JSUnifiedListingsV8.runDetailAction(\'contact\', \'' + encodedId + '\')">전화</button>' +
      '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'navigation\', \'' + encodedId + '\')">길찾기</button>' +
      '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'favorite\', \'' + encodedId + '\')">찜하기</button>' +
      (selected && /^https?:\/\//i.test(text(selected.link))
        ? '<button type="button" aria-label="선택한 원본 링크 열기" onclick="JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(selected.link) + '\')">원본 ↗</button>'
        : '<button type="button" disabled title="등록된 원본 링크가 없습니다">원본 없음</button>') + '</nav>';
  }

  function detailStatusMessage(propertyId) {
    var status = state.detailStatus[text(propertyId)];
    if (status === "unavailable") return "현재 노출 중인 원본 광고가 없습니다. 거래완료만 보기의 미노출 후보에서 확인해 주세요.";
    if (status === "filtered") return "현재 검색조건에 맞는 원본 광고가 없습니다. 최신 조건을 목록에 반영했습니다.";
    if (status === "mismatch") return "선택한 원본의 최신 연결을 확인하지 못했습니다. 잠시 후 상세를 다시 열어 주세요.";
    if (status === "error") return "원본 최신 조회에 실패했습니다. 마지막 확인 자료를 유지합니다. 잠시 후 다시 열어 주세요.";
    return "원본 정보를 확인 중입니다.";
  }

  function detailPhotoPlaceholder(propertyId, photoCount) {
    return photoCount > 0 ? state.detailStatus[propertyId] === "pending" ? "사진 확인 중" : "사진 조회 불가" : "등록된 사진 없음";
  }

  function renderDetail(propertyId, originals, selectedOriginalId, layoutOptions) {
    originals = visibleOriginalsFrom(originals, propertyId);
    var selected = originals.filter(function(original) {
      return text(original.originalId) === text(selectedOriginalId);
    })[0] || originals[0];
    var masterMeta = state.masterMeta[text(propertyId)] || {};
    var phoneDetail = isPhoneDetailV2();
    var drawer = ensureDrawer();
    drawer.__detailPresentationV2 = {phone: phoneDetail, propertyId: propertyId, originals: originals, originalId: selected && selected.originalId};
    positionDrawer(drawer);
    document.getElementById("unifiedDetailTitleV8").textContent = selected
      ? (selected.buildingName || selected.address || "매물 상세") : "매물 상세";
    document.getElementById("unifiedDetailSubtitleV8").textContent = originals.length > 1
      ? "동일 공간 원본 " + originals.length + "개" : originals.length === 1 ? "원본매물 1개"
      : state.detailStatus[propertyId] === "unavailable" ? "현재 노출 광고 없음"
      : /^(?:mismatch|error|filtered)$/.test(state.detailStatus[propertyId]) ? "원본 연결 확인 필요" : "원본 확인 중";
    var images = originalImages(selected);
    var photoCount = selected ? Math.max(images.length, Number(selected.photoCount) || 0) : 0;
    var encodedActionPropertyId = encodeURIComponent(text(propertyId));
    var buildingSale = selected && global.JSListingTradeV1 && global.JSListingTradeV1.isBuildingSale && global.JSListingTradeV1.isBuildingSale(selected);
    var landLabel = selected && global.JSListingTradeV1 && global.JSListingTradeV1.landUseLabel
      ? global.JSListingTradeV1.landUseLabel(selected) : "";
    var body = document.getElementById("unifiedDetailBodyV8");
    var detailNotice = selected && /^(?:mismatch|error)$/.test(state.detailStatus[propertyId])
      ? '<div class="unified-empty-v8" role="status">' + esc(detailStatusMessage(propertyId)) + '</div>' : '';
    body.innerHTML = detailNotice + (!selected ? '<div class="unified-empty-v8" role="status">' + esc(detailStatusMessage(propertyId)) + '</div>' :
      '<section class="unified-detail-gallery-v8">' +
        (images.length ? '<button type="button" class="unified-detail-hero-v8" ' +
          'onclick="JSUnifiedListingsV8.openDetailGallery(this)">' +
            '<img alt="매물 대표 사진" referrerpolicy="no-referrer" ' +
              'onload="JSUnifiedListingsV8.detailImageLoaded(this)" ' +
              'onerror="JSUnifiedListingsV8.detailImageError(this)">' +
            '<span class="unified-detail-photo-count-v8" aria-live="polite"></span>' +
          '</button>' +
          '<button type="button" class="unified-detail-photo-nav-v8 prev" aria-label="이전 사진" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.stepDetailPhoto(this, -1)">‹</button>' +
          '<button type="button" class="unified-detail-photo-nav-v8 next" aria-label="다음 사진" ' +
            'onclick="event.stopPropagation(); JSUnifiedListingsV8.stepDetailPhoto(this, 1)">›</button>' :
          '<div class="unified-gallery-empty-v8">' + esc(detailPhotoPlaceholder(propertyId, photoCount)) + '</div>') +
      '</section>' +
      '<section class="unified-detail-summary-v8"><div class="unified-detail-source-address-v827">' +
        '<div class="unified-detail-source-row-v827"><span class="source-' + sourceKey(selected.source) + '">' +
          esc(selected.source) + '</span>' +
          (selected.link ? '<button type="button" class="unified-detail-source-link-v827" ' +
            'aria-label="선택한 원본 링크 열기" title="' + esc(selected.source) + ' 추출 원본 열기" ' +
            'onclick="JSUnifiedListingsV8.openExternalLink(\'' + encodedExternalLink(selected.link) + '\')">원본 링크 ↗</button>' : '') +
        '</div><strong>' + esc(selected.address) + (buildingSale ? '' : ' ' + esc(landLabel || originalRoomLabel(selected))) + '</strong></div>' +
        (isSourceUnavailable(selected) ? '<p class="source-unavailable">원본 광고 미노출 · 거래완료 후보 · 실제 계약 여부는 별도 확인</p>' : '') +
        (global.JSListingTradeV1 && global.JSListingTradeV1.buildingSaleAreaInfoHtml ? global.JSListingTradeV1.buildingSaleAreaInfoHtml(selected) : '') +
        (phoneDetail ? phoneDetailFactsV2(selected) : '<p>' + conditionLine(selected, buildingSale) + '</p>') +
        (global.JSListingTradeV1 ? global.JSListingTradeV1.saleDetailsHtml(selected) : '') +
        (!phoneDetail && global.JSSaleWorkbenchV1 ? global.JSSaleWorkbenchV1.detailTools(selected, propertyId) : '') +
        '<div class="unified-detail-utility-actions-v8" aria-label="매물 바로가기">' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'navigation\', \'' + encodedActionPropertyId + '\')">내비</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'roadview\', \'' + encodedActionPropertyId + '\')">로드뷰</button>' +
          (!phoneDetail ? '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'register\', \'' + encodedActionPropertyId + '\')">대장</button>' +
          '<button type="button" onclick="JSUnifiedListingsV8.runDetailAction(\'edit\', \'' + encodedActionPropertyId + '\')">수정</button>' : '') +
        '</div>' +
        detailDateMetadata(masterMeta, selected) +
        (!phoneDetail ? '<div class="unified-detail-actions-v8" aria-label="원본매물 정리 작업">' +
          (!selected.masterFallback && originals.length > 1 ? '<button type="button" class="separate" onclick="JSUnifiedListingsV8.separate(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">별도 매물 분리</button>' : '') +
          (!selected.masterFallback ? '<button type="button" class="move" onclick="JSUnifiedListingsV8.startMove(\'' +
            encodeURIComponent(selected.originalId) + '\', ' + Number(selected.revision || 1) + ')">원본 1개 합치기</button>' : '') +
          '<button type="button" class="move whole-master" onclick="JSUnifiedListingsV8.startWholeMasterMove(\'' +
            encodedActionPropertyId + '\')">대표 전체 합치기</button>' +
        '</div>' : '') +
        (selected.memo ? '<div class="unified-detail-memo-v8">' + esc(selected.memo) + '</div>' : '') +
      '</section>' +
      (originals.length > 1 ? '<section class="unified-detail-originals-v8"><h4>이 공간의 원본매물</h4>' +
        originals.map(function(original) { return originalRow(original, original.originalId === selected.originalId); }).join("") +
      '</section>' : ''));
    var phoneActions = drawer.querySelector('.phone-detail-actions-v2');
    if (phoneActions) phoneActions.remove();
    if (phoneDetail && selected) drawer.insertAdjacentHTML('beforeend', phoneDetailActionsV2(propertyId, selected));
    var detailGallery = body.querySelector(".unified-detail-gallery-v8");
    if (detailGallery && layoutOptions && layoutOptions.gallery) {
      detailGallery.replaceWith(layoutOptions.gallery);
    } else if (detailGallery && images.length) {
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

  function syncDetailPresentationV2() {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    if (!drawer || (!drawer.classList.contains("open") && !drawer.classList.contains("opening-v827"))) return;
    var saved = drawer.__detailPresentationV2;
    var body = document.getElementById("unifiedDetailBodyV8");
    if (!saved || !body || saved.phone === isPhoneDetailV2()) { positionDrawer(drawer); return; }
    var gallery = body.querySelector(".unified-detail-gallery-v8");
    var scrollTop = body.scrollTop;
    var key = text(saved.propertyId) + ":" + text(saved.originalId);
    if (drawer.__layoutDraftKeyV2 !== key) drawer.__layoutDraftV2 = {};
    drawer.__layoutDraftKeyV2 = key;
    var drafts = drawer.__layoutDraftV2;
    var focused = document.activeElement;
    var focusKey = "";
    var selection = null;
    function fieldKey(field, index) { return field.id || field.name || field.tagName + ":" + index; }
    Array.prototype.forEach.call(body.querySelectorAll("input, select, textarea, details"), function(field, index) {
      var id = fieldKey(field, index);
      drafts[id] = {value: field.value, checked: field.checked, open: field.open};
      if (field === focused) {
        focusKey = id;
        selection = {start: field.selectionStart, end: field.selectionEnd};
      }
    });
    // Reuse the live gallery node: photo index, in-flight images and swipe
    // handlers survive. This is presentation only, with no detail fetch/save.
    renderDetail(saved.propertyId, saved.originals, saved.originalId, {gallery: gallery});
    Array.prototype.forEach.call(body.querySelectorAll("input, select, textarea, details"), function(field, index) {
      var id = fieldKey(field, index);
      var draft = drafts[id];
      if (!draft) return;
      if (typeof draft.value !== "undefined") field.value = draft.value;
      if (typeof draft.checked === "boolean") field.checked = draft.checked;
      if (typeof draft.open === "boolean") field.open = draft.open;
      if (focusKey === id) {
        field.focus({preventScroll: true});
        if (selection && selection.start != null && typeof field.setSelectionRange === "function") field.setSelectionRange(selection.start, selection.end);
      }
    });
    body.scrollTop = scrollTop;
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
      image.setAttribute("data-detail-source-v8144", text(images[safeIndex]));
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
      // An open detail already owns the in-flight refresh. Repeated clicks
      // only update its desired photo; they must not add requests or renders.
      if (state.detailPending[propertyId]) {
        if (counter) counter.textContent = "다음 사진 불러오는 중…";
        return;
      }
      if (state.detailPhotoRetryCount >= 1) {
        if (counter) counter.textContent = "사진 조회 실패 · 상세를 다시 열어 주세요";
        return;
      }
      if (state.openPropertyId !== propertyId) return;
      state.detailPhotoRetryCount += 1;
      if (counter) counter.textContent = "다음 사진 불러오는 중…";
      return refreshOpenDetail(propertyId, state.openOriginalId, state.detailRequestToken, null, true);
    }
    transitionPhotoV8140(gallery, direction, function() {
      renderDetailPhoto(gallery, Number(gallery._indexV8 || 0) + Number(direction || 0));
    });
  }

  function openDetailGallery(button) {
    if (button && button.closest(".unified-favorite-embedded-detail-v7")) return;
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

  function showDetailPhotoLookupFailure(propertyId, requestToken) {
    if (requestToken !== state.detailRequestToken || state.openPropertyId !== propertyId) return;
    var body = document.getElementById("unifiedDetailBodyV8");
    var gallery = body && body.querySelector(".unified-detail-gallery-v8");
    if (!gallery || (gallery._imagesV8 || []).length > 1 || Number(gallery._photoCountV8) < 2) return;
    var counter = gallery.querySelector(".unified-detail-photo-count-v8");
    if (counter) counter.textContent = state.detailPhotoRetryCount >= 1
      ? "사진 조회 실패 · 상세를 다시 열어 주세요"
      : "추가 사진 조회 실패 · 다음 버튼으로 재시도";
  }

  function synchronizeDetailOriginals(propertyId, originals) {
    var master = resolveMasterItem(propertyId);
    if (!master || !originals.length || state.groups[propertyId] === originals || originals.some(function(original) {
      return !text(original.originalId) || text(original.propertyId) && text(original.propertyId) !== propertyId;
    })) return false;
    // A clicked property's fresh original response is evidence for that property,
    // not a coherent replacement for the full CSV/original snapshot cache.
    state.groups[propertyId] = originals;
    delete state.sourceSnapshotProofKeys[propertyId];
    state.snapshotRevision = "";
    attach([master]);
    if (typeof global.applyFilter === "function") {
      global.applyFilter();
      return true;
    }
    return false;
  }

  function sourceCheckedTime(original) {
    var raw = text(original && original.lastCheckedAt);
    if (!raw) return 0;
    var parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sourceOriginalIndex(originals) {
    var index = {ids: Object.create(null), identities: Object.create(null)};
    originals.forEach(function(original) {
      index.ids[text(original.originalId)] = original;
      var identity = sourceIdentity(original);
      if (identity) index.identities[identity] = Object.prototype.hasOwnProperty.call(index.identities, identity) ? null : original;
    });
    return index;
  }

  function sameSourceOriginal(index, target) {
    if (!target) return null;
    var exact = index.ids[text(target.originalId)];
    var identity = sourceIdentity(target);
    if (exact && (!identity || !sourceIdentity(exact) || sourceIdentity(exact) === identity)) return exact;
    return identity ? index.identities[identity] || null : null;
  }

  function detailResponseIsOlder(propertyId, originals) {
    var known = sourceOriginalIndex(state.groups[propertyId] || []);
    return originals.some(function(original) {
      var previous = sameSourceOriginal(known, original);
      if (!previous) return false;
      var oldTime = sourceCheckedTime(previous), newTime = sourceCheckedTime(original);
      if (oldTime && (!newTime || newTime < oldTime)) return true;
      // With no newer evidence, an old cache must not end a currently active
      // ad or resurrect an inactive one merely because its row ID still matches.
      return isSourceUnavailable(previous) !== isSourceUnavailable(original) && (!newTime || newTime <= oldTime);
    });
  }

  function prepareDetailOriginals(propertyId, originals, originalId, options) {
    var before = displayedOriginalProjection(propertyId);
    var previous = (before || state.groups[propertyId] || []).filter(function(original) {
      return text(original.originalId) === originalId;
    })[0];
    var wantedIdentity = sourceIdentity(previous) || state.openOriginalIdentity;
    if (!originals.length) {
      state.detailStatus[propertyId] = "mismatch";
      return {originals: detailOriginals(state.groups[propertyId] || [], propertyId), retry: true};
    }
    var selectedExists = !originalId || originals.some(function(original) {
      var identity = sourceIdentity(original);
      return text(original.originalId) === originalId && (!wantedIdentity || !identity || identity === wantedIdentity) ||
        wantedIdentity && identity === wantedIdentity;
    });
    var incomingIndex = sourceOriginalIndex(originals);
    var missingKnownSource = (state.groups[propertyId] || []).some(function(original) {
      return !sameSourceOriginal(incomingIndex, original);
    });
    // A normal HTTP response can still be an old R2 snapshot containing only
    // the selected ad. Verify missing siblings with one forced current read
    // before replacing a newer complete group with that partial response.
    var unverifiedMissingSource = missingKnownSource && !(options && options.forceFresh);
    if (!selectedExists || unverifiedMissingSource || detailResponseIsOlder(propertyId, originals)) {
      state.detailStatus[propertyId] = "mismatch";
      delete state.detailCache[propertyId];
      delete state.detailCachedAt[propertyId];
      return {originals: detailOriginals(state.groups[propertyId] || [], propertyId), retry: true};
    }
    // A five-minute browser cache is presentation only. It cannot replace a
    // newer full-snapshot group, even when it happens to contain matching IDs.
    var fromCache = !!(options && options.fromCache);
    var refreshedList = !fromCache && synchronizeDetailOriginals(propertyId, originals);
    var visible = detailOriginals(originals, propertyId);
    if (refreshedList && before && !displayedOriginalProjection(propertyId)) {
      visible = [];
      state.detailStatus[propertyId] = visibleOriginalsFrom(originals, propertyId).length ? "filtered" : "unavailable";
    } else if (!visible.length) {
      state.detailStatus[propertyId] = visibleOriginalsFrom(originals, propertyId).length ? "mismatch" : "unavailable";
    }
    var selected = visible.filter(function(original) { return text(original.originalId) === originalId; })[0];
    if (!selected && wantedIdentity) {
      var sameIdentity = visible.filter(function(original) { return sourceIdentity(original) === wantedIdentity; });
      if (sameIdentity.length === 1) selected = sameIdentity[0];
    }
    if (!selected && originalId && visible.length) {
      state.detailStatus[propertyId] = "mismatch";
      return {originals: [], retry: true};
    }
    if (visible.length) state.detailStatus[propertyId] = "";
    var knownIndex = fromCache ? sourceOriginalIndex(state.groups[propertyId] || []) : null;
    var needsCurrentPhoto = fromCache && visible.some(function(original) {
      var known = sameSourceOriginal(knownIndex, original);
      return known && !originalImage(known) && !!originalImage(original);
    });
    return {originals: visible, selected: selected || visible[0],
      retry: needsCurrentPhoto || state.detailStatus[propertyId] === "mismatch"};
  }

  function refreshOpenDetail(propertyId, originalId, requestToken, measurement, force) {
    return loadDetail(propertyId, force).then(function(originals) {
      if (requestToken !== state.detailRequestToken || state.openPropertyId !== propertyId ||
          state.openOriginalId !== originalId) return;
      var body = document.getElementById("unifiedDetailBodyV8");
      var active = document.activeElement;
      // Do not replace a form while the user is editing it. The fresh response
      // remains cached and is used the next time the card is opened.
      if (body && active && body.contains && body.contains(active) &&
          (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || ""))) return;
      var prepared = prepareDetailOriginals(propertyId, originals, originalId, {forceFresh: !!force});
      if (prepared.retry && !force && !state.detailRefreshRetries[propertyId]) {
        state.detailRefreshRetries[propertyId] = 1;
        return refreshOpenDetail(propertyId, originalId, requestToken, measurement, true);
      }
      originals = prepared.originals;
      var gallery = body && body.querySelector(".unified-detail-gallery-v8");
      var photoIndex = gallery ? Number(gallery._indexV8 || 0) : 0;
      var scrollTop = body ? body.scrollTop : 0;
      var selected = prepared.selected || originals.filter(function(original) {
        return text(original.originalId) === originalId;
      })[0] || originals[0];
      state.openOriginalId = text(selected && selected.originalId);
      state.openOriginalIdentity = sourceIdentity(selected);
      renderDetail(propertyId, originals, state.openOriginalId);
      body = document.getElementById("unifiedDetailBodyV8");
      gallery = body && body.querySelector(".unified-detail-gallery-v8");
      if (gallery && photoIndex > 0) renderDetailPhoto(gallery, photoIndex);
      if (Object.prototype.hasOwnProperty.call(state.pendingDetailSteps, propertyId)) {
        showDetailPhotoLookupFailure(propertyId, requestToken);
      }
      if (body) body.scrollTop = scrollTop;
      if (originals.length && global.JSLocalMetricsV1) global.JSLocalMetricsV1.finish(measurement);
    }).catch(function(error) {
      if (requestToken === state.detailRequestToken && state.openPropertyId === propertyId) {
        state.detailStatus[propertyId] = "error";
        renderDetail(propertyId, displayedOriginals(propertyId), state.openOriginalId);
      }
      showDetailPhotoLookupFailure(propertyId, requestToken);
      console.warn("매물 상세 최신화 실패 · 기존 정보를 유지합니다.", error);
    });
  }

  function open(encodedPropertyId, encodedOriginalId) {
    var measurement = global.JSLocalMetricsV1 ? global.JSLocalMetricsV1.start("detail") : null;
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var requestToken = ++state.detailRequestToken;
    state.detailPhotoRetryCount = 0;
    state.detailRefreshRetries[propertyId] = 0;
    state.detailStatus[propertyId] = "pending";
    delete state.pendingDetailSteps[propertyId];
    state.openPropertyId = propertyId;
    var initial = displayedOriginals(propertyId);
    var wanted = initial.filter(function(original) { return text(original.originalId) === originalId; })[0] || initial[0];
    state.openOriginalIdentity = sourceIdentity(wanted);
    var cached = state.detailCache[propertyId];
    if (cached) {
      var prepared = prepareDetailOriginals(propertyId, cached, originalId || text(wanted && wanted.originalId), {fromCache: true});
      cached = prepared.originals;
      state.openOriginalId = text(prepared.selected && prepared.selected.originalId) || originalId || text(cached[0] && cached[0].originalId);
      renderDetail(propertyId, cached, state.openOriginalId);
      if (cached.length && global.JSLocalMetricsV1) global.JSLocalMetricsV1.finish(measurement);
      if (prepared.retry || !detailIsFresh(propertyId)) return refreshOpenDetail(propertyId, state.openOriginalId, requestToken, measurement, prepared.retry);
      return;
    }
    if (!originalId && initial[0]) originalId = text(initial[0].originalId);
    state.openOriginalId = originalId;
    renderDetail(propertyId, initial, originalId);
    if (initial.length && global.JSLocalMetricsV1) global.JSLocalMetricsV1.finish(measurement);
    return refreshOpenDetail(propertyId, originalId, requestToken, measurement);
  }

  function loadContacts(propertyId) {
    propertyId = text(propertyId);
    if (!propertyId) return Promise.resolve({ok: true, propertyId: "", contactCount: 0, contacts: []});
    if (Object.prototype.hasOwnProperty.call(state.contactCache, propertyId)) {
      return Promise.resolve(state.contactCache[propertyId]);
    }
    if (state.contactPending[propertyId]) return state.contactPending[propertyId];
    var propertyGeneration = Number(state.detailPropertyGeneration[propertyId]) || 0;
    var request = apiGet("unifiedListingContacts", {propertyId: propertyId}).then(function(result) {
      if (propertyGeneration === (Number(state.detailPropertyGeneration[propertyId]) || 0)) state.contactCache[propertyId] = result;
      if (state.contactPending[propertyId] === request) delete state.contactPending[propertyId];
      return result;
    }, function(error) {
      if (state.contactPending[propertyId] === request) delete state.contactPending[propertyId];
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
    var wasVisible = drawer.getAttribute("aria-hidden") !== "true";
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
    if (wasVisible && global.JSDialogFocusV1) global.JSDialogFocusV1.deactivate(drawer);
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
    closeGallery(false);
    if (drawer && global.JSDialogFocusV1) global.JSDialogFocusV1.deactivate(drawer, {restore: false});
    state.openPropertyId = "";
    state.openOriginalId = "";
    state.detailRequestToken += 1;
  }

  function isDetailOpenForPropertyV8143(propertyId) {
    var drawer = document.getElementById("unifiedDetailDrawerV8");
    return !!drawer && drawer.getAttribute("aria-hidden") !== "true" &&
      text(state.openPropertyId) === text(propertyId);
  }

  function toggleCardDetail(encodedPropertyId) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    if (!propertyId) return false;
    if (isDetailOpenForPropertyV8143(propertyId)) {
      closeDetail();
      return false;
    }
    open(encodeURIComponent(propertyId));
    return true;
  }

  function imageError(image, showLabel) {
    if (!image) return;
    var parent = image.parentElement;
    image.remove();
    if (!parent) return;
    parent.classList.remove("has-photo");
    parent.classList.add("no-photo");
    if (showLabel && !parent.querySelector("span")) parent.insertAdjacentHTML("beforeend", "<span>사진 조회 실패</span>");
  }

  function thumbnailImageError(image) {
    if (!image || !image.parentElement) return;
    var original = text(image.getAttribute("data-thumbnail-source-v8144"));
    var proxy = thumbnailProxyUrl(original);
    image._jsThumbnailFailedV8144 = true;
    // Healthy thumbnails still load directly. Only a failed request uses the
    // existing authenticated image cache, once per thumbnail element.
    if (proxy && !image._jsThumbnailProxyTriedV8144 && image.getAttribute("src") !== proxy) {
      image._jsThumbnailProxyTriedV8144 = true;
      image.src = proxy;
      return;
    }
    // Phone cards declare display:block!important. Hide only this failed image
    // without letting its broken-image box cover the failure message.
    image.style.setProperty("display", "none", "important");
    var parent = image.parentElement;
    parent.classList.remove("has-photo");
    parent.classList.add("no-photo");
    if (!parent.querySelector("[data-thumbnail-error-v8144]")) {
      parent.insertAdjacentHTML("beforeend", '<span data-thumbnail-error-v8144>사진 불러오기 실패</span>');
    }
  }

  function thumbnailImageLoaded(image) {
    if (!image || !image.parentElement) return;
    image._jsThumbnailFailedV8144 = false;
    image.style.display = "";
    var parent = image.parentElement;
    parent.classList.remove("no-photo");
    parent.classList.add("has-photo");
    var label = parent.querySelector("[data-thumbnail-error-v8144]");
    if (label) label.remove();
  }

  function detailImageLoaded(image) {
    if (!image) return;
    var original = text(image.getAttribute("data-detail-source-v8144"));
    var loadedSource = text(image.getAttribute("src"));
    if (!original || !loadedSource || (loadedSource !== original && loadedSource !== detailDisplayImageUrl(original))) return;
    // Repair only already-failed thumbnails of this exact photo. Do not
    // rerender the list or fetch other listings when a detail photo succeeds.
    document.querySelectorAll(".unified-thumb-v8 img[data-thumbnail-source-v8144]").forEach(function(thumbnail) {
      if (!thumbnail._jsThumbnailFailedV8144 || text(thumbnail.getAttribute("data-thumbnail-source-v8144")) !== original) return;
      var recovered = thumbnail._jsThumbnailRecoverySourcesV8144 || (thumbnail._jsThumbnailRecoverySourcesV8144 = []);
      if (recovered.indexOf(loadedSource) >= 0) return;
      recovered.push(loadedSource);
      if (loadedSource === thumbnailProxyUrl(original)) thumbnail._jsThumbnailProxyTriedV8144 = true;
      thumbnail.src = loadedSource;
    });
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
      invalidateDetails();
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
    if (isDetailOpenForPropertyV8143(propertyId)) {
      closeDetail();
      return true;
    }
    if (typeof global.selectListingOnMapV844 === "function") {
      global.selectListingOnMapV844(item);
    }
    open(encodeURIComponent(propertyId));
    return true;
  }

  function openGallery(encodedPropertyId, encodedOriginalId, startIndex) {
    var propertyId = decodeURIComponent(encodedPropertyId || "");
    var originalId = decodeURIComponent(encodedOriginalId || "");
    var originals = visibleOriginalsFrom(state.detailCache[propertyId] || allOriginals(propertyId), propertyId);
    var original = originals.filter(function(entry) { return entry.originalId === originalId; })[0];
    var images = originalImages(original);
    if (!images.length) return;
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "unifiedGalleryV8";
      modal.className = "unified-gallery-modal-v8";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "매물 사진 크게 보기");
      modal.setAttribute("aria-hidden", "true");
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
      modal.addEventListener("keydown", function(event) {
        if (!modal.classList.contains("open") || !global.JSDialogFocusV1) return;
        global.JSDialogFocusV1.handleKeydown(modal, event, closeGallery);
      });
      document.body.appendChild(modal);
    }
    var index = wrapPhotoIndexV8141(startIndex, images.length);
    modal._imagesV8 = images.slice();
    bindPhotoSwipe(modal, function(direction) { stepGallery(direction); });
    renderGalleryImage(modal, index);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if (global.JSDialogFocusV1) global.JSDialogFocusV1.activate(modal, modal.querySelector(".close"));
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

  function closeGallery(restoreFocus) {
    var modal = document.getElementById("unifiedGalleryV8");
    if (!modal) return;
    var wasOpen = modal.classList.contains("open");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (wasOpen && global.JSDialogFocusV1) {
      global.JSDialogFocusV1.deactivate(modal, {restore: restoreFocus !== false});
    }
  }

  function closeTell(restoreFocus) {
    var modal = document.getElementById("tellModalV8");
    if (!modal) return;
    var wasOpen = modal.classList.contains("open");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    state.tellRequestToken += 1;
    if (wasOpen && global.JSDialogFocusV1) {
      global.JSDialogFocusV1.deactivate(modal, {restore: restoreFocus !== false});
    }
  }

  function resolveTellReturnFocusV8(detailDrawer) {
    var active = document.activeElement;
    var trigger = document.querySelector("button.search-tell-v8[onclick*='JSUnifiedListingsV8.openTell']");
    var activeIsInsideDetail = !!(detailDrawer && active && detailDrawer.contains(active));
    var candidate = (!active || active === document.body || activeIsInsideDetail) ? trigger : active;
    if (!global.JSDialogFocusV1 || typeof global.JSDialogFocusV1.isRestorable !== "function") {
      return candidate || trigger || null;
    }
    if (global.JSDialogFocusV1.isRestorable(candidate)) return candidate;
    return global.JSDialogFocusV1.isRestorable(trigger) ? trigger : null;
  }

  function openTell() {
    if (!desktop()) return;
    var detailDrawer = document.getElementById("unifiedDetailDrawerV8");
    var returnFocus = resolveTellReturnFocusV8(detailDrawer);
    closeDetailForOverlay();
    var modal = document.getElementById("tellModalV8");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "tellModalV8";
      modal.className = "tell-modal-v8";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML = '<div class="tell-backdrop-v8" aria-hidden="true"></div>' +
        '<section role="dialog" aria-modal="true" aria-labelledby="tellModalTitleV8"><header><div>' +
        '<strong id="tellModalTitleV8">Tell 주소 연락처</strong>' +
        '<span>공실박스에서 수집된 번호를 매물 상태와 관계없이 조회합니다.</span></div>' +
        '<button type="button" aria-label="Tell 연락처 검색 닫기">×</button></header>' +
        '<form><input type="search" placeholder="예: 월평동 1197" autocomplete="off"><button type="submit">검색</button></form>' +
        '<div class="tell-results-v8"><p>주소를 입력해 주세요.</p></div></section>';
      modal.querySelector("header button").onclick = function() { closeTell(); };
      modal.querySelector(".tell-backdrop-v8").onclick = function() { closeTell(); };
      modal.addEventListener("keydown", function(event) {
        if (!modal.classList.contains("open") || !global.JSDialogFocusV1) return;
        global.JSDialogFocusV1.handleKeydown(modal, event, closeTell);
      });
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
    modal.setAttribute("aria-hidden", "false");
    if (global.JSDialogFocusV1) {
      global.JSDialogFocusV1.activate(modal, modal.querySelector("input"), {returnFocus: returnFocus});
    }
  }

  global.addEventListener("focus", function() {
    if (state.openPropertyId && !detailIsFresh(state.openPropertyId)) {
      refreshOpenDetail(state.openPropertyId, state.openOriginalId, state.detailRequestToken);
    }
  });

  global.addEventListener("js-async-mutation-finished", function(event) {
    var detail = event && event.detail || {};
    if (detail.ok && /^(toggleDone|updateProperty|deleteProperty|moveOriginalListing|consolidateExistingMasters)$/.test(detail.action || "")) {
      invalidateDetails();
    }
  });

  global.addEventListener("resize", syncDetailPresentationV2);
  global.addEventListener("js-phone-device-change", syncDetailPresentationV2);

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
    if (event.defaultPrevented || event.isComposing || (document.querySelector && document.querySelector("dialog[open]"))) return;
    var tellModal = document.getElementById("tellModalV8");
    if (tellModal && tellModal.classList.contains("open")) {
      if (event.key === "Escape") closeTell();
      return;
    }
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
    load: load, attach: attach, attachCompatible: attachCompatible, canCacheCompatible: canCacheCompatible,
    mergeScoped: mergeScoped, invalidatePendingLoad: invalidatePendingLoad,
    markSnapshotStale: function() { setOriginalLoadPhase("stale"); originalLoadStatus(true, "사진·링크 정보 업데이트가 지연되어 마지막 확인 자료를 표시합니다. "); },
    getOriginalMetadataStatus: getOriginalMetadataStatus,
    pendingCompatibleIds: function() { return Object.keys(state.pendingProofIds); },
    cardParts: cardParts, matchesSource: matchesSource,
    allOriginals: allOriginals, visibleOriginals: group, refreshOriginalVisibility: function(items) { return attach(items); },
    isSourceUnavailable: isSourceUnavailable,
    isCandidateOriginal: isCandidateOriginal, filterItemForView: filterItemForView,
    isTransactionCandidate: isTransactionCandidate, candidateSummary: candidateSummary,
    toggle: toggle, toggleCardDetail: toggleCardDetail, open: open, prefetch: prefetch, close: closeDetail,
    isOpenForProperty: isDetailOpenForPropertyV8143,
    closeForOverlay: closeDetailForOverlay, handleCardClick: handleCardClick,
    openGallery: openGallery, separate: separate, startMove: startMove,
    startWholeMasterMove: startWholeMasterMove, openTell: openTell,
    loadContacts: loadContacts, getCachedContacts: getCachedContacts,
    imageError: imageError, thumbnailImageError: thumbnailImageError, thumbnailImageLoaded: thumbnailImageLoaded,
    detailImageLoaded: detailImageLoaded, renderDetailPhoto: renderDetailPhoto, stepDetailPhoto: stepDetailPhoto,
    openDetailGallery: openDetailGallery, detailImageError: detailImageError,
    runDetailAction: runDetailAction, openExternalLink: openExternalLink
  };
})(window);

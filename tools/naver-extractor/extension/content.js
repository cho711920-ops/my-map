(() => {
  "use strict";

  const PAGE_SOURCE = "JS_NAVER_EXTRACTOR_PAGE";
  const CONTENT_SOURCE = "JS_NAVER_EXTRACTOR_CONTENT";
  const HOOK_ID = "js-naver-extractor-hook-211";

  let latestCapture = null;
  let collectionState = {
    status: "idle",
    collected: 0,
    expected: 0,
    page: 0,
    message: ""
  };

  function inject() {
    if (document.getElementById(HOOK_ID)) return;

    const target = document.documentElement || document.head || document.body;
    if (!target) {
      setTimeout(inject, 0);
      return;
    }

    const script = document.createElement("script");
    script.id = HOOK_ID;
    script.src = chrome.runtime.getURL("page-hook.js");
    script.onload = () => script.remove();
    target.appendChild(script);
  }

  function notifyPopup(payload) {
    try {
      const result = chrome.runtime.sendMessage(
        Object.assign({type: "NAVER_COLLECTION_EVENT"}, payload)
      );

      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (_) {}
  }

  inject();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE) return;

    if (data.type === "ARTICLES_CAPTURED") {
      latestCapture = {
        articles: Array.isArray(data.articles) ? data.articles : [],
        responseUrl: data.responseUrl || "",
        pageUrl: data.pageUrl || location.href,
        page: Number(data.page) || 1,
        expected: Number(data.expected) || 0,
        hasMore: data.hasMore,
        capturedAt: data.capturedAt || Date.now()
      };

      collectionState = {
        status: "detected",
        collected: latestCapture.articles.length,
        expected: latestCapture.expected,
        page: latestCapture.page,
        message: "선택한 마커의 매물을 감지했습니다."
      };

      notifyPopup({capture: latestCapture, state: collectionState});
      return;
    }

    if (data.type === "COLLECT_PROGRESS") {
      collectionState = {
        status: "collecting",
        collected: Number(data.collected) || 0,
        expected: Number(data.expected) || 0,
        page: Number(data.page) || 0,
        message: data.message || "전체 목록을 수집하고 있습니다."
      };

      notifyPopup({state: collectionState});
      return;
    }

    if (data.type === "COLLECT_COMPLETE") {
      latestCapture = {
        articles: Array.isArray(data.articles) ? data.articles : [],
        responseUrl: data.responseUrl || "",
        pageUrl: data.pageUrl || location.href,
        page: Number(data.page) || 1,
        expected: Number(data.expected) || 0,
        hasMore: false,
        capturedAt: data.capturedAt || Date.now()
      };

      collectionState = {
        status: "complete",
        collected: latestCapture.articles.length,
        expected: latestCapture.expected,
        page: latestCapture.page,
        message: data.message || "클러스터 전체 목록 수집을 완료했습니다."
      };

      notifyPopup({capture: latestCapture, state: collectionState});
      return;
    }

    if (data.type === "COLLECT_ERROR") {
      collectionState = {
        status: "error",
        collected: Number(data.collected) || 0,
        expected: Number(data.expected) || 0,
        page: Number(data.page) || 0,
        message: data.message || "전체 목록 수집에 실패했습니다."
      };

      notifyPopup({state: collectionState});
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;

    if (message.type === "GET_NAVER_STATE") {
      sendResponse({
        ok: true,
        capture: latestCapture,
        state: collectionState
      });
      return false;
    }

    if (message.type === "COLLECT_ALL") {
      if (!latestCapture || !latestCapture.responseUrl) {
        sendResponse({
          ok: false,
          message: "네이버 지도에서 원하는 클러스터를 먼저 눌러주세요."
        });
        return false;
      }

      collectionState = {
        status: "collecting",
        collected: latestCapture.articles.length,
        expected: latestCapture.expected,
        page: latestCapture.page,
        message: "클러스터 전체 목록 수집을 시작합니다."
      };

      window.postMessage({
        source: CONTENT_SOURCE,
        type: "COLLECT_ALL_REQUEST",
        requestId: message.requestId || String(Date.now()),
        responseUrl: latestCapture.responseUrl,
        maxPages: message.maxPages || 100
      }, "*");

      sendResponse({ok: true});
      return false;
    }

    if (message.type === "CLEAR_NAVER_STATE") {
      latestCapture = null;
      collectionState = {
        status: "idle",
        collected: 0,
        expected: 0,
        page: 0,
        message: ""
      };
      sendResponse({ok: true});
      return false;
    }

    return false;
  });
})();

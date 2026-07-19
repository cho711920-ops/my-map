(() => {
  "use strict";

  const VERSION = "2.1.1";
  const PAGE_SOURCE = "JS_NAVER_EXTRACTOR_PAGE";
  const CONTENT_SOURCE = "JS_NAVER_EXTRACTOR_CONTENT";
  const MAX_PAGE_LIMIT = 100;

  if (window.__JS_NAVER_EXTRACTOR_211__) return;
  window.__JS_NAVER_EXTRACTOR_211__ = true;

  const nativeFetch =
    typeof window.fetch === "function"
      ? window.fetch.bind(window)
      : null;
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;

  let latestCapture = null;
  let collecting = false;

  function articlesFrom(json) {
    if (!json || !Array.isArray(json.articleList)) return [];
    return json.articleList.filter(
      (article) => article && article.articleNo
    );
  }

  function absoluteUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      if (url.origin !== location.origin) return "";
      return url.href;
    } catch (_) {
      return "";
    }
  }

  function pageNumber(url) {
    try {
      const value = Number(new URL(url).searchParams.get("page"));
      return Number.isFinite(value) && value > 0 ? value : 1;
    } catch (_) {
      return 1;
    }
  }

  function expectedCount(json) {
    const candidates = [
      json && json.totalCount,
      json && json.articleCount,
      json && json.total,
      json && json.pageInfo && json.pageInfo.totalCount
    ];

    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }

    return 0;
  }

  function explicitHasMore(json) {
    const candidates = [
      json && json.isMoreData,
      json && json.hasMore,
      json && json.moreData,
      json && json.pageInfo && json.pageInfo.hasNext
    ];

    for (const value of candidates) {
      if (typeof value === "boolean") return value;
    }

    return null;
  }

  function publish(type, payload) {
    window.postMessage(
      Object.assign(
        {
          source: PAGE_SOURCE,
          type,
          version: VERSION,
          pageUrl: location.href,
          capturedAt: Date.now()
        },
        payload || {}
      ),
      "*"
    );
  }

  function publishCapture(json, sourceUrl) {
    try {
      const articles = articlesFrom(json);
      const responseUrl = absoluteUrl(sourceUrl);
      if (!articles.length || !responseUrl) return;

      latestCapture = {
        articles,
        json,
        responseUrl,
        page: pageNumber(responseUrl),
        expected: expectedCount(json),
        hasMore: explicitHasMore(json),
        capturedAt: Date.now()
      };

      publish("ARTICLES_CAPTURED", {
        articles,
        responseUrl,
        page: latestCapture.page,
        expected: latestCapture.expected,
        hasMore: latestCapture.hasMore
      });
    } catch (_) {
      // 네이버 화면 자체의 동작에 영향을 주지 않도록 감지 오류는 무시합니다.
    }
  }

  async function collectAll(request) {
    if (collecting) {
      publish("COLLECT_ERROR", {
        requestId: request.requestId || "",
        message: "이미 전체 수집을 진행하고 있습니다."
      });
      return;
    }

    if (!nativeFetch) {
      publish("COLLECT_ERROR", {
        requestId: request.requestId || "",
        message: "이 브라우저에서는 전체 수집을 실행할 수 없습니다."
      });
      return;
    }

    const responseUrl = absoluteUrl(
      request.responseUrl ||
      (latestCapture && latestCapture.responseUrl)
    );

    if (!responseUrl || !latestCapture) {
      publish("COLLECT_ERROR", {
        requestId: request.requestId || "",
        message: "선택한 마커의 응답 주소를 찾지 못했습니다. 마커를 다시 눌러주세요."
      });
      return;
    }

    collecting = true;

    const requestId = request.requestId || String(Date.now());
    const limit = Math.min(
      Math.max(Number(request.maxPages) || MAX_PAGE_LIMIT, 1),
      MAX_PAGE_LIMIT
    );
    const baseUrl = new URL(responseUrl);
    const firstPage = pageNumber(responseUrl);
    const found = new Map();
    const firstArticles = latestCapture.articles || [];
    const expected = latestCapture.expected || 0;
    let lastJson = latestCapture.json || {};
    let currentPage = firstPage;
    let observedPageSize = Math.max(firstArticles.length, 1);
    let noNewPageCount = 0;

    firstArticles.forEach((article) => {
      found.set(String(article.articleNo), article);
    });

    publish("COLLECT_PROGRESS", {
      requestId,
      page: currentPage,
      collected: found.size,
      expected,
      message: "선택한 클러스터의 첫 페이지를 확인했습니다."
    });

    try {
      for (let step = 1; step < limit; step += 1) {
        const hasMore = explicitHasMore(lastJson);

        if (hasMore === false) break;
        if (expected && found.size >= expected) break;

        const nextPage = currentPage + 1;
        const target = new URL(baseUrl.href);
        target.searchParams.set("page", String(nextPage));

        const response = await nativeFetch(target.href, {
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*"
          }
        });

        if (!response.ok) {
          throw new Error(
            "네이버 목록 조회 실패(" + response.status + ")"
          );
        }

        const json = await response.json();
        const articles = articlesFrom(json);
        const before = found.size;

        articles.forEach((article) => {
          found.set(String(article.articleNo), article);
        });

        currentPage = nextPage;
        lastJson = json;
        observedPageSize = Math.max(observedPageSize, articles.length);
        noNewPageCount = found.size === before
          ? noNewPageCount + 1
          : 0;

        publish("COLLECT_PROGRESS", {
          requestId,
          page: currentPage,
          collected: found.size,
          expected: expected || expectedCount(json),
          message:
            currentPage + "페이지까지 " + found.size + "건을 수집했습니다."
        });

        if (!articles.length || noNewPageCount >= 1) break;

        const nextHasMore = explicitHasMore(json);
        if (nextHasMore === false) break;

        if (
          nextHasMore === null &&
          !expected &&
          articles.length < observedPageSize
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 140));
      }

      const articles = Array.from(found.values());

      latestCapture = {
        articles,
        json: lastJson,
        responseUrl,
        page: currentPage,
        expected: expected || expectedCount(lastJson),
        hasMore: false,
        capturedAt: Date.now()
      };

      publish("COLLECT_COMPLETE", {
        requestId,
        articles,
        responseUrl,
        page: currentPage,
        collected: articles.length,
        expected: latestCapture.expected,
        message: "클러스터 전체 목록 수집을 완료했습니다."
      });
    } catch (error) {
      publish("COLLECT_ERROR", {
        requestId,
        collected: found.size,
        message: String(error && error.message ? error.message : error)
      });
    } finally {
      collecting = false;
    }
  }

  if (nativeFetch) {
    window.fetch = async function(...args) {
      const response = await nativeFetch(...args);

      try {
        const clone = response.clone();
        const contentType = clone.headers.get("content-type") || "";

        if (contentType.includes("json")) {
          clone.json()
            .then((json) => publishCapture(json, response.url || ""))
            .catch(() => {});
        }
      } catch (_) {}

      return response;
    };
  }

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__jsNaverResponseUrl = absoluteUrl(url);
    return nativeXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("load", function() {
      try {
        let json = null;

        if (this.responseType === "json") {
          json = this.response;
        } else if (!this.responseType || this.responseType === "text") {
          json = JSON.parse(this.responseText);
        }

        publishCapture(json, this.__jsNaverResponseUrl || "");
      } catch (_) {}
    }, {once: true});

    return nativeXhrSend.apply(this, args);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== CONTENT_SOURCE) return;

    if (data.type === "COLLECT_ALL_REQUEST") {
      collectAll(data);
    }
  });
})();

"use strict";

const VERSION = "2.1.1";
const BATCH_SIZE = 30;
const MAX_PAGES = 100;
const RESUME_KEY = "naverBatchResume211";

const $ = (id) => document.getElementById(id);

let listings = [];
let capture = null;
let collectionState = null;
let saving = false;
let activeTabId = null;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function normalize(article, pageUrl) {
  const price = article && article.price ? article.price : {};

  return {
    articleNo: clean(article && article.articleNo),
    buildingName: clean(
      article && (article.buildingName || article.articleName)
    ),
    category: clean(
      article && (
        article.articleRealEstateTypeName ||
        article.realEstateTypeName
      )
    ),
    tradeType: clean(article && article.tradeTypeName),
    deposit: clean(
      article && (
        article.dealOrWarrantPrc ??
        article.depositPrice ??
        price.deposit
      )
    ),
    monthly: clean(
      article && (
        article.rentPrc ??
        article.monthlyPrice ??
        price.monthly
      )
    ),
    areaSquareMeter:
      article && (article.area2 ?? article.area1 ?? ""),
    floorInfo: clean(article && article.floorInfo),
    roomInfo: clean(
      article && (
        article.roomInfo ||
        article.roomName ||
        article.unitInfo
      )
    ),
    direction: clean(article && article.direction),
    description: clean(article && article.articleFeatureDesc),
    tags: Array.isArray(article && article.tagList)
      ? article.tagList
      : [],
    latitude: article && article.latitude || "",
    longitude: article && article.longitude || "",
    realtorName: clean(article && article.realtorName),
    providerUrl: clean(
      article && (article.cpPcArticleUrl || article.cpMobileArticleUrl)
    ),
    currentUrl: pageUrl || ""
  };
}

function floorText(value) {
  const raw = clean(value);
  if (!raw) return "-";

  const current = raw.split("/")[0].trim();
  if (/^-?\d+$/.test(current)) {
    const number = Number(current);
    return number < 0 ? `B${Math.abs(number)}` : `${number}층`;
  }

  const basement = current.match(/^B0*(\d+)$/i);
  if (basement) return `B${Number(basement[1])}`;
  return current;
}

function pyeong(value) {
  const sqm = Number(value);
  return Number.isFinite(sqm) && sqm > 0
    ? `${Math.round((sqm / 3.305785) * 10) / 10}평`
    : "-";
}

function priceText(item) {
  const trade = item.tradeType || "월세";
  if (trade === "월세" || trade === "단기임대") {
    return `${item.deposit || "0"}/${item.monthly || "0"}`;
  }
  return `${trade} ${item.deposit || "0"}`;
}

function setStatus(title, text) {
  $("statusTitle").textContent = title;
  $("statusText").textContent = text;
}

function updateProgress(done, total) {
  const wrap = $("progressWrap");
  const bar = $("progressBar");

  if (!total) {
    wrap.classList.add("hidden");
    bar.style.width = "0%";
    return;
  }

  wrap.classList.remove("hidden");
  bar.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
}

function updateSummary(html) {
  const summary = $("summary");
  if (!html) {
    summary.classList.add("hidden");
    summary.textContent = "";
    return;
  }

  summary.classList.remove("hidden");
  summary.innerHTML = html;
}

function listingSignature(items) {
  const ids = items.map((item) => clean(item.articleNo)).filter(Boolean);
  return [ids.length, ids[0] || "", ids[ids.length - 1] || ""].join("|");
}

async function getActiveNaverTab() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  const tab = tabs && tabs[0];

  if (!tab || !tab.id || !String(tab.url || "").startsWith("https://new.land.naver.com/")) {
    throw new Error("네이버부동산 탭에서 추출기를 열어주세요.");
  }

  activeTabId = tab.id;
  return tab;
}

async function sendToContent(message) {
  if (!activeTabId) await getActiveNaverTab();
  return chrome.tabs.sendMessage(activeTabId, message);
}

async function loadState() {
  try {
    await getActiveNaverTab();
    const response = await sendToContent({type: "GET_NAVER_STATE"});

    if (response && response.capture) {
      applyCapture(response.capture);
    }

    if (response && response.state) {
      applyCollectionState(response.state);
    }
  } catch (error) {
    setStatus("네이버 탭 확인 필요", error.message || String(error));
  }
}

function applyCapture(nextCapture) {
  capture = nextCapture;
  listings = (Array.isArray(nextCapture.articles) ? nextCapture.articles : [])
    .map((article) => normalize(article, nextCapture.pageUrl || ""))
    .filter((item) => item.articleNo);

  render();
}

function applyCollectionState(state) {
  collectionState = state || null;
  if (!state) return;

  const collected = Number(state.collected) || 0;
  const expected = Number(state.expected) || 0;

  if (state.status === "collecting") {
    setStatus(
      "클러스터 전체 수집 중",
      state.message || `${collected}건을 확인했습니다.`
    );
    updateProgress(collected, expected || Math.max(collected + 1, 1));
    $("collectAllBtn").disabled = true;
    return;
  }

  if (state.status === "complete") {
    setStatus(
      "전체 목록 수집 완료",
      `${collected}건을 모았습니다. 이제 전체 저장을 누르세요.`
    );
    updateProgress(collected, collected || 1);
    return;
  }

  if (state.status === "error") {
    setStatus("전체 수집 오류", state.message || "다시 시도해주세요.");
    updateProgress(0, 0);
    return;
  }

  if (state.status === "detected") {
    setStatus(
      "매물 감지 성공",
      collected === 1
        ? "매물 1건을 찾았습니다."
        : `같은 마커에서 ${collected}건을 찾았습니다.`
    );
  }
}

function render() {
  const wrap = $("listWrap");
  const list = $("list");
  list.innerHTML = "";

  const hasListings = listings.length > 0;
  $("collectAllBtn").disabled = !hasListings || saving;
  $("saveAllBtn").disabled = !hasListings || saving;

  if (!hasListings) {
    wrap.classList.add("hidden");
    $("count").textContent = "";
    return;
  }

  wrap.classList.remove("hidden");
  $("count").textContent = `${listings.length}건`;
  $("saveAllBtn").textContent = `${listings.length}건 전체 저장`;

  listings.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "card";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent =
      `${priceText(item)} · ${pyeong(item.areaSquareMeter)} · ${floorText(item.floorInfo)}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent =
      `${item.category || "구분 없음"} · ${item.buildingName || "건물명 없음"} · ${item.articleNo}`;

    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = item.description || "매물설명 없음";

    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = "이 매물만 저장";
    button.addEventListener("click", () => saveOne(index, button));

    card.append(price, meta, desc, button);
    list.appendChild(card);
  });
}

async function postBatch(items) {
  const webhookUrl = $("webhookUrl").value.trim();
  const accessKey = $("accessKey").value.trim();

  if (!webhookUrl) {
    throw new Error("설정에서 JS부동산 D1 API URL을 먼저 저장해주세요.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({
        action: "saveNaverBatch",
        accessKey,
        data: items
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error("JS부동산 D1 응답을 읽지 못했습니다.");
    }

    if (!result.ok) {
      throw new Error(result.message || "저장에 실패했습니다.");
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function saveOne(index, button) {
  const item = listings[index];
  button.disabled = true;
  button.textContent = "저장 중...";

  try {
    const result = await postBatch([item]);

    if (Number(result.saved) > 0) {
      button.textContent = "저장 완료";
      setStatus("저장 완료", "선택한 매물을 JS부동산 D1에 저장했습니다.");
    } else if (Number(result.duplicate) > 0) {
      button.textContent = "이미 저장됨";
      setStatus("중복 매물", "기존 매물과 조건이 같아 저장하지 않았습니다.");
    } else {
      button.textContent = "저장 제외";
      setStatus(
        "저장 결과 확인",
        result.failures && result.failures[0]
          ? result.failures[0].message
          : "저장된 매물이 없습니다."
      );
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = "다시 저장";
    setStatus("저장 실패", error.name === "AbortError"
      ? "저장 시간이 초과되었습니다. 다시 눌러주세요."
      : error.message || String(error));
  }
}

async function saveAll() {
  if (saving || !listings.length) return;

  saving = true;
  render();
  $("collectAllBtn").disabled = true;

  const signature = listingSignature(listings);
  const stored = await chrome.storage.local.get([RESUME_KEY]);
  const oldResume = stored[RESUME_KEY];
  let index = oldResume && oldResume.signature === signature
    ? Number(oldResume.nextIndex) || 0
    : 0;
  const totals = oldResume && oldResume.signature === signature
    ? Object.assign({saved: 0, duplicate: 0, failed: 0}, oldResume.totals)
    : {saved: 0, duplicate: 0, failed: 0};

  try {
    while (index < listings.length) {
      const batch = listings.slice(index, index + BATCH_SIZE);
      const from = index + 1;
      const to = index + batch.length;

      setStatus(
        "전체 저장 중",
        `${from}~${to}번 매물을 저장하고 있습니다. 창을 닫지 마세요.`
      );
      updateProgress(index, listings.length);

      const result = await postBatch(batch);
      totals.saved += Number(result.saved) || 0;
      totals.duplicate += Number(result.duplicate) || 0;
      totals.failed += Number(result.failed) || 0;
      index += batch.length;

      await chrome.storage.local.set({
        [RESUME_KEY]: {
          version: VERSION,
          signature,
          nextIndex: index,
          totals,
          total: listings.length,
          updatedAt: Date.now()
        }
      });

      updateSummary(
        `저장 <strong>${totals.saved}</strong> · 중복 <strong>${totals.duplicate}</strong> · 실패 <strong>${totals.failed}</strong>`
      );

      await new Promise((resolve) => setTimeout(resolve, 220));
    }

    await chrome.storage.local.remove([RESUME_KEY]);
    updateProgress(listings.length, listings.length);
    setStatus(
      "전체 저장 완료",
      `신규 ${totals.saved}건, 중복 ${totals.duplicate}건, 실패 ${totals.failed}건입니다.`
    );
  } catch (error) {
    setStatus(
      "저장 중단",
      `${index}건까지 처리했습니다. 다시 누르면 중단 지점부터 이어서 저장합니다. ${error.message || error}`
    );
  } finally {
    saving = false;
    render();

    const resume = (await chrome.storage.local.get([RESUME_KEY]))[RESUME_KEY];
    if (resume && resume.signature === signature) {
      $("saveAllBtn").textContent = `${resume.nextIndex}건 이후 이어서 저장`;
    }
  }
}

$("settingsBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({
    naverWebhookUrl: $("webhookUrl").value.trim(),
    naverAccessKey: $("accessKey").value.trim()
  });
  setStatus("설정 저장 완료", "마커를 다시 클릭하면 매물을 감지합니다.");
});

$("collectAllBtn").addEventListener("click", async () => {
  try {
    const response = await sendToContent({
      type: "COLLECT_ALL",
      requestId: String(Date.now()),
      maxPages: MAX_PAGES
    });

    if (!response || !response.ok) {
      throw new Error(response && response.message
        ? response.message
        : "전체 수집을 시작하지 못했습니다.");
    }

    $("collectAllBtn").disabled = true;
    setStatus("전체 수집 시작", "클러스터의 다음 페이지를 차례로 불러옵니다.");
  } catch (error) {
    setStatus("전체 수집 실패", error.message || String(error));
  }
});

$("saveAllBtn").addEventListener("click", saveAll);

$("clearBtn").addEventListener("click", async () => {
  try {
    await sendToContent({type: "CLEAR_NAVER_STATE"});
  } catch (_) {}

  await chrome.storage.local.remove([RESUME_KEY]);
  listings = [];
  capture = null;
  collectionState = null;
  updateProgress(0, 0);
  updateSummary("");
  render();
  setStatus("감지 내용 삭제", "네이버 지도에서 원하는 마커를 다시 클릭하세요.");
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "NAVER_COLLECTION_EVENT") return;
  if (message.capture) applyCapture(message.capture);
  if (message.state) applyCollectionState(message.state);
});

async function init() {
  const stored = await chrome.storage.local.get([
    "naverWebhookUrl",
    "naverAccessKey",
    RESUME_KEY
  ]);

  $("webhookUrl").value = stored.naverWebhookUrl || "https://js-map.com/api/collector";
  $("accessKey").value = stored.naverAccessKey || "JS_NAVER_EXTRACT_2026";

  await loadState();

  if (stored[RESUME_KEY] && listings.length) {
    const resume = stored[RESUME_KEY];
    if (resume.signature === listingSignature(listings)) {
      $("saveAllBtn").textContent = `${resume.nextIndex}건 이후 이어서 저장`;
      updateSummary(
        `이전 저장 진행률: <strong>${resume.nextIndex}/${resume.total}</strong>`
      );
    }
  }
}

init();

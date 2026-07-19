(function () {
  "use strict";

  var VERSION = "1.1.1";
  var PANEL_ID = "js-gongsil-collector-panel";
  var STYLE_ID = "js-gongsil-collector-style";
  var APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzPedWbaT4yaLNxqrvKI9F3L4JVZ0Q8wVnsSyLEELmaW2h9QuyfGYsESW_7rDxbdqNw/exec";
  // Invalidate keys saved during the initial security rollout. Some browsers
  // saved the instruction line instead of the actual collector key.
  var COLLECTOR_KEY_STORAGE = "js_gongsil_collector_access_key_v2";

  if (!/gongsilbox\.com$/i.test(location.hostname)) {
    alert("공실박스 지도에서 실행해 주세요.");
    return;
  }

  if (window.__JS_GONGSIL_COLLECTOR__) {
    window.__JS_GONGSIL_COLLECTOR__.reopen();
    return;
  }

  var originalFetch = window.fetch.bind(window);
  var state = {
    active: true,
    busy: false,
    capture: null,
    capturedAt: 0,
    detailAuth: null,
    detailCache: {}
  };

  var panel = createPanel();
  var statusElement = panel.querySelector("[data-role=status]");
  var detailElement = panel.querySelector("[data-role=detail]");
  var saveButton = panel.querySelector("[data-action=save]");
  var closeButton = panel.querySelector("[data-action=close]");

  patchFetch();
  setStatus(
    "수집할 숫자 클러스터를 클릭하세요.",
    "공실박스 지도에서 원하는 숫자 원을 한 번 누르면 저장 버튼이 활성화됩니다."
  );

  saveButton.addEventListener("click", collectAndSave);
  closeButton.addEventListener("click", closePanel);

  window.__JS_GONGSIL_COLLECTOR__ = {
    version: VERSION,
    reopen: function () {
      state.active = true;
      panel.style.display = "block";
      patchFetch();
      if (state.capture) {
        showCapture(state.capture);
      } else {
        setStatus(
          "수집할 숫자 클러스터를 클릭하세요.",
          "원하는 숫자 원을 한 번 누르면 저장 버튼이 활성화됩니다."
        );
      }
    },
    getCapture: function () {
      return state.capture;
    },
    setDetailAuth: function (auth) {
      state.detailAuth = auth || null;
    },
    transformItem: transformItem,
    decryptText: decryptText
  };

  function getCollectorKey() {
    var saved = "";
    try {
      saved = String(localStorage.getItem(COLLECTOR_KEY_STORAGE) || "").trim();
    } catch (_) {}
    if (saved) return saved;

    var entered = String(window.prompt(
      "공실박스 수집기 보안키를 입력하세요.\n(이 PC에서는 최초 1회만 입력합니다.)",
      ""
    ) || "").trim();
    if (!entered) throw new Error("공실박스 수집기 보안키가 필요합니다.");
    try {
      localStorage.setItem(COLLECTOR_KEY_STORAGE, entered);
    } catch (_) {}
    return entered;
  }

  function createPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "#" + PANEL_ID + "{" +
        "position:fixed;right:16px;bottom:18px;z-index:2147483647;" +
        "width:min(360px,calc(100vw - 24px));box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;" +
        "background:#fff;border:1px solid #d7e3f4;border-radius:16px;" +
        "box-shadow:0 16px 45px rgba(15,23,42,.24);overflow:hidden;color:#172033}" +
        "#" + PANEL_ID + " *{box-sizing:border-box}" +
        "#" + PANEL_ID + " .jsg-head{display:flex;align-items:center;justify-content:space-between;" +
        "padding:13px 15px;background:linear-gradient(135deg,#1677ff,#075fe4);color:#fff}" +
        "#" + PANEL_ID + " .jsg-title{font-size:16px;font-weight:800;letter-spacing:-.3px}" +
        "#" + PANEL_ID + " .jsg-version{font-size:10px;opacity:.75;margin-left:6px}" +
        "#" + PANEL_ID + " .jsg-close{width:32px;height:32px;border:0;border-radius:9px;" +
        "background:rgba(255,255,255,.16);color:#fff;font-size:22px;line-height:30px;cursor:pointer}" +
        "#" + PANEL_ID + " .jsg-body{padding:15px}" +
        "#" + PANEL_ID + " .jsg-status{font-size:15px;font-weight:800;line-height:1.45;color:#172033}" +
        "#" + PANEL_ID + " .jsg-detail{margin-top:7px;color:#667085;font-size:12px;line-height:1.55;" +
        "white-space:pre-line;max-height:116px;overflow:auto}" +
        "#" + PANEL_ID + " .jsg-rule{margin-top:12px;padding:10px 11px;background:#f3f7fd;" +
        "border-radius:10px;color:#3e536f;font-size:11px;line-height:1.55}" +
        "#" + PANEL_ID + " .jsg-save{width:100%;height:46px;margin-top:12px;border:0;border-radius:11px;" +
        "font-size:15px;font-weight:800;color:#fff;background:#1677ff;cursor:pointer}" +
        "#" + PANEL_ID + " .jsg-save:disabled{cursor:not-allowed;background:#c7d2e3;color:#f7f9fc}" +
        "@media(max-width:640px){#" + PANEL_ID + "{right:8px;bottom:8px;width:calc(100vw - 16px)}}" ;
      document.head.appendChild(style);
    }

    var element = document.createElement("section");
    element.id = PANEL_ID;
    element.innerHTML =
      '<div class="jsg-head">' +
        '<div class="jsg-title">JS 공실박스 수집기 <span class="jsg-version">v' + VERSION + '</span></div>' +
        '<button type="button" class="jsg-close" data-action="close" aria-label="닫기">×</button>' +
      '</div>' +
      '<div class="jsg-body">' +
        '<div class="jsg-status" data-role="status"></div>' +
        '<div class="jsg-detail" data-role="detail"></div>' +
        '<div class="jsg-rule">저장 위치: JS부동산 매물현황<br>' +
        '전화번호: 세입자만 K열 · 나머지는 J열<br>' +
        '메모: 항상 (임장가자)로 시작</div>' +
        '<button type="button" class="jsg-save" data-action="save" disabled>' +
          '선택 클러스터 전체 저장' +
        '</button>' +
      '</div>';
    document.body.appendChild(element);
    return element;
  }

  function patchFetch() {
    if (window.fetch && window.fetch.__jsGongsilPatched) return;

    var wrappedFetch = async function (input, init) {
      var response = await originalFetch(input, init);
      if (state.active && isListRequest(input)) {
        captureListRequest(input, init, response.clone()).catch(function (error) {
          console.warn("[JS 공실박스] 목록 포착 실패", error);
        });
      }
      if (state.active && isDetailRequest(input)) {
        captureDetailRequest(input, init, response.clone()).catch(function (error) {
          console.warn("[JS 공실박스] 상세정보 포착 실패", error);
        });
      }
      return response;
    };
    wrappedFetch.__jsGongsilPatched = true;
    wrappedFetch.__jsGongsilOriginal = originalFetch;
    window.fetch = wrappedFetch;
  }

  function isListRequest(input) {
    var url = typeof input === "string"
      ? input
      : input && input.url
        ? input.url
        : "";
    return /\/api\/maps\/lists(?:\?|$)/i.test(url);
  }

  function isDetailRequest(input) {
    var url = typeof input === "string"
      ? input
      : input && input.url
        ? input.url
        : "";
    return /\/maps\/mmview(?:\?|$)/i.test(url);
  }

  async function captureDetailRequest(input, init, response) {
    var source = "";
    if (init && typeof init.body === "string") {
      source = init.body;
    } else if (input && typeof input.clone === "function") {
      try {
        source = await input.clone().text();
      } catch (_) {}
    }
    if (!source) return;

    var body;
    var result;
    try {
      body = JSON.parse(source);
      result = await response.json();
    } catch (_) {
      return;
    }

    if (body && body.mid) {
      state.detailAuth = {
        mid: body.mid,
        guest: body.guest === true,
        endpoint: requestUrl(input) || "/maps/mmview",
        template: Object.assign({}, body)
      };
    }

    if (result && result.res === "success" && result.data) {
      state.detailCache[detailKey(body)] = result.data;
    }
  }

  async function captureListRequest(input, init, response) {
    var text = "";

    if (init && typeof init.body === "string") {
      text = init.body;
    } else if (input && typeof input.clone === "function") {
      try {
        text = await input.clone().text();
      } catch (_) {}
    }

    if (!text) return;

    var body;
    var data;
    try {
      body = JSON.parse(text);
      data = await response.json();
    } catch (_) {
      return;
    }

    if (
      !body ||
      (!Array.isArray(body.bfidxs) && !Array.isArray(body.bidxs)) ||
      !data ||
      data.res !== "success"
    ) {
      return;
    }

    state.capture = {
      body: body,
      response: data
    };
    state.capturedAt = Date.now();
    showCapture(state.capture);
  }

  function showCapture(capture) {
    var items = getListItems(capture.response);
    var selectedCount = unique(
      (capture.body.bfidxs || []).map(String)
    ).length;
    var countText = selectedCount
      ? "선택된 매물번호 " + selectedCount + "개"
      : "목록 " + items.length + "개";

    setStatus(
      "클러스터를 확인했습니다.",
      countText + " · 화면 목록 " + items.length + "개\n아래 버튼을 누르면 전체 목록과 전화번호를 저장합니다."
    );
    saveButton.disabled = false;
    saveButton.textContent = "선택 클러스터 전체 저장";
  }

  async function collectAndSave() {
    if (state.busy) return;
    if (!state.capture) {
      alert("먼저 공실박스 지도에서 수집할 숫자 클러스터를 클릭해 주세요.");
      return;
    }

    state.busy = true;
    saveButton.disabled = true;

    try {
      setStatus("클러스터 전체 목록을 읽는 중입니다.", "잠시만 기다려 주세요.");
      var items = await loadAllCapturedItems(state.capture);

      if (!items.length) {
        throw new Error("선택한 클러스터에서 매물을 찾지 못했습니다.");
      }

      await ensureDetailAuth();

      setStatus(
        "지번주소와 전화번호를 확인하는 중입니다.",
        "전체 " + items.length + "개 · 공실박스에 보이는 번호를 자동 분류합니다."
      );

      var transformed = [];
      var rejected = [];
      var completed = 0;
      // 공실박스 상세조회는 화면에서 한 건씩 여는 흐름을 기준으로 동작합니다.
      // 동시에 여러 건을 요청하면 정상 세션에서도 일부 상세 응답이 누락될 수 있습니다.
      var queueResult = await mapWithConcurrency(items, 1, async function (item) {
        var result;
        try {
          result = await transformItem(item, state.capture.body);
        } catch (error) {
          result = {
            ok: false,
            reason: error && error.message ? error.message : String(error)
          };
        }

        completed += 1;
        if (completed === items.length || completed % 5 === 0) {
          setStatus(
            "지번주소와 전화번호를 확인하는 중입니다.",
            completed + " / " + items.length + "개 처리"
          );
        }
        return result;
      });

      queueResult.forEach(function (result) {
        if (result && result.ok) transformed.push(result.record);
        else rejected.push(result && result.reason ? result.reason : "변환 실패");
      });

      if (!transformed.length) {
        throw new Error(
          "저장 가능한 매물이 없습니다.\n" + rejectedSummary(rejected)
        );
      }

      setStatus(
        "JS부동산 매물현황으로 전송 중입니다.",
        transformed.length + "개 저장 · 변환 제외 " + rejected.length + "개"
      );

      var result = await sendToAppsScript(transformed);
      if (!result || result.ok !== true) {
        if (
          result &&
          String(result.message || "").indexOf("승인되지 않은 요청") !== -1
        ) {
          try {
            localStorage.removeItem(COLLECTOR_KEY_STORAGE);
          } catch (_) {}
        }
        throw new Error(
          result && result.message
            ? result.message
            : "Apps Script에서 저장 성공 응답을 받지 못했습니다."
        );
      }
      var message = result && result.message
        ? result.message
        : "공실박스 매물 전송을 완료했습니다.";

      setStatus(
        "저장 완료",
        message + (rejected.length
          ? "\n변환 제외 " + rejected.length + "개\n" + rejectedSummary(rejected)
          : "")
      );
      saveButton.textContent = "저장 완료 · 다시 수집 가능";
    } catch (error) {
      console.error("[JS 공실박스] 수집 오류", error);
      setStatus(
        "수집 중 오류가 발생했습니다.",
        error && error.message ? error.message : String(error)
      );
      saveButton.textContent = "다시 시도";
    } finally {
      state.busy = false;
      saveButton.disabled = false;
    }
  }

  async function loadAllCapturedItems(capture) {
    var byId = {};
    addItems(byId, getListItems(capture.response));

    if (!capture.response.more) {
      return Object.keys(byId).map(function (key) { return byId[key]; });
    }

    var sizes = [500, 1000, 2000, 5000, 10000];
    for (var index = 0; index < sizes.length; index += 1) {
      var body = Object.assign({}, capture.body, {
        mxline: sizes[index],
        key: Number(capture.body.key || 0) + index + 101
      });
      var response = await originalFetch("/api/maps/lists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      var data = await response.json();

      if (!data || data.res !== "success") {
        throw new Error(data && data.message ? data.message : "공실박스 목록 조회에 실패했습니다.");
      }

      addItems(byId, getListItems(data));
      setStatus(
        "클러스터 전체 목록을 읽는 중입니다.",
        Object.keys(byId).length + "개 확인"
      );

      if (!data.more) break;
    }

    return Object.keys(byId).map(function (key) { return byId[key]; });
  }

  async function ensureDetailAuth() {
    if (state.detailAuth && state.detailAuth.mid) return state.detailAuth;

    setStatus(
      "상세 연락처 연결이 한 번 필요합니다.",
      "매물 목록에서 아무 매물의 호실 또는 매물번호를 한 번 눌러 상세창을 열어 주세요.\n연결되는 즉시 전체 수집을 자동으로 계속합니다."
    );
    saveButton.textContent = "상세창 연결 대기 중";

    for (var attempt = 0; attempt < 360; attempt += 1) {
      if (state.detailAuth && state.detailAuth.mid) return state.detailAuth;
      await delay(250);
    }
    throw new Error(
      "상세 연락처 연결 시간이 초과되었습니다. 매물 상세창을 한 번 연 뒤 다시 저장해 주세요."
    );
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function addItems(target, items) {
    items.forEach(function (item, index) {
      var id = text(pick(item, ["Bfidx", "bfidx", "BfIdx", "id"]));
      if (!id) id = "row-" + index + "-" + JSON.stringify(item).slice(0, 100);
      target[id] = item;
    });
  }

  function getListItems(data) {
    if (!data) return [];
    if (Array.isArray(data.datas)) return data.datas;
    if (data.datas && Array.isArray(data.datas.res)) return data.datas.res;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  async function transformItem(item, requestBody) {
    var requestId = text(requestBody.reqsID);
    var addressData = await decryptAddressData(item, requestId);
    var address = buildLotAddress(item, addressData);

    if (!address || !/\d/.test(address)) {
      return { ok: false, reason: "지번주소 없음" };
    }

    var rental = getRentalTerms(item);
    if (!rental) {
      return { ok: false, reason: "임대조건 없음" };
    }

    var phones = await collectPhones(item, requestBody, addressData);
    var memo = appendPhoneMemo(buildMemo(item), phones.extraMemo);
    var pyeong = getPyeong(item);
    var values = [
      getBuildingName(item),
      address,
      getRoom(item),
      getPropertyType(item),
      rental.deposit,
      rental.rent,
      getManagementFee(item),
      getPremium(item),
      pyeong,
      phones.landlordPrimary,
      phones.tenantPrimary,
      memo,
      "",
      "",
      "공실박스"
    ];

    return {
      ok: true,
      record: {
        externalId: text(pick(item, ["Bfidx", "bfidx", "BfIdx"])),
        values: values
      }
    };
  }

  async function decryptAddressData(item, requestId) {
    return {
      addr: await decryptText(pick(item, ["Addr", "addr"]), requestId),
      road: await decryptText(pick(item, ["AddrRoad", "addrRoad"]), requestId),
      bun1: await decryptText(pick(item, ["AddrBun1", "addrBun1"]), requestId),
      bun2: await decryptText(pick(item, ["AddrBun2", "addrBun2"]), requestId)
    };
  }

  async function decryptText(value, requestId) {
    var source = text(value);
    if (!source || !requestId) return source;
    if (/[\u3131-\uD79D]/.test(source) && !/^[0-9a-f]+$/i.test(source)) return source;

    try {
      var payload = decodeCipher(source);
      if (payload.length < 29) return source;

      var keyBytes = new Uint8Array(32);
      var encodedKey = new TextEncoder().encode(requestId);
      keyBytes.set(encodedKey.slice(0, 32));
      var cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
      var plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: payload.slice(0, 12)
        },
        cryptoKey,
        payload.slice(12)
      );
      return new TextDecoder().decode(plain);
    } catch (_) {
      return source;
    }
  }

  function decodeCipher(source) {
    if (/^[0-9a-f]+$/i.test(source) && source.length % 2 === 0) {
      var hex = new Uint8Array(source.length / 2);
      for (var index = 0; index < hex.length; index += 1) {
        hex[index] = parseInt(source.slice(index * 2, index * 2 + 2), 16);
      }
      return hex;
    }

    var binary = atob(source.replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildLotAddress(item, decrypted) {
    var full = cleanAddress(decrypted.addr);
    var province = text(pick(item, ["AddrDo", "Do", "addrdo"]));
    var city = text(pick(item, ["AddrSi", "AddrCity", "City", "addrcity"]));
    var dong = text(pick(item, ["AddrDong", "Dong", "addrdong"]));
    var lee = text(pick(item, ["AddrLee", "Lee", "addrlee"]));
    var district = getDistrict(item, city);

    if (full && /\d/.test(full) && !/로|길\s*\d/.test(full)) {
      if (district && !/(?:^|\s)[가-힣]+구(?:\s|$)/.test(full)) {
        full = district + " " + full;
      }
      return cleanAddress(full);
    }

    var mountain = truthy(pick(item, ["AddrSan", "San", "addrsan"])) ? "산 " : "";
    var bun1 = text(decrypted.bun1).replace(/[^0-9]/g, "");
    var bun2 = text(decrypted.bun2).replace(/[^0-9]/g, "");
    var number = bun1 ? mountain + bun1 + (bun2 && bun2 !== "0" ? "-" + bun2 : "") : "";
    var composed = [province, city, dong, lee, number].filter(Boolean).join(" ");
    composed = cleanAddress(composed);

    if (composed && /\d/.test(composed)) return composed;
    if (full && /\d/.test(full)) return full;
    return "";
  }

  function getDistrict(item, city) {
    var candidates = [
      city,
      pick(item, ["AddrCity", "City", "addrcity"]),
      pick(item, ["AddrSi", "Si", "addrsi"]),
      pick(item, ["Sigungu", "Gu", "District"])
    ].map(text);

    for (var index = 0; index < candidates.length; index += 1) {
      var match = candidates[index].match(/(?:^|\s)([가-힣]+구)(?:\s|$)/);
      if (match) return match[1];
    }
    return "";
  }

  function cleanAddress(value) {
    return text(value)
      .replace(/대전광역시|대전시/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getRentalTerms(item) {
    var deposit = numberValue(pick(item, ["Bo", "Deposit", "MmDeposit"]));
    var rent = numberValue(pick(item, ["Mm", "Monthly", "MmMonthly", "Rent"]));

    if (!deposit && !rent) {
      deposit = numberValue(pick(item, ["Jun", "JeonseDeposit"]));
      rent = numberValue(pick(item, ["Jmm", "JeonseMonthly"]));
    }

    var moneys = pick(item, ["Moneys", "moneys"]);
    if ((!deposit && !rent) && Array.isArray(moneys)) {
      var rentalMoney = moneys.find(function (money) {
        var type = text(money && money.Ty);
        return type === "월세" || type === "반전세" || type === "전세";
      });
      if (rentalMoney) {
        deposit = numberValue(rentalMoney.Bo);
        rent = numberValue(rentalMoney.Mm);
      }
    }

    if (!deposit && !rent) return null;
    return {
      deposit: deposit || 0,
      rent: rent || 0
    };
  }

  function getBuildingName(item) {
    return text(pick(item, ["Bilname", "BilName", "Bname", "BuildingName"])) ||
      text(pick(item, ["TypeView", "ViewType"])) ||
      "상가";
  }

  function getRoom(item) {
    var room = text(pick(item, ["Ho", "BfHo", "Room", "Honame"]));
    if (room && room !== "전체" && room !== "0") {
      return /호$/.test(room) ? room : room + "호";
    }

    var floor = Number(pick(item, ["Ff", "BfFloor", "Floor", "floor"]));
    if (!Number.isFinite(floor)) return "";
    if (floor < 0) return "지하" + Math.abs(floor) + "층";
    if (floor === 0) return "";
    return floor + "층";
  }

  function getPropertyType(item) {
    var type = text(pick(item, ["TypeView", "ViewType", "LndType", "Type"]));
    if (/사무/.test(type)) return "사무실";
    if (/공장|창고/.test(type)) return "공장/창고";
    if (/상가|점포|근린/.test(type)) {
      return truthy(pick(item, ["Ckhus", "Collective", "IsCollective"]))
        ? "집합상가"
        : "일반상가";
    }
    return type || "상가";
  }

  function getPyeong(item) {
    var pyeong = numberValue(pick(item, ["Area", "Pyeong", "Py", "AreaPy"]));
    if (pyeong) return trimNumber(pyeong);

    var squareMeters = numberValue(pick(item, ["BfArea", "AreaM2", "Areatxt"]));
    return squareMeters ? trimNumber(squareMeters * 0.3025) : "";
  }

  function getPremium(item) {
    var direct = numberValue(
      pick(item, ["Premium", "Gwon", "Gwonri", "BfPremium", "RightMoney"])
    );
    if (direct) return direct;

    var gongsilPremium = text(pick(item, ["Gul", "gul"]));
    if (/^\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|만원|원)?$/.test(gongsilPremium)) {
      return numberValue(gongsilPremium);
    }

    var note = [
      pick(item, ["Memo", "BfMemo"]),
      pick(item, ["Note", "BfAdnote2"]),
      pick(item, ["Hoetc", "Gul"])
    ].map(text).join(" ");
    var pMatch = note.match(/(?:^|[\s,·|/])p\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)(?=$|[\s,·|/])/i);
    if (pMatch) return numberValue(pMatch[1]);

    var match = note.match(/(?:권리금?|권)\s*[:：]?\s*(?:(\d+(?:\.\d+)?)\s*억)?\s*(\d[\d,]*(?:\.\d+)?)?\s*(?:만\s*원|만원|원)?/);
    if (!match) return "";

    var eok = Number(match[1] || 0) * 10000;
    var man = Number(String(match[2] || "0").replace(/,/g, ""));
    var total = eok + man;
    return total || "";
  }

  function getManagementFee(item) {
    var direct = numberValue(
      pick(item, ["Gal", "BfGalMoney", "ManagementFee", "ManageFee"])
    );
    if (direct) return direct;

    var note = [
      pick(item, ["Memo", "BfMemo"]),
      pick(item, ["Note", "BfAdnote2"]),
      pick(item, ["Hoetc", "Gul"])
    ].map(text).join(" ");
    var match = note.match(/(?:관리비|관)\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)/);
    return match ? numberValue(match[1]) : "";
  }

  function buildMemo(item) {
    var parts = [];
    var moveDate = text(pick(item, ["MoveDate", "BfMoveDate", "MoveInDate"]));
    if (moveDate) parts.push("입주 " + moveDate);

    var currentBusiness = text(
      pick(item, ["CurrentBusiness", "CurrentIndustry", "NowBusiness", "Uptype", "BusinessType"])
    );
    if (currentBusiness) parts.push("현재업종 " + currentBusiness);

    [
      pick(item, ["Memo", "BfMemo"]),
      pick(item, ["Note", "BfAdnote2"]),
      pick(item, ["Hoetc"]),
      gongsilMemoValue(pick(item, ["Gul", "gul"]))
    ].forEach(function (value) {
      addMemoPart(parts, value);
    });

    var detail = unique(
      parts.map(function (part) {
        return text(part).replace(/\s+/g, " ");
      }).filter(Boolean)
    ).join(" · ").slice(0, 880);
    return "(임장가자)" + (detail ? " " + detail : "");
  }

  function addMemoPart(parts, value) {
    if (Array.isArray(value)) {
      value.forEach(function (entry) { addMemoPart(parts, entry); });
      return;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        addMemoPart(parts, value[key]);
      });
      return;
    }
    var part = cleanMemoFinancialTokens(text(value));
    if (!part || part === "0" || part === "false") return;
    if (/^(공실박스|출처\s*공실박스)$/i.test(part)) return;
    parts.push(part);
  }

  function gongsilMemoValue(value) {
    var source = text(value);
    if (/^\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|만원|원)?$/.test(source)) {
      return "";
    }
    return source;
  }

  function cleanMemoFinancialTokens(value) {
    return text(value)
      .replace(
        /(?:권리금?|권)\s*[:：]?\s*(?:(?:\d+(?:\.\d+)?)\s*억(?:\s*\d[\d,]*(?:\.\d+)?)?|\d[\d,]*(?:\.\d+)?)\s*(?:만\s*원|만원|원)?/g,
        " "
      )
      .replace(
        /(?:관리비|관)\s*[:：]?\s*\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|만원|원)?/g,
        " "
      )
      .replace(
        /(?:^|[\s,·|/])p\s*[:：]?\s*\d[\d,]*(?:\.\d+)?(?=$|[\s,·|/])/gi,
        " "
      )
      .replace(/\s*([,·|/])\s*(?=$|[,·|/])/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function collectPhones(item, requestBody, addressData) {
    var contacts = [];
    var candidates = [];

    var detail = await fetchDetailData(item);
    if (detail && detail.bilinfo && Array.isArray(detail.bilinfo.tels)) {
      candidates = candidates.concat(detail.bilinfo.tels);
    }
    if (detail && detail.floorinfo && Array.isArray(detail.floorinfo.Tels)) {
      candidates = candidates.concat(detail.floorinfo.Tels);
    }

    ["Btel", "Ftel", "Tels", "TelList", "Phones"].forEach(function (key) {
      var value = item[key];
      if (Array.isArray(value)) candidates = candidates.concat(value);
      else if (value && typeof value === "object") candidates.push(value);
    });

    if (!candidates.length) {
      var direct = pick(item, ["Tel", "Phone", "OwnerTel"]);
      if (direct) candidates.push({ Tel: direct, Ty: "J" });
    }

    var seenTidx = {};
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index] || {};
      var tidx = text(pick(candidate, ["Tidx", "tidx", "Tid", "id"]));
      if (tidx && seenTidx[tidx]) continue;
      if (tidx) seenTidx[tidx] = true;

      var phone = normalizePhone(pick(candidate, ["Tel", "tel", "Phone", "phone"]));
      var label = text(pick(candidate, ["Type2", "Ty", "Type", "Label", "Name"]));
      var tenantHint = isTenantLabel(label);

      if (!phone) continue;
      contacts.push({
        phone: phone,
        label: contactLabel(tenantHint ? "S" : label),
        tenant: tenantHint || isTenantLabel(label)
      });
    }

    var byPhone = {};
    contacts.forEach(function (contact) {
      var existing = byPhone[contact.phone];
      if (!existing || (!existing.tenant && contact.tenant)) {
        byPhone[contact.phone] = contact;
      } else if (
        existing &&
        existing.label === "기타연락처" &&
        contact.label !== "기타연락처"
      ) {
        existing.label = contact.label;
      }
    });

    var uniqueContacts = Object.keys(byPhone).map(function (phone) {
      return byPhone[phone];
    });
    var tenantContacts = uniqueContacts.filter(function (contact) {
      return contact.tenant;
    });
    var landlordContacts = uniqueContacts.filter(function (contact) {
      return !contact.tenant;
    });
    landlordContacts.sort(function (left, right) {
      return landlordPriority(right.label) - landlordPriority(left.label);
    });

    var primary = landlordContacts.length ? landlordContacts[0] : null;
    var extras = landlordContacts.slice(1).map(function (contact, index) {
      var label = contact.label;
      if (label === "주인" && primary && primary.label === "주인") {
        label = "주인 추가번호" + (index > 0 ? " " + (index + 1) : "");
      }
      return label + ": " + contact.phone;
    });
    tenantContacts.slice(1).forEach(function (contact, index) {
      extras.push(
        "세입자 추가번호" + (index > 0 ? " " + (index + 1) : "") +
        ": " + contact.phone
      );
    });

    return {
      landlordPrimary: primary ? primary.phone : "",
      tenantPrimary: tenantContacts.length ? tenantContacts[0].phone : "",
      extraMemo: extras
    };
  }

  function detailKey(source) {
    return [
      text(pick(source, ["Bidx", "bidx"])),
      text(pick(source, ["Bfidx", "bfidx"])),
      text(pick(source, ["Admidx", "adidx", "admidx"]))
    ].join(":");
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    return input && input.url ? input.url : "";
  }

  async function fetchDetailData(item) {
    var key = detailKey(item);
    if (state.detailCache[key]) return state.detailCache[key];
    if (!state.detailAuth || !state.detailAuth.mid) return null;

    var payload = Object.assign({}, state.detailAuth.template || {}, {
      mid: state.detailAuth.mid,
      guest: state.detailAuth.guest === true,
      bidx: pick(item, ["Bidx", "bidx"]),
      bfidx: pick(item, ["Bfidx", "bfidx"]),
      adidx: pick(item, ["Admidx", "adidx", "admidx"]),
      pidx: ""
    });

    if (
      isMissingIdentifier(payload.bidx) ||
      isMissingIdentifier(payload.bfidx) ||
      isMissingIdentifier(payload.adidx)
    ) {
      throw new Error(
        "상세조회 식별값 누락 (bidx=" + text(payload.bidx) +
        ", bfidx=" + text(payload.bfidx) +
        ", adidx=" + text(payload.adidx) + ")"
      );
    }

    var endpoint = state.detailAuth.endpoint || "/maps/mmview";
    var response = await originalFetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      redirect: "follow",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error("상세정보 조회 실패 (HTTP " + response.status + ")");
    }

    var result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error("상세정보 응답 형식을 확인하지 못했습니다.");
    }
    if (!result || result.res !== "success" || !result.data) {
      throw new Error(
        result && (result.message || result.msg)
          ? result.message || result.msg
          : "상세정보 조회 거절 (res=" + text(result && result.res) + ")"
      );
    }
    state.detailCache[key] = result.data;
    return result.data;
  }

  function isTenantLabel(value) {
    var label = text(value).toUpperCase();
    return label === "S" || /세입자|임차(?:인)?/.test(label);
  }

  function contactLabel(value) {
    var raw = text(value);
    var code = raw.toUpperCase();
    var labels = {
      "1": "남성",
      "2": "여성",
      "5": "가족",
      "G": "관리업체",
      "B": "부동산",
      "J": "주인",
      "S": "세입자"
    };
    if (labels[code]) return labels[code];
    if (/세입자|임차(?:인)?/.test(raw)) return "세입자";
    if (/임대인|건물주|소유자|주인/.test(raw)) return "주인";
    if (/관리/.test(raw)) return "관리업체";
    if (/부동산|중개/.test(raw)) return "부동산";
    if (/남성|남자/.test(raw)) return "남성";
    if (/여성|여자/.test(raw)) return "여성";
    if (/가족/.test(raw)) return "가족";
    return raw || "기타연락처";
  }

  function landlordPriority(label) {
    if (label === "주인") return 100;
    if (label === "가족") return 60;
    if (label === "남성" || label === "여성") return 50;
    if (label === "관리업체") return 30;
    if (label === "부동산") return 20;
    return 10;
  }

  function appendPhoneMemo(memo, extraMemo) {
    var parts = Array.isArray(extraMemo) ? extraMemo.filter(Boolean) : [];
    if (!parts.length) return memo;
    return text(memo) + " · " + parts.join(" · ");
  }

  async function sendToAppsScript(records) {
    var collectorKey = getCollectorKey();
    var requestId =
      "gongsil-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    await originalFetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "gongsilImportBatch",
        requestId: requestId,
        collectorKey: collectorKey,
        records: records
      })
    });

    try {
      return await pollMutationStatus(requestId, collectorKey);
    } catch (error) {
      throw new Error(
        "시트 저장 결과를 확인하지 못했습니다. " +
        "Apps Script Code.gs가 v6.4.7인지, 새 버전으로 배포했는지 확인해 주세요. " +
        "요청번호: " + requestId
      );
    }
  }

  function pollMutationStatus(requestId, collectorKey) {
    return new Promise(function (resolve, reject) {
      var attempts = 0;

      function check() {
        attempts += 1;
        var callbackName =
          "__jsGongsilStatus_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        var script = document.createElement("script");
        var timer;

        window[callbackName] = function (payload) {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();

          if (payload && payload.ready) {
            resolve(payload.result || payload);
          } else if (attempts < 24) {
            setTimeout(check, 900);
          } else {
            reject(new Error("저장 결과 확인 시간 초과"));
          }
        };

        timer = setTimeout(function () {
          delete window[callbackName];
          script.remove();
          if (attempts < 24) setTimeout(check, 900);
          else reject(new Error("저장 결과 확인 시간 초과"));
        }, 3500);

        script.onerror = function () {
          clearTimeout(timer);
          delete window[callbackName];
          script.remove();
          reject(new Error("저장 결과 확인 차단"));
        };
        script.src =
          APPS_SCRIPT_URL +
          "?action=mutationStatus&requestId=" + encodeURIComponent(requestId) +
          "&collectorKey=" + encodeURIComponent(collectorKey) +
          "&callback=" + encodeURIComponent(callbackName) +
          "&_=" + Date.now();
        document.head.appendChild(script);
      }

      setTimeout(check, 1100);
    });
  }

  function closePanel() {
    state.active = false;
    panel.style.display = "none";
  }

  function setStatus(title, detail) {
    statusElement.textContent = title || "";
    detailElement.textContent = detail || "";
  }

  function rejectedSummary(reasons) {
    var counts = {};
    (reasons || []).forEach(function (reason) {
      var label = text(reason) || "변환 실패";
      counts[label] = (counts[label] || 0) + 1;
    });
    var entries = Object.keys(counts)
      .sort(function (left, right) { return counts[right] - counts[left]; })
      .slice(0, 3)
      .map(function (reason) { return "- " + reason + " " + counts[reason] + "개"; });
    return entries.length ? entries.join("\n") : "- 원인을 확인하지 못했습니다.";
  }

  function isMissingIdentifier(value) {
    return value === undefined || value === null || value === "";
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    var results = new Array(items.length);
    var cursor = 0;

    async function run() {
      while (cursor < items.length) {
        var index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }

    var runners = [];
    for (var index = 0; index < Math.min(concurrency, items.length); index += 1) {
      runners.push(run());
    }
    await Promise.all(runners);
    return results;
  }

  function pick(source, keys) {
    if (!source) return "";
    for (var index = 0; index < keys.length; index += 1) {
      var value = source[keys[index]];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  }

  function text(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return "";
    return String(value).trim();
  }

  function numberValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    var source = text(value).replace(/,/g, "");
    var match = source.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function normalizeMoney(value) {
    var number = numberValue(value);
    return number || "";
  }

  function normalizePhone(value) {
    var digits = text(value).replace(/[^0-9]/g, "");
    if (digits.length < 9) return "";
    if (/^02\d{7,8}$/.test(digits)) {
      return digits.replace(/^(02)(\d{3,4})(\d{4})$/, "$1-$2-$3");
    }
    return digits.replace(/^(0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");
  }

  function trimNumber(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "";
    return Math.round(number * 10) / 10;
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      var key = String(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function truthy(value) {
    if (value === true || value === 1) return true;
    var normalized = text(value).toLowerCase();
    return normalized === "1" || normalized === "y" || normalized === "yes" ||
      normalized === "true" || normalized === "산";
  }
})();

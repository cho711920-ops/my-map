(function (global, document) {
  "use strict";

  var state = {
    catalog: null,
    candidates: [],
    selectedIndustryId: "",
    lastFocus: null
  };

  function isDesktopOrTablet() {
    return global.matchMedia && global.matchMedia("(min-width: 769px)").matches;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function buildModal() {
    if (byId("permitDiagnosisModalV1")) return;

    var modal = document.createElement("div");
    modal.id = "permitDiagnosisModalV1";
    modal.className = "permit-diagnosis-modal-v1";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<section class="permit-diagnosis-dialog-v1" role="dialog" aria-modal="true" ' +
        'aria-labelledby="permitDiagnosisTitleV1">' +
        '<header class="permit-diagnosis-header-v1">' +
          '<div class="permit-diagnosis-brand-v1"><span class="permit-diagnosis-logo-v1">입</span>' +
            '<div><h2 id="permitDiagnosisTitleV1">업종별 입점·인허가 사전진단</h2>' +
            '<p>업종을 먼저 알아보고, 필요할 때 고객과 매물에 대입합니다.</p></div></div>' +
          '<button class="permit-diagnosis-close-v1" type="button" aria-label="입점진단 닫기">×</button>' +
        '</header>' +
        '<nav class="permit-diagnosis-tabs-v1" aria-label="입점진단 구분">' +
          '<button class="permit-diagnosis-tab-v1 on" type="button" data-permit-tab="learn">업종 알아보기</button>' +
          '<button class="permit-diagnosis-tab-v1" type="button" data-permit-tab="apply">고객·매물에 대입</button>' +
        '</nav>' +
        '<div class="permit-diagnosis-scroll-v1">' +
          '<section id="permitPanelLearnV1" class="permit-diagnosis-panel-v1" data-permit-panel="learn">' +
            '<div class="permit-diagnosis-grid-v1">' +
              '<article class="permit-diagnosis-card-v1">' +
                '<h3>어떤 영업을 준비하나요?</h3>' +
                '<p class="permit-diagnosis-help-v1">상호가 아니라 실제 운영방식, 이용 대상, 설치 시설, 음식 판매 여부를 적어주세요.</p>' +
                '<textarea id="permitIndustryRequestV1" class="permit-diagnosis-textarea-v1" ' +
                  'placeholder="예: 성인만 이용하는 PC방입니다. PC 40대를 설치하고 음식과 음료도 판매할 예정입니다."></textarea>' +
                '<div class="permit-diagnosis-quick-v1">' +
                  '<button type="button" data-permit-example="성인만 이용하는 PC방을 운영하고 PC 40대와 음식·음료 판매를 함께 할 예정입니다.">성인 PC방</button>' +
                  '<button type="button" data-permit-example="커피와 디저트를 조리·판매하는 카페를 운영하려고 합니다.">카페</button>' +
                  '<button type="button" data-permit-example="손톱과 발톱을 관리하는 네일숍을 운영하려고 합니다.">네일숍</button>' +
                  '<button type="button" data-permit-example="운동기구와 샤워실을 갖춘 헬스장을 운영하려고 합니다.">헬스장</button>' +
                '</div>' +
                '<button id="permitInterpretBtnV1" class="permit-diagnosis-primary-v1 permit-diagnosis-wide-v1" type="button">업종 해석</button>' +
                '<div class="permit-step-note-v1">STEP 1에서는 공식 업종 후보와 기본 준비사항을 보여줍니다. ' +
                  '법적 용도·절차 판정과 공공데이터 비교는 후속 규칙엔진에서 처리합니다.</div>' +
              '</article>' +
              '<article class="permit-diagnosis-card-v1">' +
                '<h3>공식 업종 후보</h3>' +
                '<p class="permit-diagnosis-help-v1">AI가 임의 확정하지 않습니다. 설명을 비교한 뒤 사용자가 최종 업종을 선택합니다.</p>' +
                '<div id="permitCandidateResultsV1"><div class="permit-candidate-empty-v1">' +
                  '<div><strong>운영 내용을 입력해주세요.</strong><br>해석 후 공식 업종 후보가 이곳에 표시됩니다.</div></div></div>' +
              '</article>' +
            '</div>' +
            '<div id="permitIndustryDetailV1" class="permit-industry-detail-host-v1"></div>' +
          '</section>' +
          '<section id="permitPanelApplyV1" class="permit-diagnosis-panel-v1" data-permit-panel="apply" hidden>' +
            '<article class="permit-diagnosis-card-v1">' +
              '<h3>고객·매물에 대입</h3>' +
              '<p class="permit-diagnosis-help-v1">선택한 매물을 읽어오거나 외부 상가 주소를 직접 입력할 수 있습니다. 기존 매물은 수정하지 않습니다.</p>' +
              '<div class="permit-location-grid-v1">' +
                '<div class="permit-diagnosis-field-v1"><label for="permitAddressV1">주소</label><input id="permitAddressV1" autocomplete="off"></div>' +
                '<div class="permit-diagnosis-field-v1"><label for="permitFloorV1">층</label><input id="permitFloorV1"></div>' +
                '<div class="permit-diagnosis-field-v1"><label for="permitUnitV1">호실</label><input id="permitUnitV1"></div>' +
                '<div class="permit-diagnosis-field-v1"><label for="permitAreaV1">전용면적(㎡)</label><input id="permitAreaV1" inputmode="decimal"></div>' +
                '<div class="permit-diagnosis-field-v1"><label for="permitListingIdV1">매물번호</label><input id="permitListingIdV1"></div>' +
              '</div>' +
              '<div class="permit-location-actions-v1">' +
                '<button id="permitLoadSelectedV1" class="permit-diagnosis-primary-v1" type="button">현재 선택 매물 불러오기</button>' +
                '<button id="permitSearchAddressV1" class="permit-diagnosis-secondary-v1" type="button">주소 직접 검색</button>' +
                '<button id="permitPublicDataBtnV1" class="permit-diagnosis-secondary-v1" type="button">공공데이터 조회</button>' +
              '</div>' +
              '<div id="permitLocationStatusV1" class="permit-location-status-v1" aria-live="polite"></div>' +
              '<div class="permit-step-note-v1"><strong>선택 업종:</strong> <span id="permitApplyIndustryV1">아직 선택하지 않음</span><br>' +
                '공공데이터에 없는 현장 구조·전기·소방 정보는 임의 추정하지 않고 미확인으로 유지합니다.</div>' +
              '<div id="permitPublicDataResultsV1"></div>' +
            '</article>' +
          '</section>' +
        '</div>' +
      '</section>';

    document.body.appendChild(modal);
    bindModalEvents(modal);
  }

  function loadCatalog() {
    if (state.catalog) return Promise.resolve(state.catalog);
    return fetch("data/industry-catalog.json?v=20260729-step9", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("업종 카탈로그를 불러오지 못했습니다.");
        return response.json();
      })
      .then(function (catalog) {
        state.catalog = catalog;
        return catalog;
      });
  }

  function setTab(tabName) {
    document.querySelectorAll("[data-permit-tab]").forEach(function (button) {
      button.classList.toggle("on", button.getAttribute("data-permit-tab") === tabName);
    });
    document.querySelectorAll("[data-permit-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-permit-panel") !== tabName;
    });
  }

  function interpretIndustry() {
    var request = byId("permitIndustryRequestV1").value;
    var results = byId("permitCandidateResultsV1");
    if (!request.trim()) {
      results.innerHTML = '<div class="permit-candidate-empty-v1"><div>영업 내용을 먼저 입력해주세요.</div></div>';
      return;
    }

    loadCatalog().then(function (catalog) {
      state.candidates = global.PermitIndustryIntentParserV1.interpret(
        request,
        catalog.industries,
        4
      );
      state.selectedIndustryId = "";
      results.innerHTML = global.PermitIndustryCandidateSelectorV1.renderCandidates(
        state.candidates,
        ""
      );
      byId("permitIndustryDetailV1").innerHTML = "";
      byId("permitApplyIndustryV1").textContent = "아직 선택하지 않음";
    }).catch(function (error) {
      results.innerHTML = '<div class="permit-candidate-empty-v1"><div>' +
        global.PermitIndustryCandidateSelectorV1.escapeHtml(error.message) + '</div></div>';
    });
  }

  function selectIndustry(industryId) {
    var entry = state.candidates.find(function (candidate) {
      return candidate.industry.id === industryId;
    });
    if (!entry || !state.catalog) return;

    state.selectedIndustryId = industryId;
    byId("permitCandidateResultsV1").innerHTML =
      global.PermitIndustryCandidateSelectorV1.renderCandidates(state.candidates, industryId);
    byId("permitIndustryDetailV1").innerHTML =
      global.PermitIndustryCandidateSelectorV1.renderIndustryDetail(
        entry.industry,
        state.catalog.notice
      );
    byId("permitApplyIndustryV1").textContent = entry.industry.officialName;
    document.dispatchEvent(new CustomEvent("permit:industry-selected-v1", {
      detail: { industry: entry.industry }
    }));
  }

  function fillLocation(data) {
    if (!data) return;
    byId("permitAddressV1").value = data.address || "";
    byId("permitFloorV1").value = data.floor || "";
    byId("permitUnitV1").value = data.unit || "";
    byId("permitAreaV1").value = data.area || "";
    byId("permitListingIdV1").value = data.listingId || "";
  }

  function loadSelectedItem() {
    var selection = global.PermitPropertyLocationInputV1.getSelectedItemResult();
    var item = selection.item;
    var status = byId("permitLocationStatusV1");
    if (!item) {
      status.textContent = selection.message;
      return;
    }
    var data = global.PermitPropertyLocationInputV1.fromItem(item);
    fillLocation(data);
    status.textContent = data.listingName + " 매물 정보를 불러왔습니다." +
      (data.areaSourcePyeong ? " (원본 " + data.areaSourcePyeong + "평)" : "");
  }

  function searchDirectAddress() {
    var status = byId("permitLocationStatusV1");
    status.textContent = "주소를 확인하고 있습니다.";
    global.PermitPropertyLocationInputV1.searchAddress(byId("permitAddressV1").value)
      .then(function (result) {
        byId("permitAddressV1").value = result.address;
        status.textContent = result.roadAddress
          ? "주소 확인 완료 · 도로명 " + result.roadAddress
          : "지번주소 확인 완료";
      })
      .catch(function (error) {
        status.textContent = error.message;
      });
  }

  function publicDataInput() {
    return {
      address: byId("permitAddressV1").value.trim(),
      floor: byId("permitFloorV1").value.trim(),
      unit: byId("permitUnitV1").value.trim(),
      area: byId("permitAreaV1").value.trim(),
      listingId: byId("permitListingIdV1").value.trim(),
      industryId: state.selectedIndustryId
    };
  }

  function resetModal() {
    state.candidates = [];
    state.selectedIndustryId = "";
    [
      "permitIndustryRequestV1",
      "permitAddressV1",
      "permitFloorV1",
      "permitUnitV1",
      "permitAreaV1",
      "permitListingIdV1"
    ].forEach(function (id) {
      var input = byId(id);
      if (input) input.value = "";
    });
    var candidates = byId("permitCandidateResultsV1");
    if (candidates) {
      candidates.innerHTML = '<div class="permit-candidate-empty-v1"><div>' +
        '<strong>운영 내용을 입력해주세요.</strong><br>해석 후 공식 업종 후보가 이곳에 표시됩니다.' +
        '</div></div>';
    }
    if (byId("permitIndustryDetailV1")) byId("permitIndustryDetailV1").innerHTML = "";
    if (byId("permitApplyIndustryV1")) byId("permitApplyIndustryV1").textContent = "아직 선택하지 않음";
    if (byId("permitLocationStatusV1")) byId("permitLocationStatusV1").textContent = "";
    if (byId("permitPublicDataResultsV1")) byId("permitPublicDataResultsV1").innerHTML = "";
    var queryButton = byId("permitPublicDataBtnV1");
    if (queryButton) {
      queryButton.disabled = false;
      queryButton.textContent = "공공데이터 조회";
    }
    setTab("learn");
    document.dispatchEvent(new CustomEvent("permit:reset-v1"));
  }

  function queryPublicData() {
    var button = byId("permitPublicDataBtnV1");
    var status = byId("permitLocationStatusV1");
    var results = byId("permitPublicDataResultsV1");
    var input = publicDataInput();
    if (!input.industryId) {
      status.textContent = "먼저 업종 알아보기에서 최종 업종을 선택해주세요.";
      return;
    }
    if (!input.address) {
      status.textContent = "조회할 주소를 입력하거나 선택 매물을 불러와주세요.";
      return;
    }
    button.disabled = true;
    button.textContent = "공공데이터 조회 중";
    status.textContent = "지번을 확인하고 건축물대장·용도지역 자료를 조회하고 있습니다.";
    results.innerHTML = '<div class="permit-public-loading-v1">공식 공공데이터를 조회하고 있습니다.</div>';

    global.PermitBuildingDataAdapterV1.query(input)
      .then(function (diagnosis) {
        results.innerHTML = global.PermitBuildingDataAdapterV1.render(diagnosis);
        status.textContent = "공공데이터 조회가 완료되었습니다. 자료가 없는 항목은 미확인으로 유지했습니다.";
        document.dispatchEvent(new CustomEvent("permit:public-data-v1", {
          detail: { diagnosis: diagnosis }
        }));
      })
      .catch(function (error) {
        results.innerHTML = '<div class="permit-public-error-v1"><strong>조회하지 못했습니다.</strong><br>' +
          global.PermitIndustryCandidateSelectorV1.escapeHtml(error.message) + '</div>';
        status.textContent = error.message;
      })
      .finally(function () {
        button.disabled = false;
        button.textContent = "공공데이터 조회";
      });
  }

  function closeModal() {
    var modal = byId("permitDiagnosisModalV1");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("permit-diagnosis-open-v1");
    if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
  }

  function bindModalEvents(modal) {
    modal.querySelector(".permit-diagnosis-close-v1").addEventListener("click", closeModal);
    modal.querySelectorAll("[data-permit-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.getAttribute("data-permit-tab"));
      });
    });
    modal.querySelectorAll("[data-permit-example]").forEach(function (button) {
      button.addEventListener("click", function () {
        byId("permitIndustryRequestV1").value = button.getAttribute("data-permit-example") || "";
      });
    });
    byId("permitInterpretBtnV1").addEventListener("click", interpretIndustry);
    byId("permitCandidateResultsV1").addEventListener("click", function (event) {
      var button = event.target.closest("[data-permit-industry-id]");
      if (button) selectIndustry(button.getAttribute("data-permit-industry-id"));
    });
    byId("permitLoadSelectedV1").addEventListener("click", loadSelectedItem);
    byId("permitSearchAddressV1").addEventListener("click", searchDirectAddress);
    byId("permitPublicDataBtnV1").addEventListener("click", queryPublicData);
  }

  function openModal() {
    if (!isDesktopOrTablet()) return;
    buildModal();
    var modal = byId("permitDiagnosisModalV1");
    state.lastFocus = document.activeElement;
    resetModal();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("permit-diagnosis-open-v1");
    loadCatalog().catch(function () {});
    global.setTimeout(function () {
      var input = byId("permitIndustryRequestV1");
      if (input) input.focus();
    }, 0);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeModal();
  });

  document.addEventListener("DOMContentLoaded", buildModal);

  global.openPermitDiagnosisV1 = openModal;
  global.closePermitDiagnosisV1 = closeModal;
  global.PermitDiagnosisUIV1 = {
    open: openModal,
    close: closeModal,
    setTab: setTab,
    reset: resetModal
  };
})(window, document);

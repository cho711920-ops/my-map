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
            '<div><h2 id="permitDiagnosisTitleV1">상가 업종 중개 실무</h2>' +
            '<p>고객 업종을 이해하고, 맞는 매물을 찾고, 계약 전후 위험을 확인합니다.</p></div></div>' +
          '<button class="permit-diagnosis-close-v1" type="button" aria-label="입점진단 닫기">×</button>' +
        '</header>' +
        '<nav class="permit-diagnosis-tabs-v1" aria-label="입점진단 구분">' +
          '<button class="permit-diagnosis-tab-v1 on" type="button" data-permit-tab="learn">업종 실무안내</button>' +
          '<button class="permit-diagnosis-tab-v1" type="button" data-permit-tab="apply">선택 매물 확인</button>' +
        '</nav>' +
        '<div class="permit-diagnosis-scroll-v1">' +
          '<section id="permitPanelLearnV1" class="permit-diagnosis-panel-v1" data-permit-panel="learn">' +
            '<div class="permit-diagnosis-grid-v1">' +
              '<article class="permit-diagnosis-card-v1">' +
                '<h3>고객이 어떤 업종을 원하나요?</h3>' +
                '<p class="permit-diagnosis-help-v1">“김밥집”, “네일숍” 같은 생활표현부터 공식 업종명·KSIC 코드까지 검색됩니다. 후보 차이와 고객에게 다시 물어볼 내용을 안내합니다.</p>' +
                '<textarea id="permitIndustryRequestV1" class="permit-diagnosis-textarea-v1" ' +
                  'placeholder="예: 손님이 작은 김밥집을 하려고 합니다. 홀 테이블도 몇 개 놓을 예정입니다."></textarea>' +
                '<div class="permit-diagnosis-quick-v1">' +
                  '<button type="button" data-permit-example="작은 김밥집을 운영하고 홀 테이블과 포장·배달을 함께 하려고 합니다.">김밥집</button>' +
                  '<button type="button" data-permit-example="성인만 이용하는 PC방을 운영하고 PC 40대와 음식·음료 판매를 함께 할 예정입니다.">성인 PC방</button>' +
                  '<button type="button" data-permit-example="커피와 디저트를 조리·판매하는 카페를 운영하려고 합니다.">카페</button>' +
                  '<button type="button" data-permit-example="손톱과 발톱을 관리하는 네일숍을 운영하려고 합니다.">네일숍</button>' +
                '</div>' +
                '<button id="permitInterpretBtnV1" class="permit-diagnosis-primary-v1 permit-diagnosis-wide-v1" type="button">업종 찾아보기</button>' +
                '<div class="permit-step-note-v1">한국표준산업분류 제11차 21개 대분류(업태)·1,205개 세세분류와 정밀 실무업종을 함께 검색합니다. 실제 메뉴·운영방식·시설을 확인한 뒤 사용자가 선택합니다.</div>' +
              '</article>' +
              '<article class="permit-diagnosis-card-v1">' +
                '<h3>공식·표준산업분류 업종 후보</h3>' +
                '<p class="permit-diagnosis-help-v1">후보를 비교해 선택하면 중개사가 알아야 할 매물조건·시설·절차·전화질문·계약사항이 펼쳐집니다.</p>' +
                '<div id="permitBrandEvidenceV1"></div>' +
                '<div id="permitCandidateResultsV1"><div class="permit-candidate-empty-v1">' +
                  '<div><strong>운영 내용을 입력해주세요.</strong><br>해석 후 공식 업종 후보가 이곳에 표시됩니다.</div></div></div>' +
              '</article>' +
            '</div>' +
            '<div id="permitIndustryDetailV1" class="permit-industry-detail-host-v1"></div>' +
          '</section>' +
          '<section id="permitPanelApplyV1" class="permit-diagnosis-panel-v1" data-permit-panel="apply" hidden>' +
            '<article class="permit-diagnosis-card-v1">' +
              '<h3>이 매물이 선택 업종에 맞는지 확인</h3>' +
              '<p class="permit-diagnosis-help-v1">선택한 매물을 불러오거나 외부 상가를 입력한 뒤, 용도와 현장·계약 체크 결과를 함께 확인합니다. 기존 매물은 수정하지 않습니다.</p>' +
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
                '<button id="permitPublicDataBtnV1" class="permit-diagnosis-secondary-v1" type="button">공식자료로 용도 확인</button>' +
              '</div>' +
              '<div id="permitLocationStatusV1" class="permit-location-status-v1" aria-live="polite"></div>' +
              '<div class="permit-step-note-v1"><strong>선택 업종:</strong> <span id="permitApplyIndustryV1">아직 선택하지 않음</span><br>' +
                '공식자료는 용도와 행정정보 확인에만 사용합니다. 현장 구조·전기·소방·배기 상태는 직접 확인하고 기록합니다.</div>' +
              '<div id="permitApplyChecklistV1"></div>' +
              '<div id="permitPublicDataResultsV1"></div>' +
              '<div id="permitBrokerBriefingV2"></div>' +
            '</article>' +
          '</section>' +
        '</div>' +
      '</section>';

    document.body.appendChild(modal);
    bindModalEvents(modal);
  }

  function loadCatalog() {
    if (state.catalog) return Promise.resolve(state.catalog);
    return Promise.all([
      fetch("data/industry-catalog.json?v=20260729-master1", { cache: "no-store" }),
      fetch("data/industry-master.json?v=20260731-health-functional1", { cache: "no-store" }),
      fetch("data/industry-critical-guidance.json?v=20260731-health-functional1", { cache: "no-store" }),
      fetch("data/industry-area-use-rules.json?v=20260731-health-functional1", { cache: "no-store" }),
      fetch("data/industry-ksic11-catalog.json?v=20260731-universal1", { cache: "no-store" })
    ]).then(function (responses) {
      if (responses.some(function (response) { return !response.ok; })) {
        throw new Error("업종 마스터를 불러오지 못했습니다.");
      }
      return Promise.all(responses.map(function (response) { return response.json(); }));
    }).then(function (catalogs) {
      var detailed = catalogs[0];
      var master = catalogs[1];
      var critical = catalogs[2];
      var areaRules = catalogs[3];
      var ksic = catalogs[4];
      var seen = {};
      var industries = [];
      function unique(items) {
        return (items || []).filter(function (item, index, all) {
          return item && all.indexOf(item) === index;
        });
      }
      function criticalGuidanceFor(industryId) {
        var profile = critical.industries && critical.industries[industryId];
        if (!profile) return null;
        var template = critical.templates && critical.templates[profile.template] || {};
        var sourceIds = unique((template.sourceIds || []).concat(profile.sourceIds || []));
        return {
          version: critical.version,
          template: profile.template,
          mustAsk: unique((template.mustAsk || []).concat(profile.mustAsk || [])),
          site: unique((template.site || []).concat(profile.site || [])),
          facility: unique((template.facility || []).concat(profile.facility || [])),
          safety: unique((template.safety || []).concat(profile.safety || [])),
          specific: unique(profile.specific || []),
          contractBlockers: unique((template.contractBlockers || []).concat(profile.contractBlockers || [])),
          agencies: unique((template.agencies || []).concat(profile.agencies || [])),
          sources: sourceIds.map(function (sourceId) {
            return critical.sources && critical.sources[sourceId];
          }).filter(Boolean),
          notice: critical.notice
        };
      }
      function areaUseRuleFor(industryId) {
        var templateId = areaRules.industries && areaRules.industries[industryId];
        var template = templateId && areaRules.templates && areaRules.templates[templateId];
        if (!template) return null;
        return Object.assign({}, template, {
          templateId: templateId,
          version: areaRules.version,
          verifiedAt: areaRules.verifiedAt,
          source: areaRules.source
        });
      }
      (detailed.industries || []).concat(master.industries || []).forEach(function (industry) {
        if (!industry || !industry.id || seen[industry.id]) return;
        seen[industry.id] = true;
        var detailedIndustry = Object.assign({}, industry, {
          criticalGuidance: criticalGuidanceFor(industry.id),
          areaUseRule: areaUseRuleFor(industry.id),
          searchPriority: 30
        });
        industries.push(detailedIndustry);
      });
      global.PermitKsicIndustryAdapterV1.expandAll(ksic).forEach(function (industry) {
        if (!industry.id || !industry.officialName || seen[industry.id]) return;
        seen[industry.id] = true;
        industries.push(industry);
      });
      state.catalog = {
        version: master.version + "+" + ksic.version,
        notice: master.notice + " " + ksic.notice,
        ksicCount: (ksic.industries || []).length,
        industries: industries
      };
      return state.catalog;
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
    var brandEvidenceHost = byId("permitBrandEvidenceV1");
    if (!request.trim()) {
      results.innerHTML = '<div class="permit-candidate-empty-v1"><div>영업 내용을 먼저 입력해주세요.</div></div>';
      if (brandEvidenceHost) brandEvidenceHost.innerHTML = "";
      return;
    }

    results.innerHTML = '<div class="permit-candidate-empty-v1"><div><strong>업종·업태를 확인하고 있습니다.</strong><br>' +
      '브랜드 사전과 실제 등록 업소 카테고리를 함께 살펴봅니다.</div></div>';
    if (brandEvidenceHost) brandEvidenceHost.innerHTML = "";

    Promise.all([
      loadCatalog(),
      global.PermitBrandIndustryResolverV1
        ? global.PermitBrandIndustryResolverV1.resolve(request)
        : Promise.resolve(null)
    ]).then(function (resolved) {
      var catalog = resolved[0];
      var brandEvidence = resolved[1];
      var interpreted = global.PermitIndustryIntentParserV1.interpret(
        request,
        catalog.industries,
        6
      );
      if (brandEvidence && brandEvidence.industryIds && brandEvidence.industryIds.length) {
        var brandEntries = [];
        brandEvidence.industryIds.forEach(function (industryId) {
          var industry = catalog.industries.find(function (entry) { return entry.id === industryId; });
          if (!industry) return;
          brandEntries.push({ industry: industry, score: 100 });
        });
        interpreted = brandEntries.concat(interpreted.filter(function (entry) {
          return brandEvidence.industryIds.indexOf(entry.industry.id) < 0;
        })).slice(0, 6);
      }
      state.candidates = dedupeOfficialCandidates(interpreted);
      renderBrandEvidence(brandEvidence);
      if (!state.candidates.length) {
        state.candidates = [{
          score: 1,
          industry: {
            id: "custom-review-" + request.replace(/\s+/g, "-").slice(0, 30),
            officialName: request + " 관련 업종 분류 확인",
            commonName: request,
            description: "표현만으로 공식 영업 업종을 확정할 수 없어 관할 등록부서 확인이 필요합니다.",
            permitType: "관할확인",
            expectedBuildingUse: "건축부서 확인 필요",
            legalArea: "업종 분류 확인 필요",
            keywords: [request],
            process: ["실제 영업내용 확인", "공식 업종명 확인", "건축물 용도 확인", "시설기준 확인", "계약 전 관할기관 확인"],
            facilities: ["급·배수", "환기·배기", "전기용량", "피난·소방", "건물 관리규약"],
            extraChecks: ["판매·서비스 범위", "고객 이용방식", "설치 장비", "영업시간"],
            ruleStatus: "AGENCY_CONFIRM"
          }
        }];
      }
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

  function dedupeOfficialCandidates(entries) {
    var results = [];
    var positions = {};
    var equivalentIndustryGroups = {
      cafe: "rest-restaurant",
      "rest-restaurant": "rest-restaurant"
    };
    (entries || []).forEach(function (entry) {
      var industry = entry && entry.industry;
      if (!industry) return;
      var equivalentId = equivalentIndustryGroups[industry.id];
      var key = equivalentId
        ? "industry-group|" + equivalentId
        : String(industry.officialName || industry.id).replace(/\s+/g, "") +
          "|" + String(industry.permitType || "");
      if (positions[key] === undefined) {
        positions[key] = results.length;
        results.push(entry);
        return;
      }
      var current = results[positions[key]];
      var currentSupported = global.PermitIndustryRuleLoaderV1 &&
        global.PermitIndustryRuleLoaderV1.supports(current.industry.id);
      var nextSupported = global.PermitIndustryRuleLoaderV1 &&
        global.PermitIndustryRuleLoaderV1.supports(industry.id);
      if (!currentSupported && nextSupported) results[positions[key]] = entry;
    });
    return results;
  }

  function renderBrandEvidence(evidence) {
    var host = byId("permitBrandEvidenceV1");
    if (!host) return;
    if (!evidence || !evidence.matched) {
      host.innerHTML = '<div class="permit-brand-evidence-v1 is-empty"><strong>브랜드 일치 없음</strong>' +
        '<span>입력한 메뉴·서비스·운영방식으로 업종 후보를 만들었습니다.</span></div>';
      return;
    }
    var escapeHtml = global.PermitIndustryCandidateSelectorV1.escapeHtml;
    var labels = (evidence.categoryEvidence || []).slice(0, 3).map(function (entry) {
      return '<li><b>' + escapeHtml(entry.name) + '</b><span>' +
        escapeHtml(entry.category) + '</span></li>';
    }).join("");
    host.innerHTML = '<section class="permit-brand-evidence-v1" data-confidence="' +
      escapeHtml(evidence.confidence || "MEDIUM") + '">' +
      '<header><div><small>' + escapeHtml(evidence.source) + '</small><strong>' +
        escapeHtml(evidence.brandName) + '</strong></div><span>' +
        escapeHtml(evidence.confidence === "HIGH" ? "브랜드 일치" : "업소 카테고리 확인") +
      '</span></header>' +
      '<p><b>확인된 업종·업태</b> ' + escapeHtml(evidence.businessType) + '</p>' +
      (labels ? '<ul>' + labels + '</ul>' : '') +
      '<footer>' + escapeHtml(evidence.notice || "") + '</footer>' +
      '</section>';
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
    if (byId("permitBrokerBriefingV2")) byId("permitBrokerBriefingV2").innerHTML = "";
    if (byId("permitApplyChecklistV1")) byId("permitApplyChecklistV1").innerHTML = "";
    var queryButton = byId("permitPublicDataBtnV1");
    if (queryButton) {
      queryButton.disabled = false;
      queryButton.textContent = "공식자료로 용도 확인";
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
    button.textContent = "공식자료 확인 중";
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
        button.textContent = "공식자료로 용도 확인";
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

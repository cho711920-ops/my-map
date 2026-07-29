(function (global, document) {
  "use strict";

  var knowledgePromise = null;
  var activeIndustryId = "";

  function esc(value) {
    var helper = global.PermitIndustryCandidateSelectorV1;
    if (helper && helper.escapeHtml) return helper.escapeHtml(value);
    var div = document.createElement("div");
    div.textContent = String(value == null ? "" : value);
    return div.innerHTML;
  }

  function unique(values) {
    return (values || []).filter(function (value, index, all) {
      return value && all.indexOf(value) === index;
    });
  }

  function loadKnowledge() {
    if (!knowledgePromise) {
      knowledgePromise = fetch("data/lease-legal-knowledge.json?v=20260730-2", {
        cache: "no-store"
      }).then(function (response) {
        if (!response.ok) throw new Error("임대차 법률자료를 불러오지 못했습니다.");
        return response.json();
      });
    }
    return knowledgePromise;
  }

  function topicIdsFor(knowledge, industryId) {
    var profileId = knowledge.industryProfiles[industryId] || "default";
    return unique((knowledge.profiles.default || []).concat(
      profileId === "default" ? [] : (knowledge.profiles[profileId] || [])
    ));
  }

  function renderSources(knowledge, ids) {
    return unique(ids).map(function (id) {
      var source = knowledge.sources[id];
      if (!source) return "";
      return '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<small>' + esc(source.type) + '</small>' + esc(source.title) + '</a>';
    }).join("");
  }

  function renderTopic(topic) {
    return '<details class="permit-lease-topic-v1">' +
      '<summary><strong>' + esc(topic.title) + '</strong><span>계약 전 확인</span></summary>' +
      '<div class="permit-lease-topic-body-v1"><p>' + esc(topic.why) + '</p><div>' +
      '<section><h5>확인할 사실</h5><ul>' + (topic.questions || []).map(function (item) {
        return '<li>' + esc(item) + '</li>';
      }).join("") + '</ul></section>' +
      '<section><h5>특약에 반영할 주제</h5><ul>' + (topic.contractPoints || []).map(function (item) {
        return '<li>' + esc(item) + '</li>';
      }).join("") + '</ul></section></div></div></details>';
  }

  function renderMediation(knowledge, topicIds) {
    var rows = (knowledge.mediationExamples || []).filter(function (row) {
      return topicIds.indexOf(row.topicId) >= 0;
    });
    if (!rows.length) return "";
    return '<div class="permit-mediation-examples-v1"><h5>공식 분쟁조정 사례 참고</h5>' +
      '<p>조정사례는 당사자의 합의를 다룬 참고자료이며 법원 판례처럼 구속력이 있는 기준은 아닙니다.</p>' +
      '<div>' + rows.map(function (row) {
        return '<a href="' + esc(row.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<small>조정사례 · ' + esc(row.publishedAt) + '</small>' +
          '<strong>' + esc(row.title) + '</strong><span>' + esc(row.summary) + '</span></a>';
      }).join("") + '</div></div>';
  }

  function shell(industryId) {
    activeIndustryId = industryId || "";
    return '<section id="permitLeaseLegalBriefingV1" class="permit-lease-legal-v1" ' +
      'data-industry-id="' + esc(activeIndustryId) + '">' +
      '<header><div><small>법령·판례·분쟁조정 연결</small><h4>임대차·계약 위험 브리핑</h4></div>' +
      '<span>근거별 구분 표시</span></header>' +
      '<div id="permitLeaseLegalContentV1" class="permit-lease-loading-v1">' +
      '업종에 맞는 임대차 위험을 정리하는 중입니다.</div></section>';
  }

  function hydrate(industryId) {
    var host = document.getElementById("permitLeaseLegalContentV1");
    var section = host && host.closest("[data-industry-id]");
    if (!host || !section || section.getAttribute("data-industry-id") !== industryId) return;
    loadKnowledge().then(function (knowledge) {
      var topicIds = topicIdsFor(knowledge, industryId);
      var topics = topicIds.map(function (id) { return knowledge.topics[id]; }).filter(Boolean);
      var sourceIds = [];
      topics.forEach(function (topic) { sourceIds = sourceIds.concat(topic.sourceIds || []); });
      host.innerHTML =
        '<div class="permit-lease-notice-v1"><strong>중개 실무 사용법</strong>' +
        '<span>확인할 사실만 특약에 반영하고, 판례·조정사례는 사실관계가 현재 계약과 같은지 별도로 확인합니다.</span></div>' +
        '<div class="permit-lease-topic-list-v1">' + topics.map(renderTopic).join("") + '</div>' +
        renderMediation(knowledge, topicIds) +
        '<div class="permit-precedent-search-v1"><div><h5>최신 관련 판례 찾기</h5>' +
        '<p>국가법령정보 공동활용에서 관련 판례 목록을 조회합니다. 자동 법률판정은 하지 않습니다.</p></div>' +
        '<button type="button" id="permitLoadPrecedentsV1" data-topic-ids="' +
        esc(topicIds.join(",")) + '">최신 판례 조회</button>' +
        '<div id="permitPrecedentResultsV1"></div></div>' +
        '<footer><div>' + renderSources(knowledge, sourceIds.concat(["precedentApi", "mediation"])) +
        '</div><p>' + esc(knowledge.notice) + '</p></footer>';
    }).catch(function (error) {
      host.innerHTML = '<div class="permit-lease-error-v1">' + esc(error.message) +
        ' 확인하지 못한 내용은 표시하지 않습니다.</div>';
    });
  }

  function renderPrecedents(payload) {
    var host = document.getElementById("permitPrecedentResultsV1");
    if (!host) return;
    if (!payload.configured) {
      host.innerHTML = '<div class="permit-precedent-unknown-v1"><strong>판례 API 연결 대기</strong><span>' +
        esc(payload.message || "서버 인증 연결이 필요합니다.") + '</span></div>';
      return;
    }
    var records = payload.records || [];
    if (!records.length) {
      host.innerHTML = '<div class="permit-precedent-unknown-v1"><strong>검색 결과 없음</strong>' +
        '<span>관련 판례가 없다는 의미가 아닙니다. 검색어와 사실관계를 바꿔 다시 확인해야 합니다.</span></div>';
      return;
    }
    host.innerHTML = '<div class="permit-precedent-results-v1">' + records.map(function (record) {
      return '<a href="' + esc(record.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<small>' + esc(record.court || "법원 미확인") + ' · ' +
        esc(record.decisionDate || "선고일 미확인") + '</small>' +
        '<strong>' + esc(record.caseName || "사건명 미확인") + '</strong>' +
        '<span>' + esc(record.caseNumber || "사건번호 미확인") + '</span>' +
        '<em>검색주제: ' + esc(record.topicTitle || "임대차") + '</em></a>';
    }).join("") + '</div><p class="permit-precedent-caution-v1">' +
      '관련 가능성이 있는 판례 목록입니다. 적용하려면 판결요지·사실관계·상가건물임대차보호법의 현재 내용을 확인해야 합니다.</p>';
  }

  function loadPrecedents(button) {
    var host = document.getElementById("permitPrecedentResultsV1");
    if (!host || button.disabled) return;
    button.disabled = true;
    button.textContent = "공식 판례 조회 중";
    host.innerHTML = '<div class="permit-lease-loading-v1">국가법령정보에서 판례 목록을 확인하고 있습니다.</div>';
    var query = new URLSearchParams({
      industryId: activeIndustryId,
      topics: button.getAttribute("data-topic-ids") || ""
    });
    fetch("/api/permit-lease-legal?" + query.toString(), {
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload.error || payload.message || "판례 조회에 실패했습니다.");
        return payload;
      });
    }).then(renderPrecedents).catch(function (error) {
      host.innerHTML = '<div class="permit-lease-error-v1">' + esc(error.message) +
        ' 조회 실패를 판례 부재로 처리하지 않습니다.</div>';
    }).finally(function () {
      button.disabled = false;
      button.textContent = "최신 판례 다시 조회";
    });
  }

  document.addEventListener("permit:industry-selected-v1", function (event) {
    activeIndustryId = event.detail && event.detail.industry &&
      event.detail.industry.id || "";
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest("#permitLoadPrecedentsV1");
    if (button) loadPrecedents(button);
  });

  global.PermitLeaseLegalBriefingV1 = {
    shell: shell,
    hydrate: hydrate,
    loadKnowledge: loadKnowledge,
    topicIdsFor: topicIdsFor
  };
})(window, document);

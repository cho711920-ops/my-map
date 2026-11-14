/* =========================================================
   v6.3.0 현장모드 - 매물 임대조건 수정
   - 임장추가 버튼 옆 '수정'
   - 기존 행을 새 행으로 추가하지 않고 정확히 찾아 수정
   - 주소/건물이름/구분은 식별 기준으로 유지하고 편집 대상에서 제외
   ========================================================= */

var propertyEditTargetV630 = null;
var propertyEditSavingV630 = false;
var propertyEditOriginalValuesV1 = null;
var propertyEditConflictV1 = null;
var propertyEditRoomTouchedV130 = false;
var propertyEditTouchedFieldsV131 = {};
var propertyEditSessionV226 = 0;
var propertyEditPendingV226 = new Map();

function recoverPropertyDraftV226(account, id, restore, message, automatically) {
  function sameAccount() {return String(window.JSAuthenticatedAccountEmail||'').trim().toLowerCase()===account;}
  function editorOpen() {return !!document.querySelector('#propertyEditModalV630.open,dialog[open],#unifiedDetailDrawerV8.open');}
  if(!sameAccount())return;
  if(automatically&&!editorOpen()){restore();return;}
  var box=document.getElementById('propertyEditRecoveryV226');
  if(!box){box=document.createElement('div');box.id='propertyEditRecoveryV226';box.setAttribute('role','status');box.style.cssText='position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:10030;padding:10px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;max-width:90vw';document.body.appendChild(box);}
  var entry=document.createElement('div'),button=document.createElement('button');
  entry.dataset.propertyId=id;entry.appendChild(document.createTextNode(message+' '));button.type='button';button.textContent='저장 안 된 입력 열기';
  button.onclick=function(){if(!sameAccount()){entry.remove();return;}if(editorOpen()){button.textContent='현재 창을 닫은 뒤 입력 열기';return;}restore();entry.remove();if(!box.children.length)box.remove();};
  entry.appendChild(button);box.appendChild(entry);
}
if(typeof window!=='undefined'){
  window.recoverPropertyDraftV226=recoverPropertyDraftV226;
  window.addEventListener('js-auth-required',function(){propertyEditPendingV226.clear();document.getElementById('propertyEditRecoveryV226')?.remove();});
}

/*
 * v6.3.2 QA2
 * 건물이름 또는 호실을 수정하면 item.key도 바뀝니다.
 * D1을 다시 불러온 뒤 새 key를 찾아 선택·리스트를 복원하기 위한 임시 상태입니다.
 */
var pendingPropertyEditNewKeyV633 = null;

/*
 * v6.3.4 수정 상태 안정화
 * - 같은 매물 연속 수정
 * - 필터 유지
 * - 다중 클러스터 선택 유지
 */
var propertyEditReloadTimerV634 = null;
var pendingPropertyEditStateV634 = null;



function getPropertyByEncodedKeyV630(encodedKey) {
  var locator = decodeURIComponent(String(encodedKey || ""));

  if (locator.indexOf("id:") === 0) {
    var propertyId = locator.slice(3).trim();
    var matches = (allItems || []).filter(function(item) {
      return item && String(item.propertyId || "").trim() === propertyId;
    });

    /*
     * ID가 없거나 둘 이상이면 어떤 매물도 대신 선택하지 않습니다.
     * 동일 주소·동일 호실 매물의 첫 번째 항목으로 넘어가는 것을 방지합니다.
     */
    return matches.length === 1 ? matches[0] : null;
  }

  var key = locator.indexOf("key:") === 0
    ? locator.slice(4)
    : locator;

  return (allItems || []).find(function(item) {
    return item && item.key === key;
  }) || null;
}


function ensurePropertyEditModalV630() {
  if (document.getElementById("propertyEditModalV630")) return;

  var modal = document.createElement("div");
  modal.id = "propertyEditModalV630";
  modal.className = "property-edit-modal-v630";
  modal.setAttribute("aria-hidden", "true");

  modal.innerHTML =
    '<div class="property-edit-backdrop-v630" onclick="closePropertyEditModalV630()"></div>' +
    '<div class="property-edit-dialog-v630" role="dialog" aria-modal="true" aria-labelledby="propertyEditTitleV630">' +
      '<div class="property-edit-header-v630">' +
        '<div>' +
          '<strong id="propertyEditTitleV630">매물 임대조건 수정</strong>' +
          '<div id="propertyEditIdentityV630" class="property-edit-identity-v630"></div>' +
        '</div>' +
        '<button type="button" class="property-edit-close-v630" onclick="closePropertyEditModalV630()" aria-label="닫기">×</button>' +
      '</div>' +

      '<div class="property-edit-body-v135"><div class="property-edit-grid-v630">' +
        '<label class="property-edit-wide-v630">건물이름 (변경가능)' +
          '<input id="peNameV630" type="text" inputmode="text" autocomplete="off" maxlength="120" spellcheck="false">' +
        '</label>' +
        '<label class="property-edit-wide-v630 property-edit-readonly-label-v631">주소 (변경불가)' +
          '<input id="peAddressV630" type="text" readonly aria-readonly="true">' +
        '</label>' +
        '<label>호실<input id="peRoomV630" type="text"></label>' +
        '<label>보증금<input id="peDepositV630" type="number" inputmode="numeric"></label>' +
        '<label>월세<input id="peRentV630" type="number" inputmode="numeric"></label>' +
        '<label>관리비<input id="peFeeV630" type="number" inputmode="numeric"></label>' +
        '<label>권리금<input id="pePremiumV630" type="number" inputmode="numeric"></label>' +
        '<label>평수<input id="peAreaV630" type="number" inputmode="decimal" step="0.1"></label>' +
        '<label class="property-edit-contact-v136">임대인 전화번호<input id="peLandlordPhoneV630" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<label class="property-edit-contact-v136">세입자 전화번호<input id="peTenantPhoneV630" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<div id="propertyEditMemoContactsV224" class="property-edit-wide-v630"></div>' +
        '<label class="property-edit-wide-v630 property-edit-state-v136">상태' +
          '<select id="peStateV630">' +
            '<option value="">계약가능</option>' +
            '<option value="확인">확인매물</option>' +
            '<option value="미확인">미확인 매물</option>' +
            '<option value="보류">보류</option>' +
            '<option value="계약완료">계약완료</option>' +
          '</select>' +
        '</label>' +
        '<label class="property-edit-wide-v630 property-edit-memo-v136">메모' +
          '<textarea id="peMemoV630" rows="5"></textarea>' +
        '</label>' +
      '</div>' +

      '<div id="propertyEditRawMemoV144"></div>' +
      '<div id="propertyEditStatusV630" class="property-edit-status-v630" role="status"></div></div>' +

      '<div class="property-edit-actions-v630">' +
        '<button type="button" id="propertyEditDeleteBtnV648" class="property-edit-delete-v648" onclick="deletePropertyV648()">매물삭제</button>' +
        '<div class="property-edit-actions-right-v648">' +
          '<button type="button" class="property-edit-cancel-v630" onclick="closePropertyEditModalV630()">취소</button>' +
          '<button type="button" id="propertyEditSaveBtnV630" class="property-edit-save-v630" onclick="savePropertyEditV630()">저장</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  window.addEventListener("resize", syncPropertyEditViewportV135);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncPropertyEditViewportV135);
    window.visualViewport.addEventListener("scroll", syncPropertyEditViewportV135);
  }
  propertyEditFieldsV1().filter(function(field) {
    return ["name", "room", "deposit", "rent", "fee", "premium", "area", "landlordPhone", "tenantPhone"].indexOf(field[0]) !== -1;
  }).forEach(function(field) {
    document.getElementById(field[1]).addEventListener("input", function() {
      propertyEditTouchedFieldsV131[field[0]] = true;
      if (field[0] === 'landlordPhone' || field[0] === 'tenantPhone') delete this.dataset.memoPhoneV224;
      if (field[0] === "room") propertyEditRoomTouchedV130 = true;
    });
  });
  document.getElementById('peMemoV630').addEventListener('input', function() {
    if (propertyEditTargetV630 && !propertyEditSavingV630) syncPropertyMemoContactsV224(propertyEditTargetV630);
  });

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closePropertyEditModalV630();
    }
  });
}


function openPropertyEditModalV630(encodedKey) {
  if (typeof window !== "undefined" && window.JSQueryListingsV152 && window.JSQueryListingsV152.guardKey(encodedKey, function() {openPropertyEditModalV630(encodedKey);})) return;
  var saleItem = getPropertyByEncodedKeyV630(encodedKey);
  if (saleItem && window.JSListingTradeV1 && window.JSListingTradeV1.isSale(saleItem)) {
    if (window.JSSalePropertyEditV1) return window.JSSalePropertyEditV1.open(saleItem);
    alert("매매 수정창을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    return;
  }
  ensurePropertyEditModalV630();

  var item = getPropertyByEncodedKeyV630(encodedKey);

  if (!item) {
    alert("수정할 매물을 찾지 못했습니다.");
    return;
  }

  propertyEditTargetV630 = item;
  propertyEditSessionV226 += 1;
  propertyEditRoomTouchedV130 = false;
  propertyEditTouchedFieldsV131 = {};
  propertyEditSavingV630 = false;
  // Freeze the values the user actually saw, not a live item later refreshed
  // by collection, another tab, or an optimistic status change.
  propertyEditOriginalValuesV1 = buildOriginalPropertyValuesV630(item).slice();
  propertyEditConflictV1 = null;

  var deleteButtonV648 = document.getElementById("propertyEditDeleteBtnV648");
  var saveButtonV648 = document.getElementById("propertyEditSaveBtnV630");

  if (deleteButtonV648) {
    deleteButtonV648.disabled = false;
    deleteButtonV648.textContent = "매물삭제";
  }

  if (saveButtonV648) {
    saveButtonV648.disabled = false;
    saveButtonV648.textContent = "저장";
  }

  document.getElementById("propertyEditIdentityV630").textContent =
    [item.name, item.address, window.JSListingTradeV1 ? window.JSListingTradeV1.displayType(item) : item.type].filter(Boolean).join(" · ");

  document.getElementById("peNameV630").value = item.name || "";
  document.getElementById("peAddressV630").value = item.address || "";
  document.getElementById("peRoomV630").value = item.room || "";
  propertyEditFieldsV1().forEach(function(field) {
    if (["deposit", "rent", "fee", "premium", "area"].indexOf(field[0]) < 0) return;
    var input = document.getElementById(field[1]);
    var value = propertyEditNumberV135(item, field[0]);
    input.value = value === null ? "" : value;
    input.placeholder = "미입력";
  });
  document.getElementById("peLandlordPhoneV630").value = item.landlordPhone || "";
  delete document.getElementById('peLandlordPhoneV630').dataset.memoPhoneV224;
  window.JSBuildingRegistryV164?.decorateEdit(item);
  document.getElementById("peTenantPhoneV630").value = item.tenantPhone || "";
  delete document.getElementById('peTenantPhoneV630').dataset.memoPhoneV224;
  document.getElementById("peStateV630").value = item.state || "";
  document.getElementById("peMemoV630").value = propertyMemoTextV144(item);
  syncPropertyMemoContactsV224(item);
  document.getElementById("propertyEditRawMemoV144").innerHTML = window.JSUnifiedListingsV8 && window.JSUnifiedListingsV8.memoEditorRawHtml ? window.JSUnifiedListingsV8.memoEditorRawHtml(item) : "";
  document.getElementById("propertyEditStatusV630").textContent = "";
  var previousConflict = document.getElementById("propertyEditConflictV1");
  if (previousConflict) previousConflict.remove();

  var modal = document.getElementById("propertyEditModalV630");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  syncPropertyEditViewportV135();
  modal.querySelector(".property-edit-body-v135").scrollTop = 0;

  setTimeout(function() {
    var first = document.getElementById("peNameV630");
    // Do not steal focus from an input the user has already started editing.
    var handheld = window.JSPhoneDeviceV1 && window.JSPhoneDeviceV1.isHandheld();
    if (!handheld && first && propertyEditTargetV630 === item && modal.classList.contains("open") && !modal.contains(document.activeElement)) first.focus({preventScroll: true});
  }, 50);
}


function closePropertyEditModalV630() {
  if (propertyEditSavingV630) return;

  var modal = document.getElementById("propertyEditModalV630");
  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  propertyEditTargetV630 = null;
  propertyEditOriginalValuesV1 = null;
  propertyEditConflictV1 = null;
}


function numberFromEditV630(id) {
  var element = document.getElementById(id);
  if (!element || String(element.value).trim() === "") return null;
  var value = Number(element && element.value);

  return Number.isFinite(value) ? value : 0;
}

// A missing DB value is not an explicit zero. Preserve that distinction in
// both the frozen concurrency baseline and the form submitted to the server.
function propertyEditNumberV135(item, key) {
  if (item[key] === null || item.displayValuePresence && item.displayValuePresence[key] === false) return null;
  return item[key] || 0;
}

function syncPropertyEditViewportV135() {
  var modal = document.getElementById("propertyEditModalV630");
  if (!modal || !modal.classList.contains("open")) return;
  var viewport = window.visualViewport;
  var width = viewport ? viewport.width : window.innerWidth;
  var height = viewport ? viewport.height : window.innerHeight;
  // visualViewport values are already in layout CSS pixels, including the
  // native 1280px desktop-fit mode. Do not multiply by the zoom scale.
  modal.style.setProperty("--pe-left-v135", (viewport ? viewport.offsetLeft : 0) + "px");
  modal.style.setProperty("--pe-top-v135", (viewport ? viewport.offsetTop : 0) + "px");
  modal.style.setProperty("--pe-width-v135", width + "px");
  modal.style.setProperty("--pe-height-v135", height + "px");
  modal.classList.toggle("property-edit-compact-v135", width >= 700 && height < 900);
}


function normalizeBuildingNameV638(value) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}


function buildOriginalPropertyValuesV630(item) {
  return [
    item.name || "",
    item.address || "",
    item.room || "",
    item.type || "",
    propertyEditNumberV135(item, "deposit"),
    propertyEditNumberV135(item, "rent"),
    propertyEditNumberV135(item, "fee"),
    propertyEditNumberV135(item, "premium"),
    propertyEditNumberV135(item, "area"),
    item.landlordPhone || "",
    item.tenantPhone || "",
    item.memo || "",
    item.state || "",
    item.regDate || "",
    item.source || ""
  ];
}


function propertyEditFieldsV1() {
  return [
    ["name", "peNameV630", "건물이름", 0], ["room", "peRoomV630", "호실", 2],
    ["deposit", "peDepositV630", "보증금", 4], ["rent", "peRentV630", "월세", 5],
    ["fee", "peFeeV630", "관리비", 6], ["premium", "pePremiumV630", "권리금", 7],
    ["area", "peAreaV630", "평수", 8], ["landlordPhone", "peLandlordPhoneV630", "임대인 전화", 9],
    ["tenantPhone", "peTenantPhoneV630", "세입자 전화", 10], ["memo", "peMemoV630", "메모", 11],
    ["state", "peStateV630", "상태", 12]
  ];
}

function propertyEditComparableV1(key, value) {
  if (["deposit", "rent", "fee", "premium", "area"].indexOf(key) >= 0) return value === null || value === "" ? null : Number(value) || 0;
  if (key === "state") return !value || value === "active" ? "" : String(value).trim();
  return String(value == null ? "" : value).trim();
}

function propertyEditCurrentItemV1(row) {
  var item = { name: row.title, address: row.address, room: row.room, type: row.listing_type,
    deposit: row.deposit, rent: row.monthly_rent, fee: row.maintenance_fee, premium: row.premium,
    area: row.area_m2, landlordPhone: row.landlord_phone, tenantPhone: row.tenant_phone,
    memo: row.operating_memo, state: row.status === "active" ? "" : row.status,
    propertyId: row.property_id, contactListRaw: row.contacts_json,
    regDate: row.first_collected_at, source: row.main_source };
  item.displayValuePresence = {};
  ["deposit", "rent", "fee", "premium", "area"].forEach(function(key) {
    item.displayValuePresence[key] = item[key] !== null && item[key] !== undefined && item[key] !== "";
  });
  return item;
}

function propertyMemoTextV144(item) {
  return window.JSUnifiedListingsV8 && window.JSUnifiedListingsV8.editableMemoText
    ? window.JSUnifiedListingsV8.editableMemoText(item) : String(item && item.memo || "");
}

function syncPropertyMemoContactsV224(item) {
  if (propertyEditTargetV630 !== item) return;
  var values = memoContactEditorValuesV224(item, document.getElementById('peMemoV630').value);
  var fields = {landlordPhone:['peLandlordPhoneV630','landlord_phone'],tenantPhone:['peTenantPhoneV630','tenant_phone']};
  Object.keys(fields).forEach(function(key) {
    var input = document.getElementById(fields[key][0]), previous = input.dataset.memoPhoneV224;
    // A historically empty column is not a request to ignore a newly written
    // labelled memo number. A deletion made in this editor is still touched
    // and must not be filled back while the user types.
    if (input.readOnly || !previous && (propertyEditTouchedFieldsV131[key] || input.value.trim())) return;
    if (previous && input.value !== previous) return;
    input.value = values[key];
    if (values[key]) {input.dataset.memoPhoneV224 = values[key];propertyEditTouchedFieldsV131[key] = true;}
    else {delete input.dataset.memoPhoneV224;delete propertyEditTouchedFieldsV131[key];}
  });
  document.getElementById('propertyEditMemoContactsV224').innerHTML = memoContactEditorHtmlV224(values.contacts);
}

function showPropertyEditConflictV1(draft) {
  var target = propertyEditTargetV630;
  var status = document.getElementById("propertyEditStatusV630");
  if (!target) return Promise.resolve();
  if (!window.JSDataAccessV6) {
    status.textContent = "최신 값 조회 연결이 없습니다. 입력 내용은 유지되며 저장하지 않았습니다.";
    return Promise.resolve();
  }
  return window.JSDataAccessV6.read("listingChanges", { ids: target.propertyId }).then(function(result) {
    if (propertyEditTargetV630 !== target) return;
    var row = (result.items || []).filter(function(entry) { return entry.property_id === target.propertyId; })[0];
    if (!row || row.status === "deleted") {
      status.textContent = "매물이 삭제되었거나 조회할 수 없습니다. 입력 내용은 유지되며 저장하지 않았습니다.";
      return;
    }
    var current = propertyEditCurrentItemV1(row);
    // Keep edits typed while the latest-value request was in flight too.
    draft = Object.assign({}, draft);
    propertyEditFieldsV1().forEach(function(field) {
      draft[field[0]] = propertyEditComparableV1(field[0], document.getElementById(field[1]).value);
    });
    propertyEditConflictV1 = {current: current, draft: draft, choices: {}};
    var old = document.getElementById("propertyEditConflictV1");
    if (old) old.remove();
    var panel = document.createElement("div");
    panel.id = "propertyEditConflictV1";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "최신 값과 내 입력 비교");
    var heading = document.createElement("p");
    heading.textContent = "아직 저장하지 않았습니다. 체크한 항목만 내 입력을 유지합니다. 나머지는 최신 값을 사용합니다.";
    panel.appendChild(heading);
    propertyEditFieldsV1().forEach(function(field) {
      var key = field[0];
      var latest = propertyEditComparableV1(key, key === "memo" ? propertyMemoTextV144(current) : current[key]);
      var mine = propertyEditComparableV1(key, draft[key]);
      if (latest === mine) return;
      var initial = propertyEditComparableV1(key, key === "memo" ? propertyMemoTextV144({source:propertyEditOriginalValuesV1[14],memo:propertyEditOriginalValuesV1[field[3]]}) : propertyEditOriginalValuesV1[field[3]]);
      var label = document.createElement("label");
      label.style.display = "block";
      label.style.whiteSpace = "pre-wrap";
      label.style.overflowWrap = "anywhere";
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = mine !== initial && latest === initial;
      checkbox.setAttribute("aria-label", field[2] + " 내 입력 유지");
      propertyEditConflictV1.choices[key] = checkbox;
      label.appendChild(checkbox);
      var description = document.createElement("span");
      var display = function(value) { return key === "state" ? (value || "계약가능") : (value === null ? "(미입력)" : value === "" ? "(빈 값)" : String(value)); };
      description.textContent = " " + field[2] + " · 최신: " + display(latest) + " / 내 입력: " + display(mine);
      label.appendChild(description);
      panel.appendChild(label);
    });
    var apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "선택한 값으로 편집 계속 (아직 저장 안 함)";
    apply.onclick = applyPropertyEditConflictV1;
    panel.appendChild(apply);
    status.parentNode.insertBefore(panel, status.nextSibling);
    status.textContent = "다른 작업에서 값이 변경되어 저장을 중단했습니다. 입력 내용은 그대로 유지했습니다.";
  }).catch(function() {
    if (propertyEditTargetV630 === target) status.textContent = "최신 값 조회에 실패했습니다. 입력 내용은 유지됩니다. 저장을 다시 눌러 비교해 주세요.";
  });
}

function applyPropertyEditConflictV1() {
  var conflict = propertyEditConflictV1;
  if (!conflict || !propertyEditTargetV630 || propertyEditSavingV630) return;
  propertyEditFieldsV1().forEach(function(field) {
    var choice = conflict.choices[field[0]];
    if (choice && !choice.checked) delete propertyEditTouchedFieldsV131[field[0]];
    var value = choice && choice.checked ? document.getElementById(field[1]).value : conflict.current[field[0]];
    if (field[0] === "memo" && !(choice && choice.checked)) value = propertyMemoTextV144(conflict.current);
    document.getElementById(field[1]).value = propertyEditComparableV1(field[0], value);
  });
  document.getElementById("propertyEditRawMemoV144").innerHTML = window.JSUnifiedListingsV8 && window.JSUnifiedListingsV8.memoEditorRawHtml ? window.JSUnifiedListingsV8.memoEditorRawHtml(conflict.current) : "";
  propertyEditOriginalValuesV1 = buildOriginalPropertyValuesV630(conflict.current).slice();
  propertyEditRoomTouchedV130 = !!propertyEditTouchedFieldsV131.room;
  Object.assign(propertyEditTargetV630, conflict.current);
  propertyEditConflictV1 = null;
  var panel = document.getElementById("propertyEditConflictV1");
  if (panel) panel.remove();
  document.getElementById("propertyEditStatusV630").textContent = "최신 값 비교를 반영했습니다. 내용을 확인한 뒤 저장을 눌러 주세요.";
}




function replaceEditKeyV634(key, aliases, nextKey) {
  if (!key) return key;
  return aliases.indexOf(key) >= 0 ? nextKey : key;
}


function remapEditViewStateV634(state, aliases, nextKey) {
  if (!state) return null;

  return {
    selectedItemKey: replaceEditKeyV634(
      state.selectedItemKey || "",
      aliases,
      nextKey
    ),
    selectedGroupKey: state.selectedGroupKey || "",
    selectedGroupKeys: (state.selectedGroupKeys || []).slice(),
    multiClusterMode: !!state.multiClusterMode,
    clusterSelection: state.clusterSelection || null,
    visibleKeys: (state.visibleKeys || []).map(function(key) {
      return replaceEditKeyV634(key, aliases, nextKey);
    }),
    sidebarScrollTop: Number(state.sidebarScrollTop || 0),
    aiOpen: !!state.aiOpen,
    aiItemKey: replaceEditKeyV634(
      state.aiItemKey || "",
      aliases,
      nextKey
    ),
    aiScrollTop: Number(state.aiScrollTop || 0)
  };
}


function keepOnlyFilteredEditKeysV634(state) {
  if (!state) return null;

  var allowed = {};
  (currentItems || []).forEach(function(item) {
    if (item && item.key) allowed[item.key] = true;
  });

  state.visibleKeys = (state.visibleKeys || []).filter(function(key) {
    return !!allowed[key];
  });

  if (state.selectedItemKey && !allowed[state.selectedItemKey]) {
    state.selectedItemKey = "";
  }

  if (state.aiItemKey && !allowed[state.aiItemKey]) {
    state.aiItemKey = "";
    state.aiOpen = false;
  }

  return state;
}


function mergeEditAliasesV634(oldKey, newKey, item) {
  var aliases = [];

  if (
    pendingPropertyEditStateV634 &&
    pendingPropertyEditStateV634.address === String(item.address || "") &&
    pendingPropertyEditStateV634.type === String(item.type || "")
  ) {
    aliases = (pendingPropertyEditStateV634.aliases || []).slice();
  }

  [oldKey, newKey].forEach(function(key) {
    if (key && aliases.indexOf(key) < 0) aliases.push(key);
  });

  return aliases;
}


function restoreEditedViewNowV634(viewState, aliases, newKey) {
  applyFilter();

  var restoredState = remapEditViewStateV634(
    viewState,
    aliases,
    newKey
  );

  restoredState = keepOnlyFilteredEditKeysV634(restoredState);

  if (restoredState && typeof restoreAutoUpdateViewState === "function") {
    preserveActionSelectionDuringRender = true;
    restoreAutoUpdateViewState(restoredState);
    preserveActionSelectionDuringRender = false;
  }

  if (
    restoredState &&
    restoredState.selectedItemKey &&
    typeof redrawSelectedMarkers === "function"
  ) {
    redrawSelectedMarkers();
  }
}


function schedulePropertyEditReloadV634() {
  if (propertyEditReloadTimerV634) {
    clearTimeout(propertyEditReloadTimerV634);
  }

  /*
   * 연속 수정 시 마지막 저장 기준으로 한 번만 재조회합니다.
   */
  propertyEditReloadTimerV634 = setTimeout(function() {
    propertyEditReloadTimerV634 = null;
    loadSheet(true, true);
  }, 2200);
}


function savePropertyEditV630() {
  if (propertyEditSavingV630 || !propertyEditTargetV630) return;
  if(propertyEditPendingV226.has(String(propertyEditTargetV630.propertyId)))return;
  if(window.JSBuildingRegistryV164?.canSaveEdit(propertyEditTargetV630)===false)return;
  if (propertyEditConflictV1) {
    document.getElementById("propertyEditStatusV630").textContent = "먼저 최신 값 비교에서 유지할 입력을 선택해 주세요. 아직 저장하지 않았습니다.";
    return;
  }

  if (!saveApiURL) {
    alert("JS부동산 D1 서버 주소가 설정되지 않았습니다.");
    return;
  }

  var item = propertyEditTargetV630;
  var saveButton = document.getElementById("propertyEditSaveBtnV630");
  var deleteButton = document.getElementById("propertyEditDeleteBtnV648");
  var status = document.getElementById("propertyEditStatusV630");

  /*
   * 저장 직전 화면 상태를 보관합니다.
   */
  var editViewStateV634 =
    typeof captureAutoUpdateViewState === "function"
      ? captureAutoUpdateViewState()
      : null;

  var updated = {
    name: normalizeBuildingNameV638(
      document.getElementById("peNameV630").value
    ),
    room: String(document.getElementById("peRoomV630").value || "").trim(),
    deposit: numberFromEditV630("peDepositV630"),
    rent: numberFromEditV630("peRentV630"),
    fee: numberFromEditV630("peFeeV630"),
    premium: numberFromEditV630("pePremiumV630"),
    area: numberFromEditV630("peAreaV630"),
    landlordPhone: window.JSBuildingRegistryV164?window.JSBuildingRegistryV164.ownPhoneForSave(item,String(document.getElementById("peLandlordPhoneV630").value||'').trim()):String(document.getElementById("peLandlordPhoneV630").value || "").trim(),
    tenantPhone: String(document.getElementById("peTenantPhoneV630").value || "").trim(),
    memo: String(document.getElementById("peMemoV630").value || "").trim(),
    state: String(document.getElementById("peStateV630").value || "").trim(),
    contacts: extractListContactsV650(item,{withoutBuilding:true}).map(function(contact) {
      return { role: contact.role, phone: contact.phone.display };
    })
  };

  var rawMemoV144 = propertyEditOriginalValuesV1 && propertyEditOriginalValuesV1[11];
  if (rawMemoV144 != null && updated.memo === propertyMemoTextV144({source:propertyEditOriginalValuesV1[14],memo:rawMemoV144}).trim()) updated.memo = rawMemoV144;

  if (
    item.state === "계약완료" &&
    !updated.state &&
    typeof makeDoneMemo === "function"
  ) {
    updated.memo = makeDoneMemo(updated.memo, false);
    document.getElementById("peMemoV630").value = updated.memo;
  }

  var updatedValuePresenceV650 = {
    deposit: String(document.getElementById("peDepositV630").value || "").trim() !== "",
    rent: String(document.getElementById("peRentV630").value || "").trim() !== "",
    fee: String(document.getElementById("peFeeV630").value || "").trim() !== "",
    premium: String(document.getElementById("pePremiumV630").value || "").trim() !== "",
    area: String(document.getElementById("peAreaV630").value || "").trim() !== ""
  };

  propertyEditSavingV630 = true;
  saveButton.disabled = true;
  if (deleteButton) deleteButton.disabled = true;
  saveButton.textContent = "저장 중...";
  status.textContent = "D1에 매물 수정 저장 중...";
  var editPreviewV225=window.JSQueryListingsV152?.beginPropertyEditV225?.(item,updated,Object.keys(propertyEditTouchedFieldsV131));
  var editAccountV225=String(window.JSAuthenticatedAccountEmail||'').trim().toLowerCase();
  var backgroundV226=!!editPreviewV225,sessionV226=propertyEditSessionV226;
  var draftV226=Object.fromEntries(propertyEditFieldsV1().map(function(field){return[field[1],document.getElementById(field[1]).value];}));
  var memoAutoV226=Object.fromEntries(['peLandlordPhoneV630','peTenantPhoneV630'].map(function(id){return[id,document.getElementById(id).dataset.memoPhoneV224];}));
  var originalV226=propertyEditOriginalValuesV1&&propertyEditOriginalValuesV1.slice(),touchedV226=Object.assign({},propertyEditTouchedFieldsV131),roomTouchedV226=propertyEditRoomTouchedV130;
  function restoreDraftV226(error){
    ensurePropertyEditModalV630();propertyEditSessionV226++;propertyEditTargetV630=item;propertyEditSavingV630=false;propertyEditOriginalValuesV1=originalV226;propertyEditTouchedFieldsV131=touchedV226;propertyEditRoomTouchedV130=roomTouchedV226;propertyEditConflictV1=null;
    Object.keys(draftV226).forEach(function(id){document.getElementById(id).value=draftV226[id];});
    Object.keys(memoAutoV226).forEach(function(id){delete document.getElementById(id).dataset.memoPhoneV224;if(memoAutoV226[id])document.getElementById(id).dataset.memoPhoneV224=memoAutoV226[id];});
    window.JSBuildingRegistryV164?.decorateEdit(item);
    document.getElementById('propertyEditMemoContactsV224').innerHTML=memoContactEditorHtmlV224(memoContactEditorValuesV224(item,draftV226.peMemoV630).contacts);
    document.getElementById('propertyEditRawMemoV144').innerHTML=window.JSUnifiedListingsV8?.memoEditorRawHtml(item)||'';
    document.getElementById('propertyEditIdentityV630').textContent=[item.name,item.address,item.type].filter(Boolean).join(' · ');
    saveButton.disabled=false;saveButton.textContent='저장';if(deleteButton)deleteButton.disabled=false;
    var modal=document.getElementById('propertyEditModalV630');modal.classList.add('open');modal.setAttribute('aria-hidden','false');syncPropertyEditViewportV135();
    if(Number(error?.status)===409||/HTTP 409|PROPERTY_EDIT_CONFLICT/.test(String(error?.message||'')))showPropertyEditConflictV1(updated);
    else status.textContent='저장하지 못했습니다. 입력 내용은 유지됩니다. 확인 후 다시 저장해 주세요.';
  }

  var requestV226=postSafeMutationV654("updateProperty", {
      expectedAccountEmail: editAccountV225,
      row: item.sheetRow || 0,
      key: {
        propertyId: item.propertyId || "",
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || ""
      },
      originalValues: propertyEditOriginalValuesV1 && propertyEditOriginalValuesV1.slice(),
      editedFields: Object.keys(propertyEditTouchedFieldsV131),
      updated: updated
  });
  if(backgroundV226){
    propertyEditPendingV226.set(String(item.propertyId),true);
    var hiddenV226=document.getElementById('propertyEditModalV630');hiddenV226.classList.remove('open');hiddenV226.setAttribute('aria-hidden','true');
    propertyEditSavingV630=false;propertyEditTargetV630=null;propertyEditOriginalValuesV1=null;propertyEditConflictV1=null;
  }
  requestV226.then(function(queueResult) {
    propertyEditPendingV226.delete(String(item.propertyId));
    if(String(window.JSAuthenticatedAccountEmail||'').trim().toLowerCase()!==editAccountV225){editPreviewV225?.finish();if(propertyEditTargetV630===item)propertyEditSavingV630=false;return;}
    if (!queueResult || queueResult.persisted !== true || queueResult.queued || queueResult.propertyId && String(queueResult.propertyId) !== String(item.propertyId)) {
      throw new Error("매물 수정 저장 결과를 확인하지 못했습니다.");
    }
    /*
     * QA3 안정화:
     * gviz 캐시를 이용한 성공/실패 판정은 제거합니다.
     * 화면에서는 수정값을 즉시 반영하고, 잠시 뒤 최신 D1 데이터를 다시 읽습니다.
     */
    // The server may have merged unrelated changes from another editor.
    // Reflect the accepted values, never the stale full form we submitted.
    if (queueResult && queueResult.updated) updated = Object.assign({}, updated, queueResult.updated);
    var oldKey = item.key;

    item.name = updated.name;
    item.room = updated.room;
    item.deposit = updated.deposit;
    item.rent = updated.rent;
    item.fee = updated.fee;
    item.premium = updated.premium;
    item.area = updated.area;
    Object.keys(updatedValuePresenceV650).forEach(function(key) {
      updatedValuePresenceV650[key] = updated[key] !== null && updated[key] !== "" && updated[key] !== undefined;
    });
    item.displayValuePresence = updatedValuePresenceV650;
    item.landlordPhone = updated.landlordPhone;
    item.tenantPhone = updated.tenantPhone;
    item.memo = updated.memo;
    item.state = updated.state;
    item.contactListRaw = JSON.stringify(updated.contacts || []);
    item.key = itemKey(item);
    if (window.JSUnifiedListingsV8 && window.JSUnifiedListingsV8.acceptSavedFinancialEdit) window.JSUnifiedListingsV8.acceptSavedFinancialEdit(item,queueResult);
    editPreviewV225?.accepted();
    if (window.JSInitialListingsCacheV1) {
      try {
        var initialCache = window.JSInitialListingsCacheV1;
        Promise.resolve(initialCache.commitItem ? initialCache.commitItem(item, queueResult) : initialCache.clear()).catch(function() {});
      } catch (_) {}
    }

    var editAliasesV634 = mergeEditAliasesV634(
      oldKey,
      item.key,
      item
    );

    if(backgroundV226){
      if(selectedItemKey===oldKey)selectedItemKey=item.key;
      if(window.JSListingRefreshV1?.refreshMoved)Promise.resolve(window.JSListingRefreshV1.refreshMoved({affectedPropertyIds:[item.propertyId]})).catch(function(){});
      return;
    }

    pendingPropertyEditNewKeyV633 = item.key;
    pendingPropertyEditStateV634 = {
      aliases: editAliasesV634,
      newKey: item.key,
      address: String(item.address || ""),
      type: String(item.type || ""),
      viewState: remapEditViewStateV634(
        editViewStateV634,
        editAliasesV634,
        item.key
      )
    };

    if (selectedItemKey === oldKey || selectedItemKey === item.key) {
      selectedItemKey = item.key;
      selectedListCardIdV845 = typeof getLinkedSelectionCardIdV845 === "function"
        ? getLinkedSelectionCardIdV845(item)
        : (typeof selectedListCardIdV845 !== "undefined" ? selectedListCardIdV845 : null);
    }

    propertyEditSavingV630 = false;
    saveButton.disabled = false;
    if (deleteButton) deleteButton.disabled = false;
    saveButton.textContent = "저장";
    status.textContent = "";

    var modal = document.getElementById("propertyEditModalV630");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }

    propertyEditTargetV630 = null;
    propertyEditOriginalValuesV1 = null;

    /*
     * 필터·리스트·다중 선택 상태를 즉시 복원합니다.
     */
    restoreEditedViewNowV634(
      pendingPropertyEditStateV634.viewState,
      pendingPropertyEditStateV634.aliases,
      pendingPropertyEditStateV634.newKey
    );

    var mainStatus = document.getElementById("status");
    if (mainStatus) {
      mainStatus.innerHTML = "매물 수정 요청 완료 · 최신 D1 동기화 중";
    }

    if (!queueResult.fullReload && window.JSListingRefreshV1 && window.JSListingRefreshV1.refreshMoved) {
      var savedView = pendingPropertyEditStateV634;
      Promise.resolve().then(function() { return window.JSListingRefreshV1.refreshMoved({affectedPropertyIds:[item.propertyId]}); }).then(function(applied) {
        if (!applied) { if (pendingPropertyEditStateV634 === savedView) schedulePropertyEditReloadV634(); return; }
        if (pendingPropertyEditStateV634 === savedView) {
          pendingPropertyEditStateV634 = null;
          pendingPropertyEditNewKeyV633 = null;
          if (mainStatus && mainStatus.textContent === "매물 수정 요청 완료 · 최신 D1 동기화 중") mainStatus.textContent = "매물 수정 저장 완료";
        }
      }).catch(function() { if (pendingPropertyEditStateV634 === savedView) schedulePropertyEditReloadV634(); });
    } else schedulePropertyEditReloadV634();
  }).catch(function(error) {
    propertyEditPendingV226.delete(String(item.propertyId));
    editPreviewV225?.finish();
    if(String(window.JSAuthenticatedAccountEmail||'').trim().toLowerCase()!==editAccountV225){if(propertyEditTargetV630===item)propertyEditSavingV630=false;return;}
    console.error(error);
    if(backgroundV226){recoverPropertyDraftV226(editAccountV225,String(item.propertyId),function(){restoreDraftV226(error);},'매물 수정이 저장되지 않았습니다.',sessionV226===propertyEditSessionV226);return;}
    pendingPropertyEditNewKeyV633 = null;
    pendingPropertyEditStateV634 = null;
    propertyEditSavingV630 = false;
    saveButton.disabled = false;
    if (deleteButton) deleteButton.disabled = false;
    saveButton.textContent = "저장";
    if (Number(error && error.status) === 409 || /HTTP 409|PROPERTY_EDIT_CONFLICT/.test(String(error && error.message || ""))) {
      status.textContent = "다른 작업에서 값이 변경되었습니다. 입력 내용은 유지한 채 최신 값을 조회합니다.";
      showPropertyEditConflictV1(updated);
    } else {
      status.textContent = "수정 요청에 실패했습니다. 입력 내용은 유지됩니다.";
      alert("매물 수정 중 오류가 발생했습니다. 입력 내용은 유지됩니다.");
    }
  });
}


/* =========================================================
   v6.4.8 매물삭제
   - 수정 팝업 하단 좌측의 빨간 삭제 버튼
   - 고유 매물ID가 유일하게 일치할 때만 서버에서 삭제
   - 행번호·주소·호실을 이용한 대체 삭제 금지
   - D1 API의 실제 처리 결과 확인 후에만 완료 처리
   ========================================================= */

function buildPropertyDeleteLabelV648(item) {
  return [
    item && item.name ? item.name : "건물이름 없음",
    item && item.address ? item.address : "주소 없음",
    item && item.room ? item.room : "호실 없음",
    "보증금 " + (Number(item && item.deposit) || 0) +
      " / 월세 " + (Number(item && item.rent) || 0)
  ].join("\n");
}


function createPropertyDeleteRequestIdV648() {
  return "property-delete-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 12);
}


function readMutationStatusJsonpV648(requestId) {
  return new Promise(function(resolve, reject) {
    var callbackName = "__propertyDeleteStatusV648_" +
      Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    var script = document.createElement("script");
    var settled = false;
    var timeout = setTimeout(function() {
      finish(new Error("삭제 결과 확인 시간이 초과되었습니다."));
    }, 7000);

    function cleanup() {
      clearTimeout(timeout);
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value || {});
    }

    window[callbackName] = function(payload) {
      finish(null, payload);
    };

    script.onerror = function() {
      finish(new Error("삭제 결과를 확인하지 못했습니다."));
    };

    script.src = saveApiURL +
      "?action=mutationStatus" +
      "&requestId=" + encodeURIComponent(requestId) +
      "&callback=" + encodeURIComponent(callbackName) +
      "&_=" + Date.now();

    document.head.appendChild(script);
  });
}


function waitForPropertyDeleteResultV648(requestId, attempt) {
  var currentAttempt = Number(attempt) || 0;

  return readMutationStatusJsonpV648(requestId).then(function(status) {
    if (status && status.ready) {
      return status.result || {
        ok: false,
        message: "삭제 결과가 비어 있습니다."
      };
    }

    if (currentAttempt >= 19) {
      throw new Error(
        "삭제 결과 확인 시간이 초과되었습니다. 새로고침 후 삭제 여부를 확인해주세요."
      );
    }

    return new Promise(function(resolve) {
      setTimeout(resolve, 400);
    }).then(function() {
      return waitForPropertyDeleteResultV648(requestId, currentAttempt + 1);
    });
  });
}


function deletePropertyV648() {
  if (propertyEditSavingV630 || !propertyEditTargetV630) return;

  if (!saveApiURL) {
    alert("JS부동산 D1 서버 주소가 설정되지 않았습니다.");
    return;
  }

  var item = propertyEditTargetV630;
  var propertyId = String(item.propertyId || "").trim();

  if (!propertyId) {
    alert(
      "이 매물에는 고유 매물ID가 없어 안전하게 삭제할 수 없습니다.\n" +
      "새로고침 후에도 매물ID가 없으면 관리자에게 확인해주세요."
    );
    return;
  }

  var confirmed = window.confirm(
    "정말 이 매물을 삭제하시겠습니까?\n\n" +
    buildPropertyDeleteLabelV648(item) +
    "\n\n삭제한 행은 되돌릴 수 없습니다."
  );

  if (!confirmed) return;

  var deleteButton = document.getElementById("propertyEditDeleteBtnV648");
  var saveButton = document.getElementById("propertyEditSaveBtnV630");
  var status = document.getElementById("propertyEditStatusV630");
  var requestId = createPropertyDeleteRequestIdV648();

  propertyEditSavingV630 = true;

  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = "삭제 중...";
  }
  if (saveButton) saveButton.disabled = true;
  if (status) status.textContent = "매물ID 확인 후 D1에서 삭제 중...";

  fetch(saveApiURL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "deleteProperty",
      requestId: requestId,
      key: {
        propertyId: propertyId
      },
      originalValues: buildOriginalPropertyValuesV630(item)
    })
  }).then(function() {
    return waitForPropertyDeleteResultV648(requestId, 0);
  }).then(function(result) {
    if (!result || !result.ok) {
      throw new Error(
        result && result.message
          ? result.message
          : "서버가 매물 삭제를 거부했습니다."
      );
    }

    propertyEditSavingV630 = false;
    propertyEditTargetV630 = null;
    pendingPropertyEditNewKeyV633 = null;
    pendingPropertyEditStateV634 = null;

    if (propertyEditReloadTimerV634) {
      clearTimeout(propertyEditReloadTimerV634);
      propertyEditReloadTimerV634 = null;
    }

    var modal = document.getElementById("propertyEditModalV630");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }

    if (typeof clearLinkedListingSelectionV845 === "function") {
      clearLinkedListingSelectionV845();
    } else {
      selectedItemKey = null;
      selectedListCardIdV845 = null;
    }
    selectedGroupKey = null;
    selectedGroupKeys = [];
    if (typeof clearPinnedClusterSelectionV6515 === "function") {
      clearPinnedClusterSelectionV6515(false);
    }
    openMemoKey = null;
    editingMemoKey = null;

    var mainStatus = document.getElementById("status");
    if (mainStatus) mainStatus.innerHTML = "매물 삭제 완료 · 최신 D1 불러오는 중";

    loadSheet(false);
  }).catch(function(error) {
    console.error(error);
    propertyEditSavingV630 = false;

    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent = "매물삭제";
    }
    if (saveButton) saveButton.disabled = false;

    var message = error && error.message
      ? error.message
      : "매물 삭제 중 오류가 발생했습니다.";

    if (status) status.textContent = message;
    alert(message);
  });
}

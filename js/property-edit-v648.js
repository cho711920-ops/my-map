/* =========================================================
   v6.3.0 현장모드 - 매물 임대조건 수정
   - 임장추가 버튼 옆 '수정'
   - 기존 행을 새 행으로 추가하지 않고 정확히 찾아 수정
   - 주소/건물이름/구분은 식별 기준으로 유지하고 편집 대상에서 제외
   ========================================================= */

var propertyEditTargetV630 = null;
var propertyEditSavingV630 = false;

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

      '<div class="property-edit-grid-v630">' +
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
        '<label>임대인 전화번호<input id="peLandlordPhoneV630" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<label>세입자 전화번호<input id="peTenantPhoneV630" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>' +
        '<label class="property-edit-wide-v630">상태' +
          '<select id="peStateV630">' +
            '<option value="">계약가능</option>' +
            '<option value="계약완료">계약완료</option>' +
          '</select>' +
        '</label>' +
        '<label class="property-edit-wide-v630">메모' +
          '<textarea id="peMemoV630" rows="5"></textarea>' +
        '</label>' +
      '</div>' +

      '<div id="propertyEditStatusV630" class="property-edit-status-v630"></div>' +

      '<div class="property-edit-actions-v630">' +
        '<button type="button" id="propertyEditDeleteBtnV648" class="property-edit-delete-v648" onclick="deletePropertyV648()">매물삭제</button>' +
        '<div class="property-edit-actions-right-v648">' +
          '<button type="button" class="property-edit-cancel-v630" onclick="closePropertyEditModalV630()">취소</button>' +
          '<button type="button" id="propertyEditSaveBtnV630" class="property-edit-save-v630" onclick="savePropertyEditV630()">저장</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closePropertyEditModalV630();
    }
  });
}


function openPropertyEditModalV630(encodedKey) {
  ensurePropertyEditModalV630();

  var item = getPropertyByEncodedKeyV630(encodedKey);

  if (!item) {
    alert("수정할 매물을 찾지 못했습니다.");
    return;
  }

  propertyEditTargetV630 = item;
  propertyEditSavingV630 = false;

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
    [item.name, item.address, item.type].filter(Boolean).join(" · ");

  document.getElementById("peNameV630").value = item.name || "";
  document.getElementById("peAddressV630").value = item.address || "";
  document.getElementById("peRoomV630").value = item.room || "";
  document.getElementById("peDepositV630").value = item.deposit || 0;
  document.getElementById("peRentV630").value = item.rent || 0;
  document.getElementById("peFeeV630").value = item.fee || 0;
  document.getElementById("pePremiumV630").value = item.premium || 0;
  document.getElementById("peAreaV630").value = item.area || 0;
  document.getElementById("peLandlordPhoneV630").value = item.landlordPhone || "";
  document.getElementById("peTenantPhoneV630").value = item.tenantPhone || "";
  document.getElementById("peStateV630").value = item.state || "";
  document.getElementById("peMemoV630").value = item.memo || "";
  document.getElementById("propertyEditStatusV630").textContent = "";

  var modal = document.getElementById("propertyEditModalV630");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  setTimeout(function() {
    var first = document.getElementById("peNameV630");
    if (first) first.focus();
  }, 50);
}


function closePropertyEditModalV630() {
  if (propertyEditSavingV630) return;

  var modal = document.getElementById("propertyEditModalV630");
  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  propertyEditTargetV630 = null;
}


function numberFromEditV630(id) {
  var element = document.getElementById(id);
  var value = Number(element && element.value);

  return Number.isFinite(value) ? value : 0;
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
    item.deposit || 0,
    item.rent || 0,
    item.fee || 0,
    item.premium || 0,
    item.area || 0,
    item.landlordPhone || "",
    item.tenantPhone || "",
    item.memo || "",
    item.state || "",
    item.regDate || "",
    item.source || ""
  ];
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
    loadSheet(true);
  }, 2200);
}


function savePropertyEditV630() {
  if (propertyEditSavingV630 || !propertyEditTargetV630) return;

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
    landlordPhone: String(document.getElementById("peLandlordPhoneV630").value || "").trim(),
    tenantPhone: String(document.getElementById("peTenantPhoneV630").value || "").trim(),
    memo: String(document.getElementById("peMemoV630").value || "").trim(),
    state: String(document.getElementById("peStateV630").value || "").trim(),
    contacts: extractListContactsV650(item).map(function(contact) {
      return { role: contact.role, phone: contact.phone.display };
    })
  };
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

  postSafeMutationV654("updateProperty", {
      row: item.sheetRow || 0,
      key: {
        propertyId: item.propertyId || "",
        name: item.name || "",
        address: item.address || "",
        room: item.room || "",
        type: item.type || ""
      },
      originalValues: buildOriginalPropertyValuesV630(item),
      updated: updated
  }).then(function(queueResult) {
    /*
     * QA3 안정화:
     * gviz 캐시를 이용한 성공/실패 판정은 제거합니다.
     * 화면에서는 수정값을 즉시 반영하고, 잠시 뒤 최신 D1 데이터를 다시 읽습니다.
     */
    var oldKey = item.key;

    item.name = updated.name;
    item.room = updated.room;
    item.deposit = updated.deposit;
    item.rent = updated.rent;
    item.fee = updated.fee;
    item.premium = updated.premium;
    item.area = updated.area;
    item.displayValuePresence = updatedValuePresenceV650;
    item.landlordPhone = updated.landlordPhone;
    item.tenantPhone = updated.tenantPhone;
    item.memo = updated.memo;
    item.state = updated.state;
    item.contactListRaw = JSON.stringify(updated.contacts || []);
    item.key = itemKey(item);

    var editAliasesV634 = mergeEditAliasesV634(
      oldKey,
      item.key,
      item
    );

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

    if (!queueResult || !queueResult.queued) schedulePropertyEditReloadV634();
  }).catch(function(error) {
    console.error(error);
    pendingPropertyEditNewKeyV633 = null;
    pendingPropertyEditStateV634 = null;
    propertyEditSavingV630 = false;
    saveButton.disabled = false;
    if (deleteButton) deleteButton.disabled = false;
    saveButton.textContent = "저장";
    status.textContent = "수정 요청에 실패했습니다.";
    alert("매물 수정 중 오류가 발생했습니다.");
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

    selectedItemKey = null;
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


/* =========================================================
   JS부동산 선택인쇄 v2
   표 구성:
   전화번호 | 건물이름·주소 | 매물내역 | 메모 | 등록일
   ========================================================= */

(function () {
  "use strict";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function shortDate(value) {
    var text = String(value || "").trim();
    var match = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);

    if (match) {
      return match[1].slice(2) + "." +
        String(match[2]).padStart(2, "0") + "." +
        String(match[3]).padStart(2, "0");
    }

    return text;
  }

  function todayLabel() {
    var d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  }

  function cleanMemo(value) {
    return String(value || "")
      .replace(/\(\s*임장가자\s*\)/gi, "")
      .replace(/\(\s*공실박스\s*\)/gi, "")
      .replace(/출처\s*[:：]\s*[^\/|,，\n]+/gi, "")
      .replace(/\s*\/\s*\/\s*/g, " / ")
      .replace(/^\s*\/\s*/, "")
      .replace(/\s*\/\s*$/, "")
      .trim();
  }

  function phoneHtml(item) {
    var rows = [];

    if (item.landlordPhone) {
      rows.push('<div><b>임</b> ' + esc(item.landlordPhone) + '</div>');
    }

    if (item.tenantPhone) {
      rows.push('<div><b>세</b> ' + esc(item.tenantPhone) + '</div>');
    }

    return rows.join("") || '<span class="empty-cell">-</span>';
  }

  function buildingHtml(item) {
    var name = item.name ? '<div class="print-building-name">' + esc(item.name) + '</div>' : "";
    var room = item.room ? ' <span class="print-room">' + esc(item.room) + '</span>' : "";
    var address = '<div class="print-address">' + esc(item.address || "") + room + '</div>';

    return name + address;
  }

  function detailHtml(item) {
    var top = [
      item.type || "",
      item.room || "",
      item.area ? item.area + "평" : ""
    ].filter(Boolean).join(" · ");

    var price = [
      "보" + (item.deposit || 0),
      "월" + (item.rent || 0),
      "관" + (item.fee || 0),
      "권" + (item.premium || 0)
    ].join(" / ");

    return (
      (top ? '<div class="print-detail-top">' + esc(top) + '</div>' : "") +
      '<div class="print-price">' + esc(price) + '</div>'
    );
  }

  function rowClass(item) {
    var classes = [];

    if (typeof isDone === "function" && isDone(item)) {
      classes.push("print-row-done");
    }

    if (
      typeof isFieldVisitItem === "function" &&
      isFieldVisitItem(item)
    ) {
      classes.push("print-row-visit");
    }

    return classes.join(" ");
  }

  window.printSelectedList = function () {
    var items =
      typeof getSelectedPrintItems === "function"
        ? getSelectedPrintItems()
        : [];

    if (!items.length) {
      alert("인쇄할 매물을 선택해주세요.");
      return;
    }

    var rows = items.map(function (item) {
      var memo = cleanMemo(item.memo);

      return (
        '<tr class="' + rowClass(item) + '">' +
          '<td class="col-phone">' + phoneHtml(item) + '</td>' +
          '<td class="col-building">' + buildingHtml(item) + '</td>' +
          '<td class="col-detail">' + detailHtml(item) + '</td>' +
          '<td class="col-memo">' +
            (memo
              ? '<div class="print-memo">' + esc(memo) + '</div>'
              : '<span class="empty-cell">-</span>') +
          '</td>' +
          '<td class="col-date">' + esc(shortDate(item.regDate)) + '</td>' +
        '</tr>'
      );
    }).join("");

    var html =
      '<!doctype html>' +
      '<html lang="ko">' +
      '<head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>JS부동산 임장리스트</title>' +
        '<link rel="stylesheet" href="css/print-v2.css?v=2.0.0">' +
      '</head>' +
      '<body class="js-print-body">' +
        '<main class="js-print-sheet">' +
          '<header class="js-print-header">' +
            '<div class="js-print-title">JS부동산 임장리스트</div>' +
            '<div class="js-print-meta">' +
              '<span>출력일: ' + esc(todayLabel()) + '</span>' +
              '<span>총 선택매물: ' + items.length + '건</span>' +
            '</div>' +
          '</header>' +
          '<table class="js-print-table">' +
            '<colgroup>' +
              '<col style="width:14%">' +
              '<col style="width:20%">' +
              '<col style="width:24%">' +
              '<col style="width:34%">' +
              '<col style="width:8%">' +
            '</colgroup>' +
            '<thead>' +
              '<tr>' +
                '<th>전화번호</th>' +
                '<th>건물이름 · 주소</th>' +
                '<th>매물내역</th>' +
                '<th>메모</th>' +
                '<th>등록일</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</main>' +
        '<script>' +
          'window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});' +
        '<\/script>' +
      '</body>' +
      '</html>';

    var printWindow = window.open("", "_blank", "width=1100,height=850");

    if (!printWindow) {
      alert("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 인쇄해주세요.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };
})();

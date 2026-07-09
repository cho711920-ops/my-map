<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JS부동산 매물지도</title>

<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=5aac168af365fa2024b4fd331bcf9463&libraries=services&autoload=false"></script>

<link rel="stylesheet" href="css/style.css">
</head>

<body>

<div id="wrap">
  <div id="sidebar">
    <div id="dragHandle"></div>
    <div class="header">JS부동산 매물지도</div>

    <div class="filters">
      <div class="filter-title">매물 검색</div>

      <div class="search-row">
        <input id="keyword" placeholder="지역 / 건물이름 / 호실 / 구분 / 메모 검색">
        <button class="search-btn" onclick="applyFilter()">검색</button>
      </div>

      <div class="filter-row">
        <button id="detailBtn" class="detail-btn" onclick="toggleDetailFilter()">상세▼</button>

        <div class="filter-select-wrap">
          <select id="typeFilter" onchange="applyFilter()">
            <option value="">구분 전체</option>
          </select>

          <select id="sortFilter" onchange="applyFilter()">
            <option value="latest">최신등록순</option>
            <option value="name">가나다순</option>
            <option value="depositLow">보증금 낮은순</option>
            <option value="depositHigh">보증금 높은순</option>
            <option value="rentLow">월세 낮은순</option>
            <option value="rentHigh">월세 높은순</option>
            <option value="areaHigh">평수 큰순</option>
            <option value="areaLow">평수 작은순</option>
          </select>
        </div>

        <button id="favoriteBtn" class="favorite-filter-btn" onclick="toggleFavoriteOnly()">찜만</button>
        <button class="reset-btn" onclick="resetFilter()">초기화</button>
      </div>

      <div class="extra-action-row">
        <button id="hideDoneBtn" class="hide-done-btn" onclick="toggleHideDone()">완료숨김</button>
        <button class="select-all-btn" onclick="selectAllVisibleItems()">전체선택</button>
        <button class="clear-selected-btn" onclick="clearSelectedPrintItems()">선택해제</button>
        <button id="printSelectedBtn" class="print-btn" onclick="printSelectedList()">선택인쇄</button>
        <button class="quick-add-btn" onclick="openQuickAddModal()">빠른등록</button>
      </div>

      <div id="detailFilter" class="detail-filter">
        <div class="row">
          <input id="minDeposit" placeholder="보증금 최소">
          <input id="maxDeposit" placeholder="보증금 최대">
        </div>

        <div class="row">
          <input id="minRent" placeholder="월세 최소">
          <input id="maxRent" placeholder="월세 최대">
        </div>

        <div class="row">
          <input id="minArea" placeholder="평수 최소">
          <input id="maxArea" placeholder="평수 최대">
        </div>

        <button class="apply-btn" onclick="applyFilter()">필터 적용</button>
      </div>
    </div>

    <div id="list"></div>
  </div>

  <div id="map"></div>
</div>

<button id="toggleBtn" onclick="toggleSidebar()">매물 보기</button>
<div id="status">로딩중...</div>
<div id="errorStatus" onclick="showAddressErrors()">주소 오류 0개</div>

<div id="roadviewModal">
  <div id="roadviewBox">
    <h3>네이버 로드뷰 보기</h3>
    <p style="font-size:14px;color:#555;">
      네이버지도가 열리면<br>
      거리뷰/로드뷰 버튼을 눌러 확인하세요.
    </p>
    <a id="roadviewLink" class="rv-btn" target="_blank">네이버지도에서 위치 열기</a>
    <div class="rv-close" onclick="closeRoadviewModal()">닫기</div>
  </div>
</div>



<div id="quickAddModal">
  <div class="quick-add-box">
    <div class="quick-add-title">JS부동산 AI 등록 v2.0</div>
    <div class="quick-add-desc">
      공실박스·네이버·당근 등에서 본 내용을 붙여넣으면 AI가 주요 항목을 추출합니다.<br>
      분석 결과는 아래 칸에서 직접 수정한 뒤 시트 행 복사 또는 자동등록으로 넘길 수 있습니다.
    </div>

    <div class="quick-add-grid">
      <div class="full">
        <label>외부 매물 내용 붙여넣기</label>
        <textarea id="qaRaw" placeholder="예: 대전 용문동 상가 보증금 2000 월세 110 관리비 5 권리금 1000 30평 010-0000-0000 메모..."></textarea>
      </div>

      <div>
        <label>출처</label>
        <select id="qaSource">
          <option value="공실박스">공실박스</option>
          <option value="네이버">네이버</option>
          <option value="당근">당근</option>
          <option value="직접확인">직접확인</option>
          <option value="기타">기타</option>
        </select>
      </div>

      <div>
        <label>등록일</label>
        <input id="qaRegDate" placeholder="자동입력">
      </div>

      <div>
        <label>건물이름</label>
        <input id="qaName" placeholder="건물이름 또는 제목">
      </div>

      <div>
        <label>주소</label>
        <input id="qaAddress" placeholder="예: 용문동 272-14">
      </div>

      <div>
        <label>호실</label>
        <input id="qaRoom" placeholder="예: 1층 / 201호">
      </div>

      <div>
        <label>구분</label>
        <input id="qaType" placeholder="예: 상가 / 사무실 / 월세">
      </div>

      <div>
        <label>보증금</label>
        <input id="qaDeposit" placeholder="예: 2000">
      </div>

      <div>
        <label>월세</label>
        <input id="qaRent" placeholder="예: 110">
      </div>

      <div>
        <label>관리비</label>
        <input id="qaFee" placeholder="예: 5">
      </div>

      <div>
        <label>권리금</label>
        <input id="qaPremium" placeholder="예: 1000">
      </div>

      <div>
        <label>평수</label>
        <input id="qaArea" placeholder="예: 30">
      </div>

      <div>
        <label>임대인전화</label>
        <input id="qaLandlordPhone" placeholder="010-0000-0000">
      </div>

      <div>
        <label>세입자전화</label>
        <input id="qaTenantPhone" placeholder="010-0000-0000">
      </div>

      <div>
        <label>상태</label>
        <select id="qaState">
          <option value="">공란/계약가능</option>
          <option value="계약완료">계약완료</option>
        </select>
      </div>

      <div class="full">
        <label>메모</label>
        <textarea id="qaMemo" placeholder="출처, 특징, 확인사항 등을 적어두세요."></textarea>
      </div>
    </div>

    <div id="quickAddWarning" class="quick-add-warning"></div>
    <div id="quickAddPreview" class="quick-add-preview">AI 분석 전입니다. 외부 매물 내용을 붙여넣고 AI 분석을 눌러주세요.</div>

    <div class="quick-add-actions">
      <button class="parse-btn" onclick="parseQuickAddText()">AI 분석</button>
      <button class="auto-save-btn" onclick="saveQuickAddToSheet()">자동등록 준비</button>
      <button class="copy-row-btn" onclick="copyQuickAddRow()">시트 행 복사</button>
      <button class="open-sheet-btn" onclick="openGoogleSheet()">시트 열기</button>
      <button class="close-quick-btn" onclick="closeQuickAddModal()">닫기</button>
    </div>

    <div class="quick-add-tip">
      ※ 자동등록을 쓰려면 HTML 코드 상단의 <b>saveApiURL</b>에 Apps Script 웹앱 URL을 1번만 넣으면 됩니다.<br>
      ※ 아직 연결 전이면 <b>시트 행 복사</b>로 기존처럼 구글시트 맨 아래 첫 칸에 붙여넣을 수 있습니다.<br>
      ※ 복사/등록 순서: 건물이름 / 주소 / 호실 / 구분 / 보증금 / 월세 / 관리비 / 권리금 / 평수 / 임대인전화 / 세입자전화 / 메모 / 상태 / 등록일
    </div>
  </div>
</div>

<script src="js/script.js"></script>
<script src="js/parser.js"></script>

</body>
</html>

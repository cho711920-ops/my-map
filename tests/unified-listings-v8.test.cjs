const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backend = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_통합운영시스템_v7.gs",
  "utf8"
);
const ui = fs.readFileSync("js/unified-listings-v8.js", "utf8");
const css = fs.readFileSync("css/unified-listings-v8.css", "utf8");
const naver = fs.readFileSync("js/naver-collector.js", "utf8");
const gongsil = fs.readFileSync("js/gongsil-collector.js", "utf8");
const operationsCenter = fs.readFileSync("js/operations-center-v7.js", "utf8");
const operationsReview = fs.readFileSync("js/operations-collection-v8.js", "utf8");
const daangn = fs.readFileSync(
  "C:/Users/USER/Documents/Codex/2026-07-17/sork/outputs/JS부동산_당근수집기_v2_개별및클러스터.gs",
  "utf8"
);

assert.match(backend, /MM_VERSION = "8\.1\.1"/);
assert.match(backend, /var MM_V8_ORIGINAL_SHEET = "JS_원본매물"/);
assert.match(backend, /var MM_V8_RELATION_SHEET = "JS_통합매물연결"/);
assert.match(backend, /var MM_V8_MEDIA_SHEET = "JS_원본미디어"/);
assert.match(backend, /var MM_V8_TELL_SHEET = "JS_연락처원본"/);
assert.match(backend, /function mmV8MoveOriginal_/);
assert.match(backend, /expectedRevision/);
assert.match(backend, /verifiedOriginal !== targetMasterId \|\| verifiedSource !== targetMasterId/);
assert.match(backend, /지번주소·층호실 동일 · 원본매물 연결/);
assert.match(backend, /101호와 102호/);
assert.match(backend, /row\[16\] = ""/);

assert.match(ui, /동일매물 ' \+ count \+ '개/);
assert.match(ui, /동일매물 ' \+ count \+ '개/);
assert.match(ui, /원본 링크 열기/);
assert.match(ui, /별도 매물로 분리/);
assert.match(ui, /이 매물 전체 통합/);
assert.doesNotMatch(ui, /이 원본 링크 열기/);
assert.match(css, /\.unified-detail-actions-v8 \.separate,[\s\S]*?height:\s*30px/);
assert.match(ui, /이동할 통합매물 카드 또는 체크박스를 클릭하세요/);
assert.match(ui, /통합 저장·시트 확인 중입니다/);
assert.match(ui, /event\.preventDefault\(\)/);
assert.match(ui, /pending\.sourcePropertyId === propertyId/);
assert.match(ui, /if \(moveBanner\) moveBanner\.hidden = true/);
assert.match(ui, /openGallery/);
assert.match(ui, /aria-label="이전 사진"/);
assert.match(ui, /aria-label="다음 사진"/);
assert.match(ui, /function stepGallery\(direction\)/);
assert.match(ui, /function renderDetailPhoto\(gallery, index\)/);
assert.match(ui, /function detailDisplayImageUrl\(url\)/);
assert.match(ui, /function preloadDetailImage\(url, highPriority\)/);
assert.match(ui, /slice\(0, 6\)/);
assert.match(ui, /\[1, 2, 3, 4, 5\]/);
assert.match(ui, /s=960x960/);
assert.match(ui, /function stepDetailPhoto\(button, direction\)/);
assert.match(ui, /function openDetailGallery\(button\)/);
assert.match(ui, /unified-detail-photo-count-v8/);
assert.match(ui, /event\.key === "ArrowLeft"/);
assert.match(ui, /event\.key === "ArrowRight"/);
assert.match(ui, /function closeDetail\(\)/);
assert.match(ui, /openTell/);
assert.match(ui, /function loadTellContacts\(query\)/);
assert.match(ui, /function getCachedTellContacts\(query\)/);
assert.match(ui, /state\.tellInputTimer = global\.setTimeout/);
assert.match(ui, /if \(cached\) renderTellResults\(results, cached\)/);
assert.match(css, /unified-expanded-v8/);
assert.match(css, /border: 1px solid #93c5fd/);
assert.match(css, /visibility: hidden;[\s\S]*?pointer-events: none;/);
assert.match(css, /unified-detail-drawer-v8\.open \{[\s\S]*?visibility: visible;[\s\S]*?pointer-events: auto;/);
assert.match(css, /unified-gallery-nav-v8/);
assert.match(css, /unified-detail-gallery-v8 \{ position: relative; height: 330px/);
assert.match(css, /unified-detail-photo-count-v8/);
assert.match(css, /unified-detail-summary-v8 > p \{[^}]*font-size: 17px/);
assert.match(css, /async-mutation-status-v1\.idle \{ display: none/);
assert.match(naver, /function finImageUrls/);
assert.match(gongsil, /function collectMediaUrls/);
assert.match(gongsil, /상세조회·역할 확인이 실패하면 빈 연락처로 덮지 않고 이 원본만 실패 처리/);
assert.doesNotMatch(gongsil, /phones = \{[^}]*contacts: \[\]/);
assert.match(daangn, /articleByOriginalArticleId/);
assert.match(daangn, /raw: article/);
assert.match(daangn, /function dgImageUrls_/);
assert.match(daangn, /primaryImage: record\.primaryImage/);
assert.match(operationsCenter, /getDashboard: function\(\) \{ return state\.dashboard; \}/);
assert.match(operationsCenter, /활성 통합매물/);
assert.doesNotMatch(operationsCenter, /대표출처 우선순위/);
assert.match(operationsReview, /현재 시트가 비어 있습니다/);
assert.match(operationsReview, /!dashboardReviewCount && !dashboardMasterCount && !number\(dashboard\.raw\)/);

const context = {
  Utilities: {
    formatDate() { return "2026-08-01 10:00:00"; },
    getUuid() { return "uuid"; },
    DigestAlgorithm: {SHA_256: "SHA_256"},
    Charset: {UTF_8: "UTF_8"},
    computeDigest() { return Array(32).fill(7); }
  },
  Session: {getScriptTimeZone() { return "Asia/Seoul"; }}
};
vm.createContext(context);
vm.runInContext(backend, context);

const master = Array(31).fill("");
master[0] = "테스트상가";
master[1] = "서구 용문동 219-8";
master[2] = "101호";
master[3] = "일반상가";
master[4] = 1000;
master[5] = 50;
master[8] = 9;
master[15] = "M-SPACE-1";
master[17] = "활성";
master[19] = context.mmPhysicalKey_(master[1], master[2]);
master[20] = context.mmConditionKey_(master[4], master[5], master[8]);

function baseState() {
  const physical = context.mmPhysicalKey_(master[1], master[2]);
  const floor = context.mmAddressFloorKey_(master[1], master[2]);
  return {
    masterRows: [master.slice()],
    sourceRows: [],
    sourceByKey: {},
    heldSourceKeys: {},
    heldFingerprints: {},
    masterById: {"M-SPACE-1": 0},
    masterByPhysical: {[physical]: [0]},
    masterByExact: {},
    masterByAddressOffer: {},
    masterByAddressPrice: {},
    masterByAddressFloor: {[floor]: [0]},
    masterByAddressFloorPrice: {}
  };
}

function raw(room, deposit, rent, area, sourceId) {
  const row = Array(29).fill("");
  row[0] = "R-" + sourceId;
  row[1] = "snapshot";
  row[2] = "2026-08-01 10:00:00";
  row[3] = "당근";
  row[4] = sourceId;
  row[7] = "https://realty.daangn.com/item/" + sourceId;
  row[8] = "테스트상가";
  row[9] = "대전광역시 서구 용문동 219-8";
  row[10] = "서구 용문동 219-8";
  row[11] = room;
  row[12] = "일반상가";
  row[13] = deposit;
  row[14] = rent;
  row[17] = area;
  row[22] = JSON.stringify({
    imageUrls: ["https://cdn.example.com/listing-" + sourceId + ".jpg"]
  });
  return row;
}

const differentTermsSameSpace = context.mmPlanRaw_(raw("101호", 3000, 180, 23.8, "D-1"), baseState());
assert.equal(differentTermsSameSpace.type, "merge");
assert.equal(differentTermsSameSpace.masterId, "M-SPACE-1");

const differentRoom = context.mmPlanRaw_(raw("102호", 1000, 50, 9, "D-2"), baseState());
assert.equal(differentRoom.type, "create");

const ambiguousFloor = context.mmPlanRaw_(raw("1층", 1000, 50, 9, "D-3"), baseState());
assert.equal(ambiguousFloor.type, "review");
assert.equal(ambiguousFloor.reviewType, "층호실표기확인");

const media = context.mmV8ExtractMedia_({
  images: [{url: "https://cdn.example.com/a.jpg"}, {thumbnail: "https://cdn.example.com/b.webp"}]
});
assert.equal(media.primary, "https://cdn.example.com/a.jpg");
assert.deepEqual(Array.from(media.urls), [
  "https://cdn.example.com/a.jpg",
  "https://cdn.example.com/b.webp"
]);

const daangnMedia = context.mmV8ExtractMedia_({
  link: "https://realty.daangn.com/?article_id=12345",
  images: [
    "https://realty.daangn.com/?article_id=12345",
    "https://example.cloudfront.net/listings/12345/photo"
  ]
});
assert.equal(daangnMedia.primary, "https://example.cloudfront.net/listings/12345/photo");
assert.deepEqual(Array.from(daangnMedia.urls), [
  "https://example.cloudfront.net/listings/12345/photo"
]);
assert.equal(context.mmV8ImageUrl_("https://realty.daangn.com/?article_id=12345"), "");
assert.equal(context.mmV8ImageUrl_("https://landthumb-phinf.pstatic.net/example.jpg"),
  "https://landthumb-phinf.pstatic.net/example.jpg");

const daangnLogicalPhotos = context.mmV8ImageUrls_(
  "https://img.kr.gcp-karroter.net/realty/article/3962003/a.png?q=95&s=1440x1440&t=inside",
  JSON.stringify([
    "https://img.kr.gcp-karroter.net/realty/article/3962003/a.png?q=95&s=1440x1440&t=inside",
    "https://img.kr.gcp-karroter.net/realty/realty/articles/a.jpeg?q=95&s=1440x1440&t=inside",
    "https://img.kr.gcp-karroter.net/realty/realty/articles/a.jpeg?q=82&s=300x300&t=crop",
    "https://img.kr.gcp-karroter.net/realty/article/3962003/b.png?q=95&s=1440x1440&t=inside",
    "https://img.kr.gcp-karroter.net/realty/realty/articles/b.jpeg?q=95&s=1440x1440&t=inside",
    "https://img.kr.gcp-karroter.net/realty/realty/articles/b.jpeg?q=82&s=300x300&t=crop"
  ])
);
assert.deepEqual(Array.from(daangnLogicalPhotos), [
  "https://img.kr.gcp-karroter.net/realty/realty/articles/a.jpeg?q=95&s=1440x1440&t=inside",
  "https://img.kr.gcp-karroter.net/realty/realty/articles/b.jpeg?q=95&s=1440x1440&t=inside"
]);
const listingOnlyPhotos = context.mmV8ExtractMedia_({
  primaryImage: "https://img.kr.gcp-karroter.net/realty/realty/articles/listing.jpeg?q=95&s=1440x1440&t=inside&service=realty",
  imageUrls: [
    "https://img.kr.gcp-karroter.net/realty/realty/articles/listing.jpeg?q=95&s=1440x1440&t=inside&service=realty",
    "https://img.kr.gcp-karroter.net/realty/realty/articles/broker.jpeg?q=82&s=300x300&t=crop&service=realty"
  ],
  raw: {
    profileImage: "https://img.kr.gcp-karroter.net/origin/profile/202607/broker.webp?q=82&s=640x640&t=crop&service=karrotauth"
  }
});
assert.deepEqual(Array.from(listingOnlyPhotos.urls), [
  "https://img.kr.gcp-karroter.net/realty/realty/articles/listing.jpeg?q=95&s=1440x1440&t=inside&service=realty"
]);
assert.equal(context.mmV8ImageUrl_(
  "https://img.kr.gcp-karroter.net/origin/profile/202607/broker.webp?q=82&s=640x640&t=crop&service=karrotauth"
), "");
assert.match(ui, /function originalImages\(original\)/);
assert.match(ui, /service=karrotauth/);
assert.match(backend, /function mmRepairV8ImageVariants\(\)/);
assert.match(backend, /원본사진중복정리백업/);

assert.match(ui, /referrerpolicy="no-referrer"/);
assert.match(ui, /imageError: imageError/);

console.log("unified listings v8 tests passed");

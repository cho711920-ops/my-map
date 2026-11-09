## 2026-11-10 v148/v149 초기 캐시·인증·지도 준비 보완

- 사용자 백업/원 버튼 복구 후 성능 개선 및 끝까지 진행 요청. v148 제품031ab965, v149 제품5a8b8a64 push. 최종 Worker a0216e6b-5963-4706-b0f2-cec543cfeb71 100% 확인. docs/startup-overlap-v149-20261110.txt.
- v148 현재 권위 revision/collector epoch와 일치하는 완성 파일의 단순 시간 만료 재생성 제거. 공개 허용 목록의 동일 빌드 해시 JS/CSS만 SW 이전 캐시 재사용. API/계정/HTML/사진 캐시 범위 확대 없음. 투영 의미 변경 시 R2 형식/키 세대 변경 필요.
- v149 기존 실제 세션 검증을 private HTML에 최소 식별로 넣어 유효하면 중복 API 검사 생략(600ms 지연 시 기존 검사). 지도 공개 SDK 다운로드와 인증 병렬, 실행은 승인 후. 늦은 인증 실패 unlock 보호 및 첫 표시 전 불필요한 전체 서명 계산 지연. 원장 ID/CAS/proof/범위 경계 유지.
- check 전체 통과: Node2226/PC폰 원칙246+중복12skip/lint/type/build/dry-run. 양 도메인22응답200/SHA 일치. 계측의 window 없는 VM 최초 실패는 방어 후 전체 재검수. 운영 검수용 쓰기/수집/전원/예약 변경 없음.
- 실제 IAB v148 첫 카드3844ms, v149 새로고침3057/2088ms cachehit·최신검증true. IAB는 session API fallback; 정상 로그인 별도 HTTP에서는 HTML verified bootstrap 확인. 사진1/3→2/3 실제 src 교체1500px complete/ready0ms. outputs/v149-live-proof.json·v149-live-photo.png. 사용자 Edge/휴대폰 실기·수집 중 성능 개선율 증거와 구분. 검수 탭 닫음.
- 바탕화면 JS웹 변경전 복구는 원래 a81ba6ad 고정. 최종 inspect verified true/실행false, 데이터·메모·찜·수집 예약 보존. 독립 SQL 백업이 아닌 Time Travel bookmark 포함. v148/v149 추가 단계 백업도 원래 프로젝트 private-audits/backups에 있음.
- **전체 무대기 목표 미완료**: 첫 카드2.09~3.06초 및 캐시 없는 큰 전체 파일 전송이 남음. 항상0초/모든 오류 해결/네이버·당근 수준 전체 완료를 주장하지 말 것. 첫 화면 질의와 상세 자료 분리 필요. v138 일반 추가 메모 경합도 별도 미완. 사용자 outputs/EOL 보존.

## 2026-11-09 v147 변경 전 복구 버튼·초기 캐시 재다운로드 보완

- 사용자 먼저백업/원버튼복구+네이버·당근처럼빠른사용감 승인. 기준소스4bf90fc5·Workera81ba6ad(100%) 원래프로젝트private-audits/backups/js-map-performance-baseline-20261109에 source.zip/정적자산/배포기록/SHA134파일+D1 TimeTravel bookmark. 독립SQL전체백업 아님. 바탕화면 JS웹 변경전 복구.lnk→cmd→ps1 고정 Worker복구/새 메모·연락처·찜·운영데이터·수집예약 보존. 현재동일버전 launcher실행(noop)·파일손상거부·배포후inspect 검증/실제다른버전롤백실험 안함. Node/Wrangler/유효기존CF인증 필요.
- 캐시 별도1200ms경주 제거/IDB open2500+GET2500 유한경계·늦은성공차단. 정상캐시 tiny revision503/네트워크/timeout만200ms뒤1회재시도; 인증401/403·계정/범위/수정세대변경·최신검증실패면기존자료최신인정금지. 광고/사진삭제·로딩숨김·CAS/원장ID/수집/운영쓰기변경없음. 기존HEAD 새사례실패/보완본통과.
- 제품785ceb3e push/Workereed30362-7950-4758-a543-e65c84b34647 100%. check전체통과 Node2219/원칙232+중복12skip/lint/type/build/dry-run. 양도메인20응답200/SHA일치. docs/performance-recovery-v147-20261109.txt.
- 실제IAB 수정전6339/3155ms·후4629/2941ms cachehit/검증true/9122라 개선율·무대기달성주장금지. 사진신고1/3→2/3 실제교체1500pxcomplete/ready0ms. outputs/v147-live-proof.json. 사용자Edge프로필실측 아님/운영저장·수집조작·viewport변경없음/임시탭자동정리.
- 첫기기 큰전체파일 문제는 남음: R2 lease JSON52.3MB/gzip12.8MB/18608원장·61480광고(활성수아님). 사진주소20.6MB이며바이너리아님. 오프라인압축/사전/열전치 이득부족으로 제품미적용. 초기표시경량화와상세자료분리 후속필요/원칙전체완료아님. v138 일반추가메모경합 미완 유지. 사용자outputs·EOL 보존.

## 2026-11-09 v146 중개업소 홍보 반복 누락 보완

- 사용자 용문260-39 상담·보험·업소주소/대표/등록번호 잔존. 2억원/102호를 실제조건으로 오인한 보호와 표현변형 누락 보완. 상담/서비스/타매물/자체배상보험/업소식별별 절 처리, 번호뒤 실제 입주·방수 등만 보존. 단위없는수익률·면적/임대·사용가능·위치·임차인의무 보호. 명시메모/날짜suffix·직접기록연락처 우선보존. 원문·CASbaseline·초안·수집DB·저장·초기캐시 구현 그대로/정리결과DB일괄삭제없음.
- 읽기전용 수집표식메모45264건(활성/비활성 포함/활성매물수아님) 대조, 기존표시 대비15263건 추가변화/숫자필드24694누락0/날짜suffix24정확보존. private-audits에만 원본보관/개인정보corpus커밋금지. 키워드 잔존후보는 혼합조건·개인기록 포함이므로 전부홍보로 간주/삭제하거나 전매물홍보0단정하지 않음.
- 제품114bd6e1+81e62352 push/최종Workera81ba6ad-2480-43b9-aad6-580129597df9 100%. 중간58adc7af와구분. check 전체통과 Node2208/원칙228+중복12skip/lint/type/build/dry-run. 양도메인20자산200/SHA일치. docs/source-boilerplate-v146-20261109.txt.
- 실제 신고메모362→207자/원문422별도보존/홍보false/직접세입자연락처·가벽·수도·화장실·에어컨true. inline·조건수정207확인후저장없이취소. 최종reload3624ms/9122/cache검증true라 무대기원칙미완. 신고사진1/3→2/3 src교체1500pxcomplete/ready0ms. outputs/v146-cleaned-live.png·v146-live-proof.json. 운영쓰기·수집조작·viewport변경없음/임시검수탭자동정리.
- 검색dispatch3초/중간reload Runtime.evaluate timeout뒤 실제검색·목록 정상, 도구오류와HTTP구분. 복구 원래프로젝트private-audits/backups/js-map-broker-boilerplate-v146-20261109(source473c775a/Worker3fe6e7e1). 사용자자료·EOL·outputs보존. v145 첫방문대용량/항상0초와 v138 일반추가메모경합 별도미완.

## 2026-11-09 v145 새로고침 캐시 충돌·정상 전송 취소 보완

- 사용자 LIST_RESPONSE/느린 목록 신고. v142 일반CSV 최신검사와 기존 load(false,deferCommit)의 이전 memory revision/검증키누락 응답이 충돌하는 경로 재현. deferred만 data-access 검증 warmup 소비/일반재사용 보존. 새 manifest 최신검사 유지/인증된 ETag range마다 중복revision조회 제거.
- 1MiB range의 고정20초 abort는 정상 바이트 진행도 취소. 무수신20초로 수정/전체120초 cap·1회재시도·ETag·길이·인증·범위검사 유지. 수정전실패/후통과 및 무수신·전체cap 검수. 작은조각 비교104초라 기본변경 안함.
- 제품13ff677f+5655dfda push/최종Worker3fe6e7e1-3d70-457f-b72b-6c7421229518 100%. check 전체통과(Node2184/원칙212+중복12skip/lint/type/build/dry-run). docs/startup-cache-regression-v145-20261109.txt.
- 실제IAB 새탭9232ms/reload4388ms·9122목록/cache검증true. 송촌241-8 1/9→2/9 src교체/960pxcomplete/ready0ms. 최종증거outputs/v145-live-proof-final.json·v145-live-photo-final.png. 검수용운영쓰기·수집조작·viewport변경없음/임시탭.
- 캐시 없는 직접API 전체전송79.729초/CSV18608행열수정상/원본proof18535일치·73불일치(기존exact-ID recovery대상)라 완전최신쌍 검증통과라고 말하지 않음. 3.74MB+12.79MB 첫방문 병목·항상0초 원칙 미완. 사용자화면의 정확한 내부예외 미수집/모든LIST_RESPONSE근본해결 단정금지. 메모-only epoch/parentproof 차이는 기존복구경로 유지/키검증 완화 금지.
- 복구 원래프로젝트 private-audits/backups/js-map-startup-regression-v145-20261109(source7205fcb1/13ff677f+배포이전기록). 사용자자료·outputs·기존EOL 보존. v138 일반추가메모 동시성 및 초기무대기 미완 유지.


## 2026-11-09 v144 홍보 분리·정리된 메모 편집·최신 원문 경계

- 사용자용문261-10 신고 후 ‘필요내용만/나머지수집원문’ 명시승인. v140편집원문유지 예외로 목록메모·조건수정칸은 수집표식 있는 원문만 정리/원문접기 별도. 개인미표식메모·초안·날짜추가·실제조건보존. 전화/가격만수정시 raw CAS메모그대로전송/충돌비교는투영값/최신선택후원문baseline갱신. 광고원본·수정전이력보존/일괄운영삭제없음.
- 권리의무·조건협의·중개업소공제보험·타매물상담·일반게시후거래가능면책문구 누락 보완. 숫자/실제임차인의무 섞인조건보수적유지. 단축편집hover1px움직임 제거/원문내용220px내부스크롤. 첫모바일저장위치실패는CSS/물리viewport혼용검사오류였으며실제visualViewport안확인.
- 운영검수에서 IAB캐시936자/D1원문953자(날짜메모17자)차이 발견. 필터유실아님. 새정리편집클릭에 기존정확원장점조회/캐시갱신 재사용, 늦은응답이추가모드/취소덮지못함. expectedMemoV144 비교+메모/연락처/version/상태 CAS·성공때만history batch. 최신메모overwrite/가짜성공이력차단·초안유지. 초기지도통신추가없고 명시편집시1건확인. 구버전/일반추가경합v138전체해결아님.
- 제품20d2b4fc+7cc0e8bb push/최종Workerffd2aaf7-905a-43e9-87c4-671a7f8b9135 100%배포. 중간c40aa84d와구분. 최종check Node2176/원칙210+중복12skip/lint/type/build/dry-run전체통과. 양도메인20응답200/SHA일치. docs/source-description-editor-v144-20261109.txt.
- 최종실제IAB신고원장953→211자/수동날짜메모true/조건true/홍보false/원문953접기열기. 목록수정·조건수정 둘다확인후저장없이취소. outputs/v144-clean-editor-live.png·v144-live-proof.json. 신고사진1/1 정상, 송촌241-8 별도1/9→2/9 src교체960pxcomplete/ready0ms. 검수탭닫음/viewport미사용/운영쓰기·수집조작없음.
- 최종새로고침9122목록/전체18614행 최신확인. 첫DOM7964ms/cachehit로무대기원칙미완. 중간오래열린탭 D1불러오기오류/936캐시차이 관측, 최종reload뒤최신노트정상이나근본캐시/백그라운드목록오류원인은별도미확정. 검색도구3초dispatch후정상/HTTP실패아님. 사용자초안보관후새로고침 안내. 복구원래프로젝트private-audits/backups/js-map-description-editor-v144-20261109(source94429a66/Worker915bbb07). EOL·미추적outputs·사용자자료보존.

## 2026-11-09 v143 수정창 수동 임대인·세입자 전화 표시

- 사용자괴정5-12 빈전화입력미반영. 외부광고번호차단이 수동 landlordPhone/tenantPhone도 출처만으로제외. HEAD가상대조0→1. 기존manual-history projection+확정receipt에 두phone필드 포함/실제input·같은값명시확정/정확원장이력만허용. 광고문구·비신뢰contacts_json·다른원장이력차단유지. 신규API·폴링없음/CAS·ID·초기캐시patch·사진·수집보호유지.
- 제품fc5add4e push/Worker915bbb07-e884-4e46-966d-e1daa90d43f1 100%배포. check Node2167/원칙200+중복12skip/lint/type/build/dry-run전체통과. 빈칸·재확정·동시수정·이력재조회·같은주소보호. 증거캡처후PC폰8재통과. 양도메인20응답200/SHA일치. docs/manual-contact-fields-v143-20261109.txt.
- 18:36KST신고주소활성2원장 DB전화빈값·임대인변경이력0. 이 입력이 서버에 안남은 과거원인미확정/저장됐다고단정금지. 운영IAB입력창도빈값확인후취소/검수용쓰기·통화없음. 가상번호캡처outputs/v143-contact-fixture.png와실제정보구분. 실제사진1/3→2/3 src교체960pxcomplete/ready0ms.
- warm목록9043/첫DOM7185ms·reload3428ms/cachehit라무대기원칙미완. outputs/v143-live-proof.json·v143-live-photo.png. 검색도구dispatch3초timeout후정상/HTTP실패아님. 검수탭닫음·viewport미사용. 기존캐시가과거manualmetadata면과거번호는재조회/명시재확정후표시가능. 신고원장은번호자체없어입력중번호보관·새로고침후실제번호재입력저장안내.
- 복구원래프로젝트private-audits/backups/js-map-manual-contacts-v143-20261109(source06d7e724/Worker1ad381a6). EOL·미추적outputs·사용자자료보존. v142자연수집중실측/v138메모추가동시성별도미완.

## 2026-11-09 v142 수집 후 정확 원장 delta·완성 파일 보존

- 사용자 승인1/2: finalize session 저장 source+존재변경 내부ID→public원장ID/주소추정없음. 최대1024, 클라이언트 협상142/요청당50 순차·전체검증후원자반영. 초과/조회실패/이력유실은전체갱신. 동일자료 수신도 보수적 후보 포함 가능.
- 수집 완료 때 전체 CSV/원본4파일 삭제안함. revision/원본epoch 최신성 검사+준비도중 최신변경시 multipart 중단/완성후교체. 오래된값최신표시금지. 메모만 바뀌면 원본사진 재생성안함/원본바꾸는 수정은epoch갱신. 확정저장응답전revision대기/원장ID·세대·메모focus·사진보호유지.
- 제품761a7ed2 push/Worker1ad381a6-51a4-4416-bbc6-1e753d305ce3 100%배포. docs/collector-delta-v142-20261109.txt. 최종check Node2159/원칙192+중복12skip/lint/type/build/dry-run 전체통과. 75개delta·전체다운차단·동일주소보존·오대상거부·snapshot경합 검사 포함. 양도메인20응답200/SHA일치.
- 실제IAB9043목록/재방문첫DOM4603ms·reload3028ms/cachehit: 항상0초원칙미완. 사진송촌241-8 1/9→2/9 실제교체960pxcomplete/ready0ms. outputs/v142-live-photo.png·v142-live-proof.json. 검색도구3초dispatch후결과정상/HTTP실패아님. 운영검수쓰기·수집강제조작없음/검수탭닫음·viewport미사용.
- 18:26KST최근수집완료모두배포이전으로 새코드자연완료운영관찰아직없음. 낮/수집중향상비율주장금지. 첫기기·이력누락·1024초과는전체준비가능. 지도3번/v138추가메모동시성 미수정. 복구원래프로젝트private-audits/backups/js-map-collector-delta-v142-20261109(sourceb64809cf/Worker6cf0f0ae). 기존EOL·미추적outputs보존.
# JS부동산 작업 지침

## 사용자가 정한 필수 원칙

다른 기능을 수정할 때도 아래 기준을 유지한다.

1. 새로고침 시 매물 목록과 사진을 기다리지 않고 볼 수 있어야 한다.
2. 상세카드의 다음 사진은 로딩으로 멈추거나 빈 화면이 되면 안 된다.
3. 메모·금액·매물조건은 저장 확인 즉시 목록과 상세에 반영되고 새로고침 후에도 유지돼야 한다.
4. 같은 주소·층·이름이라도 수정은 선택한 원장 ID에만 적용한다. 다른 매물에 덮어쓰면 안 된다.

원칙은 완료 기준이다. 로딩 안내를 숨기거나, 오래된 사진을 새 사진 번호로 표시하거나,
오래된 조건을 최신이라고 표시해서 기준을 통과한 것으로 처리하지 않는다.

## 모든 코드 변경의 검수

- 수정 범위를 좁히고 변경 전 소스/배포의 복구 지점을 확보한다. 사용자 작업과 운영 자료를 보존한다.
- `pnpm run check`에는 `test:principles`가 포함되어 있다. 관련 검사만 통과한 것을 전체 통과로 보고하지 않는다.
- `pnpm run test:principles`는 기존 PC·휴대폰 브라우저 회귀검사를 실행한다.
  초기 전체 캐시/새로고침, 사진 전환·진행 중 요청·늦은 상세 응답,
  같은 지번 메모 구분, 권리금·매매조건 반영, 수정 충돌, 임대/매매 범위 분리를 검사한다.
- 브라우저 실행기가 중단되면 제품 오류와 구분하고, 미실행 검사를 통과로 세지 않는다.
  브라우저 검사는 순차 실행한다. 동시 실행이 불가피하면 fixture 포트와 output 디렉터리를 모두 분리한다.
- 초기 읽기·사진·표시·저장·캐시·지도·인증·수집 후 갱신 경로를 변경하면,
  운영 웹에서도 실제 새로고침/사진 1→2 전환을 확인한다. 최초 방문과 저장된 자료가 있는 재방문을 구분한다.
  운영 매물의 메모·금액·상태를 검수용으로 임의 변경하지 않는다. 쓰기 검증은 격리된 가상 자료를 사용한다.
- 지연은 카드/사진 실제 표시와 전송 완료를 구분해 측정한다. 도구 호출 시간을 파일 수신시간이라고 보고하지 않는다.
- 기준을 깨뜨리는 변경은 완료로 보고하지 않는다. 원인을 보완하거나 안전하게 해당 변경 범위를 되돌린 후 재검수한다.
  기존 사용자 승인 범위 안의 수정에 불필요한 재승인 절차를 추가하지 않는다.

## 캐시와 수정 대상 보호

- 전체 자료의 범위·계정·세대·무효화·확정 수정 경계를 유지한다.
  새로고침 속도를 위해 오래된 병합/분리 결과나 저장 전 조건을 되살리지 않는다.
- 출처+원본 광고번호와 원장 ID를 구분한다. 동일 지번이라는 이유로 광고/사진/메모/가격을 서로 옮기지 않는다.
- 현재 지도 범위의 중복 갱신 생략, 이동 완료 후 갱신, 기존 카드와 준비된 사진 재사용을 보존한다.
- 화면 속도를 위해 전체 사진/전체 거래유형 자료를 무조건 더 내려받지 않는다.
- 수집 한 번의 누락만으로 계약을 추정하거나 같은 지번 전체를 종료하지 않는다.

## 현재 상태를 정직하게 인수인계

2026-11-06 v124 검증에서는 운영 표본의 다음 사진 전환은 정상이나,
저장된 자료가 있는 새로고침에서도 첫 카드 DOM 준비 약 2.27초가 남았다.
따라서 현재 구현을 '원칙 전체 충족' 또는 '항상 0초'인 기준선으로 취급하지 않는다.
새 작업 시작 시 `CODEX_HANDOFF.md`와 최근 검증 문서를 확인하고 실제 배포/논의/미완료를 구분한다.

## 2026-11-08 v140 수집 설명 홍보 표시 정리

- 제품ccf69865/Workerffc4ae3f-b475-4316-8194-ce0c6a0337d0. unified 공통 표시에서 세 출처 원본 설명·표식 자동메모의 명확한 중개업소 홍보만 정리. 기존/신규payload 공통, 원문접기·사용자메모·편집값 보존. 수집DB 삭제나 정리결과의 저장/가격분석 재사용 금지. 미표식 관리메모와 모호한 실제 조건은 보존. v138 추가메모 동시성은 아직 미수정.
- check Node2126+원칙178통과/중복12skip 포함 전체통과. 신고 관저동1788 실제 상세/목록685→216자·원문/입력685동일·보5000월315평48.3 보존/사진1→2 교체/960px/ready0ms. 첫DOM2751ms/cachehit라 항상0초달성 아님. docs/source-description-v140-20261108.txt 참조.

## 2026-11-09 v141 홍보정리 누락 5사례 보완

- 사용자 탄방755/둔산1826·1209/태평337-58/송촌241-8 홍보 남음. 기존v140 단일표본 검수 부족. 별표·이모지·ZWJ·공백형업소명 분리/범용 보호단어의 덩어리 통과 제거/홍보 약속과 실제 수치·시설 구분. 본문 업소명과 정확히 일치하는 O이음O식 태그만 제거. 부동산 단어 자체로 위치·용도 지우지 않음.
- 제품91a295c4 push/Worker6cf0f0ae-989b-4df9-8f00-b5c527bf7668 배포. 후속 문서/테스트LF보정은 운영자산 무변경. docs/source-description-v141-20261109.txt. check 전체통과(Node2148/원칙188+중복12skip/lint/type/build/dry-run), 단위49/양도메인20자산SHA일치. 기존·미래payload 공통 표시만: DB·수집기·가격분석·저장·ID·캐시·사진·초기목록 경로 무변경/새통신없음.
- 실제IAB 다섯 목록 메모 원문동일/기본표시430→138,72→34,121→76,760→246,355→196자. 금액·시설·면적 보존. 송촌 원문접기/수정입력355동일 후 저장없이취소, 태평 원본상세246도 목록동일/원문760보존. outputs/v141-cleaned-live.png·v141-live-proof.json. 검수탭닫음/viewport reset. 운영쓰기·수집조작없음.
- 송촌 사진1/9→2/9 실제교체/960px complete/ready0ms. warm 첫DOM4413ms/cachehit라 항상0초달성 아님. 검색도구 CDP3초timeout뒤 실제결과정상/HTTP실패 단정금지. 가상PC폰과실물Samsung/Safari구분. 새 테스트파일CRLF를LF로후속보정/기존EOL보존/outputs미추적보존. 사전복구원래프로젝트private-audits/backups/js-map-ad-description-v141-20261109(sourcee14a3c08/Workerffc4ae3f). 직접관리메모/날짜추가/원문/편집값보존, 모호한혼합홍보는보수적유지. v138추가메모 동시성 미수정.

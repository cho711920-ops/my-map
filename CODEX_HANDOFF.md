# JS부동산 Codex 인수인계

## 2026-08-10 자동수집 실측 검수와 당근 상세 보조값 수정

- 오전 실행은 네이버 중구만 완전수집으로 끝났습니다. 유성구·대덕구는 원본의 주소·층 누락으로 부분수집, 서구·동구는 실행 중 `js-map.com` 통신 오류로 부분수집됐습니다.
- 당근의 목록 비교는 정상 작동했습니다. 예를 들어 대덕구 578건 중 기존 동일 560건을 상세조회 없이 생략하고 신규·변경 후보 18건만 조회했습니다.
- 당근 상세 API에 주소·층·임대조건 일부가 빠지면 목록 단계에서 이미 확보한 값을 이어받지 않아 후보가 실패 처리되던 문제를 수정했습니다. `mergeDaangnDetailWithList`가 목록의 주소·층·보증금·월세·면적을 상세 응답의 안전한 보조값으로 사용합니다.
- 상세 저장 실패 원인은 D1 작업의 `detailErrors`에 출처 ID와 함께 남깁니다. 원본 자체의 `주소·층 오류`는 복구 화면을 무한 반복하지 않고 원인을 기록한 뒤 다음 대상으로 넘어갑니다.
- Cloudflare 테스트 54개와 자동수집 테스트를 통과했고 Worker 버전 `d9318517-7fb8-4c95-a466-a8ea1cc1d389`를 배포했습니다. Edge 확장 버전은 1.0.21, 당근 수집기는 1.4.1입니다.

## 2026-08-10 네이버·당근 기존매물 상세 재수집 차단

- 네이버 자동 구 단위 수집이 수동 수집과 달리 목록 페이지를 곧바로 상세저장하던 구형 경로를 사용하고 있었습니다. 네이버 v5.9.0부터 자동·수동 모두 `전체 목록 ID 수집 → D1 기존매물 비교 → 신규·실제 조건변경만 상세조회` 한 경로를 사용합니다.
- 당근과 네이버의 목록 지문이 달라져도 보증금·월세·면적(1평 미만 허용)·층·주소가 같으면 제목·설명·태그·대표사진 같은 표시 변화로 판단해 상세수집하지 않습니다. 실제 핵심 조건이 달라지거나 출처 ID가 처음 발견된 경우만 상세조회합니다.
- 잘못 생성된 유성구 v5.8.0 세션은 3,300건에서 `partial`로 종료했습니다. 수정 후 새 v5.9.0 실운영 검증에서 유성구 5,242건 중 기존 동일 5,022건을 상세조회 없이 생략하고, 실제 변경 3건과 과거 출처 ID가 없던 217건만 상세대상 220건으로 분류했습니다.
- 첫 수정 실행의 상세대상 220건 중 155건만 저장 접수됐고 결과는 신규 8건·조건변경 2건·검증대기 145건이었습니다. 주소·층 정보가 없는 65건 때문에 세션은 부분수집으로 보존됐으며 자동수집기는 다음 구로 계속 진행했습니다.
- Edge 자동수집 확장 프로그램은 v1.0.20, 네이버 수집기는 v5.9.0으로 전용 프로필에 설치했고 예약 시간은 매일 오전 11시를 유지했습니다.
- Cloudflare 전체 테스트 53개와 `cf:check`를 통과했고 운영 Worker 버전 `813aae3b-56d0-478a-af9c-0bf6e5844805`로 배포했습니다.

## 2026-08-10 자동수집 기존매물 재수집 방지

- 수집 전 변경분 판별이 `listing_sources`만 조회해 매물검증 대기 상태인 `collector_raw` 원본을 누락하던 문제를 수정했습니다. 이제 아직 통합되지 않은 검증 대기 원본도 출처 ID와 목록 스냅샷을 비교해 변경이 없으면 상세조회·재저장을 건너뜁니다.
- 과거 복구 데이터의 `snapshot_hash='legacy-recovery'`를 실제 FNV 해시로 잘못 해석하던 문제를 수정했습니다. 실제 `fnv1a-xxxxxxxx` 형식만 해시 비교하고, 복구 표식은 보증금·월세·면적·층·주소 등 핵심 조건으로 비교합니다.
- D1 `collector_raw(source, source_listing_id, created_at DESC)` 인덱스 마이그레이션 `0011_collector_raw_source_lookup.sql`을 운영 DB에 적용했습니다. 기존매물 판별 조회가 전체 원본을 반복 탐색하지 않습니다.
- 자동수집 전용 Edge 실행 스크립트에 `-Force` 재실행과 선택적 `-Debug` 진단 모드를 추가했습니다. 일반 예약 실행은 기존 동작과 동일합니다.
- Cloudflare 전체 테스트 51개와 `cf:check`를 통과했고 운영 Worker 버전 `8e540468-9e71-4402-987f-1c5e2e192965`로 배포했습니다.
- 2026-08-10 오전 실행 중 유성구가 1,620건에서 중단돼 해당 세션을 보존한 채 수정본으로 재개했습니다. 재개 후 0건부터 다시 시작하지 않고 같은 세션의 1,620건 다음 지점부터 진행하는 것을 D1에서 확인했습니다.

## 2026-08-09 자동수집 완주·재시도 안정화

- 네이버 자동수집 v5.8.0은 새 탭에서 화면 클러스터 사전분석이 먼저 시작돼도 자동수집 요청이 오면 해당 수동 준비 작업만 무효화합니다. 유성구·서구처럼 매물이 많은 지역이 `준비 90초`에서 멈추던 충돌을 제거했습니다.
- 당근 자동수집 v1.4.0은 상세조회 실패 ID를 버리지 않고 D1 작업의 `pendingDetailIds`에 보존합니다. 최초 조회는 동시 2개, 재시도는 동시 1개로 낮추며 ID별 최대 8회까지 이어서 조회하고 실제 API 오류를 `detailErrors`에 남깁니다.
- Edge 자동수집 확장 프로그램 v1.0.19는 대상별 즉시 재시도 4회 후에도 실패하면 다른 지역을 진행하고, 저장 지점부터 지연 재시도를 최대 8주기 수행합니다. 일시 오류는 최종 실패로 집계하지 않습니다.
- 설치 스크립트는 전용 Edge 프로필 프로세스만 종료한 뒤 확장 파일을 교체하므로 Manifest V3 서비스워커가 예전 `background.js`를 계속 사용하는 문제를 막습니다. 사용자 일반 Edge 창과 자동수집 설정·로그인 프로필은 삭제하지 않습니다.
- Cloudflare 전체 테스트 47개와 `cf:check`를 통과했고 운영 Worker 버전 `fa36a138-4919-49ad-8cd4-bfe8e5256f4e`로 배포했습니다.
- 현재 PC에는 확장 프로그램 v1.0.19와 네이버 v5.8.0·당근 v1.4.0이 설치됐으며 원본 파일과 설치 파일 해시가 일치합니다. 예약 시간은 기존대로 매일 오전 11시입니다.

## 2026-08-09 매물검증 자동판단 완료

- 자동판단 전 검증대기 `5,373`건을 Cloudflare 예약 작업으로 끝까지 처리했고 최종 `unscanned=0`을 확인했다.
- 마지막 6건은 복구된 과거 검증 데이터에 위도·경도가 없어 D1 바인딩에 `undefined`가 전달되며 반복 실패했다.
- 과거 검증 데이터를 처리하기 전에 주소·층·임대조건·사진·연락처·좌표를 현재 형식으로 정규화하고, 선택값이 없으면 `undefined`가 아닌 `null` 또는 빈 배열을 사용하도록 수정했다.
- 마지막 6건 중 2건은 자동 통합·등록되어 대기에서 제거됐고, 4건은 애매한 매물로 수동검증 대상에 안전하게 남았다.
- 최종 상태는 전체 수동검증 대상 `8,132`건, 자동판단 전 `0`건, 자동판단 완료 후 수동확인 `8,132`건이다.
- 관련 공간판단 테스트 7개와 Cloudflare 전체 테스트 46개, `cf:check`를 통과했다. 운영 Worker 버전은 `4841a3e7-8689-4746-bd8a-31096b1f53b3`이다.

## 노트북에서 작업 이어하기

- GitHub 저장소는 `https://github.com/cho711920-ops/my-map`이고 현재 작업 브랜치는 `codex/cloudflare-js-map`이다.
- 새 노트북에서는 저장소를 받은 뒤 `git switch codex/cloudflare-js-map`과 `git pull origin codex/cloudflare-js-map`을 실행하고, 이 `CODEX_HANDOFF.md`를 처음부터 끝까지 읽은 뒤 작업을 이어간다.
- 기존 저장소가 없다면 `git clone https://github.com/cho711920-ops/my-map.git` 후 저장소 폴더에서 위 브랜치로 전환한다.
- 배포 전 `pnpm run test:cloudflare`, `pnpm run cf:check`, `pnpm run build:cloudflare`를 실행하고, 배포는 `pnpm exec wrangler deploy`를 사용한다.
- Cloudflare D1·R2·Worker와 등록된 Secret은 원격 계정에 그대로 유지되므로 복사하지 않는다. 새 노트북에서 배포하거나 사용량을 조회할 때만 `pnpm exec wrangler login`으로 같은 Cloudflare 계정에 로그인한다.
- Edge 로그인 세션은 Windows 보안에 묶인 로컬 정보라 복사하지 않는다. 자동수집 대상·예약시간은 현재 PC의 자동수집 설정에서 `설정 내보내기`로 JSON 파일을 저장하고, 노트북 설치 후 `설정 가져오기`로 한 번에 복원한다. 노트북에서는 사이트별 로그인과 수집기 보안키 입력만 최초 1회 다시 한다.
- 운영 사이트는 `https://js-map.com`, Worker 이름은 `js-map`, D1은 `js-map-primary`, R2는 `js-map-media`다.
- 작업 시작 시 반드시 `git status`로 사용자 미완료 변경이 없는지 확인하고, 운영 D1 데이터를 삭제하거나 초기화하지 않는다.

## 2026-08-08 노트북 자동수집 설정 이전

- Edge 자동수집 설정 화면에 `설정 내보내기`와 `설정 가져오기`를 추가했다.
- 이동 파일에는 자동수집 사용 여부, 실행시간, 완료 탭 닫기, 네이버·당근·공실박스 대상 URL과 지역만 포함한다.
- 비밀번호, 로그인 쿠키, 수집기 보안키는 이동 파일에 포함하지 않는다.
- 노트북에서는 저장소 설치 스크립트를 실행하고 JSON을 가져온 다음, 각 사이트에 한 번 로그인하고 수집기 보안키를 입력하면 같은 자동수집 구성이 복원된다.
- ChatGPT 프로젝트로 채팅을 옮기는 것은 대화·파일 문맥 정리에 유용하지만 로컬 저장소나 Edge 프로필을 복사하지 않는다. 코드는 GitHub 브랜치, 운영 상태는 Cloudflare, 자동수집 대상은 위 JSON을 기준으로 이어간다.

## 2026-08-08 업무 중심 매물 변경이력

- 복구 버튼 문구를 의미가 명확한 `이전으로 복구`로 변경했다. 선택한 이력의 변경 직전 업무값으로 되돌리는 동작은 그대로다.
- 변경이력 비교 시 `id`, `property_id`, `status`, `main_source`, 주소와 시스템 필드를 제외하고 매물명·호실·보증금·월세·관리비·권리금·면적·임대인/임차인 연락처·메모·연락처 목록만 비교한다.
- 수정 화면의 `rent`, `memo`, `contacts` 같은 필드명을 D1의 `monthly_rent`, `operating_memo`, `contacts_json`으로 표준화해, 기존 값이 `없음`으로 바뀐 것처럼 보이던 잘못된 이력을 수정했다.
- 과거 이력도 API 응답 시 같은 규칙으로 다시 해석하므로 데이터 삭제나 재저장 없이 바로 정상 표시된다.
- 연락처는 JSON 대신 `역할 전화번호` 형식으로 표시하고 전화번호 하이픈·숫자 쉼표만 다른 경우는 변경으로 잡지 않는다.
- 관리비·권리금 같은 숫자값의 기존 빈칸과 저장 후 `0`은 모두 `없음`으로 취급해 가짜 변경이력으로 표시하지 않는다.
- 앞으로 수동 매물 수정 이력에는 업무 필드만 저장해 D1 저장공간 증가도 줄인다.
- 변경이력 목록은 수동 빠른등록·임대조건/메모 수정·복구 이력만 조회하며 수집기 내부 처리 기록은 표시하지 않는다.
- 빠른등록은 사람이 직접 수행한 업무이므로 신규 매물의 매물명·호실·임대조건·메모·연락처를 `없음 → 등록값`으로 표시한다.
- 관련 신규 테스트 3개와 Cloudflare 전체 테스트 46개, `cf:check`를 통과했다.

## 2026-08-08 운영센터 탭 겹침 수정

- `변경이력` 또는 `사용자 관리`를 연 뒤 기존 `운영현황·수집현황·매물검증·고객매칭` 탭으로 이동할 때 새 패널과 활성 버튼이 남아 화면 아래에 겹치던 문제를 수정했다.
- 기존 탭 전환 전에 변경이력·사용자 관리 패널을 항상 숨기고 두 버튼의 활성 상태도 해제한다.
- 브라우저 캐시 버전을 `operations-admin-v1.js?v=1.0.1-tab-isolation`으로 올렸다.
- 전문 운영 테스트 5개, 기존 Cloudflare 회귀 테스트 43개와 `cf:check`를 통과했다.
- 실서비스 HTML과 수정 자산의 200 응답 및 새 버전 연결을 확인했다.
- 운영 Worker 버전은 `84a50d06-f128-4cb9-bbe0-a1a703d9300a`다.

## 2026-08-08 전문 운영 최적화·권한·변경이력

- 운영현황의 대형 집계 결과를 D1 `operations_snapshots` 한 행에 저장하고, 일반 매물 수정은 숫자 증감만 반영하도록 바꿨다. 수집 완료처럼 전체 수치가 바뀌는 작업만 백그라운드에서 한 번 재계산한다.
- 5분 변경 확인 시 작은 매물 수정은 해당 매물 ID만 다시 받아 화면에 합치며, 수집 완료·통합처럼 범위가 큰 작업만 전체 목록을 갱신한다.
- 외부 매물 사진의 브라우저 캐시를 7일로 늘렸고 기존 상세창의 다음 사진 선로딩을 유지했다. 유료 이미지 변환 서비스는 추가하지 않았다.
- 매물 변경이력 탭에서 수정 전후 차이와 작업자·시간을 확인하고, owner/admin은 허용된 매물 필드의 이전 상태를 복원할 수 있다.
- 사용자 관리 탭에서 owner/admin이 Google 이메일의 member/viewer 권한과 사용 여부를 관리한다. owner와 환경변수 고정 계정은 화면에서 변경할 수 없다.
- viewer는 조회와 개인 찜 저장만 가능하며, 매물·수집·운영 데이터 쓰기는 서버에서 차단한다.
- 알림 기능과 고객매칭 로직은 이번 작업에서 변경하지 않았다.
- D1 마이그레이션 `0010_operations_snapshot_and_access.sql`을 운영 DB에 적용했다.
- 전문 운영 테스트 5개와 기존 Cloudflare 회귀 테스트 43개, `cf:check`를 모두 통과했다.
- 운영 Worker 버전은 `4fcb33f7-4a4b-4de7-855e-368003d3468f`다.

## 2026-08-07 PC·태블릿 브랜드 로고 확대

- PC·태블릿 상단의 파란 `JS` 마크를 38px에서 42px로, 내부 글자를 15px에서 17px로 확대했다.
- 검정 `JS부동산` 워드마크는 18px에서 22px로 확대했다.
- 상단 헤더 높이와 메뉴 시작 위치는 유지해 검색·관리 버튼 영역을 침범하지 않는다.
- 로고·모바일 테스트 4개, Cloudflare 테스트 36개 및 `cf:check`를 통과했다.
- 운영 Worker 버전은 `ee161bbe-c133-41b7-a209-50ebd9555c39`다.

## 2026-08-07 PC·태블릿 브랜드 로고 통일

- 모바일 헤더의 파란 그라데이션 `JS` 박스와 검정 `JS부동산` 워드마크를 PC·태블릿 왼쪽 상단에도 동일하게 적용했다.
- 기존 헤더 너비와 메뉴 배치는 유지했고 로고 새로고침 클릭/터치 동작도 보존했다.
- 운영 화면을 1024x768 태블릿과 1440x900 PC 크기로 확인했으며 헤더는 243x60, 로고 마크는 38x38로 정상 표시되고 가로 넘침이 없다.
- 로고·모바일 테스트 4개, Cloudflare 테스트 36개 및 `cf:check`를 통과했다.
- 운영 Worker 버전은 `c974132f-82f7-49a7-bdd1-88d7bcd99ed0`다.

## 2026-08-07 상단 JS부동산 로고 새로고침

- 모바일 앱 헤더의 `JS부동산` 로고와 PC 왼쪽 상단 `J S 부 동 산` 제목을 누르면 현재 사이트를 새로고침한다.
- PC 제목은 Enter/Space 키로도 실행할 수 있도록 버튼 역할과 접근성 레이블을 추가했다.
- 전용 로고 테스트 1개, 모바일 UI 테스트 3개, Cloudflare 테스트 36개 및 `cf:check`를 통과했다.
- 태블릿의 PC형 헤더에서도 외부 함수 로딩에 의존하지 않고 로고가 직접 `window.location.reload()`를 실행하도록 보강했으며 터치 조작을 명시했다.
- 운영 Worker 버전은 `0e75f1b8-8cfb-4ed8-bd25-7e7f8d8a6135`다.

## 2026-08-07 계정별·기기 간 찜 동기화

- 찜/방문 목록의 브라우저 캐시를 로그인 이메일별로 분리해, 동일 기기에서 두 허용 계정의 목록이 섞이거나 서로 덮어쓰지 않게 했다.
- 업데이트 전 PC에 저장된 기존 찜은 현재 로그인 계정의 전용 저장소로 한 번 이전하고, D1의 기존 찜과 병합한 뒤 서버에 저장한다.
- 계정을 바꾸면 화면의 이전 계정 찜 상태와 메모리 상태를 초기화하되, 각 계정의 전용 캐시는 그대로 보존한다.
- D1 클라우드 상태는 기존대로 정규화한 `owner_email`별로 저장되어 같은 Google 계정은 PC/태블릿에서 동기화되고 다른 계정은 분리된다.
- GG 로컬 기존 찜 + GG 서버 기존 찜 병합 및 같은 브라우저에서 CHO 계정 전환을 검증하는 `tests/account-favorite-sync.test.cjs`를 추가했다.
- 찜 회귀 테스트, Cloudflare 테스트 36/36, `cf:check`를 통과했다.
- 운영 Worker 버전은 `649307d1-2ff4-465d-9391-8963528ac56b`다.
- 태블릿/모바일에서 열어 둔 사이트로 다시 돌아올 때도 15초 제한으로 서버 목록을 재확인해, 새로고침 없이 다른 기기의 최신 찜을 받는다.

## 2026-08-06 네이버 거리뷰 연동 지도 인증 복구

- 네이버 Cloud Maps `JS-Realestate` 애플리케이션의 Web 서비스 URL에는 기존 `https://my-map-ten-roan.vercel.app`만 등록되어 있어 `js-map.com`에서 SDK 인증이 실패했다.
- Web 서비스 URL에 `https://js-map.com`을 추가하고 저장했다. Dynamic Map 이외의 API 선택은 변경하지 않았다.
- 새 페이지에서 `네이버 거리뷰 연결 완료`, 인증 실패 클래스 제거, 오른쪽 연동 지도 컨테이너 하위 지도 요소 3개 생성을 확인했다.

## 2026-08-06 검증매물 목록 복구

- 검증 화면 상태 문구를 `전체 검증대기 5,654건 중 현재 작업 600건을 248개 묶음으로 표시` 형식으로 변경해 전체 대기 수와 속도 보호용 작업 배치를 명확히 구분했다. 운영 Worker 버전은 `1d48a0e9-5553-4adb-988c-3027bca57e08`이다.
- D1 `collector_raw`에는 검증 대기 원본 5,654건이 정상적으로 복구되어 있었고 JSON, 주소, 층 데이터도 유효했다.
- 검증 작업공간 API가 최대 600개 주소마다 통합매물 후보를 개별 조회하여 한 화면 요청에 최대 약 601개의 D1 쿼리를 순차 실행하던 N+1 문제가 원인이었다.
- 통합매물 후보 조회를 주소 75개 단위의 `IN (...)` 배치 쿼리로 변경하여 최대 약 9개 쿼리로 줄였다.
- 새로고침 요청과 최초 요청이 겹치면 빈 상태를 먼저 그리던 프론트엔드 경쟁 조건도 하나의 진행 중 Promise를 공유하도록 수정했다.
- Cloudflare 자동 테스트 31개와 `cf:check`가 통과했다.
- 운영 Worker 버전 `8eec1b5d-87e6-4969-b826-bacc1e754f59`에 배포했다.
- 실제 `js-map.com`에서 검증 대기 5,654건, 검증대상 600건, 248개 주소 묶음 및 첫 항목 `동구 가양동 32-4`의 기존매물 1건/신규수집 8건 표시를 확인했다.

## 2026-08-06 전체 데이터 복구 및 D1 사용량 최적화

### 운영 상태

- 운영 주소: `https://js-map.com`
- Cloudflare Worker: `js-map`
- 배포 버전: `320ea09e-bb9b-4281-bad5-29e89909245d`
- 작업 브랜치: `codex/cloudflare-js-map`
- 테스트: Cloudflare 자동 테스트 30개 통과, `wrangler deploy --dry-run` 통과

### 기존 Google Sheet 전체 대조 및 복구 완료

- 기존 Sheet 20개 탭을 모두 CSV로 별도 보관하고 D1과 항목별로 대조했다.
- 통합매물은 `8,756`개다. 기존 D1의 `8,754`개에서 빠진 직접등록 2개를 복구했다.
- 연결 원본은 `23,077`개이며 연결된 원본 누락은 0개다.
- 검증 대기 원본 `5,654`개를 `collector_raw`에 복구했다.
- 기존 고객 1명과 신규 고객 1명을 모두 보존해 총 2명이다.
- 고객매칭은 기존 57개와 신규 14개를 모두 보존해 총 71개다.
- 상담이력 17개, 수집회차 24개, 공지 1개, 사용자별 cloud state 5개를 복구했다.
- 변경이력은 기존 D1 기록까지 포함해 `46,542`개다.
- 연결되지 않는 과거 이력/검증 스냅샷 `5,720`개는 `legacy_archive`에 보존했다.
- 사진 URL `112,456`개, 연락처 `3,151`개, 좌표 캐시 `7,202`개는 누락 없이 유지됐다.
- 현재 D1 실측 크기는 약 `322.6MB`이며 무료 저장 한도 5GB의 약 6.5%다.
- 운영화면에서 활성 통합매물 8,756, 검증 대기 5,654, 원본 23,077, 고객매칭 71,
  변경이력 46,542가 표시되는 것을 확인했다.
- 지도 표시 8,749개와 통합매물 8,756개의 차이 7개는 데이터 누락이 아니라 좌표 없는 주소 오류 7개다.

### 백업 및 복구 자료

- 전체 D1 복구 전 SQL 백업: `../work/d1-current-before-recovery-2026-08-06.sql`
- 기존 Sheet 20개 탭: `../work/sheet-tabs-full-2026-08-06/`
- 전체 대조 보고서: `../work/data-audit-2026-08-06.json`
- 복구 보고서와 재실행 가능한 SQL: `../work/recovery-2026-08-06/`
- Google Sheet와 기존 Vercel 프로젝트는 안전 확인 기간이 끝날 때까지 삭제하지 않는다.

### 사용량 및 속도 최적화

- 운영현황 전체집계를 R2에 1시간 캐시한다. 같은 화면을 반복해서 열어도 D1 전체집계를 다시 하지 않는다.
- Sheet CSV와 통합원본 목록 R2 캐시를 5분에서 1시간으로 늘렸다.
- 매물 수정/삭제/수집완료처럼 실제 관련 데이터가 바뀔 때만 해당 캐시를 즉시 지운다.
- 즐겨찾기 저장은 공용 매물 캐시를 지우지 않고, 좌표 저장은 좌표 캐시만 지운다.
- 통합매물/Sheet/좌표의 페이지 조회를 OFFSET에서 rowid keyset 방식으로 변경했다.
- 건축물대장 배지 저장 시 전체 매물을 훑던 OR 조건을 기본키/매물번호 인덱스 조회로 분리했다.
- 지도 자체의 5분 자동 새로고침은 유지했다. 따라서 위 최적화로 화면 최신성이 늦어지지 않는다.
- 배포 전 3시간 쿼리 분석에서 운영현황 100회가 7.80M행, 통합원본 생성 82회가 2.36M행을
  읽은 것이 과다 사용의 핵심 원인이었다. 배포 후 실제 재접속에도 두 실행횟수가 증가하지 않았다.
- 2026-08-06 확인값: Workers 오늘 5,124/100,000(5.12%), R2 925.23MB/10GB(9.25%),
  Class A 10.85k/1M(1.09%), Class B 18.78k/10M(0.19%), 청구 사용량 `$0.00`.
- 2026-08-06 14:35:09 KST 재조회: Workers 오늘 12,034/100,000(12.03%), D1 읽기 128.28M/5M,
  쓰기 1.1M/100k, 저장공간 323.89MB/5GB, R2 버킷 1.18GB/10GB(11.80%), Class A
  12.84k/1M(1.28%), Class B 24.97k/10M(0.25%), 전체 청구 사용량 `$0.00`.
- D1 대시보드의 127.6M/1.1M은 이전 실행과 표시 지연이 섞인 누적값이다. 정상 운영 기준 일일
  사용량은 다음 오전 9시 초기화 뒤 별도로 다시 확인한다.

## 현재 운영 주소

- 운영: https://js-map.com
- 보조 도메인: https://www.js-map.com
- GitHub: https://github.com/cho711920-ops/my-map
- 작업 브랜치: `codex/cloudflare-js-map`
- Cloudflare Worker: `js-map`
- 현재 배포 버전: `320ea09e-bb9b-4281-bad5-29e89909245d`

## 현재 구조

- Cloudflare Worker가 정적 사이트와 모든 API를 제공한다.
- D1 `js-map-primary`가 매물·원본매물·사진 URL·연락처·메모·고객·수집기 작업·변경이력을 저장한다.
- R2 `js-map-media`가 실제 열어 본 외부 사진과 다음 사진을 7일간 캐시한다.
- Google은 OAuth 로그인에만 사용한다. 허용된 Gmail 계정만 접속할 수 있다.
- Google Sheet와 Apps Script는 운영 런타임에서 호출하지 않는다. 기존 자료는 백업으로 보존한다.
- Vercel은 운영 런타임에서 사용하지 않는다. 2026-08-05 Pro 구독을 해지하고 Hobby 무료 플랜으로 전환했다.

## 현재 완료 데이터

- 통합매물: 8,756개
- 활성 원본매물: 23,077개
- 사진 URL: 112,456개
- 연락처: 3,151개 / 2,321개 매물
- 고객: 2명
- 검증 대기: 5,654개
- 고객매칭: 71개
- D1 크기: 약 322.6MB

## 이전 완료 기능

- 매물 목록·검색·필터·지도·상세·전체 사진
- 메모, 임대조건, 연락처, 즐겨찾기와 고객매칭 저장
- 운영현황, 매물검토함, 변경이력
- 네이버·공실박스·당근 수집기와 중복 판정·수집 재개
- 국토교통부 건축물대장 직접 조회와 D1 캐시
- 소상공인시장진흥공단 상권 조회와 D1 캐시
- SGIS·R-ONE 지역통계 직접 조회와 D1 캐시
- 허용 Gmail 로그인과 세션 보호
- 외부 사진 프록시, 다음 사진 미리받기, R2 7일 캐시

## 안전장치

- R2 외부 사진 캐시는 7일 후 자동 삭제한다.
- 7일 사진 저장 예산은 6GB로 제한한다.
- 과거 `apps-script-sync` 예약 작업은 종료 처리했고 1분 Cron Trigger를 제거했다.
- `/api/apps-script` 경로는 제거했다. 프런트는 `/api/data`와 `/api/collector`만 사용한다.
- 수집기 키와 공공데이터 키는 Cloudflare Secret으로만 저장되어 있다. 문서·코드·로그에 값을 쓰지 않는다.

## 마지막 검증

- Cloudflare 자동 테스트 30개 통과
- `js-map.com`과 `www.js-map.com` HTTP 200
- 비로그인 `/api/data` HTTP 401
- 제거된 `/api/apps-script` HTTP 404
- 잘못된 수집기 키 HTTP 403
- 로그인 상태에서 매물 8,749개 화면 로딩(주소 오류 7개는 기존 데이터)
- 운영현황 D1 통합매물 8,756개, 원본매물 23,077개 확인
- 사진 17장 상세창과 2·3번째 사진 전환 확인
- 건축물대장 공식 API 실조회 확인

## 2026-08-05 확인된 이전 누락과 복구 원칙

- D1의 `collector_raw`가 0건이라 기존 웹의 검증대기 5,000건 이상이 이전되지 않았다.
- 기존 고객 `하하99`는 D1에 있지만 기존 고객매칭이 0건이다. 현재 `customer_matches` 14건은 2026-08-05 새로 만든 고객 `야호`의 신규 데이터다.
- `customer_activities`는 0건이고, `listing_history`는 새 사이트에서 생성된 `updateProperty` 2건만 있다. 기존 고객활동과 과거 변경이력도 누락 여부를 대조해야 한다.
- 일반 매물 8,754건, 원본매물 23,077건, 사진 URL 112,456건, 연락처 3,151건은 D1에서 확인됐지만 건수만으로 전체 이전 완료라고 판단하지 않는다.
- 기존 Vercel 프로젝트와 Google Sheet·Apps Script 자료는 전체 데이터 대조와 복구 검증이 끝날 때까지 삭제하지 않는다.
- 다음 복구 작업은 검증대기와 고객매칭만이 아니라 고객활동, 즐겨찾기·임장목록, 메모·임대조건, 연락처, 사진, 원본 연결, 수집상태, 변경이력 등 모든 사용자 데이터를 기존 웹과 D1 사이에서 전수 대조한다.
- 재생성 가능한 캐시와 사용자 원본 데이터를 구분하고, 사용자 원본 데이터는 건수·키·표본 내용·화면 표시까지 확인한 뒤 누락분만 D1에 복구한다.
- D1 무료 일일 한도가 초기화되는 한국시간 오전 9시 이후 사용량을 먼저 확인하고, 복구는 일일 쓰기 한도를 넘지 않도록 소량 배치로 진행한다.

## 다음 작업 원칙

1. 작업 전 `git status`를 확인하고 사용자 변경을 보존한다.
2. 모든 운영 저장은 D1을 기준으로 한다. Google Sheet 동기화를 다시 연결하지 않는다.
3. 키는 propertyId, customerId, sourceListingId를 사용한다. 화면 행번호로 수정하지 않는다.
4. 배포 전 `pnpm run test:cloudflare`와 `pnpm run cf:check`를 실행한다.
5. 배포는 `pnpm run build:cloudflare` 후 `pnpm exec wrangler deploy`로 한다.
6. Vercel `my-map` 프로젝트 영구 삭제나 기존 Google 자료 삭제는 사용자 승인 없이 하지 않는다. Pro 구독 해지는 완료됐다.
7. 비용은 `outputs/JS_MAP_MONTHLY_COST.md`의 무료·유료 시나리오를 기준으로 판단한다.
8. 사용자가 “기존데이터 전체확인 후 빠진 것 체크해서 복구해줘”라고 요청하면 위 누락 항목에 한정하지 말고 전체 사용자 데이터 정합성 감사를 먼저 수행한다.

## 2026-08-05 네이버 지도 인증 오류 수정

- 배포 버전은 `34e96049-fc87-4282-b1f0-d3f486fd7e86`이다.
- 원인은 새 운영 도메인이 네이버 Maps 애플리케이션의 Web 서비스 URL 허용 목록에 아직 등록되지 않아 Dynamic Map 인증이 거절되는 것이다.
- 네이버 SDK의 공식 `window.navermap_authFailure` 콜백을 처리했다. 인증 오류가 발생하면 반복되는 오류 타일을 제거하고, 정상 작동하는 네이버 거리뷰를 전체 너비로 확장하며, 별도 지도 탭은 계속 사용할 수 있다.
- `https://js-map.com` 운영 화면에서 거리뷰 유지와 오류 타일 제거를 확인했다.
- 영구 설정은 네이버 클라우드 로그인 후 Web Dynamic Map을 활성화하고 Web 서비스 URL에 `https://js-map.com`, `https://www.js-map.com` 두 주소를 등록해야 완료된다. 포트와 하위 경로는 넣지 않는다.

## 2026-08-05 클러스터 상세창·일시 전환 상태 수정

- 클러스터 목록에서 매물 상세창을 연 상태로 지도에서 다른 클러스터나 매물을 선택하면 이전 상세창과 AI 보조 패널을 먼저 닫도록 수정했다.
- 로드뷰를 열고 닫거나 브라우저 탭을 잠시 전환할 때 발생하는 지도 재배치 이벤트는 실제 사용자 지도 이동과 구분한다. 따라서 선택한 클러스터와 해당 매물 목록이 유지된다.
- 사용자가 지도를 직접 드래그하거나 휠·터치로 확대/축소하면 기존 의도대로 클러스터 선택을 해제한다.
- 운영 사이트에서 `선택 매물 3개` 클러스터로 로드뷰를 열고 닫은 뒤에도 선택 마커 1개와 목록 3개가 유지되는 것을 확인했다.
- 관련 자동 테스트와 Cloudflare 테스트 40개가 통과했으며 D1/R2 데이터 쓰기는 발생하지 않았다.

## 2026-08-05 추출 원본 미노출·재노출 및 계약완료 보기 수정

- 네이버·당근·공실박스의 정상 전체수집 결과에서만 미노출 횟수를 올리고, 3회 연속 미노출된 추출 원본만 `active=0`으로 숨긴다.
- 부분수집·안전중단·오류 수집은 누락 횟수를 올리지 않는다.
- 원본이 다시 관찰되면 내용 변경 여부와 관계없이 `missing_count=0`, `active=1`로 복구한다. 따라서 누락은 반드시 연속 3회여야 한다.
- 추출 원본의 숨김·복구 과정에서는 `listings.status`를 변경하지 않는다. 사용자의 통합매물 `계약완료` 처리는 계속 수동으로만 한다.
- 거래확인 후보는 아직 계약완료되지 않은 통합매물 중 연결된 모든 원본이 3회 연속 미노출된 경우만 매물 단위로 집계한다.
- 보기 메뉴와 지도 세로 보기 버튼에 `계약완료만 보기` 체크박스를 추가했다. `계약완료 숨김`과 상호 배타적으로 작동하고 선택 상태는 새로고침 뒤에도 유지된다.
- 운영 사이트에서 계약완료만 보기 4개가 모두 계약완료 카드임을 확인했고, 숨김 전환 후 계약완료 카드가 0개가 되는 것을 확인했다.
- 배포 버전은 `34e96049-fc87-4282-b1f0-d3f486fd7e86`이다.
# 2026-08-06 스마트폰 전용 모바일 앱 UI

- PC 화면은 변경하지 않고 `max-width: 768px`에서만 작동하는 `mobile-app-v1.css/js`를 추가했다.
- 모바일은 지도·매물·임장·고객·더보기 하단 탭, 상단 검색, 빠른등록, 더보기 바텀시트를 사용하는 앱형 구조다.
- 지도 클러스터가 기존 사이드바를 열면 모바일 매물 탭으로 자동 전환된다.
- 모바일 매물카드는 사진·핵심 임대조건·전화·내비만 우선 표시하고 카드 선택 시 전체 화면 상세로 열린다.
- 통합매물 사진과 상세 열기는 모바일에서도 지원하며 상세 안에서 내비·로드뷰·대장·수정을 사용할 수 있다.
- 390px 모바일 지도/목록/더보기/상세와 1280px PC 비활성 분기를 검수했다.
- Cloudflare 자동 테스트 36개와 `cf:check`가 통과했다.
- 운영 Worker 버전은 `dc641d83-4854-443d-bea7-8147d7859bd0`이다.

## 2026-08-07 모바일 뒤로가기 창 닫기

- 스마트폰 크기(`max-width: 768px`)에서만 브라우저/안드로이드 뒤로가기와 모바일 창 상태를 연결했다.
- 매물 상세, 사진, 연락처, 수정, 건축물 등록, 로드뷰, 빠른등록, 더보기, 운영센터·고객 창, 목록관리 등 열린 창이 있으면 뒤로가기 1회로 가장 위 창만 닫힌다.
- 열린 창이 없고 매물 목록 화면이면 뒤로가기 1회로 지도 화면으로 돌아간다. 그다음 뒤로가기는 브라우저의 원래 이동을 따른다.
- 화면의 X/닫기 버튼으로 창을 닫았을 때도 불필요한 방문 기록을 함께 정리해 뒤로가기를 여러 번 누르는 현상을 방지했다.
- PC에서는 모바일 모드가 활성화되지 않으므로 기존 동작을 변경하지 않는다.
- Cloudflare 자동 테스트 36개와 `cf:check`가 통과했다.
- 운영 Worker 버전은 `e70c5f40-dc41-4144-8934-dd234307bbbe`이다.

## 2026-08-07 Mobile customer matching app UI

- This change is mobile-only (`max-width: 768px`); desktop customer matching layout and behavior are unchanged.
- The customer workspace now uses a master/detail flow: full-width customer list, then a separate full-width matching-list screen after customer selection.
- Added a visible `customer list` back button and integrated the matching screen with mobile browser/device back history.
- Customer cards, selected-customer actions, filters, and matched listing cards were resized and wrapped to prevent horizontal clipping at 390px.
- Verified at 390x844: no horizontal overflow, list/detail transition works, and browser back returns from matches to the customer list.
- Verified at 1280x800: mobile mode is inactive, both original desktop panes remain visible, and the mobile back button is hidden.
- Cloudflare tests: 36/36 passed. `cf:check` passed.
- Production Worker version: `79b2d8fc-88cb-4aa9-955e-3f1a63f41849`.

## 2026-08-07 Mobile customer card overlap fix

- Fixed a mobile-only layout regression where the matched-listing grid compressed every outer card to 20px while its inner content remained about 110px tall, causing all cards to overlap.
- The matched-listing container now uses normal block flow; every card has automatic content height with a 126px minimum and an 8px vertical gap.
- Customer cards now reserve 124px and keep the 24px statistics row visible instead of clipping the bottom content.
- Production verification at 390x844 used the real signed-in dataset: 41 matched listings rendered at 128-131px each without overlap, and both customer cards showed condition and statistics rows.
- Desktop verification at 1280px confirmed mobile mode is inactive and the mobile back control remains hidden.
- Cloudflare tests: 36/36 passed. `cf:check` passed.
- Production Worker version: `c89c7e62-fd46-4069-beb2-ecd74e82366a`.

## 2026-08-07 Mobile keyword search fix

- Fixed the mobile-only main search so its keyword is synchronized to the existing listing filter while typing and before switching to the listing tab.
- Mobile keyword searches now scan the full loaded listing dataset instead of intersecting with the current map viewport. Desktop continues to use the existing map-bounds behavior.
- Added a mobile empty-result message instead of leaving a blank listing panel.
- Production verification at 390x844: `괴정동` returned 202 listings, retained the query after opening the listing tab, and rendered 14 cards in the virtual window.
- Verified a nonsense query renders the explicit zero-result message.
- Verified at 1280x800: mobile mode and mobile search flag are inactive, so desktop behavior is unchanged.
- The search remains client-side over already loaded listings and adds no D1 requests.
- Cloudflare tests: 36/36 passed; mobile search tests: 2/2 passed. `cf:check` passed.
- Production Worker version: `4ab663bb-38c9-44c4-9c11-08195a0bf89c`.

## 2026-08-07 Mobile listing sort alignment

- Fixed the mobile-only listing toolbar so `source`, `type`, `floor`, and `sort` stay in one four-column row.
- Reset a legacy `grid-row: 2` rule on `#sortDropdown` that pushed the sort button over the first listing card.
- Normalized all four controls to the same 36px height and top coordinate at 390px.
- Production visual verification confirmed no overlap and a single aligned row; desktop remained in its original flex layout with mobile mode inactive.
- Mobile tests: 3/3 passed; Cloudflare tests: 36/36 passed. `cf:check` passed.
- Production Worker version: `4016b362-40d6-4e5a-a6b1-927062d409ed`.

## 2026-08-07 Edge 자동수집 안정화

- Windows 예약 작업 `JSMap Auto Collector`를 30분 반복이 아닌 매일 오전 11시 1회 실행으로 변경했다. 놓친 실행만 `StartWhenAvailable`로 보완한다.
- Manifest V3 서비스 워커가 장시간 수집 중 종료되어 두 번째 대상에서 멈추던 문제를 실행 상태 영속화와 대상 완료 메시지 방식으로 수정했다.
- 대상 완료 메시지가 서비스 워커 재시작 시 유실되지 않도록 최대 12회 재전송한다.
- 자동수집 대상 탭은 백그라운드로 열고 전용 Edge 창을 대상 전환 전후 최소화하여 창이 앞으로 반복해서 나타나지 않게 했다.
- 네이버 자동수집이 등록한 구를 현재 지도 화면의 선택 구로 덮어쓰던 문제를 수정했다. 자동실행은 등록된 `cortarNo`를 그대로 사용한다.
- 공실박스 자동 대상은 사용자 선택에 따라 비활성화했다. 현재 자동 대상은 네이버 5개 구와 당근 5개 구이며 공실박스는 수동 수집한다.
- 전용 Edge 확장 프로그램 `1.0.11`을 로컬 프로필에 적용했고 기존 로그인·대상 설정은 보존했다.
- 5분 연속 관찰에서 전용 Edge 프로세스 1개와 최소화 상태가 유지됐고 추가 창/재실행은 없었다. 다음 예약은 `2026-08-08 11:00 KST`다.
- `tests/edge-auto-collector.test.mjs` 5/5와 확장 프로그램 JavaScript 구문 검사를 통과했다.

## 2026-08-10 Naver/Daangn automatic collection repair

- Naver v5.9.0 completed a manifest-first revalidation for all five Daejeon districts. Jung-gu completed with no issue; Yuseong-gu, Daedeok-gu, Seo-gu and Dong-gu were retained as partial only for provider rows that expose no usable address/floor (65, 10, 81 and 2 rows respectively). There was no remaining network or storage failure on the final pass.
- Daangn detail parsing now inherits address, room and rental terms from its list manifest, accepts additional provider address fields, normalizes absent coordinates to null, and stores a compact checkpoint. This removed the prior D1 type error and oversized checkpoint failure.
- Daangn browser jobs are scoped by district/cluster. A new automatic tab now waits for server job status and resumes a running or paused checkpoint instead of replacing it with a new session.
- Final live Daangn verification proved manifest skipping: Seo-gu scanned 3,629 IDs but skipped 3,528 unchanged rows and fetched only 101 detail candidates; Dong-gu scanned 592, skipped 563 and fetched only 29.
- Remaining Daangn failures are provider-data omissions, not collector crashes: Yuseong 22, Seo 25, Daedeok 11, Jung 6 and Dong 20 rows had no usable address/floor. Partial sessions preserve all successful saves and do not mark missing listings as inactive.
- D1 reached its 500 MB per-database ceiling during Seo-gu. Removed 5,540 superseded collector-review snapshots plus two obsolete job checkpoints; production size fell to about 445.4 MB. Listings, photos, memos, contacts, latest reviews and business history were preserved.
- Migration `0012_collector_review_dedup.sql` adds one active review row per `(source, source_listing_id)`. Repeated collection now refreshes that row instead of growing D1 indefinitely. Duplicate active review count is 0 after cleanup.
- Stale `running` collector sessions were marked `paused`; there are no falsely running sessions left.
- Production Worker version: `d17ba9af-7946-40e8-a5d1-6c3ae69b560d`.
- Installed Edge automation: extension `1.0.25`, Daangn collector `1.4.5`, daily schedule 11:00 KST.
- Full Cloudflare/Edge suite: 62/62 passed; Wrangler dry-run also passed.

## 2026-08-10 Pending-review deduplication and collector completion semantics

- Production review audit showed 9,243 active review rows with 9,243 distinct provider IDs: there were no repeated rows for the same provider ID. The growth came from provider re-posts that received new Naver/Daangn IDs.
- Ingestion now compares a new provider ID with active pending reviews at the same address. If floor/unit, deposit, rent and area satisfy the existing physical-listing rule, it stores a compact alias instead of adding another active review row.
- Scheduled review repair decision version 4 collapses already queued exact pending duplicates into the oldest canonical review. The first production cycles reduced active reviews from 9,243 to 9,224 and marked 29 aliases while leaving ambiguous listings for manual review.
- Migration `0013_collector_review_address_index.sql` indexes active review address lookup. Production query planning confirms `idx_collector_raw_review_address` is used, avoiding a full collector table scan on every repair cycle.
- Daangn collector `1.4.6` reconnects a manual interrupted run from the saved checkpoint up to five times. Automatic runs use the same checkpoint path.
- A completed scan with provider address/floor omissions now returns a completed partial result with warnings. It is not treated as a crash, so the automation extension does not restart that district from zero.
- Installed Edge automation is `1.0.26`; Windows task remains daily at 11:00 KST. Gongsilbox remains manual.
- Production Worker version: `c11ec97b-d825-4d4e-a461-c0af26e5ce99`.
- Full test suite: 90/90 passed; Wrangler dry-run passed; live asset verification confirmed Daangn `1.4.6`, partial completion mode and manual recovery.

## 2026-08-10 Edge automatic runner v1.0.29

- The Windows launcher now finds the dedicated unpacked-extension ID from its profile and triggers an extension-owned autorun page through the local Edge debugging endpoint. It no longer depends on the signed-in `js-map.com/collector-install` page to deliver the daily start signal.
- The internal autorun page reloads a stale Manifest V3 background worker once after an extension upgrade, then the launcher sends a second idempotent trigger. Normal daily launches observe an already active run without creating a duplicate.
- Automatic collection settings show the installed extension version in the header. Installed production profile is `v1.0.29`; the registered targets remain Naver 5 districts plus Daangn 5 districts, with Gongsilbox disabled/manual.
- Fully enumerated districts with address/floor omissions are now accepted as partial completion warnings. They are not put into the deferred full-district retry queue. Two legacy queued Naver retries were removed from the active run.
- Target transitions no longer minimize the Edge window. The scheduled launch starts minimized, but once the user restores the window it remains visible while Naver/Daangn advance between districts.
- Live verification: Naver completed its five-district first pass and the active run advanced into Daangn; extension state reported `v1.0.29`, 10 total targets and an empty retry queue after cleanup.
- Edge automation tests: 7/7 passed.

## 2026-08-10 Per-district collection report and partial-run retry v1.0.30

- The Edge automatic-collection settings screen now keeps a single visible report for all 10 registered targets: Naver five districts and Daangn five districts. Each row shows waiting, running, retrying, completed, partial or failed state, timestamps and available counts.
- The report persists in the dedicated Edge profile and refreshes every five seconds. It adds no D1 reads or writes.
- A Daangn payload with `partial: true` is no longer accepted as a completed target even when the bridge message itself is technically successful. It is retried from the saved checkpoint and the runner advances only after an actual completion.
- Naver's fully enumerated provider omissions remain warning-completions so known address/floor omissions do not restart an entire district.
- Production-data inspection confirmed the user's report: the latest automatic run did not complete all 10 targets. Daangn Yuseong ended partially and Daangn Seo had no completion record. The JS map currently contains only first-floor originals for Yongmun-dong 257-5; the reported second-floor Daangn listing has not yet been ingested.
- Installed extension files were updated in place to `v1.0.30`. The registered targets and schedule were preserved, and no Edge window was restarted or minimized.
- A user-forced/manual launcher run now opens and stays visible; only the unattended Windows scheduled run starts minimized. Target transitions do not change the user's chosen window state.
- Edge automation tests: 8/8 passed; Cloudflare tests: 56/56 passed.

## 2026-08-10 Gongsilbox incremental detail refresh v2.1.4

- Audited a manual Gongsilbox run that selected 2,531 listings, fetched 2,364 details, created 11 listings and took about one hour. The daily slowdown came from refreshing unchanged contact details after only 20 hours and from the provider-safe single-detail request queue.
- Unchanged Gongsilbox details now refresh every seven days instead of every daily collection. New listings and material rental changes still request details immediately; daily manifest comparison remains intact.
- Import results now separate actual rental-condition changes from source-information refreshes such as photos, contacts and provider snapshots. The collector UI shows `임대조건 변경` and `정보 최신화` independently instead of labeling all source updates as condition changes.
- Gongsilbox remains manual-only. Installed collector is `v2.1.4`; Edge automatic runner remains `v1.0.30` for Naver five districts plus Daangn five districts.
- Full Cloudflare tests: 58/58 passed; Edge automation tests: 8/8 passed; Wrangler dry-run passed.
- Production Worker version: `35151ebf-834c-4ac8-b96d-edd4da4cea4c`.

## 2026-08-11 Professional desktop/tablet navigation refresh

- Rebuilt the desktop and landscape-tablet header as one 60px navigation row while preserving every existing click handler and data path.
- Added compact line icons, clearer primary/secondary button hierarchy, a branded subtitle and a blue quick-registration action.
- The map's vertical quick tools now use independent translucent glass buttons without the previous solid background rail.
- Mobile app layouts remain isolated at 768px and below; no mobile data or interaction logic was changed.
- Render QA covered 900, 1024, 1199, 1200, 1280, 1440, 1540 and 1920px with zero overlaps or viewport overflow.
- Targeted UI tests: 5/5 passed; Wrangler build and dry-run passed.
- Production Worker version: `0be2698b-ab49-4cbd-8ac9-e8d401889f60`.
- Follow-up refinement connected and capped the search group, removed desktop/tablet green status dots, reduced button padding and unused status-column width, and rebuilt the translucent vertical toolbar with per-action line icons and compact labels.
- Refined production Worker version: `5deb54c1-c177-4c91-b042-2a8d528bc7fc`.
- Balanced-toolbar follow-up widened the desktop search input by about 1.5x, widened Tell, reduced the JS부동산 brand weight, forced the heart icon to remain visible and preserved the multi-select SVG when its active state changes.
- Live desktop QA at 1794px measured a 348px keyword input, 78px Tell button, zero search seam gap and visible heart/multi-select icons. Landscape-tablet QA at 1024px reported zero toolbar overflow.
- Final production Worker version: `fdc79bd4-b402-481a-a0c6-3f9c95123738`.
- Roomier desktop actions increased the 1540px+ header labels to 13px with 8px inter-button gaps and wider action cells; 1200px uses 12px/6px while 900-1024px keeps the compact tablet fit. Mobile remains unchanged.
- Responsive QA at 900, 1024, 1200 and 1794px reported zero toolbar overflow. Production Worker version: `2d2ed80c-7f3a-4199-8217-39b7a003db3e`.
- Search-button balance follow-up widened the 1540px+ blue search action from 60px to 76px without reducing the 360px keyword input; both remain 42px high with a zero-gap seam. Production Worker version: `e0b2488c-1b66-4292-8645-0255033a2ac1`.
- Quick-registration emphasis follow-up raises the desktop action to 14px/900 weight (13px at 1200px) while retaining the existing button footprint and zero header overflow. Production Worker version: `465c8f99-318f-49d0-a691-04b18d299e07`.

## 2026-08-11 BuildingHUB credential recovery and elevator-capacity lookup

- The building-register failure was traced to an empty `DATA_GO_KR_SERVICE_KEY` Worker secret plus a missing approval for the separate Ministry of Land BuildingHUB API. The user completed the BuildingHUB application, and the dedicated secret was populated without reusing it in code as an elevator credential.
- BuildingHUB encoded display keys are decoded exactly once before `URLSearchParams` serializes them. This keeps encoded and decoded portal keys equivalent.
- JSONP failures from the building-register and elevator endpoints now remain valid executable callbacks and include a readable public error; Worker logs record the internal action/status for diagnosis.
- Production verification passed on `Seo-gu Dunsan-dong 1236`: opening the register used cached official data, and pressing `Latest lookup` returned a fresh live BuildingHUB response with the current timestamp.
- Elevator-capacity discovery now tries normalized address variants, caches a district-wide operation index in R2 when exact lookup is empty, and enriches matched elevator numbers with the separately approved building-elevator detail API. BuildingHUB and elevator environment variables remain logically separate.
- Cloudflare tests: 88/88 passed. Targeted elevator tests: 5/5 passed. Wrangler build/dry-run passed.
- Production Worker version before the secret recovery verification: `1a2dc74d-42af-4bcf-b629-78d93124be8b`.

## 2026-08-11 Elevator maximum-capacity production repair

- Production D1 proved the display path had never succeeded: 935 active listings had a verified elevator count, but 0 had `building_elevator_capacity` before this repair. Every v1-v3 capacity cache entry was either unmatched or timed out.
- The data.go.kr operation proxy returned zero rows for parcel-address searches. The Elevator Safety Agency source gateway returned the district data normally, but its response identifies buildings by road address rather than parcel address.
- Capacity lookup now passes the selected BuildingHUB title row's official road address and building name, matches the operation response by normalized road address, and falls back to the official source gateway when the proxy is empty.
- Operation rows that already contain `ratedCap` are used immediately instead of waiting for a redundant building-detail call. The old detail endpoint remains a fallback only when capacity is missing.
- Capacity caches are versioned per parcel and road address. A successful D1 persistence now invalidates `api-cache/d1-sheet.csv` and touches the listings revision so the saved value survives reloads instead of waiting for the old one-hour sheet cache.
- Live official-source verification for `대덕구 송촌동 477-1` / `동춘당로 79` returned elevator `5000593`, maximum 13 persons. That verified value was safely persisted to listing `M-e0d98b9b-e3c7-43da-92c4-04742ea290a7`; no other listing fields were changed.
- The regenerative R2 object `api-cache/d1-sheet.csv` was removed once after deployment so the next authenticated sheet request rebuilds it from the corrected D1 row.
- Cloudflare tests: 89/89 passed. Targeted elevator tests: 6/6 passed. Wrangler build/dry-run passed.
- Production Worker version: `72a7be29-4653-4d12-b781-c5f148f06418`.

## 2026-08-11 Precomputed elevator badges for current and future listings

- Listing cards no longer start an elevator-capacity request when they enter the viewport. They render only the BuildingHUB/elevator values already stored in D1, eliminating the late capacity flash.
- Naver, Daangn and Gongsilbox normalization now preserves a provider road address when available. BuildingHUB persistence also writes the official title-row road address without overwriting an existing value.
- Collection completion starts background enrichment immediately, and the existing every-minute Worker cron repeats it. Newest listings are prioritized; cached parcel data is reused, unfamiliar Daejeon parcels derive BuildingHUB inputs from the legal-dong cache, and only official maximum-capacity values are saved.
- A read-first production backfill loaded the five official Elevator Safety Agency district indexes and matched BuildingHUB road addresses exactly. Of 746 eligible missing rows, 738 received a verified maximum capacity; all 746 received the official road address. The remaining eight exact-road nonmatches were left at zero for later official recheck rather than inferred.
- Production active elevator listings after backfill: 936 total, 748 with a saved capacity, 746 with an official road address. Older uncached parcels continue through the automatic minute-by-minute enrichment path.
- Live post-deploy cron verification then advanced those counts to 954 total, 752 with capacity and 763 with an official road address, proving the automatic enrichment path was processing new/cached BuildingHUB rows in production.
- Cloudflare tests: 92/92 passed. Targeted scheduler/elevator tests: 6/6 passed. Wrangler build/dry-run passed.
- Production Worker version: `b65c443b-e056-431e-ade9-f8f6aa0e6f1b`.

## 2026-08-11 Unknown elevator-capacity marker

- A BuildingHUB-verified elevator with no saved official maximum capacity now renders as `🛗 X` instead of leaving the capacity label blank.
- Verified capacities continue to render as `🛗 13인`; listings without a verified elevator still hide the elevator badge entirely.
- The unknown marker is muted gray and its accessible label/title states that maximum capacity is unconfirmed.
- Cloudflare tests: 92/92 passed. Targeted elevator tests: 5/5 passed. Wrangler build/dry-run passed.
- Production Worker version: `bc9272c4-ebda-4cfa-a686-de7fc480701a`.

## 2026-08-11 Listing-card elevator rendering repair

- The list-card template previously created every elevator element hidden and relied entirely on a later badge-binding pass. This allowed the register modal to show official values while the listing itself remained blank when card binding had not run yet.
- Cards now render persisted D1 elevator data directly during HTML creation: verified capacity displays `🛗 13인`, verified elevator with missing capacity displays `🛗 X`, and no verified elevator remains hidden.
- The badge module now performs a startup rebinding pass for already-rendered/virtualized cards and can recover the card item by `property_id` when a card was created before the module loaded.
- A fresh BuildingHUB modal lookup now refreshes the matching listing card by `property_id` as well as parcel key, so closing the register immediately leaves the icon visible on the list.
- Direct card-markup execution passed for known, unknown and absent elevator cases. Cloudflare tests: 92/92 passed; Wrangler build/dry-run passed.
- Production Worker version: `c00ad386-5d3a-4523-ae19-20862fb8ca1e`.

## 2026-08-11 Independent elevator-registry audit and repair

- `서구 용문동 227-1` exposed an official-source discrepancy: BuildingHUB reported passenger/emergency elevators as zero, while the Elevator Safety Agency operation registry reported two active elevators, including a 13-person accessible elevator.
- Elevator-registry discovery no longer requires a positive BuildingHUB count. Separate D1 fields now preserve the BuildingHUB count, safety-registry count, lookup state and checked time; the effective card count is the maximum of the two official sources so a later BuildingHUB refresh cannot erase a verified safety-registry match.
- Older Daangn source snapshots were also inspected. Generic `address`/`publicAddress` fields recovered road addresses that had not previously reached the listing row, and future collection now preserves those verified road-address values automatically.
- The complete Daejeon five-district operation index contained 28,117 elevator rows across 12,012 road addresses. All 3,725 active listings that could be linked by an official/provider road address were audited: 1,943 listings matched the safety registry at 1,023 road addresses.
- The first audit repaired 168 listings where BuildingHUB had already reported zero and 714 previously unchecked listings where the safety registry proved an elevator. The expanded source-address audit recovered another 252 missing badges, for 1,134 newly visible elevator badges in total.
- The immediate post-audit snapshot was 2,138 active elevator listings, 1,938 with a verified person capacity and 200 correctly showing `X`; the live minute scheduler continues advancing those counts as remaining addresses acquire an official road-address link.
- `서구 용문동 227-1` has 12 active listings; all 12 now persist two elevators and maximum capacity 13. Production invariants confirmed zero registry-matched listings with an effective count of zero and zero source-merge count mismatches.
- Future automatic and manual listings run the safety-registry check independently after collection/BuildingHUB enrichment. Matches, no-matches and temporary upstream failures use separate refresh windows, preventing the same locations from being queried every minute.
- Regenerative listing caches were invalidated and the listings revision was advanced for an immediate client refresh. Cloudflare tests: 95/95 passed; targeted elevator tests and Wrangler dry-run passed.
- Production Worker version: `af56dfe4-3067-4cf1-9ddb-c08fa5004c8e`.

## 2026-08-12 v6-cloud 브라우저 데이터 접근 계층 기반

- 작업 시작 시 `codex/cloudflare-js-map` 브랜치의 깨끗한 작업 트리를 확인하고, 원격보다 뒤처진 6개 커밋을 `git fetch --prune`과 `git pull --ff-only`로 반영했다. 시작 기준 원격 HEAD는 `527eb40`이었다.
- 현재 저장소는 이미 Google Sheet·Apps Script·Vercel을 운영 런타임에서 제거하고 Worker + D1 + R2로 운영 중이므로, 새 Cloudflare 스켈레톤을 중복 생성하지 않고 브라우저 데이터 접근 경계를 추가했다.
- 새 `js/data-access-v6.js`는 `/api/data` D1 조회·저장과 `/api/sheet` CSV 호환 조회를 한곳에서 관리한다. 동일 출처 세션 자격, 캐시 정책, 강제 새로고침 헤더, JSON 오류와 재시도 가능 상태를 공통 처리한다.
- 매물 CSV 초기 로딩, 리비전 확인, 변경 매물 델타, 통합매물 조회, 원본매물 이동·대표매물 통합 경로를 공통 계층에 연결했다. 기존 직접 `fetch` 코드는 모듈 미로딩 시 호환 폴백으로 남겨 기존 빠른등록·임장ON·메모수정·로드뷰/지도·선택인쇄 동작을 변경하지 않았다.
- 캐시 버전을 `data-access` 버전으로 올렸고, 데이터 접근 모듈이 모든 소비 모듈보다 먼저 로드되는지 자동 검증한다. 자세한 경계와 점진 전환 원칙은 `docs/CLOUDFLARE_MIGRATION.md`에 추가했다.

### 변경 파일

- 신규: `js/data-access-v6.js`, `tests/cloudflare-data-access.test.mjs`
- 런타임 연결: `index.html`, `js/script.js`, `js/map.js`, `js/unified-listings-v8.js`
- 문서: `docs/CLOUDFLARE_MIGRATION.md`, `CODEX_HANDOFF.md`
- 회귀 계약/캐시 버전 갱신: `tests/cloudflare-cluster-selection-persistence.test.mjs`, `tests/cloudflare-field-visit-cluster.test.mjs`, `tests/cloudflare-list-virtualization.test.mjs`, `tests/cloudflare-separate-original.test.mjs`, `tests/cloudflare-whole-master-merge.test.mjs`

### 테스트와 빌드

- `pnpm run test:cloudflare`: 99/99 통과
- `pnpm run cf:check`: Cloudflare 자산 124개 빌드 및 Wrangler 4.118.0 dry-run 통과
- `pnpm run build:cloudflare`: 통과, `.cloudflare-assets/js/data-access-v6.js` 포함 확인
- 변경 파일과 빠른등록·임장·메모·찜·인쇄·건축물대장·운영센터 관련 핵심 브라우저 스크립트 12개의 `node --check`: 통과
- `git diff --check`: 통과

### 남은 작업과 주의사항

- 이번 변경은 안전한 첫 경계다. `operations-*`, `list-manager`, `ai-visit`, 비동기 저장 큐 등 나머지 브라우저 모듈의 직접 `/api/data` 호출은 기능별 테스트를 붙인 뒤 공통 계층으로 점진 전환한다.
- 호환용 `saveApiURL`, `sheetURL`, 직접 `fetch` 폴백은 모든 소비 모듈 전환과 실제 브라우저 회귀 확인 전까지 제거하지 않는다.
- 오래된 독립 `.cjs` 테스트 일부는 현재보다 과거인 캐시 버전을 고정 검사하거나 다른 PC의 절대 경로를 참조해 일괄 실행할 수 없다. 공식 릴리스 게이트인 `test:cloudflare`는 전부 통과했으며, 레거시 테스트는 별도 정리 후 공식 스크립트에 편입하는 것이 안전하다.
- D1 스키마·운영 데이터·R2 객체는 변경하지 않았고 이번 작업에서 운영 Worker 배포도 수행하지 않았다.

## 2026-08-12 v6-cloud 운영센터 데이터 접근 계층 전환

- 작업 시작 시 `CODEX_HANDOFF.md`를 UTF-8로 확인하고 `git fetch --prune origin`을 실행했다. 로컬 `codex/cloudflare-js-map`과 원격은 모두 `c957ecf`로 이미 일치해 추가 병합은 없었다.
- `operations-center-v7.js`, `operations-collection-v8.js`, `operations-admin-v1.js`의 현황·고객·매물검증·변경이력·사용자 관리 조회와 저장을 `JSDataAccessV6.read/mutate`에 연결했다.
- 공통 계층이 없는 구형 독립 실행 환경에서는 기존 `saveApiURL`·직접 `fetch`가 계속 동작하도록 가드된 폴백을 유지했다. D1 액션 이름, 요청 본문, 세션 자격, 화면별 오류 처리 흐름은 바꾸지 않았다.
- 운영센터 자산 캐시 버전을 각각 `7.22.2-data-access`, `7.25.3-data-access`, `1.0.4-data-access`로 갱신했고, 공통 계층 선행 로드와 세 모듈의 조회·저장 연결을 공식 Cloudflare 테스트에서 자동 검증한다.
- `docs/CLOUDFLARE_MIGRATION.md`의 브라우저 데이터 접근 경계에 운영센터 적용 범위를 반영했다.

### 테스트와 빌드

- 변경한 운영센터 JavaScript 3개의 `node --check`: 통과
- 데이터 접근·전문 운영센터 대상 테스트: 10/10 통과
- `pnpm run test:cloudflare`: 100/100 통과
- `pnpm run cf:check`: Cloudflare 자산 124개 빌드 및 Wrangler 4.118.0 dry-run 통과
- `pnpm run build:cloudflare`: 통과
- `git diff --check`: 통과
- 오래된 독립 운영센터 `.cjs` 테스트 4개는 코드 실행 전에 다른 PC의 절대 경로 또는 현재 저장소에 없는 과거 `outputs` 폴더를 읽다가 종료됐다. 이번 변경의 공식 테스트와 대상 테스트는 모두 통과했으며, 이 레거시 경로 문제는 별도 테스트 정리 작업으로 남겼다.

### 남은 작업과 주의사항

- 다음 전환 후보는 `list-manager-v6.js`, `ai-visit-session-v6.js`, `async-mutation-queue-v1.js`, `diagnosis-storage.js`다. 비동기 큐는 재시도·작업상태 계약이 있으므로 독립 테스트의 절대 경로 문제를 먼저 제거한 뒤 전환하는 편이 안전하다.
- 운영센터의 직접 `fetch` 코드는 공통 계층 미로딩 시의 호환 폴백이므로 실제 브라우저 회귀 확인 전까지 제거하지 않는다.
- D1 스키마·운영 데이터·R2 객체는 변경하지 않았고 운영 Worker 배포도 수행하지 않았다.

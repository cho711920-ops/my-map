# JS부동산 Codex 인수인계

## 현재 운영 주소

- 운영: https://js-map.com
- 보조 도메인: https://www.js-map.com
- GitHub: https://github.com/cho711920-ops/my-map
- 작업 브랜치: `codex/cloudflare-js-map`
- Cloudflare Worker: `js-map`
- 현재 배포 버전: `1c722344-3e10-487f-9a00-5ba55a5a788b`

## 현재 구조

- Cloudflare Worker가 정적 사이트와 모든 API를 제공한다.
- D1 `js-map-primary`가 매물·원본매물·사진 URL·연락처·메모·고객·수집기 작업·변경이력을 저장한다.
- R2 `js-map-media`가 실제 열어 본 외부 사진과 다음 사진을 7일간 캐시한다.
- Google은 OAuth 로그인에만 사용한다. 허용된 Gmail 계정만 접속할 수 있다.
- Google Sheet와 Apps Script는 운영 런타임에서 호출하지 않는다. 기존 자료는 백업으로 보존한다.
- Vercel은 운영 런타임에서 사용하지 않지만 Pro 구독은 아직 해지하지 않았다.

## 이전 완료 데이터

- 통합매물: 8,754개
- 활성 원본매물: 23,077개
- 사진 URL: 112,456개
- 연락처: 3,151개 / 2,321개 매물
- 고객: 1명
- D1 크기: 약 141.5MB

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

- Cloudflare 자동 테스트 22개 통과
- `js-map.com`과 `www.js-map.com` HTTP 200
- 비로그인 `/api/data` HTTP 401
- 제거된 `/api/apps-script` HTTP 404
- 잘못된 수집기 키 HTTP 403
- 로그인 상태에서 매물 8,747개 화면 로딩(주소 오류 7개는 기존 데이터)
- 운영현황 D1 통합매물 8,754개, 원본매물 23,077개 확인
- 사진 17장 상세창과 2·3번째 사진 전환 확인
- 건축물대장 공식 API 실조회 확인

## 다음 작업 원칙

1. 작업 전 `git status`를 확인하고 사용자 변경을 보존한다.
2. 모든 운영 저장은 D1을 기준으로 한다. Google Sheet 동기화를 다시 연결하지 않는다.
3. 키는 propertyId, customerId, sourceListingId를 사용한다. 화면 행번호로 수정하지 않는다.
4. 배포 전 `pnpm run test:cloudflare`와 `pnpm run cf:check`를 실행한다.
5. 배포는 `pnpm run build:cloudflare` 후 `pnpm exec wrangler deploy`로 한다.
6. Vercel 구독 해지나 기존 Google 자료 삭제는 사용자 승인 없이 하지 않는다.
7. 비용은 `outputs/JS_MAP_MONTHLY_COST.md`의 무료·유료 시나리오를 기준으로 판단한다.

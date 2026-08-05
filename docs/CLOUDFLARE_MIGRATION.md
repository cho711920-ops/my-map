# JS부동산 Cloudflare 전환

## 목표와 결과

`js-map.com`에서 기존 JS부동산 화면과 수집기를 그대로 사용하면서 Google Sheet, Apps Script, Vercel을 운영 런타임에서 제거했다. Google은 허용된 Gmail 계정의 OAuth 로그인에만 사용한다.

## 운영 구조

```text
브라우저
  ├─ 정적 사이트 ─ Cloudflare Assets
  ├─ 로그인·데이터 API ─ Cloudflare Worker
  ├─ 매물·고객·메모·수집 데이터 ─ D1
  ├─ 외부 사진 7일 캐시 ─ R2
  └─ 건축물대장·상권·지역통계 ─ Worker가 공식 API 직접 호출
```

## 데이터 전환

- 통합매물 8,754개
- 활성 원본매물 23,077개
- 사진 URL 112,456개
- 연락처 3,151개
- 고객, 고객매칭, 메모, 임대조건, 변경이력
- D1 현재 크기 약 141.5MB

## API

- `/api/session`: Google 로그인 세션
- `/api/sheet`: 기존 CSV 소비 코드를 위한 D1 CSV 응답
- `/api/data`: 로그인 사용자의 조회·저장 API
- `/api/collector`: 네이버·당근·공실박스 수집 API
- `/api/listing-image`: 허용된 외부 사진 프록시와 R2 캐시
- `/api/permit-public-data`: 건축물대장 직접 조회

과거 `/api/apps-script`는 제거되었고 1분 예약 동기화도 제거되었다. Google Sheet와 Apps Script는 백업 자료로만 보존한다.

## 비용 보호

- Workers Free를 기본으로 사용한다.
- R2는 실제 본 사진과 다음 사진만 저장하고 7일 뒤 삭제한다.
- R2 7일 사진 저장 예산을 6GB로 제한한다.
- 목록·상세·좌표 응답은 R2 캐시로 D1 반복 조회를 줄인다.
- D1 인덱스로 검색 시 읽는 행 수를 줄인다.
- 자세한 계산은 `outputs/JS_MAP_MONTHLY_COST.md`를 참고한다.

## 배포와 검증

```powershell
pnpm run test:cloudflare
pnpm run cf:check
pnpm run build:cloudflare
pnpm exec wrangler d1 migrations apply js-map-primary --remote
pnpm exec wrangler deploy
```

배포 후 로그인 화면, 매물 수, 상세 사진, 메모·임대조건 저장, 고객매칭, 운영현황, 수집기, 건축물대장을 실제 도메인에서 확인한다.

## 주의

- Secret 값을 코드, 문서, 로그, 커밋에 넣지 않는다.
- 운영 수정은 D1을 기준으로 한다.
- Vercel 해지와 기존 Google 자료 삭제는 사용자 승인 후 별도로 한다.

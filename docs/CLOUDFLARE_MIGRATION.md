# JS부동산 Cloudflare 이전

## 목표

- `js-map.com`에서 기존 JS부동산 화면과 수집기를 그대로 사용한다.
- Google 로그인 후 허용된 이메일만 데이터 API에 접근한다.
- 기존 Google Sheet와 Apps Script를 중단하지 않고 호환 프록시로 먼저 이전한다.
- 검증된 기능부터 D1로 옮기고, 허용된 사진만 R2에 저장한다.
- 데이터 변경은 행 번호가 아니라 `propertyId`, `customerId`, `sourceListingId`로 식별한다.

## 단계적 전환

1. **호환 단계**: Worker가 기존 `/api/session`, `/api/sheet`, `/api/apps-script` 응답 형태를 유지한다.
2. **그림자 읽기**: Sheet 원본을 D1에 복제하고 두 저장소의 레코드 수와 식별자를 비교한다.
3. **이중 검증**: 저장 후 Apps Script와 D1을 각각 다시 읽어 결과가 같은지 확인한다.
4. **D1 읽기 전환**: 목록·검색·상세·연락처를 인덱스 기반 D1 조회로 바꾼다.
5. **D1 쓰기 전환**: 메모·고객·수집기·작업 큐를 기능별로 전환한다.
6. **사진 전환**: 권한이 확인된 사진만 R2에 복제하고 썸네일과 다음 사진을 미리 준비한다.
7. **운영 전환**: 시험 주소 검증 후 `js-map.com`을 연결한다. 기존 사이트는 안정화 기간 후에만 종료한다.

## 로컬 실행

1. `.dev.vars.example`을 `.dev.vars`로 복사하고 실제 비밀값을 입력한다.
2. `pnpm run test:cloudflare`
3. `pnpm run cf:dev`

비밀값과 사용자 데이터는 Git에 커밋하지 않는다.

## 시트 그림자 가져오기

운영 시트 CSV를 받은 뒤 아래 도구로 무손실 SQL과 검증 보고서를 만든다.

```powershell
node tools/prepare-d1-shadow-import.mjs sheet.csv shadow-import.sql shadow-import.report.json
wrangler d1 execute js-map-primary --local --file shadow-import.sql
```

도구는 `propertyId`가 없는 행과 중복 행을 보고서에 분리하고, `INSERT OR IGNORE`만 사용한다. 기존 D1 레코드를 수정하거나 삭제하지 않는다. 실제 원격 D1 적용 전에는 보고서의 전체 식별자 수를 운영 시트와 비교한다.

## Cloudflare 리소스

- Worker: `js-map`
- D1: `js-map-primary`
- R2: `js-map-media`
- Custom domain: 안정화 후 `js-map.com`

`wrangler.toml`에는 실제 도메인 route를 아직 넣지 않는다. 시험 배포와 Google OAuth 허용 출처 등록이 끝난 뒤 연결한다.

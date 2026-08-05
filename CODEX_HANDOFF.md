# JS부동산 Codex 인수인계

## 시작 방법

사무실 컴퓨터에서 이 저장소를 내려받은 뒤 Codex에 다음과 같이 요청한다.

> `CODEX_HANDOFF.md`를 먼저 읽고 JS부동산 작업을 이어서 진행해줘. 기존 사용자 데이터와 변경을 보존하고, 수정·검증·운영 배포까지 완료해줘.

## 프로젝트 위치

- GitHub: https://github.com/cho711920-ops/my-map.git
- 운영 웹: https://my-map-ten-roan.vercel.app/
- Google Sheet: https://docs.google.com/spreadsheets/d/1zRWqjc7xVkiTnFHFujBNI72qr_aDCgxiQipQlnGgWmU/edit
- Apps Script: https://script.google.com/u/0/home/projects/1Ude367MRECx5njZoxC-BwtYNQlQqf8Z7Nph0ihYIZ4fA0GJ9sT1POq_q/edit
- 운영 웹앱 배포 ID: `AKfycbzPedWbaT4yaLNxqrvKI9F3L4JVZ0Q8wVnsSyLEELmaW2h9QuyfGYsESW_7rDxbdqNw`
- 집 컴퓨터 원본 경로: `C:\Users\USER\Documents\Codex\2026-07-17\sork\my-map`

## 현재 정상 버전

- 브랜치: `main`
- 기준 커밋: `7f3bf87 fix: restore interactive listing features`
- 이 커밋은 GitHub와 운영 Vercel에 반영됐다.
- Vercel 비용 최적화 과정에서 모든 GET API에 잘못 적용됐던 20초 제한을 제거했다.
- 건물정보 자동 요약 조회에만 제한을 유지하고, 매물·사진·상세·메모·연락처·Tell·동일매물 조회는 정상 복구했다.

## 마지막 운영 검증 결과

- 최근 메모 원문이 시트에 남아 있고 운영 매물카드와 메모 수정창에서 다시 표시됨
- 매물 사진, 상세창, 사진 넘기기 정상
- 연락처 팝업과 전화연결 정상
- 동일매물 원본 펼치기 정상
- 임대조건 수정창 정상
- 고객매칭, 운영현황, 매물검증(`동일매물·다른매물·보류`) 정상
- Tell 주소검색과 연락처 전화연결 정상
- 계정별 찜목록, 폴더추가·삭제·지도보기·임장하기 화면 정상
- 전체 자동검사 76개 통과, 작업트리 깨끗함

## 확인된 별도 데이터 문제

- `서구 탄방동 685` 공실박스 103호 등은 현재 `수집원본`의 `contactList` 자체가 비어 있다.
- 웹 표시 장애가 아니라 수집 원본 누락이다.
- 근거 없는 번호 추정이나 다른 호실 연락처 전파는 금지한다.

## 절대 원칙

- 작업 전 `git status` 확인, 사용자 변경 보존
- 매물 데이터 삭제·덮어쓰기 금지
- 수정·삭제 대상은 행번호가 아니라 매물ID·고객ID·출처매물ID로 검증
- 저장 기능은 응답만 보지 말고 실제 시트 반영과 웹 재조회까지 확인
- Apps Script API가 바뀌면 기존 운영 URL을 유지한 새 버전 배포
- 웹 변경은 테스트 후 `main`에 푸시하고 Vercel 운영 URL에서 실제 검증
- API 키와 보안키를 문서·채팅·로그에 노출하지 않음


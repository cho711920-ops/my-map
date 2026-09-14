# 수집 이력 보관·정리

이 기능은 매물, 찜, 연락처, 사용자 메모, 원본 링크, 사진을 삭제하지 않습니다. 오래된 **중복 수집 이력**만 R2에 복구 가능한 전체 행으로 보관한 뒤 D1에서 정리합니다.

## 적용 순서

1. `0021_collector_retention.sql`을 적용합니다. 마이그레이션은 상태 테이블·인덱스만 추가하며 데이터 삭제가 없습니다.
2. `node tools/preview-collector-retention.mjs`로 운영 D1의 읽기 전용 사전 보고서를 확인합니다. 전체 테이블 건수가 아닌 **현재 최대 50행 스캔의 대상 수**입니다. 보고서의 `cursor`를 다음 실행에 `--cursor=<JSON>`으로 전달하면 다음 구간을 확인합니다.
3. Worker에서 `runScheduledCollectorRetention(env)`를 기존 scheduled 유지보수에서 호출합니다.
4. 기본 모드는 `dry-run`입니다. 검증 후 `COLLECTOR_RETENTION_MODE="archive"`로 명시 설정하면 보관·검증 후 정리가 실행됩니다. 다시 `dry-run`으로 바꾸면 D1 삭제와 R2 업로드가 모두 중단됩니다.

| 설정 | 기본값 | 안전 범위 |
| --- | --- | --- |
| `COLLECTOR_RETENTION_RAW_DAYS` | 90일 | 최소 90일 |
| `COLLECTOR_RETENTION_SESSION_DAYS` | 180일 | 최소 180일 |
| `COLLECTOR_RETENTION_BATCH_LIMIT` | 각 테이블 50행 | 1–100행 |
| `COLLECTOR_RETENTION_MODE` | `dry-run` | `archive`만 실제 정리 |

기존 분 단위 cron이 호출하더라도 DB lease로 하루 한 번만 수행합니다. 고정된 오래된 보존 대상에 막히지 않도록 커서가 다음 구간으로 이동하고 끝에 도달하면 다음 실행에서 처음부터 다시 검사합니다. 오류 시 한 시간 뒤 재시도하고, 수집·검수 작업은 계속할 수 있도록 실패 결과만 반환합니다. 정리 속도는 의도적으로 제한적이며 보고서를 보고 필요할 때 배치값을 늘립니다.

## 항상 보존하는 자료

- `pending`, `review`, `held`, `error` 및 알 수 없는 처리 상태와 관련된 같은 공급자 매물 이력
- 아직 완료되지 않은 세션의 원문, 재개 가능한 작업에서 참조하는 원문·세션
- 최신 스냅샷과 거래종류별 최신 **전체 상세 원문**: 더 최근의 축약 중복 행만 있다고 전체 원문을 삭제하지 않음
- `legacy_original_id`가 있는 과거 원본 복구 자료
- 열려 있는 데이터 품질 보류의 원문·원본·매물·세션·후보 ID 증거
- 아직 원문 자식행이 있거나 listing_sources/jobs에 참조되는 세션, 공급자·지역 범위의 마지막 세션
- 잘못된 날짜·JSON, 원문 오류, 512 KiB를 넘는 대형 원문: 별도 검수 없이 삭제하지 않음

## 보관 및 동시성 안전장치

R2 `collector-retention/YYYY-MM-DD/<UUID>.json`에 삭제 후보의 모든 열과 부모 세션을 함께 저장합니다. SHA-256을 메타데이터와 완료 보고서에 기록하고 **GET 응답 본문이 업로드한 전체 본문과 일치하는지 확인한 뒤에만** 삭제합니다. 기존 `images/external/` 이미지 캐시 7일 수명주기 규칙과 경로가 다릅니다. 이 아카이브 prefix에 자동 만료 규칙을 추가하지 마세요. 사용자 자료나 아카이브를 만료시키는 버킷 전체 규칙도 사용하지 않습니다.

삭제 직전 보존 조건을 다시 검사하며, 아카이브된 모든 열이 현재 D1 행과 동일해야 삭제됩니다. 업로드 동안 수정됐거나 새 보류가 생기면 삭제하지 않습니다. 부모 세션은 자식 원문이 하나라도 남으면 삭제하지 않으므로 외래키 CASCADE에 의한 미검증 원문 삭제가 없습니다. R2 업로드·검증 실패나 마이그레이션 누락도 삭제 없이 종료됩니다. 실패 후 재실행 시 중복 아카이브는 생길 수 있지만 원문을 잃지 않는 쪽으로 처리합니다.

마지막 실행은 다음 읽기 전용 SQL로 확인합니다.

```sql
SELECT next_run_at, cursor_json, last_report_json, updated_at
FROM collector_retention_state WHERE id='daily';
```

## 복구

보고서 `archiveKey`의 JSON을 비공개 위치로 내려받고 `archiveSha256`과 파일 SHA-256을 비교합니다. `tables.collector_sessions`를 먼저, 이어 `tables.collector_raw`를 복구합니다. 기존 동일 ID 행은 덮어쓰지 않고 충돌을 검수하며, 현재 데이터베이스 백업을 먼저 확보합니다. 아카이브에는 삭제되지 않고 보존된 부모 세션이나 동시 수정으로 삭제가 취소된 행도 들어갈 수 있으므로 모든 행을 무조건 REPLACE하지 않습니다. 복구는 자동 cron이 수행하지 않습니다.

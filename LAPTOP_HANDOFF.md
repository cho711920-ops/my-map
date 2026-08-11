# JS부동산 노트북 작업 인수인계

## 현재 기준점

- GitHub 저장소: `https://github.com/cho711920-ops/my-map.git`
- 작업 브랜치: `codex/cloudflare-js-map`
- 인수인계 기준 커밋: `26a6521` (`Fix official building register credential flow`)
- 운영 사이트: `https://js-map.com`
- 상세 작업 기록: `CODEX_HANDOFF.md`
- 현재 PC 작업 폴더에는 미커밋 변경이 없습니다.

## 노트북에서 처음 한 번만 할 일

1. Codex 데스크톱 앱에 현재와 같은 OpenAI 계정으로 로그인합니다.
2. GitHub 계정으로 저장소에 접근할 수 있게 로그인합니다.
3. 아래 저장소를 노트북에 내려받습니다.

```powershell
git clone --branch codex/cloudflare-js-map https://github.com/cho711920-ops/my-map.git
cd my-map
```

4. Codex에서 내려받은 `my-map` 폴더를 작업공간으로 엽니다.
5. 새 Codex 작업을 만들고 아래 문장을 그대로 보냅니다.

```text
LAPTOP_HANDOFF.md와 CODEX_HANDOFF.md를 끝까지 읽고,
codex/cloudflare-js-map 브랜치와 운영 사이트 https://js-map.com 상태를 확인한 뒤
JS부동산 작업을 이어서 진행해줘. 기존 기능과 사용자 데이터를 보존하고,
변경 후 테스트·운영 검증·커밋·푸시까지 완료해줘.
```

## 개발·배포 준비

- Node.js 20 이상이 필요합니다.
- 저장소 의존성 설치:

```powershell
pnpm install
```

- Cloudflare 배포나 D1/R2 점검이 필요할 때만 노트북에서 로그인합니다.

```powershell
pnpm exec wrangler login
```

- 운영 비밀키는 Git에 저장하지 않습니다. 기존 Worker의 비밀키는 Cloudflare 원격 환경에 유지되므로 저장소를 내려받는 것만으로 노트북 파일에 노출되지 않습니다.
- `wrangler login` 후에는 현재 Cloudflare 계정의 기존 Worker/D1/R2를 사용하며 새 리소스를 만들지 않습니다.

## 중요한 구분

- 건축물대장: `DATA_GO_KR_SERVICE_KEY`
- 승강기 조회: `ELEVATOR_OPERATION_SERVICE_KEY`
- 두 값은 코드와 Cloudflare 환경에서 별도 용도로 관리합니다.
- Google Sheets와 Vercel은 현재 운영 사이트의 주 데이터·호스팅 경로가 아닙니다.

## 자동수집 관련 주의

- Edge 자동수집 확장 프로그램의 로그인 세션, 전용 프로필, 등록 지역과 Windows 예약 작업은 현재 PC의 로컬 설정입니다.
- 노트북에서 코드 작업만 이어갈 때는 자동수집 설정을 옮길 필요가 없습니다.
- 자동수집 실행 PC까지 노트북으로 바꾸려면 확장 프로그램 설치와 설정 가져오기를 별도로 진행해야 합니다. 두 PC에서 같은 시간에 자동수집을 동시에 실행하지 않습니다.

## 작업 종료 규칙

1. 관련 테스트와 `pnpm run cf:check`를 실행합니다.
2. 운영 사이트에서 실제 기능을 확인합니다.
3. `CODEX_HANDOFF.md`에 변경 사항을 기록합니다.
4. `codex/cloudflare-js-map` 브랜치에 커밋하고 GitHub에 푸시합니다.


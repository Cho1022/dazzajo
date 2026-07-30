# 4분 데모 상세 상태 전이 2차 감사

- 생성 시각: `2026-07-14T13:11:46.067659+09:00`
- 기준 commit: `45a4b1e78cdf44cca1c13cfb55636a15ecdf438b`
- Build Chat profile: `BUILD_CHAT_54_MINI_FAST`
- 추천부터 원격지원까지 실제 API 상태 전이를 실행하고 생성 데이터는 terminal 상태로 정리했다.

## 요약

- 실행 case: **100/100**
- PASS: **100**
- 확정 버그: **0**
- 의심 사례: **0**
- harness gap: **0**
- draft 원복: **100/100**

## 그룹별 결과

| 그룹 | PASS | 확정 | 의심 | harness gap |
|---|---:|---:|---:|---:|
| DEMO_REQUIREMENT_RECOMMEND | 20 | 0 | 0 | 0 |
| DEMO_GPU_DOWNGRADE_RESTORE | 20 | 0 | 0 | 0 |
| DEMO_ASSEMBLY_MATCH | 20 | 0 | 0 | 0 |
| DEMO_DIAGNOSIS_CONSENT | 20 | 0 | 0 | 0 |
| DEMO_REMOTE_SUPPORT | 20 | 0 | 0 | 0 |

## 실패 사례

| case | 그룹 | 판정 | 반복 위반 |
|---|---|---|---|

## 지연 진단

- 평균: **0.150초**
- p95: **0.048초**
- 최대: **4.989초**

지연은 진단 자료로만 기록했으며 timeout 또는 5xx가 아닌 경우 기능 실패로 계산하지 않았다.

## 원본 증거

전체 상태 전이 응답과 2회 재현 기록은 [`v1-rfq-baseline`의 JSON 원본](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/demo-journey-stateful-audit-20260714-phase2.json)에 있다.
브라우저 대표 재현 20개는 `.qa-results/stateful/demo-journey-stateful-web-replay.json`에 생성했다.

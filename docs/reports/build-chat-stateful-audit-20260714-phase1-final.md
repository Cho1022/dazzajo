# Build Chat 상세 상태 전이 1차 감사

- 생성 시각: `2026-07-14T13:02:42.201737+09:00`
- 기준 commit: `45a4b1e78cdf44cca1c13cfb55636a15ecdf438b`
- 모델 profile: `BUILD_CHAT_54_MINI_FAST`
- 지연 시간은 진단 자료이며 timeout/5xx 외에는 기능 실패로 판정하지 않았다.

## 요약

- 실행 case: **100/100**
- 실행 turn: **300**
- PASS: **100**
- 확정 버그: **0**
- 독립 원인: **0**
- 의심 사례: **0**
- harness gap: **0**
- 인프라 징후: **0**
- draft 원복 확인: **100/100**

## 그룹별 결과

| 그룹 | PASS | 확정 버그 | 의심 | harness gap | 인프라 |
|---|---:|---:|---:|---:|---:|
| COMPATIBILITY_BACKFILL | 14 | 0 | 0 | 0 | 0 |
| CURRENT_PART_QUANTITY | 12 | 0 | 0 | 0 | 0 |
| CLARIFICATION_CONTEXT | 12 | 0 | 0 | 0 | 0 |
| EXACT_ALIAS_AMBIGUITY | 10 | 0 | 0 | 0 | 0 |
| DIRECTION_IMPROVEMENT | 12 | 0 | 0 | 0 | 0 |
| BUDGET_HARD_COUNTER | 12 | 0 | 0 | 0 | 0 |
| SIMULATION_EXPLANATION | 10 | 0 | 0 | 0 | 0 |
| CACHE_CONTEXT_ISOLATION | 8 | 0 | 0 | 0 | 0 |
| EXHAUSTION_PARTIAL_SATURATION | 6 | 0 | 0 | 0 | 0 |
| ROBUSTNESS_AS_HANDOFF | 4 | 0 | 0 | 0 | 0 |

## 확정 버그

확정 버그가 발견되지 않았다.

## 의심·환경 사례

| case | 판정 | 사유 |
|---|---|---|

## 지연 진단

- 평균: **2.264초**
- p95: **6.692초**
- 최대: **8.928초**

## 원본 증거

전체 request/response, draft 전후 fingerprint, Tool 결과, 2회 재현 기록은 [`v1-rfq-baseline`의 JSON 원본](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/build-chat-stateful-audit-20260714-phase1-final.json)에 있다.
웹 재현 20개 입력은 `.qa-results/stateful/build-chat-stateful-web-replay.json`에 생성했다.

# Build Chat 상세 상태 전이 1차 감사

- 생성 시각: `2026-07-14T12:27:24.283013+09:00`
- 기준 commit: `45a4b1e78cdf44cca1c13cfb55636a15ecdf438b`
- 모델 profile: `BUILD_CHAT_54_MINI_FAST`
- 지연 시간은 진단 자료이며 timeout/5xx 외에는 기능 실패로 판정하지 않았다.

## 요약

- 실행 case: **100/100**
- 실행 turn: **300**
- PASS: **75**
- 확정 버그: **24**
- 독립 원인: **4**
- 의심 사례: **1**
- harness gap: **0**
- 인프라 징후: **0**
- draft 원복 확인: **100/100**

## 그룹별 결과

| 그룹 | PASS | 확정 버그 | 의심 | harness gap | 인프라 |
|---|---:|---:|---:|---:|---:|
| COMPATIBILITY_BACKFILL | 0 | 14 | 0 | 0 | 0 |
| CURRENT_PART_QUANTITY | 12 | 0 | 0 | 0 | 0 |
| CLARIFICATION_CONTEXT | 12 | 0 | 0 | 0 | 0 |
| EXACT_ALIAS_AMBIGUITY | 10 | 0 | 0 | 0 | 0 |
| DIRECTION_IMPROVEMENT | 4 | 7 | 1 | 0 | 0 |
| BUDGET_HARD_COUNTER | 9 | 3 | 0 | 0 | 0 |
| SIMULATION_EXPLANATION | 10 | 0 | 0 | 0 | 0 |
| CACHE_CONTEXT_ISOLATION | 8 | 0 | 0 | 0 | 0 |
| EXHAUSTION_PARTIAL_SATURATION | 6 | 0 | 0 | 0 | 0 |
| ROBUSTNESS_AS_HANDOFF | 4 | 0 | 0 | 0 | 0 |

## 독립 원인 트리아지

| ID | 독립 원인 | 연결 사례 수 | 판단 근거 |
|---|---|---:|---|
| BG-STATE-01 | 관계 문장에서 기준 부품을 추천 대상으로 뒤집음 | 4 | `현재 보드에 맞는 CPU`, `현재 케이스에 들어가는 메인보드`가 기준 부품 추천으로 역전됨 |
| BG-STATE-02 | 직전 후보 카테고리와 AS 증상 문맥이 후속 턴에서 소실됨 | 21 | `다시 선택지`, `다른 후보`, `원인과 다음 행동`이 직전 턴의 대상을 이어받지 못함 |
| BG-STATE-03 | `M.2` 저장장치 alias가 부품 추천 의도로 연결되지 않음 | 0 | `M.2 슬롯에 넣을 2테라`가 저장장치 후보 대신 전체 견적 되묻기로 전환됨 |
| BG-STATE-04 | 현재 견적 평가에서 개선 후보 요청으로 넘어가는 의도 전이가 막힘 | 2 | 호환 GPU·점수 개선 부품 요청이 평가 설명 또는 저정보 되묻기로 종료됨 |
| BG-STATE-05 | deterministic 예산 snapshot의 Tool FAIL 카드가 최종 서빙 게이트를 통과함 | 3 | 같은 200만원 QHD 의도의 숫자 표현 3종에서 동일 FAIL 조합이 노출됨 |

## 확정 버그

| case | 그룹 | 재현된 위반 | 시작 상태 |
|---|---|---|---|
| state-compat-01-b860-cpu-top3 | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | B860_COMPLETE |
| state-compat-02-am5-cpu-top3 | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | AM5_COMPLETE |
| state-compat-03-b860-reject-am5 | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH | B860_COMPLETE |
| state-compat-04-am5-board-top3 | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | AM5_COMPLETE |
| state-compat-05-gpu-backfill | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | COMPLETE_VERIFIED |
| state-compat-06-case-backfill | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | COMPLETE_VERIFIED |
| state-compat-07-cooler-backfill | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | COMPLETE_VERIFIED |
| state-compat-08-psu-backfill | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | COMPLETE_VERIFIED |
| state-compat-09-ram-platform | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH | B860_COMPLETE |
| state-compat-10-storage-fit | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | COMPLETE_VERIFIED |
| state-compat-11-mb-size-fit | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH | TIGHT_CASE |
| state-compat-12-cooler-size-fit | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH | TIGHT_CASE |
| state-compat-13-warn-after-pass | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-compat-14-fail-filter-refill | COMPATIBILITY_BACKFILL | CATEGORY_MISMATCH, TOP3_NOT_BACKFILLED | COMPLETE_VERIFIED |
| state-direction-05-ram-up | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-direction-06-storage-up | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-direction-07-psu-headroom | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-direction-08-board-up | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-direction-09-case-clearance | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-direction-10-cooler-up | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-direction-12-score-chip-improves | DIRECTION_IMPROVEMENT | CATEGORY_MISMATCH | COMPLETE_VERIFIED |
| state-budget-01-target-200 | BUDGET_HARD_COUNTER | GRAPH_FAIL_RECOMMENDED | EMPTY |
| state-budget-10-numeric-comma | BUDGET_HARD_COUNTER | GRAPH_FAIL_RECOMMENDED | EMPTY |
| state-budget-11-korean-number | BUDGET_HARD_COUNTER | GRAPH_FAIL_RECOMMENDED | EMPTY |

## 의심·환경 사례

| case | 판정 | 사유 |
|---|---|---|
| state-direction-01-gpu-up | SUSPECTED | CATEGORY_MISMATCH |

## 지연 진단

- 평균: **2.371초**
- p95: **6.282초**
- 최대: **18.672초**

## 원본 증거

전체 request/response, draft 전후 fingerprint, Tool 결과, 2회 재현 기록은 [`v1-rfq-baseline`의 JSON 원본](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/build-chat-stateful-audit-20260714-phase1.json)에 있다.
웹 재현 20개 입력은 `.qa-results/stateful/build-chat-stateful-web-replay.json`에 생성했다.

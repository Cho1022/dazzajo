# Build Chat 상세 상태 전이 1차 감사

- 생성 시각: `2026-07-14T22:49:06.812530+09:00`
- 기준 commit: `c8e5aeba3ad61a5d0e905e8751a67724260807c6`
- 모델 profile: `BUILD_CHAT_54_MINI_FAST`
- 지연 시간은 진단 자료이며 timeout/5xx 외에는 기능 실패로 판정하지 않았다.

## 요약

- 실행 case: **1/100**
- 실행 turn: **3**
- PASS: **1**
- 확정 버그: **0**
- 독립 원인: **0**
- 의심 사례: **0**
- harness gap: **0**
- 인프라 징후: **0**
- draft 원복 확인: **1/1**

## 그룹별 결과

| 그룹 | PASS | 확정 버그 | 의심 | harness gap | 인프라 |
|---|---:|---:|---:|---:|---:|
| CLARIFICATION_CONTEXT | 1 | 0 | 0 | 0 | 0 |

## 확정 버그

확정 버그가 발견되지 않았다.

## 의심·환경 사례

| case | 판정 | 사유 |
|---|---|---|

## 지연 진단

- 평균: **0.872초**
- p95: **2.579초**
- 최대: **2.579초**

## 원본 증거

전체 request/response, draft 전후 fingerprint, Tool 결과, 2회 재현 기록은 [`v1-rfq-baseline`의 JSON 원본](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/build-chat-stateful-audit-20260714-core-recipient-flow.json)에 있다.
웹 재현 입력은 `.qa-results/stateful-core-recipient/build-chat-stateful-web-replay.json`에 생성했다.

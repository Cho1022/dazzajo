# 홈쇼핑 사용자 흐름 전수 검사 보고서 - 2026-07-03

## 검사 범위

- 대상 브랜치: `codex/build-chat-cache-rag-quality`
- 검사 전 기준 main: `upstream/main` `b117f17`
- 검사 대상 사용자 화면:
  - `/`
  - `/self-quote`
  - `/parts/:id`
  - `/checkout`
  - `/checkout/complete`
  - 로그인 리다이렉트
  - 홈/셀프 견적 AI 챗봇 action
- 관리자 화면은 이번 검사 범위에서 제외했다. 단, 관리자 seed/API 변경이 사용자 쇼핑 흐름을 깨는 경우는 원인 분석 대상에 포함했다.

## 증거 자료

스크린샷 보존 위치:

[`v1-rfq-baseline`의 원본 감사 디렉터리](https://github.com/Cho1022/dazzajo/tree/v1-rfq-baseline/docs/reports/home-shopping-audit-20260703)

아래 파일명은 보존 태그의 `screenshots/`에 있는 주요 캡처다.

- `01-home-after-login-viewport.png`: 로그인 후 홈 화면
- `02-fast-route-gpu.png`: 자연어로 GPU 카테고리 이동
- `04-home-ai-5090-result.png`: RTX 5090 요청에 대한 홈 AI 추천 결과
- `05-self-quote-after-ai-apply.png`: AI 추천 견적을 셀프 견적에 적용한 뒤 합계 확인
- `06-exact-cpu-detail-route.png`: 정확한 CPU 상품명 자연어 상세 이동
- `07-detail-after-add.png`: 상품 상세 페이지에서 견적 담기 성공
- `09-checkout.png`: 현재 견적 기반 체크아웃 화면
- `10-checkout-complete.png`: 체크아웃 완료 화면
- `11-chat-cpu-better.png` ~ `18-chat-cooler-better.png`: 수정 전 카테고리별 챗봇 검증 매트릭스
- `19-recheck-cpu-better-no-downgrade.png`: CPU rank 수정 후 역방향 추천 방지 재검증
- `20-recheck-gpu-cheaper-single-action.png`: GPU 하향 요청 action 단일화 재검증
- `21-fresh-self-quote-after-fixes.png`: 수정 후 새로 진입한 셀프 견적 화면

브라우저 원본 증거도 위 보존 태그에 있다.

- `self-quote-chat-matrix.json`
- `recheck-chat-results.json`

Figma 보드 처리:

- 대상 파일 key: `bu2jnMDo64u6pebmRGgqps`
- Figma API 업로드 결과: 편집 권한 오류로 실패
- 오류 메시지: `You do not have permission to edit this file`
- Debug UUID: `7170f719-7323-4723-8d38-421d3e31afbe`
- 우회 산출물:
  - 보존 태그의 `figma-board/home-shopping-audit-board.png`
  - 해당 이미지는 Figma에 수동 드래그 앤 드롭할 수 있는 단일 보드형 이미지다.

## 시나리오 검사 결과

| 영역 | 시나리오 | 결과 |
| --- | --- | --- |
| 로그인 | `/login`에서 `user@example.com` 로그인 | 통과 |
| 홈 | 로그인 후 추천상품 탭과 AI 챗봇 렌더링 | 통과 |
| 빠른 화면 이동 | `GPU 보여줘` | 통과. LLM 호출 없이 `/self-quote?category=GPU`로 이동했다. |
| 홈 AI 추천 | `5090 글카가 들어간 PC 추천해줘` | 통과. RTX 5090 포함 추천 견적 3개가 반환됐다. |
| AI 견적 적용 | 첫 번째 AI 추천 견적을 quote draft에 적용 | 통과. 홈 추천 총액과 셀프 견적 총액이 `10,716,940원`으로 일치했다. |
| 정확 상품 상세 이동 | `AMD 라이젠9-6세대 9950X3D 그래니트 릿지 정품(멀티팩) 상세페이지로 이동해` | 통과. 비슷한 이름의 `9950X3D2`가 아니라 정확한 `9950X3D` 상세 페이지로 이동했다. |
| 상품 상세 | 현재 상품을 견적에 담기 | 통과. 서버 견적초안에 저장됐다. |
| 체크아웃 | 현재 견적 -> 체크아웃 -> 완료 | 통과. 캡처 기준 체크아웃과 완료 화면 총액이 `10,122,330원`으로 일치했다. |
| Tool FAIL 방어 | 의도적으로 일부 부품만 있는 draft에서 전력/규격 경고 표시 | 표시 흐름 통과. FAIL/WARN 관계도 상태를 무시하고 무조건 적용하는 동작은 발견되지 않았다. |

## 발견 및 수정한 문제

### P1 - 같은 카테고리 draft action이 여러 개 자동 실행됨

문제:

- `그래픽카드 더 싼데 성능 너무 떨어지지 않게` 같은 요청에서 AI가 GPU 교체 action을 여러 개 반환할 수 있었다.
- 프론트는 같은 GPU 카테고리 action들을 순차적으로 자동 실행하려고 했다.
- 사용자 입장에서는 한 번의 요청으로 장바구니가 여러 번 바뀌는 것처럼 보일 수 있다.

수정:

- 백엔드 `BuildChatService`가 draft 변경용 교체 action을 1개만 반환하도록 제한했다.
- 프론트 `AiBuildAssistant`가 자동 실행 가능한 draft action을 카테고리 기준으로 중복 제거한 뒤 실행하도록 보정했다.

회귀 방지:

- 기존 홈/셀프 견적 Playwright 테스트 통과
- Build Chat 관련 백엔드 테스트 통과

### P1 - “더 좋은 CPU” 요청에서 X3D가 비-X3D로 내려갈 수 있음

문제:

- 현재 CPU가 `9950X3D`일 때 사용자가 “CPU 더 좋은 걸로”라고 요청하면, 비-X3D 같은 등급 CPU가 fallback 후보로 잡힐 수 있었다.
- 기존 rank 계산은 TDP를 양수 점수로 반영했고, 같은 큰 등급 버킷 안에서는 실질적으로 낮은 후보도 fallback으로 허용했다.
- 게임/고성능 사용자 맥락에서는 `9950X3D`에서 `9950X`로 가는 것이 “상향”이라고 보기 어렵다.

수정:

- `PartReplacementRanker`에서 CPU TDP를 양수 rank 신호로 쓰지 않도록 제거했다.
- CPU 모델명과 `X3D` 여부를 rank 신호로 반영했다.
- `MORE_EXPENSIVE` fallback이 현재 rank보다 낮은 후보로 떨어지지 않도록 차단했다.

회귀 방지:

- `betterCpuDoesNotDowngradeX3dToNonX3dSameTierFallback` 테스트를 추가했다.

### P2 - ReactFlow 관계도 MiniMap 중복 key 경고

문제:

- 관계도에 `part-STORAGE`처럼 같은 원본 노드 id가 반복되면 React duplicate key 경고가 발생했다.
- 특히 ReactFlow `MiniMap` 내부에서 중복 원본 id를 다시 key로 사용하면서 콘솔 오류처럼 보였다.

수정:

- 관계도 node id를 ReactFlow 렌더링용 고유 id로 정규화했다.
- 클릭/선택 동작은 기존 원본 id를 보존해 동작하도록 유지했다.
- 중복 key 경고를 계속 발생시키는 보조 `MiniMap`은 제거했다.
- 메인 관계도, 확대/축소 컨트롤, 노드 클릭, 엣지 클릭, 후보 패널은 유지했다.

회귀 방지:

- Docker web 재빌드 후 새 번들이 정상 서빙되는 것을 확인했다.
- 수정 후 새 `/self-quote` 브라우저 확인:
  - `recentErrorCount=0`
  - `duplicateKeyWarnings=0`
  - `miniMapWarnings=0`

## 남은 참고 사항

- 이번 브라우저 전수 검사에서는 blank 화면, fatal runtime crash, 체크아웃 총액 불일치, 정확 상품명 상세 이동 실패는 발견되지 않았다.
- CPU/GPU만 있는 의도적 부분 draft에서는 일부 챗봇 응답이 “후보 부족” 형태로 나올 수 있었다. 기능 오류는 아니지만, 이후 품질 개선에서는 부족한 draft context를 질문하거나 전체 견적 context를 더 잘 추론하도록 보강할 수 있다.
- 빠른 화면 이동은 intent 판정 자체는 즉시 처리되지만, 페이지 준비에는 데이터 로딩 시간이 포함된다. 캡처 기준 사용자 체감은 정상 범위였으나 완전한 1초 미만은 아니다.

## 검증 로그

- `.\gradlew.bat test --tests "com.buildgraph.prototype.agent.PartReplacementRankerTest" --tests "com.buildgraph.prototype.build.BuildChatServiceTest" --no-daemon`: 통과
- `npm --prefix apps/web run test -- tests/home.spec.ts tests/self-quote.spec.ts`: 통과
- `python tools/validate_openapi.py docs/openapi.yaml`: 통과, 85 paths
- `npm --prefix apps/web run test`: 통과, 107 tests
- `npm --prefix apps/web run build`: 통과
- `.\gradlew.bat test --no-daemon`: 통과
- `.\gradlew.bat bootJar --no-daemon`: 통과
- `docker compose up --build -d api web`: 통과
- `GET http://localhost:8080/api/health`: `{"database":"UP","status":"UP"}`
- 재빌드 후 브라우저 smoke:
  - fresh `/self-quote` console error 0건
  - duplicate key warning 0건

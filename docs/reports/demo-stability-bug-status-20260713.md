# BuildGraph 데모 안정화 버그 현황

## 1. 기준과 상태

- 최초 작성일: 2026-07-13 KST
- 최종 갱신일: 2026-07-14 KST
- 원격 기준: `upstream/main=45a4b1e` (`fix: harden demo stateful user journeys (#163)`)
- 병합 PR: [#163](https://github.com/jungle-final-project/prototype/pull/163)
- 현재 후속 수정 브랜치: `codex/stateful-qa-fixes`
- PR #163까지의 코드와 회귀 테스트는 main에 병합됐다. 상세 상태 전이 감사에서 발견한 10개 독립 원인과 재검증 중 추가로 확인한 5개 경계 사례는 현재 브랜치에서 수정·검증했다.
- 이 문서는 과거 전체 PR의 수정 건수를 합산한 문서가 아니다. 최신 main 이후 확인한 데모 시나리오 버그와 현재 로컬 수정 상태를 기록한다.
- 아래 자동 검증 수치는 PR #163 병합 검증과 현재 후속 수정 브랜치의 3단계 재검증 결과를 구분해 기록한다.

상태 정의:

- `MERGED`: 코드와 회귀 테스트가 PR #163을 통해 main에 병합됨
- `RESOLVED`: 과거 OPEN 이력으로 추적하던 항목이 main 코드와 회귀 테스트에서 해결됨
- `MAIN_GUARANTEE`: 최신 main에 이미 들어가 있어 현재 작업 성과로 중복 계산하지 않음
- `LOCAL_FIXED`: 현재 브랜치에서 수정하고 관련 자동 테스트를 통과했지만 아직 PR로 병합하지 않음
- `VERIFIED`: 수정 후 해당 단계 전체 상태형 재검증까지 통과함
- `OPEN`: 재현됐지만 아직 수정하지 않음
- `IMPROVED`: 원인 일부와 품질 오류는 수정했지만 외부 변동을 포함한 최종 목표는 아직 충족하지 못함
- `VERIFY`: 일부 계층은 수정했으나 실제 앱 또는 전체 사용자 흐름 재검증이 필요함

현황 요약:

| 구분 | 수 | 의미 |
|---|---:|---|
| main 병합 독립 원인 | 26 | 같은 원인에서 파생된 화면/API 사례는 중복 계산하지 않음 |
| main 병합 신규 연결 기능 | 3 | 쇼핑몰 AI와 PC Agent 연결 계층 |
| 기존 main 보장 | 5 | 이번 작업 성과로 중복 계산하지 않음 |
| 해결 이력 | 2 | 과거 OPEN이었으나 현재 해결됨 |
| 기존 부분 개선 OPEN | 1 | `BG-OPEN-05`; 냉간 LLM 5초 보장은 미완 |
| 기존 OPEN 중 후속 수정 | 6 | `BG-OPEN-02`, `BG-OPEN-06`~`10`; 현재 브랜치에서 수정하고 관련 회귀 테스트 통과 |
| 기존 추가 검증 VERIFY | 2 | 실제 Agent 또는 전체 사용자 흐름 검증 필요 |
| 기존 문서화 사례 | 60 | 상세 예시 48개 + 추가 발견 사례 12개이며 독립 버그 수가 아님 |
| 상태형 감사 독립 원인 | 10 | 3단계 감사 안에서 중복 제거한 수이며 기존 항목과 단순 합산하지 않음 |
| 상태형 감사 확정 사례 | 86 | API 200건과 브라우저 140건에서 확인한 사례 수, 독립 버그 수가 아님 |
| 상태형 확정 사례 해결 | 86/86 | 동일 corpus 재실행 결과 확정 사례 전부 수정·재검증 완료 |
| 상태형 확정 사례 미해결 | 0/86 | 이번 상태형 감사의 확정 사례 기준 미해결 없음 |
| 상태형 감사 의심 사례 | 0 | 1회성 LLM 변동 또는 미확정 오라클로 남긴 사례 없음 |
| 후속 수정 완료 독립 원인 | 10 | `BG-STATE-01`~`10`, 수정 후 3단계 전체 재검증 통과 |
| 재검증 중 추가 보강 사례 | 5 | 기존 3건 + 복합 하드 조건 LLM 경량 경로 + 카테고리 간 숫자 조건 격리 |
| 수정 후 최종 검증 | 340 | API 200건 + 대표 웹 40건 + 사용자 화면 100건, 모두 PASS |

### 숫자 해석 기준

- **전체 버그가 10개라는 뜻이 아니다.** `10개`는 이번 3단계 상태형 감사에서 86개 재현 사례를 원인별로 묶은 `BG-STATE-01~10`만 가리킨다.
- main에는 그 이전에 정리한 독립 원인 `BG-LOCAL-01~26`이 이미 병합돼 있다.
- `BG-OPEN-*`은 기존 위험 추적표다. `BG-LOCAL-*` 또는 `BG-STATE-*`와 일부 원인이 겹치므로 26 + 10 + 11처럼 단순 합산하지 않는다.
- **해결 완료로 확정할 수 있는 범위**는 main에 병합된 `BG-LOCAL-01~26`과 상태형 전체 재검증을 통과한 `BG-STATE-01~10`이다.
- **아직 전체 종결은 아니다.** `BG-OPEN-05`는 고정 비용과 품질 오류를 수정했지만 냉간 LLM 요청 5초 보장은 남아 있으며, `BG-OPEN-04`, `BG-OPEN-11` 2건은 실제 PC Agent/전체 E2E 검증이 필요하다. `BG-OPEN-02`, `BG-OPEN-06~10` 6건은 로컬 수정·테스트는 끝났지만 아직 main에 병합되지 않았다.
- `기존 문서화 사례 60개`, `상태형 감사 확정 사례 86개`, `최종 검증 340건`은 테스트 입력·재현·검증 row 수다. 독립 버그 수로 세지 않는다.

따라서 현재 상태를 한 문장으로 표현하면 **“이번 상태형 감사의 독립 원인 10개는 모두 수정·재검증했지만, 전체 추적 항목에는 부분 개선 중인 성능 항목 1건, 실제 환경 VERIFY 2건, 미병합 LOCAL_FIXED 6건이 남아 있다”**가 정확하다.

### 독립 원인 발견 순서와 해결 수

| 발견 시점 | ID 범위 | 독립 원인 | 해결 상태 | 비고 |
|---|---|---:|---:|---|
| 1·2·3차 감사 전 최초 데모 안정화 | `BG-LOCAL-01~16` | 16 | **16/16** | 사용자가 기억한 최초 독립 버그 묶음. PR #163으로 main 병합 완료 |
| 1·2·3차 감사 전 후속 상세 점검 | `BG-LOCAL-17~26` | 10 | **10/10** | 관리자 감사 로그, 호환 후보, alias, 후속 문맥 등 추가 발견. PR #163으로 main 병합 완료 |
| **상태형 감사 시작 전 합계** | `BG-LOCAL-01~26` | **26** | **26/26** | 최초 16개가 없어진 것이 아니라 후속 10개와 합쳐져 26개로 표시됨 |
| 1·2·3차 상태형 감사 | `BG-STATE-01~10` | 10 | **10/10** | 확정 사례 86건을 중복 원인별로 묶은 수. 현재 브랜치에서 수정·전체 재검증 완료 |

`BG-OPEN-*`은 위 발견 순서와 별개로 남은 위험을 추적하는 상태표이며 일부 원인이 `BG-LOCAL-*`·`BG-STATE-*`와 겹친다. 따라서 독립 원인 총계에 다시 더하지 않는다.

### 확정 사례 해결 현황

| 감사 단계 | 최초 확정 사례 | 해결·재검증 | 미해결 | 판정 근거 |
|---|---:|---:|---:|---|
| 1차 Build Chat 상태형 API | 26 | 26 | 0 | 동일 100개 corpus, 300턴 재실행 결과 100/100 PASS |
| 2차 4분 데모 API | 35 | 35 | 0 | 동일 100개 데모 체인 재실행 결과 100/100 PASS |
| 3차 사용자 화면 Chromium | 25 | 25 | 0 | 동일 100개 사용자 화면 시나리오 strict 재실행 결과 100/100 PASS |
| **합계** | **86** | **86** | **0** | 확정 사례 삭제나 오라클 완화 없이 제품 코드 수정 후 재실행 |

대표 웹에서 별도로 재현한 12건은 위 API 확정 사례를 브라우저에서 다시 확인한 중복 증거라 86건에 더하지 않았다. 해당 대표 웹 체인도 수정 후 `1차 20/20`, `2차 20/20`으로 통과했다. 재검증 중 새로 확인한 경계 사례 5건도 모두 보강·검증했지만, 최초 확정 사례 86건에는 소급 합산하지 않는다.

`BG-LOCAL-*` ID는 추적 연속성을 위해 유지하지만 현재 상태는 모두 `MERGED`다.

## 2. main에 병합된 독립 이슈

| ID | 우선순위 | 상태 | 문제 | 수정 내용 |
|---|---|---|---|---|
| BG-LOCAL-01 | P1 | MERGED | QHD 게임용 완성 견적이 GPU 후보 구성 실패 후 GPU 없는 조합으로 내려갈 수 있음 | GPU가 필요한 고예산 게임 견적에서 no-GPU fallback을 금지하고 GPU 포함 조합만 반환 |
| BG-LOCAL-02 | P1 | MERGED | `GPU를 한 단계 낮은 저렴한 제품으로` 요청이 동급 GPU를 선택할 수 있음 | 명확한 방향 교체는 ranker fast path로 처리하고 GPU 하향 요청은 실제 하위 tier만 허용 |
| BG-LOCAL-03 | P1 | MERGED | 2-DIMM RAM 키트를 수량 2로 담아 4개 모듈과 가격 2배로 계산함 | 상품의 `moduleCount`를 읽어 목표 모듈 수를 retail package 수량으로 변환 |
| BG-LOCAL-04 | P1 | MERGED | 기존 RAM 슬롯 초과나 PSU 크기 실패가 무관한 CPU/GPU 후보까지 FAIL로 오염시킴 | 전체 Tool 결과를 후보 카테고리와 직접 관련된 compatibility/size 항목으로 투영 |
| BG-LOCAL-05 | P1 | MERGED | RAM·SSD 수량을 1에서 0으로 내릴 수 없어 잘못 담은 마지막 상품을 제거하지 못함 | 수량 0 요청을 DELETE로 연결하고 마지막 RAM 객체까지 제거 허용 |
| BG-LOCAL-06 | P1 | MERGED | 조립 요청에서 수령인·전화·배송 주소를 모두 필수로 요구해 데모 흐름을 막음 | 지역·희망일·AS 동의만 필수로 두고 연락처·주소는 선택 입력, 기본 지역·일정 제공 |
| BG-LOCAL-07 | P1 | MERGED | 외부 기사가 입찰해도 사용자가 내 견적함과 진행 중 의뢰에서 제안을 찾거나 선택하기 어려움 | available offer 수 반환, 5초 polling, 내 견적함 및 요청 상세의 제안 비교·선택 직행 동선 추가 |
| BG-LOCAL-08 | P1 | MERGED | 사용자가 올린 로그는 검증 문구만 저장되고 실제 AS RAG 분석 결과가 티켓 근거로 남지 않음 | 업로드 시 `as_rag_analysis`와 요약을 저장하고 분석 장애 시 로그 업로드 자체는 유지 |
| BG-LOCAL-09 | P1 | MERGED | 종료·취소된 티켓 또는 기존 데모 seed 상담이 신규 AS 접수를 막고 상담방을 재생성함 | 고정 seed 티켓만 archive/cancel하고 terminal ticket에는 새 상담방을 만들지 않음 |
| BG-LOCAL-10 | P1 | MERGED | 원격지원 링크 갱신 때 세션이 중복 생성되거나 티켓 종료 후 세션이 활성 상태로 남음 | 최신 active session upsert, 상담 archive 시 cancel, 티켓 resolved/closed/cancelled 시 세션 종료 |
| BG-LOCAL-11 | P2 | MERGED | 상품명의 연속 공백·괄호·특수문자 차이로 정확 상품 `견적에 담아줘` fast path가 실패함 | 서버와 요청 상품명을 동일 규칙으로 정규화해 단일 exact 자산을 찾음 |
| BG-LOCAL-12 | P2 | MERGED | AI 동작 수정 후에도 기존 exact/semantic 캐시가 과거 응답을 재생할 수 있음 | 상태형 추천·후속 답변 파서·가성비 정렬 정책까지 반영해 exact cache `v48`, intent router cache `v23`으로 namespace 갱신 |
| BG-LOCAL-13 | P2 | MERGED | 배치도에서 hover한 부품 객체가 인접 레이어 아래로 가려짐 | hover hitbox의 z-index를 올려 선택 객체를 전면 표시 |
| BG-LOCAL-14 | P2 | MERGED | 기사에게 공개된 선택 입력 연락처·주소가 빈 값일 때 화면 문구가 깨질 수 있음 | 빈 연락처·주소는 `미입력`으로 표시 |
| BG-LOCAL-15 | P2 | MERGED | 관리자 원격지원 처리 후 사용자 티켓 화면이 자동으로 갱신되지 않음 | 사용자 티켓 상세에 5초 polling 적용 |
| BG-LOCAL-16 | P2 | MERGED | 체크리스트에서 상품 하나를 고르면 카테고리 목록이 닫히고 다음 슬롯으로 강제 이동함 | 선택한 카테고리 아코디언과 URL을 유지해 `9600X → 285K`처럼 연속 교체 가능 |
| BG-LOCAL-17 | P2 | MERGED | 관리자 티켓 감사 로그 INSERT에서 PostgreSQL 파라미터 타입 추론이 실패할 수 있음 | nullable audit 필드를 명시적으로 `text` cast |
| BG-LOCAL-18 | P1 | MERGED | 현재 B860 견적에서 `CPU 추천해줘`가 AM5 전용 9950X3D·9900X3D를 TOP3와 담기 칩으로 노출함 | 엔진의 현재 견적 플랫폼 필터와 서버 활성 draft 기반 Tool 최종 게이트를 추가했다. FAIL 후보를 제거한 뒤 최대 50개 후보 안에서 통과 후보 3개를 채우며, 3개가 모이면 즉시 검사를 중단한다. |
| BG-LOCAL-19 | P1 | MERGED | `FRAME 4000D` 같은 상품명을 RAM으로 잘못 감지해 정확 상품 담기 흐름이 깨질 수 있음 | 카테고리 alias를 단어 경계 기준으로 판정해 상품명 내부 문자열 오탐을 차단 |
| BG-LOCAL-20 | P1 | MERGED | RAM·SSD를 실제로 담은 다음 같은 추천을 하면 방금 담은 상품이 TOP3에 다시 나옴 | ADD 카테고리도 현재 선택 exact part를 후보에서 제외하고 뒤의 Tool 통과 후보로 보충 |
| BG-LOCAL-21 | P1 | MERGED | `램 하나 넣어줘`처럼 상품이 불명확한 요청이 임의의 고가 RAM을 바로 선택함 | 상품·스펙·예산·방향이 없으면 제품을 고르지 않고 용량/가격/성능 기준 칩을 제시 |
| BG-LOCAL-22 | P1 | MERGED | 되묻기에 `32GB`라고 답하면 `추천해줘 32GB`를 상품명으로 오인하고 후보 없음으로 종료함 | 짧은 답은 카테고리 문맥과 합성하되 추천 동사·가격 수식어를 모델 토큰에서 제거하고, 완전한 후속 명령은 원문 중복 합성을 생략 |
| BG-LOCAL-23 | P1 | MERGED | 추천 상품 칩을 누른 뒤 빈 견적에서는 미리보기가 생성되지 않거나 exact 상품이 다시 LLM 경로로 흐름 | exact ACTIVE 상품은 빈 견적 ADD, 단일 슬롯 REPLACE, 같은 RAM/SSD 수량 증가 의미로 결정적 미리보기 생성 |
| BG-LOCAL-24 | P1 | MERGED | `장착 여유 큰 케이스` 요청이 현재와 같은 수치의 파생 상품이나 더 작은 케이스를 추천함 | GPU·쿨러·파워의 알려진 여유가 모두 비퇴행이고 하나 이상 실제 증가하는 후보만 허용 |
| BG-LOCAL-25 | P1 | MERGED | 서버가 만든 `가성비` 칩이 CPU 9950X3D, GPU RTX 5090, 1500W 파워부터 추천하고 4~9초가 걸림 | 객관적 가격 대비 지표로 정렬하고 단순 가성비/최저가/고성능 요청을 결정적 fast path로 처리; 실제 API 8개 12~22ms |
| BG-LOCAL-26 | P1 | MERGED | 셀프견적에서 변경 동사가 없는 추천·후속 질문은 최신 draft가 빠져 과거 추천 카드 또는 캐시 문맥과 충돌할 수 있음 | `/self-quote`의 모든 챗 요청과 clarification 후속에 최신 `currentQuoteDraft`를 첨부하고 홈의 문맥 없는 전체 추천만 shared cache 유지 |

## 3. main에 병합된 신규 연결 기능

| ID | 상태 | 내용 | 경계 |
|---|---|---|---|
| BG-FEATURE-01 | MERGED | 쇼핑몰 챗봇에서 멈춤·검은 화면·재부팅·부팅 실패·과열·저장장치·네트워크·오디오 증상을 접수 전 안내로 인식 | 증상 기반 일반 가능성은 안내하되 위험도·확정 원인·로그 근거는 만들지 않음 |
| BG-FEATURE-02 | MERGED | 챗봇 결과 카드에서 PC Agent 다운로드와 `/support/new` AS 접수 제공 | 실제 로그 기반 진단은 별도 PC Agent AI가 담당 |
| BG-FEATURE-03 | MERGED | AS 화면과 쇼핑몰 챗봇이 동일한 Agent ZIP 생성·activation token·SHA-256 검증 경로 사용 | 다운로드 코드 중복 제거 |

## 4. 최신 main에서 이미 보장되는 항목

다음은 현재 로컬 수정 건수로 중복 계산하지 않는다.

| ID | 상태 | 보장 내용 |
|---|---|---|
| BG-MAIN-01 | MAIN_GUARANTEE | TARGET 예산 요청은 모든 카드가 예산 ±12.5% 범위여야 함 |
| BG-MAIN-02 | MAIN_GUARANTEE | 밴드 안 조합이 부족하면 추천 카드는 1~3개만 반환 가능 |
| BG-MAIN-03 | MAIN_GUARANTEE | Tool FAIL 변경안은 적용 미리보기에서 hard drop |
| BG-MAIN-04 | MAIN_GUARANTEE | CPU/GPU/PSU/CASE/COOLER 같은 단일 카테고리 ADD는 기존 부품 REPLACE로 보정 |
| BG-MAIN-05 | MAIN_GUARANTEE | simulation은 읽기 전용이며 draft mutation action을 만들지 않음 |

## 5. 현재 확인된 미해결 및 추가 검증 항목

| ID | 우선순위 | 상태 | 재현 또는 위험 | 다음 조치 |
|---|---|---|---|---|
| BG-OPEN-01 | P1 | RESOLVED | 추천 카드의 `균형/고성능` 라벨과 적용 후 1000점 평가·병목 조언이 충돌함 | 가격 인덱스 relabel 제거, 공통 1000점 평가 snapshot으로 tier·label·badge 생성 |
| BG-OPEN-02 | P1 | LOCAL_FIXED | 점수 조언의 `상위 GPU 추천` 칩이 동급 GPU를 추천해 점수·FPS가 개선되지 않을 수 있음 | 점수 개선·상향 표현을 대상 카테고리 추천으로 유지하고 현재 대비 실질 개선 후보만 허용하도록 보강; 상태형 전체 재검증 통과 |
| BG-OPEN-03 | P1 | RESOLVED | 과거 변경 미리보기 `currentBuilds`가 최신 활성 draft보다 강한 문맥으로 사용될 수 있음 | 셀프견적의 모든 챗 요청과 clarification 후속에 최신 `currentQuoteDraft`를 첨부하고 Playwright로 고정 |
| BG-OPEN-04 | P1 | VERIFY | AS 분석 저장은 보강했지만 Display 4101/nvlddmkm 같은 근거가 발표용 한글 evidence row로 끝까지 보이는지 미확정 | 실제 Agent fixture 업로드부터 사용자·관리자 UI까지 재검증 |
| BG-OPEN-05 | P1 | IMPROVED | 복합 하드 조건 요청은 기존 broad LLM schema와 semantic miss를 함께 거쳐 약 7.4~8.9초가 걸렸고, CPU 숫자가 GPU 조건으로 번지거나 SSD 용량이 RAM 조건으로 번져 카드 0개가 될 수 있었음 | deterministic 답변으로 우회하지 않고 동일 `gpt-5.4-mini`의 견적 요구사항 전용 schema를 사용. 명시 하드 조건은 semantic lookup을 생략하고 카테고리별 조건을 격리했으며 후보 풀은 요청당 1회 조회. 최종 냉간 5건은 모두 3개 카드·하드 조건 보존, 평균 3.628초이나 1건 7.050초로 5초 보장은 미완; 동일 exact 요청은 14ms |
| BG-OPEN-06 | P2 | LOCAL_FIXED | build 1개를 반환하면서 `추천 조합 3개`라고 말할 수 있음 | fast/LLM 응답을 실제 `builds.size()`와 동기화하고 견적 결과 화면 제목도 실제 카드 수로 표시; 캐시 namespace 갱신 |
| BG-OPEN-07 | P2 | LOCAL_FIXED | 불가능 예산 역제안의 최소 구성 금액과 실제 표시 카드 금액이 다를 수 있음 | 최소 구성가 미달 시 밴드 밖 카드를 만들지 않고 DB 최소가·부족액·다음 예산 칩만 반환하도록 고정 |
| BG-OPEN-08 | P2 | LOCAL_FIXED | 역제안 문구에 `원을(를)` 같은 부자연스러운 조사 또는 드문 외국어 토큰이 섞일 수 있음 | 조사가 필요 없는 `현재 예산에서 약 n원 부족합니다` 템플릿으로 고정 |
| BG-OPEN-09 | P2 | LOCAL_FIXED | 일반 사용자 화면에서 기사 프로필 없음이 예상된 404 console error로 누적됨 | 미신청 상태를 `204 No Content` 정상 응답으로 변경하고 프론트에서 nullable profile로 처리 |
| BG-OPEN-10 | P2 | LOCAL_FIXED | 홈 정적 추천이 카테고리별 `price_desc` 결과를 같은 인덱스로 묶어 1천만~2천만원 조합과 Tool `FAIL` 조합을 노출함 | 클라이언트 조합 생성을 제거하고 Build Chat의 200만원 예산 티어 조합을 `GET /api/recommendations/home-builds`로 제공; 8개 카테고리 완성, target 밴드, Tool `FAIL` 부재를 응답 직전에 재검증 |
| BG-OPEN-11 | P2 | VERIFY | 실제 PC Agent 앱이 쇼핑몰에서 발급한 activation 설정으로 등록·로그 업로드·진단까지 이어지는지 미검증 | PC Agent 실행 파일 기준 E2E 수행 |

## 6. 검증 현황

- 백엔드 Gradle 전체 테스트: 756개 재실행, 실패 0건(의도된 skip 4건)
- 백엔드 `bootJar`: 통과
- OpenAPI: 150 paths 검증 통과
- `git diff --check`: 통과
- 후속 버그 targeted backend: Build Chat 문구·역제안 및 기사 프로필 controller/service 테스트 통과
- 후속 버그 targeted web: 외부 기사 marketplace 5개 시나리오 통과
- 웹 전체 Playwright: 272개 재실행 결과 `passed`, 실패 0건
- 웹 production build: 통과
- 상태형 corpus/runner 자체 테스트: 6개 통과
- Docker API 이미지 재빌드: 완료
- 기존 볼륨과 분리한 clean PostgreSQL에서 Flyway V117/V118 적용 및 `/api/health=UP` 확인
- 실제 상태형 RAM 체인: clarification 20ms → `32GB` 후보 3개 30ms → 생성 상품 칩 `draft-edit` 미리보기 1개 19ms, warning 0건
- 실제 8개 카테고리 단순 가성비 추천: 각 12~22ms, 호환 후보가 있는 카테고리는 TOP3 반환
- 실제 홈 검증 조합 API: 23ms, 2개 반환(1,885,950원/1,914,940원), 각 8개 카테고리 완성, Tool `FAIL` 0건, 200만원 target 밴드 준수
- 실제 Build Chat smoke `게임하다 화면이 자꾸 멈춰`: `DISPLAY_FREEZE`, `PRE_DIAGNOSIS`, build 0, simulation 없음, 원인 후보 없음, Agent 다운로드/AS 접수 반환
- GitHub Actions: API, web, OpenAPI, compose, PC Agent, Docker runtime smoke 6개 job 모두 통과
- 최초 상태형 감사: 1차 Build Chat API `74 PASS / 26 확정 사례`, 2차 4분 데모 API `65 PASS / 35 확정 사례`, 3차 사용자 화면 `75 PASS / 25 확정 사례`
- 최초 감사에서 확정한 86개 사례와 10개 독립 원인은 아래 10절에 case ID까지 보존했다.
- 수정 후 1차: Build Chat API `100/100 PASS`, 300턴, draft 원복 `100/100`; 대표 웹 `20/20 PASS`
- 수정 후 2차: 4분 데모 API `100/100 PASS`, draft 원복 `100/100`; 대표 웹 `20/20 PASS`
- 수정 후 3차: 사용자 화면 Chromium strict 실행 `100/100 PASS`
- 첫 3차 재실행에서 `surface-state-050`이 Chromium `ERR_NO_BUFFER_SPACE`와 함께 1회 실패했으나, strict 전체 재실행에서 동일 case를 포함한 `100/100 PASS`여서 제품 버그가 아닌 단발성 실행 환경 징후로 분리했다.
- 세 단계 모두 교차 사용자 노출과 예상치 못한 실제 draft 변경 P0는 0건이다.

## 7. 병합 상태와 공유 시 주의점

- 데모 안정화 코드·테스트·문서는 PR #163으로 main에 병합됐다.
- `docs/reports/aws-load-test-preparation-handoff-20260712.md`는 별도 AWS 작업 문서이며 PR #163과 이번 로컬 보고서 갱신 범위에서 제외한다.
- 원격 `V117__user_contact_address.sql`과 겹치던 seed 정리 migration은 `V118__close_blocking_demo_support_seeds.sql`로 재배정했고 clean DB 적용을 확인했다.
- 화면 예시나 자연어 입력 하나를 독립 버그 하나로 계산하면 부정확하다. 독립 원인은 26개이고, 아래 60개는 원인별 회귀를 재현하기 위한 사례 기록이다.
- 부분 개선 중인 성능 항목은 1건, 실제 환경 추가 검증은 2건이다. `BG-OPEN-02`, `BG-OPEN-06`~`10`은 이번 후속 수정에 포함했지만 아직 PR 병합 전이므로 `LOCAL_FIXED`로 구분한다.

## 8. 사용자 흐름 기준 세부 변경 예시

아래 목록은 팀원이 실제 화면과 자연어 시나리오에서 무엇이 달라졌는지 빠르게 확인하기 위한 상세 예시다. 하나의 독립 버그를 API, 화면, 상태 처리로 나눈 항목이 포함되어 있으므로 사례 수는 독립 버그 수가 아니다. `MAIN_GUARANTEE` 항목은 최신 main에 이미 있던 방어이며 현재 작업 성과로 중복 계산하지 않는다.

### AI 견적과 부품 변경

1. `MERGED` QHD 게임용 완성 견적에는 GPU가 반드시 포함된다.
2. `MERGED` GPU 포함 조합 생성이 실패해도 GPU 없는 사무용 조합으로 조용히 대체하지 않는다.
3. `MERGED` 2-DIMM RAM 키트는 상품 수량 1, 실제 모듈 수 2로 계산한다.
4. `MERGED` RAM 키트의 가격과 Tool 슬롯 검증도 retail package 수량을 기준으로 계산한다.
5. `MERGED` `GPU를 한 단계 낮은 더 저렴한 제품으로 바꿔줘`는 현재 GPU보다 실제 tier가 낮은 후보만 사용한다.
6. `MERGED` 명확한 상향·하향 교체는 LLM 재해석 없이 ranker와 Tool 검증을 거친 미리보기로 반환한다.
7. `MERGED` 상품명의 연속 공백, 괄호, 특수문자 차이를 정규화해 정확 상품 `견적에 담아줘`를 찾는다.
8. `MERGED` 동작 변경 후 이전 Redis 응답이 재생되지 않도록 exact/semantic cache namespace를 갱신했다.
9. `MAIN_GUARANTEE` Tool FAIL이 발생한 변경안은 적용 미리보기 카드로 제공하지 않는다.
10. `MAIN_GUARANTEE` CPU·GPU·PSU·CASE·COOLER 같은 단일 카테고리에 `ADD`가 들어와도 기존 부품 `REPLACE`로 보정한다.

### 수동 견적과 호환 후보

11. `MERGED` 현재 견적의 전체 Tool FAIL을 모든 후보에 그대로 복사하지 않고 후보 카테고리 관련 항목만 평가한다.
12. `MERGED` 기존 RAM 슬롯 초과 때문에 무관한 CPU 후보가 장착 불가로 표시되지 않는다.
13. `MERGED` 기존 PSU 크기 문제 때문에 실제로 장착 가능한 GPU 후보가 장착 불가로 표시되지 않는다.
14. `MERGED` 후보 FAIL 문구는 소켓, RAM 규격, 슬롯 수, 쿨러 TDP, 실제 장착 치수처럼 해당 후보의 원인을 설명한다.
15. `MERGED` RAM·SSD 수량 감소 버튼을 1에서도 누를 수 있고 0이 되면 항목 삭제로 처리한다.
16. `MERGED` 마지막 RAM 객체도 제거할 수 있어 잘못 담은 다중 부품 때문에 견적을 버릴 필요가 없다.
17. `MERGED` 배치도에서 hover한 부품 객체가 인접 부품 레이어 아래로 가려지지 않는다.
18. `MERGED` CPU 9600X를 고른 뒤에도 CPU 목록이 유지되어 바로 285K로 다시 선택할 수 있다.

### 조립 기사 요청과 제안 선택

19. `MERGED` 조립 요청에서 수령인 입력은 선택 사항이다.
20. `MERGED` 수령인을 비우면 서버가 계정 이름 또는 이메일을 snapshot 기본값으로 사용한다.
21. `MERGED` 전화번호 입력은 선택 사항이며 비어 있어도 요청을 만들 수 있다.
22. `MERGED` 배송 방식을 선택해도 초기 기사 제안 요청 단계의 주소는 선택 사항이다.
23. `MERGED` 데모 입력 부담을 줄이기 위해 지역은 서울, 희망일은 현재 날짜 기준 3일 후로 시작한다.
24. `MERGED` 조립 요청 목록 API가 현재 선택 가능한 기사 제안 수를 함께 반환한다.
25. `MERGED` 제안 대기 중인 요청 목록과 상세는 5초마다 새 제안을 확인한다.
26. `MERGED` 내 견적함에서 새 제안이 있으면 기사 제안 비교 화면으로 바로 이동한다.
27. `MERGED` 진행 중 의뢰 상세에서 도착한 제안 수와 `기사 제안 비교·선택` 버튼을 표시한다.
28. `MERGED` 선택 기사 화면에서 비어 있는 연락처와 주소는 깨진 값 대신 `미입력`으로 표시한다.

### AS 로그와 원격지원 상태

29. `MERGED` 사용자 로그 업로드 시 검증 결과뿐 아니라 AS RAG 분석 payload도 저장한다.
30. `MERGED` 로그 목록의 요약은 분석 결과가 있으면 실제 `summaryText`를 우선 사용한다.
31. `MERGED` AS RAG 분석이 실패해도 검증된 로그 업로드 자체는 정상 저장한다.
32. `MERGED` 깨끗한 DB의 고정 데모 상담 두 건만 종료해 신규 AS 접수를 막지 않게 한다.
33. `MERGED` CLOSED·CANCELLED 티켓에는 사용자 상담방을 다시 만들지 않는다.
34. `MERGED` 상담방을 archive하면 남아 있는 원격지원 요청도 CANCELLED로 종료한다.
35. `MERGED` 같은 티켓에 원격지원 링크를 다시 저장할 때 새 세션을 계속 만들지 않고 최신 active session을 갱신한다.
36. `MERGED` 티켓을 RESOLVED·CLOSED·CANCELLED로 변경하면 활성 원격지원 세션도 COMPLETED 또는 CANCELLED로 끝낸다.
37. `MERGED` 관리자 감사 로그의 nullable 문자열을 명시적으로 cast해 PostgreSQL 타입 추론 오류를 방지한다.
38. `MERGED` 사용자 티켓 화면은 5초 polling으로 관리자 링크·처리 메모·종료 상태를 반영한다.

### 쇼핑몰 AI와 PC Agent 연결

39. `MERGED` 쇼핑몰 AI는 멈춤·검은 화면·재부팅·부팅 실패 등의 증상을 인식하고 일반적인 원인 가능성을 안내하지만, 위험도·확정 원인·로그 근거는 단정하지 않는다.
40. `MERGED` 쇼핑몰 안내 카드에서 동일한 공통 다운로드 모듈로 PC Agent ZIP을 만들고 AS 접수 화면으로 이동할 수 있으며, 실제 로그 기반 진단은 별도 PC Agent AI가 담당한다.

### 상태형 추천 체인 추가 예시

41. `MERGED` `램 하나 넣어줘`는 임의 상품을 고르지 않고 32GB·64GB·최저가 기준 칩을 먼저 보여준다.
42. `MERGED` 되묻기에 짧게 `32GB`라고 답해도 실제 32GB 이상 RAM 후보 3개로 이어진다.
43. `MERGED` 서버가 생성한 정확 상품 칩을 다시 보내면 빈 견적에서도 단일 변경 미리보기가 생성된다.
44. `MERGED` RAM/SSD를 실제 추가한 뒤 같은 조건을 다시 물으면 방금 담은 상품 대신 다른 후보를 채운다.
45. `MERGED` RAM 슬롯이 꽉 찬 경우 제품 3개를 억지로 만들지 않고 제거 또는 호환 문제 설명으로 전환한다.
46. `MERGED` `가성비` 칩은 최고가 제품이 아니라 카테고리별 객관적 가격 대비 기준으로 정렬한다.
47. `MERGED` 단순 가성비·최저가·고성능 부품 추천은 LLM을 거치지 않아 후보 50개 Tool 보충을 포함해도 실제 API에서 12~22ms에 완료된다.
48. `MERGED` 셀프견적에서 `CPU 추천해줘`처럼 변경 동사가 없는 질문도 최신 장바구니를 서버에 보내 후속 후보와 현재 상태가 충돌하지 않는다.

## 9. 중간에 추가 발견한 사례 단위 추적

아래 12건은 독립 원인을 새로 12개 추가한 것이 아니다. PR 준비 중 연속 대화와 실제 견적 상태를 바꿔가며 발견한 재현 사례를 기존 원인 또는 계약 회귀에 연결한 것이다.

| 사례 | 시작 상태·입력 | 과거 실패 양상 | 현재 보장 | 연결 항목 |
|---|---|---|---|---|
| BG-CASE-49 | B860 메인보드가 담긴 견적에서 `CPU 추천해줘` | AM5 전용 9950X3D·9900X3D가 TOP3에 노출됨 | 현재 플랫폼과 Tool을 통과한 CPU만 노출 | BG-LOCAL-18 |
| BG-CASE-50 | 후보 앞쪽 CPU 2개가 소켓 FAIL이고 뒤쪽에 호환 CPU가 있음 | FAIL 2개를 제거한 뒤 추천 1개만 반환 | 최대 50개 안에서 뒤 후보를 보충해 가능한 경우 TOP3 완성 | BG-LOCAL-18 |
| BG-CASE-51 | 후보 목록에 Tool PASS와 WARN이 섞여 있음 | 앞에 있던 WARN 후보가 PASS 후보보다 우선됨 | PASS 3개를 우선 채우고 부족할 때만 WARN 사용 | BG-LOCAL-18 |
| BG-CASE-52 | `커세어 FRAME 4000D LCD ... 견적에 담아줘` | 상품명 안의 `RAM` 문자열을 메모리 카테고리로 오인 | 단어 경계 alias 판정 후 정확 CASE 상품 미리보기 생성 | BG-LOCAL-19 |
| BG-CASE-53 | FSP 600W 파워가 이미 담긴 상태에서 같은 파워 추천 | 현재 부품을 다시 추천하거나 무의미한 담기 칩 생성 | 현재 exact 상품을 제외하고 대안이 없으면 다른 후보 요청 칩 제공 | BG-LOCAL-20 |
| BG-CASE-54 | 특정 32GB RAM이 담긴 상태에서 `32GB RAM 추천해줘` | 방금 담은 RAM이 TOP3에 반복 노출 | 동일 상품을 제외하고 뒤의 호환 RAM으로 보충 | BG-LOCAL-20 |
| BG-CASE-55 | `RAM 추천해줘` 되묻기 뒤 완전한 명령 `고성능 GPU 추천해줘` 입력 | 원래 RAM 문장과 새 GPU 명령을 중복 합성 | 완전한 후속 명령은 새 원문 그대로 처리 | BG-LOCAL-22 |
| BG-CASE-56 | request body에 draft가 빠진 상태에서 정확 CASE 상품 칩 전송 | 빈 견적으로 오인해 CASE를 추가하거나 추천을 반복 | 인증 사용자의 활성 draft를 다시 읽어 단일 슬롯 REPLACE 미리보기 생성 | BG-LOCAL-23, BG-LOCAL-26 |
| BG-CASE-57 | 같은 RAM 상품이 이미 담긴 상태에서 정확 상품 `견적에 담아줘` | 동일 상품 row를 중복 ADD하거나 추천으로 되돌아감 | 다중 장착 카테고리는 기존 상품 수량 증가 미리보기 생성 | BG-LOCAL-23 |
| BG-CASE-58 | `50만원 이하 9950X3D CPU 추천해줘` | 예산 처리 중 명시 모델 조건이 사라질 수 있음 | 9950X3D 조건을 유지하고 실제 가격·부족액 기반 역제안 | 하드 조건·역제안 계약 회귀 |
| BG-CASE-59 | B860 견적에서 `9950X3D CPU 추천해줘` | 자산 자체가 없는 경우와 현재 견적에 비호환인 경우를 같은 문구로 처리 | 내부 자산 존재와 Tool 비호환을 구분해 설명 | BG-LOCAL-18 |
| BG-CASE-60 | 쿨러가 이미 담긴 상태에서 `수랭 쿨러 추천해줘` | 현재 쿨러 존재만으로 쿨러 후보 전체가 제거될 수 있음 | 현재 exact 상품만 제외하고 다른 수랭 후보는 TOP3로 유지 | BG-LOCAL-20 |

## 10. 상세 상태 전이 3단계 감사 결과

### 최초 감사 실행 범위

| 단계 | 실행 | PASS | 확정 사례 | 독립 원인 | 의심 | 최초 감사 근거 |
|---|---:|---:|---:|---:|---:|---|
| 1차 Build Chat 상태형 API | 100 case / 300 turn | 74 | 26 | 5 | 0 | [Markdown](build-chat-stateful-audit-20260714-phase1.md) · [JSON](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/build-chat-stateful-audit-20260714-phase1.json) |
| 1차 대표 웹 재현 | 20 | 14 | 6 | 위 1차 원인에 포함 | 0 | 아래 `확정 사례 86건 목록`에 case와 실패 유형 보존 |
| 2차 4분 데모 API | 100 | 65 | 35 | 3, 이 중 신규 1 | 0 | 아래 `확정 사례 86건 목록`에 35개 case ID 보존 |
| 2차 대표 웹 재현 | 20 | 14 | 6 | 위 2차 원인에 포함 | 0 | 동일 API 원인의 웹 재현으로 아래 목록에 연결 |
| 3차 사용자 화면 Chromium | 100 | 75 | 25 | 4 | 0 | 아래 `확정 사례 86건 목록`에 25개 case ID 보존 |

웹 대표 재현 실패는 같은 API 원인을 브라우저에서 확인한 증거이므로 확정 사례 86건에 다시 더하지 않았다. 2차의 `BG-STATE-02`, `BG-STATE-05`도 1차에서 이미 확인한 원인의 데모 문구 변형이므로 전체 독립 원인은 5 + 신규 1 + 신규 4 = 10개다.

### 수정 후 최종 재검증

| 단계 | 최종 결과 | 검증 범위 | 최종 보고서 |
|---|---:|---|---|
| 1차 Build Chat 상태형 API | 100/100 PASS | 300턴, draft 원복 100/100, 확정·의심 0 | [Markdown](build-chat-stateful-audit-20260714-phase1-final.md) · [JSON](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/build-chat-stateful-audit-20260714-phase1-final.json) |
| 1차 대표 웹 재현 | 20/20 PASS | 고위험 체인의 실제 브라우저 입력·응답 | [Markdown](build-chat-stateful-web-audit-20260714.md) · [JSON](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/build-chat-stateful-web-audit-20260714.json) |
| 2차 4분 데모 API | 100/100 PASS | 추천, GPU 하향·복구, 조립, 진단 동의, 원격지원 각 20건 | [Markdown](demo-journey-stateful-audit-20260714-phase2.md) · [JSON](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/demo-journey-stateful-audit-20260714-phase2.json) |
| 2차 대표 웹 재현 | 20/20 PASS | 4분 데모 대표 상태 전이 | [Markdown](demo-journey-stateful-web-audit-20260714.md) · [JSON](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/demo-journey-stateful-web-audit-20260714.json) |
| 3차 사용자 화면 Chromium | 100/100 PASS | strict 모드, 인증부터 모바일·권한까지 10개 그룹 | [Markdown](user-surface-stateful-audit-20260714-phase3.md) · [JSON](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/user-surface-stateful-audit-20260714-phase3.json) |

최종 PASS는 최초 확정 사례를 삭제하거나 오라클을 완화해 만든 수치가 아니다. 동일 corpus와 핵심 불변식을 유지한 채 제품 코드와 상태 연결을 수정한 뒤 다시 실행한 결과다. 응답 지연은 이 감사에서 진단 자료로만 기록했으며 timeout·5xx 외에는 기능 실패 판정에 사용하지 않았다.

### 발견한 버그 10개

| ID | 상태 | 발견한 버그 | 대표 재현 | 확정 근거 | 기존 항목과의 관계 |
|---|---|---|---|---:|---|
| BG-STATE-01 | VERIFIED | 관계 문장에서 기준 부품을 추천 대상으로 뒤집음 | B860 견적에서 `현재 메인보드에 맞는 CPU 추천해줘` | 4 사례 | 관계 대상 category를 우선하고 현재 플랫폼·Tool 통과 후보로 보충; 1차 100건 통과 |
| BG-STATE-02 | VERIFIED | 후보·AS·시뮬레이션 대상 문맥이 후속 턴에서 소실됨 | GPU 하향 미리보기 뒤 `바꾸면 QHD 게임 성능이 얼마나 달라져?` | 1차 20 + 2차 20 사례 | clarification과 `DRAFT_EDIT_PREVIEW`의 서버 자산 ID를 후속 턴에 연결; 2차 100건 통과 |
| BG-STATE-03 | VERIFIED | `M.2` 저장장치 alias가 부품 추천 의도로 연결되지 않음 | `M.2 슬롯에 넣을 2테라 추천해줘` | 1 사례 | `M.2`를 STORAGE alias로 판정하고 수량·용량 제약을 유지; 1차 100건 통과 |
| BG-STATE-04 | VERIFIED | 평가 설명에서 실제 개선 후보 요청으로 전환되지 않음 | `현재 견적 점수를 실제로 높일 부품을 추천해줘` | 2 사례 | 점수 개선 표현을 대상 카테고리 추천으로 라우팅하고 실질 개선 guard 적용; 1차 100건 통과 |
| BG-STATE-05 | VERIFIED | deterministic 저예산 추천에서 Tool FAIL 카드가 최종 응답에 남음 | `200만원으로 QHD 게임용 PC 추천해줘` | 1차 3 + 2차 15 사례 | 모든 deterministic/fallback 서빙 직전에 Tool FAIL을 hard drop; 1·2차 200건 통과 |
| BG-STATE-06 | VERIFIED | 180만원 TARGET 예산 fallback이 ±12.5% 밴드를 벗어남 | `180만원으로 QHD 게임용 PC 추천해줘` | 5 사례 | raw budget intent 기준으로 fallback까지 최종 밴드 guard 적용; 1·2차 200건 통과 |
| BG-STATE-07 | VERIFIED | 셀프견적 카테고리 double-submit에서 후보 패널이 닫힘 | CASE·GPU·COOLER 카테고리를 빠르게 두 번 선택 | 3 사례 | 같은 category 재선택을 닫기 토글로 처리하지 않고 패널 유지; 3차 strict 100건 통과 |
| BG-STATE-08 | VERIFIED | 모바일 탭·패널이 390px viewport를 넘음 | 모바일 셀프견적·상품 상세 복귀·AS 챗 진입 | 9 사례 | 상단 내비·패널·AS 영역의 최소 폭과 overflow 정책 수정; 3차 strict 100건 통과 |
| BG-STATE-09 | VERIFIED | AS 챗이 일반 사용자가 접근할 수 없는 고정 기본 티켓을 조회함 | 일반 사용자로 `/support/ai-chat` 진입 | 10 사례 | 고정 티켓 의존 제거, 현재 사용자 티켓 조회와 없을 때 접수 CTA로 분리; 3차 strict 100건 통과 |
| BG-STATE-10 | VERIFIED | 순수 카테고리 이동 명령이 Build Chat 호출 후에도 이동하지 않음 | 전역 챗봇에서 `GPU 보여줘` | 5 사례 | 명확한 category-only 명령을 프론트 local fast route로 처리; 3차 strict 100건 통과 |

연결 사례 수는 원인별 영향 범위를 보여주기 위한 값이다. 한 사례가 두 원인에 동시에 연결될 수 있으므로 합계는 86건과 일치하지 않을 수 있다.

### 최종 재검증 중 추가로 보강한 경계 사례 5건

| ID | 상태 | 재현 입력·상태 | 실제 원인 | 수정·확인 |
|---|---|---|---|---|
| BG-STATE-FOLLOWUP-01 | VERIFIED | 현재 견적에서 `2TB SSD 추천해줘`, `전력이 충분한 파워 추천해줘` | `견적`이라는 단어만으로 전체 PC 추천으로 오인하거나 숫자 제약이 없다는 이유로 deterministic 부품 추천을 건너뜀 | `현재/지금/이 견적·구성` 문맥과 fit 표현을 분리해 부품 추천 fast path로 처리; Docker에서 6턴 모두 `FAST_PART_RECOMMEND`, 4~13ms 확인 |
| BG-STATE-FOLLOWUP-02 | VERIFIED | `RTX 5090 말고 가성비 GPU로 견적 추천해줘` | 부정된 모델명도 하드 부품 조건으로 읽어 LLM JSON 실패 또는 후보 없음 답변을 만들 수 있음 | 모델 토큰 뒤의 `말고/빼고/제외/없이/아닌/대신`을 부정 극성으로 판정하고, 예산·용도 없는 경우 원문을 보존한 clarification 반환 |
| BG-STATE-FOLLOWUP-03 | VERIFIED | GPU 하향 미리보기 후 `바꾸면 QHD 게임 성능이 얼마나 달라져?` | 후속 문장에 모델명이 없어 시뮬레이션 target을 찾지 못함 | 직전 `DRAFT_EDIT_PREVIEW`의 변경 partId를 ACTIVE 서버 자산으로 재조회해 target으로 사용; 2차 데모 20개 GPU 체인 모두 통과 |
| BG-STATE-FOLLOWUP-04 | IMPROVED | `MSI 메인보드와 RTX 5070 Ti를 반드시 같이 넣어 307만원 이하 게임 PC로 구성해줘` | 라우터가 `넣어`를 mutation 계열로 보아 전체 견적 요청인데도 broad LLM schema로 보내고 semantic miss까지 대기 | 빈 draft·명시 예산·하드 부품 조건·전체 PC 맥락을 모두 만족할 때만 견적 요구사항 전용 LLM schema 사용. 문구별 정답 하드코딩이나 deterministic 조합 생성은 하지 않음. 조건 보존은 통과했으나 냉간 5초 초과 변동 1건이 남아 `IMPROVED` 유지 |
| BG-STATE-FOLLOWUP-05 | VERIFIED | `9950X3D CPU + RTX 5080 GPU`, `2TB SSD + 1000W 파워`, `4TB SSD + 1200W 파워` | 범용 숫자 정규식이 CPU 모델을 GPU 모델로, SSD 용량을 RAM 용량으로 교차 적용해 실제 자산이 있어도 `PART_CONSTRAINT_NOT_FOUND`와 카드 0개 반환 | LLM의 카테고리 분류는 유지하고 서버 안전망은 GPU class·RAM/SSD 인접 용량·PSU watt처럼 형식이 명확한 값만 해당 카테고리에 적용. Docker 재검증에서 세 입력 모두 카드 3개 반환, 하위 용량·출력 없음 |

이 5건은 최초 86개 확정 사례 수를 부풀려 다시 합산하지 않는다. 최초 감사 이후 최종 PASS를 만드는 과정에서 발견한 별도 경계 보강 기록이다.

### 확정 사례 86건 목록

아래 표는 확정 사례의 고유 ID를 단계별로 모두 기록한 것이다. API 사례는 동일하게 복원한 시작 상태에서 2회 연속 재현했으며, 3차 화면 사례는 normal·reload·back-forward·double-submit·empty-state 변형으로 같은 원인을 반복 확인했다.

#### 1차 Build Chat API: 26건

| 그룹 | 수 | 확정 case ID | 확인한 실패 |
|---|---:|---|---|
| COMPATIBILITY_BACKFILL | 13 | `state-compat-01-b860-cpu-top3`, `state-compat-02-am5-cpu-top3`, `state-compat-04-am5-board-top3`, `state-compat-05-gpu-backfill`, `state-compat-06-case-backfill`, `state-compat-07-cooler-backfill`, `state-compat-08-psu-backfill`, `state-compat-09-ram-platform`, `state-compat-10-storage-fit`, `state-compat-11-mb-size-fit`, `state-compat-12-cooler-size-fit`, `state-compat-13-warn-after-pass`, `state-compat-14-fail-filter-refill` | 요청 카테고리 역전, Tool 통과 후보 TOP3 미보충 |
| EXACT_ALIAS_AMBIGUITY | 1 | `state-alias-09-storage-m2-alias` | M.2 요청을 STORAGE로 유지하지 못함 |
| DIRECTION_IMPROVEMENT | 7 | `state-direction-03-cpu-up`, `state-direction-05-ram-up`, `state-direction-06-storage-up`, `state-direction-07-psu-headroom`, `state-direction-09-case-clearance`, `state-direction-10-cooler-up`, `state-direction-12-score-chip-improves` | 상향·여유·점수 개선 요청이 다른 카테고리 또는 설명 흐름으로 이탈 |
| BUDGET_HARD_COUNTER | 3 | `state-budget-01-target-200`, `state-budget-10-numeric-comma`, `state-budget-11-korean-number` | 200만원 QHD 추천에 Graph/Tool FAIL 카드 노출 |
| ROBUSTNESS_AS_HANDOFF | 2 | `state-robust-01-as-freeze`, `state-robust-04-typo-mixed` | 화면 멈춤·혼합 오타 증상 후속 턴에서 AS 안내 소실 |

#### 2차 4분 데모 API: 35건

| 그룹 | 수 | 확정 case ID | 확인한 실패 |
|---|---:|---|---|
| DEMO_REQUIREMENT_RECOMMEND | 15 | `demo-state-001`, `demo-state-002`, `demo-state-003`, `demo-state-005`, `demo-state-006`, `demo-state-007`, `demo-state-009`, `demo-state-010`, `demo-state-011`, `demo-state-013`, `demo-state-014`, `demo-state-015`, `demo-state-017`, `demo-state-018`, `demo-state-019` | 15건 모두 Tool FAIL 추천. 이 중 `demo-state-003`, `demo-state-007`, `demo-state-011`, `demo-state-015`, `demo-state-019`는 180만원 TARGET 밴드도 위반 |
| DEMO_GPU_DOWNGRADE_RESTORE | 20 | `demo-state-021`, `demo-state-022`, `demo-state-023`, `demo-state-024`, `demo-state-025`, `demo-state-026`, `demo-state-027`, `demo-state-028`, `demo-state-029`, `demo-state-030`, `demo-state-031`, `demo-state-032`, `demo-state-033`, `demo-state-034`, `demo-state-035`, `demo-state-036`, `demo-state-037`, `demo-state-038`, `demo-state-039`, `demo-state-040` | GPU 하향 미리보기 뒤 성능 질문에서 target을 잃어 simulation 미생성 |

#### 3차 사용자 화면 Chromium: 25건

| 그룹 | 수 | 확정 case ID | 확인한 실패 |
|---|---:|---|---|
| SELF_QUOTE_TOOL·PART_DETAIL_PRICE | 5 | `surface-state-024`, `surface-state-027`, `surface-state-029`, `surface-state-034`, `surface-state-042` | double-submit 후보 패널 닫힘 또는 모바일 가로 넘침 |
| SUPPORT_AS | 10 | `surface-state-081`, `surface-state-082`, `surface-state-083`, `surface-state-084`, `surface-state-085`, `surface-state-086`, `surface-state-087`, `surface-state-088`, `surface-state-089`, `surface-state-090` | 고정 기본 AS 티켓 조회 404. `surface-state-087`은 모바일 overflow도 동시 발생 |
| GLOBAL_AI_NAVIGATION | 5 | `surface-state-091`, `surface-state-092`, `surface-state-093`, `surface-state-094`, `surface-state-095` | `GPU 보여줘`가 Build Chat을 호출하고 카테고리 화면으로 이동하지 않음 |
| MOBILE_ERROR_ACCESS | 5 | `surface-state-096`, `surface-state-097`, `surface-state-098`, `surface-state-099`, `surface-state-100` | 390px viewport에서 셀프견적 상단 탭·본문이 가로로 넘음 |

1차 26 + 2차 35 + 3차 25 = 확정 사례 86건이다. 1·2차 대표 웹 실패 12건은 같은 API 버그를 화면에서 다시 확인한 증거이므로 별도 확정 사례로 더하지 않았다.

### 안전성 결론

- 최초 감사 단계에서는 제품 코드를 수정하지 않고 10개 독립 원인과 86개 확정 사례를 수집했다. 이후 현재 `codex/stateful-qa-fixes` 브랜치에서 원인을 수정하고 같은 corpus로 재검증했다.
- 수정 후 API 상태형 체인 200개는 모두 시작 전후 draft fingerprint를 비교했고 200/200 원복됐다.
- 교차 사용자 데이터 노출, 설명·시뮬레이션 요청의 예기치 않은 draft mutation, 복원 실패는 확인되지 않았다.
- 조립 요청·기사 매칭 20건, 진단 동의 20건, 원격지원 종료 20건과 사용자 화면 strict 100건은 모두 통과했다.
- 최초 확정 사례 86건은 발견 증거로 계속 보존한다. 현재 상태는 10개 독립 원인 모두 `VERIFIED`이며, 이를 독립 버그 86개로 표현하지 않는다.

# Support Chat 실시간 기능 개선 체크리스트

작성일: 2026-07-06
업데이트일: 2026-07-06

> 역사 문서: 이 체크리스트는 2026-08-02 Spring STOMP 전환 이전 raw WebSocket/REST 전송 구현을 기록한다. 현재 계약은 `docs/load-test/support-chat-stomp-protocol.md`와 `docs/architecture/support-chat-stomp-handoff.md`를 따른다.

현재 확인 기준:

- 현재 워킹트리의 P0/P1 구현 코드와 추가된 회귀 테스트 기준으로 체크했다.
- 자동 검증은 `apps/api` Gradle test/bootJar, `apps/web` build/test, support chat Playwright 회귀 테스트 통과 기준이다.
- 구현은 되었지만 명시 테스트나 문서 계약 갱신이 남은 항목은 완료로 체크하지 않았다.

## 목적

사용자 위젯과 관리자 상담 화면의 실시간 채팅 기능에서 발견된 메시지 유실, 조용한 연결 실패, unread 오염, 상태 불일치, 캐시 노출 위험을 닫기 위한 개선 체크리스트다.

핵심 방향:

- 메시지 전송은 REST로 일원화한다. HTTP 성공 응답을 전송 ACK로 본다.
- WebSocket은 수신 전용 push 채널로 사용한다.
- 티켓 종료 시 상담방 기록은 읽을 수 있어야 한다.
- 읽기용 room loader에는 `status = 'ACTIVE'` 필터를 넣지 않는다.
- 전송 차단은 전송 직전 검증에서만 처리한다.
- WebSocket 재연결은 `refreshAuthTokens()`를 직접 호출하지 않고 `getToken()`만 다시 읽는다.

대상 범위:

- `apps/api/src/main/java/com/buildgraph/prototype/ticket`
- `apps/api/src/main/java/com/buildgraph/prototype/admin`
- `apps/web/src/features/support`
- `apps/web/src/features/admin/pages/AdminSupportChatSessionsPage.tsx`
- `docs/hosoek/support-chat-realtime-improvement-checklist.md`

## 완료 기준

- [x] 서버가 거부한 메시지는 클라이언트 입력창에서 사라지지 않는다.
- [x] 사용자/관리자 메시지는 REST mutation 성공 시에만 입력창에서 제거된다.
- [x] WS inbound `MESSAGE`는 저장되지 않고 error frame만 반환한다.
- [x] WS 전송 실패, 잘못된 payload, 종료 티켓 전송이 사용자에게 명확히 표시된다.
- [x] access token 만료 후에는 REST polling/query가 refresh를 담당하고, WS 재연결은 최신 `getToken()`만 사용한다.
- [x] 네트워크 단절, 서버 재시작, 비정상 close 이후 자동 재연결된다.
- [x] 티켓 종료/취소 후 기존 상담 기록은 계속 조회되고 전송만 차단된다.
- [x] `canSendMessage`는 `room.status == "ACTIVE" && ticketStatus not in CLOSED/CANCELLED` 기준이다.
- [x] 닫힌 티켓 또는 active가 아닌 room에는 새 메시지를 보낼 수 없다.
- [x] REST, WS, OpenAPI, DB 상태 전이가 같은 계약을 따른다.

## P0: 메시지 유실과 연결 장애 차단

- [x] 체크리스트와 구현 계획을 REST-only 전송 기준으로 유지한다.
  - ACK 프로토콜은 만들지 않는다.
  - WS는 push 수신과 server-side error frame 전송만 담당한다.

- [x] 사용자/관리자 전송 submit을 REST mutation으로 일원화한다.
  - 대상: `SupportChatWidget.tsx`, `AdminSupportChatSessionsPage.tsx`
  - 완료 기준: `socket.send()` 성공 여부로 입력창을 비우는 경로가 없다.

- [x] REST 전송 실패 UI를 추가한다.
  - 대상: 양쪽 `sendMutation`
  - 완료 기준: 400, 401, 409, network error에서 입력값이 보존되고 inline error가 표시된다.

- [x] 입력 길이와 content 타입을 프론트/백엔드 양쪽에서 검증한다.
  - 대상: `SupportChatService.requireMessage`, 사용자/관리자 입력창
  - 완료 기준: non-string content, 빈 내용, 2000자 초과가 저장되지 않는다.

- [x] WS inbound message 저장을 비활성화한다.
  - 대상: `SupportChatWebSocketHandler.handleTextMessage`
  - 완료 기준: `type: "MESSAGE"`는 `{ type: "ERROR", code: "WS_MESSAGE_DISABLED", retryable: false }`를 반환하고 세션을 유지한다.

- [x] malformed JSON, missing type, unknown type을 WS error frame으로 처리한다.
  - 대상: `SupportChatWebSocketHandler.handleTextMessage`
  - 완료 기준: 잘못된 WS payload 한 번으로 세션이 예외 close되지 않는다.

- [x] WS 자동 재연결 backoff를 추가한다.
  - 대상: 사용자 위젯, 관리자 페이지
  - 완료 기준: close/error 시 1s, 2s, 5s, 10s backoff로 재연결하고 refresh endpoint를 직접 호출하지 않는다.

- [x] 서버 push 실패 세션을 정리한다.
  - 대상: `SupportChatWebSocketHandler.broadcastRoomUpdate`
  - 완료 기준: stale token 또는 send 실패 session은 close/remove되고 다른 session push는 계속된다.

## P0: 티켓과 상담방 쓰기 차단

- [x] 티켓 종료/취소 시 room을 archive하지 않는다.
  - 대상: `TicketQueryService.update`, 관리자 ticket update path
  - 완료 기준: CLOSED/CANCELLED 후에도 기존 `supportChatRoomId`와 상담 기록을 읽을 수 있다.

- [x] 티켓 상태 변경 후 상담방을 broadcast한다.
  - 대상: 관리자 ticket update path
  - 완료 기준: `supportChatRoomId`가 있으면 `broadcastRoomUpdate(roomId)`가 호출되고, 사용자/관리자 화면의 `canSendMessage`가 즉시 갱신된다.

- [x] 읽기용 `roomForUser`와 `roomForAdmin`에는 `ACTIVE` 필터를 추가하지 않는다.
  - 완료 기준: active가 아닌 room도 상세/기록 조회는 가능하다.

- [x] 전송 지점에서만 room status를 검사한다.
  - 대상: `SupportChatService.requireMessageAllowed`
  - 완료 기준: terminal ticket 또는 `room.status != "ACTIVE"`이면 REST/WS 방어 경로 모두 409 또는 error frame으로 거부된다.

- [x] `canSendMessage` 계산에 room status를 반영한다.
  - 대상: `SupportChatService.contactMap`
  - 완료 기준: room이 active가 아니거나 ticket이 terminal이면 `canSendMessage=false`다.

## P1: 상태, unread, 순서 일관성

- [x] push용 detail 조회와 mark-read를 분리한다.
  - 완료 기준: 백그라운드 탭에서 push를 받아도 unread count가 사라지지 않는다.

- [x] 관리자 페이지 진입 시 첫 방 자동 선택으로 unread가 사라지는 동작을 막는다.
  - 완료 기준: 관리자 화면을 여는 것만으로 최신 방 unread가 0이 되지 않는다.

- [x] snapshot version 또는 `lastMessageAt/messageId` 비교를 추가한다.
  - 완료 기준: 늦게 도착한 과거 snapshot이 최신 캐시를 덮지 않는다.

- [x] WebSocket send 동시성 보호 또는 outbound queue를 추가한다.
  - 완료 기준: REST thread와 WS thread가 동시에 push해도 `TEXT_FULL_WRITING`으로 유실되지 않는다.
  - 현재 구현: `ConcurrentWebSocketSessionDecorator`로 세션 send를 보호하고 실패 세션만 close/remove한다.

- [x] 관리자 WS push가 목록 캐시도 갱신하게 한다.
  - 완료 기준: 최근 메시지, 최근 시각, unread count가 다음 polling 전까지 stale로 남지 않는다.

- [x] 서버가 내려주는 `pollingIntervalMs`를 프론트가 사용하게 한다.
  - 완료 기준: fallback polling 정책이 서버/프론트에서 엇갈리지 않는다.

## P1: 프론트 사용자 경험

- [x] 메시지 영역에 자동 스크롤을 추가한다.
- [x] 메시지 영역에 new marker를 추가한다.
- [x] 위젯 query loading/error/empty 상태를 분리한다.
- [x] 사용자당 진행 중 상담방 1개 정책으로 다른 상담방 알림 필요성을 제거한다.
  - 완료 기준: `/support/new`에서 진행 중 상담이 있으면 새 접수 대신 기존 상담방 이동 CTA를 표시하고, `POST /api/as-tickets`도 409로 차단한다.
- [x] `routeTicketId` stale closure를 제거한다.
- [x] support chat 위젯과 AI build assistant 위젯의 모바일 겹침을 방지한다.

## P1: 인증과 캐시 격리

- [x] 로그아웃/사용자 전환 시 support chat query cache를 정리한다.
- [x] support chat query key에 사용자/권한 경계를 반영한다.
- [x] 로그아웃 또는 auth clear 이벤트에서 열린 WS를 즉시 닫는다.
- [x] 관리자 권한 가드가 auth 변화에 반응하게 한다.
- [x] 지원 채팅 query retry 정책을 조정한다.

## P2: 운영 안정성

- [x] 기존 AS AI Chat/support chat migration 백필 누락을 점검한다.
  - 현재 구현: `V97__support_chat_rooms_backfill_repair.sql`로 누락 room, 잘못 archived된 최신 room, 누락 SYSTEM 메시지, last message metadata를 보정한다.
- [x] REST CORS와 WS allowed origin 기본값을 일치시킨다.
  - 현재 구현: `buildgraph.cors.allowed-origins` 공통 property를 REST CORS와 WS config가 함께 사용한다.
- [x] WS query string token 사용을 대체할 인증 방식을 별도 설계한다.
  - 현재 구현: Redis 60초 TTL, 1회 사용 Socket Ticket을 REST로 발급하고 WS 첫 `AUTH` frame으로 소비한다.
- [x] 멀티 인스턴스 push 전략을 문서화하거나 구현한다.
  - 현재 결정: P2에서는 단일 인스턴스 push + polling fallback 한계로 문서화하고 Redis pub/sub fan-out은 다음 단계로 둔다.
- [x] 연결 상태 표시를 실제 상태와 맞춘다.
  - 현재 구현: `실시간 연결`, `재연결 중`, `자동 새로고침`, `연결 끊김` 상태를 분리한다.
- [x] 관리자 상담방 목록 전체를 전용 WebSocket으로 실시간 갱신한다.
  - 현재 구현: `/ws/admin/support-chat-queue`가 단일 방 update/remove patch를 보내고, 상세 방 소켓과 독립적으로 동작한다.

## 테스트 체크리스트

### Backend

- [x] REST 메시지 성공 시 broadcast 호출 test
- [x] terminal ticket 전송 409 test
- [x] `room.status != ACTIVE` 전송 409 test
- [x] non-string content 400 test
- [x] 빈 내용, literal `"null"`, 2000자 초과 400 test
- [x] WS `MESSAGE`가 저장되지 않고 `WS_MESSAGE_DISABLED` error frame을 보내는 test
- [x] WS malformed JSON, missing type, unknown type error frame test
- [x] 관리자 티켓 상태 변경 후 `supportChatRoomId` broadcast test
- [x] 종료 티켓의 기존 상담 기록 조회 보존 test
- [x] user push snapshot이 unread를 clear하지 않는 test
- [x] admin push snapshot이 unread를 clear하지 않는 test
- [x] 관리자 상세 `markRead=false` 요청 test
- [x] 열린 상담방이 있는 사용자의 `POST /api/as-tickets` 409 test
- [x] 열린 상담방이 종료된 뒤 새 티켓 생성 허용 test
- [x] WS broadcast에서 한 세션 실패가 다른 세션 push를 막지 않는 test
- [x] user/admin ws-ticket endpoint가 권한 확인 후 ticket을 발급하는 test
- [x] ws-ticket이 Redis 60초 TTL로 저장되고 1회만 소비되는 test
- [x] invalid/mismatched ticket이 WS error frame 후 close되는 test
- [x] 인증 전 WS payload가 error frame 후 close되는 test
- [x] 인증 성공 후 최초 `CHAT_UPDATED`와 기존 broadcast가 동작하는 test
- [x] REST CORS와 WS config가 같은 allowed origins 기본값을 사용하는 test
- [x] support chat migration contract test
- [x] admin queue ws-ticket endpoint 발급 test
- [x] admin queue WebSocket 인증/patch/remove/실패 격리 test

### Frontend

- [x] 사용자 위젯 submit이 socket 전송 없이 REST mutation을 호출하는 test
- [x] 관리자 submit이 socket 전송 없이 REST mutation을 호출하는 test
- [x] REST mutation error 시 입력값 보존 test
- [x] inline error 표시 test
- [x] `maxLength=2000` 입력 제한 test
- [x] socket close 후 backoff 재연결이 새 ws-ticket을 발급받는 test
- [x] 위젯 API 실패와 빈 상담방 상태 분리 test
- [x] 위젯 메시지 영역 자동 스크롤 test
- [x] auth change 시 위젯 close와 cache cleanup test
- [x] 관리자 WS push가 목록 캐시를 갱신하는 test
- [x] 관리자 자동 선택 상세가 `markRead=false`로 로드되는 test
- [x] `/support/new` 진행 중 상담방 CTA와 submit 차단 test
- [x] stale submit 409 시 기존 상담방 CTA 표시 test
- [x] `/support/{ticketId}?chat=1` 위젯 자동 열기 test
- [x] 사용자/관리자 메시지 영역 new marker test
- [x] 서버 `pollingIntervalMs` 기반 fallback refresh test
- [x] 관리자 auth clear 시 guard 반응 test
- [x] 모바일 support chat과 AI assistant 상호 배타 test
- [x] socket URL에 `token=`이 포함되지 않는 test
- [x] socket 연결 전 ws-ticket REST API가 호출되는 test
- [x] socket open 직후 `AUTH` frame이 전송되는 test
- [x] ws-ticket API 401이 기존 REST refresh retry를 사용하는 test
- [x] 사용자/관리자 연결 상태 UI test
- [x] admin queue WebSocket update/remove/reconnect test

## 방문 지원 예약 기능

### Backend

- [x] `visit_support_reservations.scheduled_at` migration contract test
- [x] 사용자 예약 요청 `REQUESTED` 저장 test
- [x] 사용자 변경 요청 `RESCHEDULE_REQUESTED` 저장 test
- [x] 관리자 예약 확정 `SCHEDULED` 저장 test
- [x] 관리자 예약 취소 `CANCELLED` 저장 test
- [x] 종료 티켓 예약 변경 409 test
- [x] 예약 변경 후 SYSTEM 메시지와 unread 갱신 test
- [x] 예약 변경 후 room detail/queue broadcast controller test
- [x] 상담방 detail/list `visitReservation` 포함 test

### Frontend

- [x] 사용자 위젯 예약 요청 form/API 호출 test
- [x] 사용자 위젯 확정 예약 표시 및 취소 버튼 미노출 test
- [x] 사용자 위젯 WebSocket detail push로 예약 패널 갱신 test
- [x] 관리자 상담방 예약 확정/취소 API 호출 test
- [x] 관리자 예약 실패 시 입력값 보존 및 오류 표시 test
- [x] 관리자 queue patch로 목록 예약 상태/시각 갱신 test

## 관리자 상담방 삭제 및 재접수 허용

### Backend

- [x] 관리자 상담방 삭제 API controller/broadcast test
- [x] 상담방 삭제 시 `ARCHIVED` 전환과 SYSTEM 메시지 저장 test
- [x] 삭제 시 `OPEN`/`RESOLVED` 티켓 `CANCELLED` 처리 test
- [x] `CLOSED`/`CANCELLED` 티켓 삭제 시 티켓 상태 유지 test
- [x] 삭제된 상담방이 사용자 active 상담 기준에서 제외되는 test
- [x] 삭제된 상담방이 새 AS 접수를 막지 않는 test

### Frontend

- [x] 관리자 상세 패널 삭제 버튼/확인/DELETE 호출 test
- [x] 삭제 성공 시 목록 제거와 읽기 전용 상세 표시 test
- [x] 삭제 실패 시 선택 상태와 입력값 보존 및 오류 표시 test
- [x] 삭제된 사용자 AS 접수 버튼 활성화 test

### Manual/E2E

- [ ] 사용자/관리자 양쪽에서 REST 전송 성공 확인
- [ ] WS 연결 상태에서 상대 메시지 push 수신 확인
- [ ] 서버가 WS `MESSAGE`를 받아도 저장하지 않고 error frame만 반환하는지 확인
- [ ] 티켓 CLOSED 후 기존 상담 기록은 열리고 전송만 막히는지 확인
- [ ] socket close 후 refresh 직접 호출 없이 polling refresh와 backoff reconnect로 복구되는지 확인

### Automated Verification

- [x] `cd apps/api && ./gradlew test --no-daemon`
- [x] `cd apps/api && ./gradlew bootJar --no-daemon`
- [x] `cd apps/web && npm run build`
- [x] `cd apps/web && npm run test`
- [x] `cd apps/web && npx playwright test tests/support-chat-widget.spec.ts tests/admin-support-chat.spec.ts`
- [x] `python3 tools/validate_openapi.py`

## 권장 작업 순서

1. 체크리스트를 REST-only 전송과 읽기 보존 정책으로 정리한다.
2. backend/frontend 회귀 테스트를 먼저 추가한다.
3. REST validation, 전송 차단, `canSendMessage` 계산을 고친다.
4. WS inbound 저장을 비활성화하고 error frame을 추가한다.
5. 티켓 상태 변경 broadcast를 연결한다.
6. 프론트 전송을 REST-only로 바꾸고 오류/입력 제한을 추가한다.
7. WS backoff 재연결을 추가하되 refresh endpoint는 직접 호출하지 않는다.
8. 검증 명령을 실행한다.

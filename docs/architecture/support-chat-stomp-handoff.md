# 사용자–관리자 상담 STOMP 전환 인수인계

## 현재 문맥

다짜조에는 실시간 흐름이 세 종류 있다.

1. 사용자–관리자 사람 상담: 이번 변경에서 Spring STOMP로 전환했다.
2. AS AI Chat: REST+SSE를 그대로 유지한다.
3. PC Agent 진단: raw WebSocket `/ws/pc-agent/diagnosis`를 그대로 유지한다.

이 경계를 섞지 않는 것이 가장 중요하다. 사람 상담은 LLM, RAG, Tool Calling, 로그 분석, 티켓 생성을 수행하지 않는다.

## 변경 전과 변경 후

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 메시지 전송 | USER/ADMIN REST POST | STOMP SEND `/app/support-chat/messages` |
| 실시간 수신 | custom raw JSON WebSocket | STOMP topic subscription |
| 인증 | REST 임시 ticket + raw `AUTH` frame | STOMP CONNECT `Authorization` header |
| 방 갱신 | 전체 `SupportChatSessionResponse` snapshot | `MESSAGE_CREATED`/`ROOM_UPDATED` 증분 event |
| 관리자 목록 | 별도 raw `/ws/admin/support-chat-queue` | `/topic/support-chat/admin-queue` |
| 재시도 중복 방지 | 없음 | 발신자 + `clientMessageId` unique constraint |
| polling | 소켓 연결 중에도 유지 | 오프라인만 사용, 재연결 직후 REST 재동기화 |

## 서버 실행 흐름

```text
WebSocket handshake /ws/support-chat
→ STOMP CONNECT(Authorization)
→ SupportChatInboundChannelInterceptor
→ CurrentUserService JWT 검증
→ Principal 저장
→ SUBSCRIBE room/admin/error destinations

STOMP SEND /app/support-chat/messages
→ destination 검사
→ SupportChatMessagingController
→ principal 기반 USER/ADMIN 재확인
→ SupportChatService.saveMessage
→ room 권한·상태 검사
→ clientMessageId 멱등 INSERT
→ unread/last-message 갱신
→ transaction commit
→ SupportChatEventPublisher
→ room MESSAGE_CREATED + admin queue ROOM_UPDATED
```

## 주요 파일

| 파일 | 책임 |
|---|---|
| `SupportChatWebSocketConfig.java` | STOMP endpoint, application prefix, simple broker, inbound interceptor |
| `PcAgentWebSocketConfig.java` | 변경 대상이 아닌 PC Agent raw WebSocket 분리 |
| `SupportChatInboundChannelInterceptor.java` | CONNECT 인증, SEND destination 제한, SUBSCRIBE ACL |
| `SupportChatPrincipal.java` | JWT 사용자와 Spring Principal 연결 |
| `SupportChatMessagingController.java` | STOMP SEND 처리와 개인 오류 응답 |
| `SupportChatMessagingContract.java` | request/event/error canonical 계약 |
| `SupportChatService.java` | 권한, 상태, 멱등 저장, unread 갱신 |
| `SupportChatEventPublisher.java` | commit 후 room/admin queue 게시와 실패 격리 |
| `V135__support_chat_stomp_client_message_id.sql` | 멱등키 컬럼과 partial unique index |
| `supportChatApi.ts` | stompjs 연결, 구독, 자동 재연결, SEND |

## 트랜잭션과 실패 경계

- 메시지 저장, unread 갱신, 최초 관리자 배정은 하나의 DB transaction이다.
- event publish는 DB 변경 뒤 수행한다.
- publish 실패로 이미 저장된 메시지를 rollback하지 않는다.
- 실패는 warning log와 meter로 관측한다.
- 클라이언트는 재연결 직후 REST snapshot을 읽어 event 누락을 복구한다.
- 정확히 한 번 전달을 주장하지 않는다. DB는 idempotent write, 전달은 at-least-once 가능성을 전제로 cache를 병합한다.

## 보안 체크리스트

- CONNECT header 외 위치에 JWT를 넣지 않는다.
- payload의 sender ID/role을 받지 않는다.
- USER room SUBSCRIBE는 `room.user_id`와 principal을 비교한다.
- ADMIN queue와 room SUBSCRIBE는 DB의 최신 ADMIN 역할을 확인한다.
- SEND도 서비스에서 방 소유권과 종료 상태를 다시 검사한다.
- 개인 오류 외 destination은 허용 목록으로 제한한다.
- 오류 payload에 SQL, stack trace, 내부 PK, JWT를 노출하지 않는다.

## 프론트 cache 규칙

- 전송 즉시 `optimistic:{clientMessageId}` 메시지를 추가한다.
- 같은 `clientMessageId`의 `MESSAGE_CREATED`가 오면 서버 `messageId`를 가진 canonical 메시지로 치환한다.
- 다른 발신자의 새 메시지는 배열 끝에 추가한다.
- `ROOM_UPDATED` 요약은 기존 contact에 병합하고 방문 예약처럼 event에 없는 상세 필드는 유지한다.
- 개인 오류가 오면 해당 optimistic message를 실패 상태로 표시한다.
- STOMP 연결 중 polling을 끄고, close/error 시 polling을 다시 사용한다.

## 로컬 검증

```bash
cd apps/api
./gradlew test --tests '*SupportChat*' --no-daemon
./gradlew bootJar --no-daemon

cd apps/web
npm run build
npm run test

python tools/validate_openapi.py
```

수동 검증은 USER와 ADMIN 브라우저를 동시에 열고, 양쪽 전송·재연결·중복 클릭·다른 사용자의 방 구독 거절·종료 방 전송 거절을 확인한다.

## 면접/코드리뷰 예상 질문 15개

### 1. 왜 raw WebSocket 대신 STOMP를 사용했나요?

연결 자체는 WebSocket이 담당하지만, STOMP가 destination, subscription, user queue, application handler 규약을 제공한다. 방별 fan-out과 개인 오류를 custom frame router 없이 표현할 수 있어 인증·권한·테스트 경계가 명확해진다.

### 2. STOMP와 WebSocket의 관계는 무엇인가요?

WebSocket은 양방향 연결과 frame 전송을 제공하는 transport다. STOMP는 그 위에서 CONNECT, SEND, SUBSCRIBE와 destination 의미를 정의하는 messaging protocol이다. 이 구현은 SockJS 없이 native WebSocket 위에 STOMP를 사용한다.

### 3. JWT를 HTTP handshake query가 아니라 CONNECT header로 보낸 이유는 무엇인가요?

URL은 프록시·접근 로그·브라우저 기록에 남기 쉽다. STOMP CONNECT native header는 URL 노출을 피하면서 기존 JWT 검증기를 재사용할 수 있다. 서버 interceptor가 한 번 검증한 사용자를 session principal로 보관한다.

### 4. CONNECT에서만 인증하면 SUBSCRIBE 보안은 충분한가요?

아니다. 인증은 “누구인가”만 증명한다. 방 topic 구독 때 “이 방을 볼 수 있는가”를 별도로 검사해야 한다. USER는 방 소유권, ADMIN은 최신 역할과 방 존재 여부를 확인한다.

### 5. payload의 senderRole을 받지 않는 이유는 무엇인가요?

클라이언트 입력은 위조할 수 있다. 발신자 ID와 역할은 CONNECT principal에서만 가져와야 USER가 ADMIN 메시지를 흉내 내거나 다른 사용자 ID로 저장하는 것을 막을 수 있다.

### 6. `clientMessageId`가 왜 필요한가요?

네트워크가 끊기면 클라이언트는 서버 저장 성공 여부를 모른 채 재전송할 수 있다. 발신자별 UUID를 unique key로 저장하면 같은 논리 메시지의 중복 row와 unread count 중복 증가를 막을 수 있다.

### 7. 왜 unique key가 `clientMessageId` 단독이 아닌 발신자와의 조합인가요?

서로 다른 사용자가 우연히 같은 UUID를 생성해도 충돌하지 않아야 한다. 멱등성의 범위가 “한 발신자의 전송”이므로 `(sender_user_id, client_message_id)`가 의미에 맞다.

### 8. 발신자에게도 메시지 event를 보내는 이유는 무엇인가요?

REST 성공 응답이 사라졌으므로 서버가 정한 `messageId`, `createdAt`, 정규화된 content를 발신자도 받아야 한다. 발신자는 `clientMessageId`로 optimistic 항목을 canonical 항목으로 치환한다.

### 9. 전체 상담방 snapshot 대신 증분 event를 쓴 이유는 무엇인가요?

메시지 한 건마다 최근 100개 이력과 예약/티켓 정보를 모두 직렬화하면 payload와 DB 조회가 커진다. 메시지 event와 작은 방 요약만 보내고, 구조 변경이 필요한 경우 `refreshRequired`로 REST 재조회한다.

### 10. DB commit과 broker publish를 한 transaction으로 묶지 않은 이유는 무엇인가요?

simple broker는 DB transaction resource가 아니다. publish 실패 때문에 이미 유효한 사용자 메시지를 rollback하는 것도 부적절하다. DB를 source of truth로 두고 publish 실패는 관측한 뒤 REST 재동기화로 복구한다.

### 11. 이 구현은 exactly-once인가요?

아니다. 전달은 중복될 수 있고 연결 단절 중 event가 누락될 수 있다. DB write는 멱등키로 effectively-once에 가깝게 만들고, 프론트 cache는 messageId/clientMessageId로 중복 제거하며, 재연결 REST snapshot으로 누락을 복구한다.

### 12. 연결 중 polling을 끄는 것이 안전한가요?

STOMP event만으로 정상 구간을 갱신하고, close/error가 감지되면 polling을 다시 켠다. 재연결 직후 즉시 REST refetch도 수행하므로 끊긴 구간을 보정한다. 이 조합이 상시 polling보다 부하를 줄이면서 최종 일관성을 유지한다.

### 13. simple broker의 한계는 무엇인가요?

broker와 subscription state가 한 API JVM 안에 있다. API 인스턴스가 여러 개면 한 인스턴스의 DB 변경이 다른 인스턴스 연결에 자동 fan-out되지 않는다. 확장 시 RabbitMQ 같은 broker relay와 WebSocket routing 전략이 필요하다.

### 14. AS AI Chat과 왜 합치지 않았나요?

사람 상담은 USER/ADMIN 메시지 저장과 방 권한이 핵심이고, AS AI Chat은 LLM 실행 상태와 SSE streaming이 핵심이다. 처리 비용, 실패 모델, 보안 주체, 응답 형태가 달라 같은 프로토콜로 합치면 경계가 흐려진다.

### 15. 다음 개선 우선순위는 무엇인가요?

첫째 실제 STOMP 통합 테스트와 브라우저 E2E를 강화한다. 둘째 publish 보장을 높이려면 transactional outbox를 도입한다. 셋째 다중 인스턴스 전에는 external broker relay와 부하 테스트를 완료한다. 넷째 pending/failed 메시지 재시도 UI를 명시적으로 제공한다.

## 다음 작업자가 반드시 알아야 할 부분

`support_chat_messages`가 최종 원본이고 STOMP event는 전달 수단이다. 새 event를 추가할 때도 권한은 destination과 서비스 양쪽에서 검사하고, event 누락을 REST snapshot으로 복구할 수 있어야 한다.

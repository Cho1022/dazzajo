# 사용자–관리자 상담 STOMP 프로토콜과 부하 테스트 기준

## 범위

이 문서는 `support_chat_rooms` 기반 사람 상담만 다룬다. AS AI Chat의 REST+SSE, Agent 진단 REST, `/ws/pc-agent/diagnosis`, 티켓·로그 업로드 흐름은 변경 대상이 아니다.

## 연결 계약

| 구분 | 값 |
|---|---|
| WebSocket endpoint | `/ws/support-chat` |
| SockJS | 사용하지 않음 |
| STOMP application prefix | `/app` |
| simple broker prefix | `/topic`, `/queue` |
| user destination prefix | `/user` |
| CONNECT 인증 | native header `Authorization: Bearer {accessToken}` |
| 자동 재연결 | 클라이언트 `reconnectDelay=5000ms` |

JWT나 임시 ticket은 URL query string에 넣지 않는다. 기존 REST `ws-ticket`과 raw JSON `AUTH` frame은 제거됐다.

## 목적지

| 동작 | destination | 권한 |
|---|---|---|
| 메시지 전송 | `/app/support-chat/messages` | 로그인 USER/ADMIN |
| 방 증분 event 구독 | `/topic/support-chat/rooms/{roomId}` | 방 소유 USER 또는 ADMIN |
| 관리자 목록 증분 event 구독 | `/topic/support-chat/admin-queue` | ADMIN |
| 개인 오류 구독 | `/user/queue/support-chat-errors` | 현재 principal |

서버는 STOMP CONNECT 시 JWT를 검증해 principal을 만들고, SUBSCRIBE마다 방 소유권 또는 최신 ADMIN 역할을 검사한다. SEND body의 발신자 정보는 신뢰하지 않으며 principal의 사용자 ID와 역할을 사용한다.

## SEND payload

```json
{
  "roomId": "7c2f8f17-8f18-4d10-bcd1-9d20d1c71a01",
  "clientMessageId": "6dff10b8-c102-438c-b9a7-cd74565498d5",
  "content": "재부팅 후에도 같은 증상입니다."
}
```

- `roomId`, `clientMessageId`는 UUID다.
- `content`는 trim 후 1~2000자다.
- `clientMessageId`는 발신자별 멱등키다.
- `(sender_user_id, client_message_id)` partial unique constraint가 중복 저장을 막는다.
- 중복 SEND는 unread count를 다시 올리지 않고 기존 메시지의 canonical event를 다시 게시한다.

## MESSAGE_CREATED event

```json
{
  "type": "MESSAGE_CREATED",
  "messageId": "e5017145-ef85-476b-b17e-ea88d6aee2f1",
  "clientMessageId": "6dff10b8-c102-438c-b9a7-cd74565498d5",
  "roomId": "7c2f8f17-8f18-4d10-bcd1-9d20d1c71a01",
  "senderId": "c6d75f0c-0f57-4d1c-a8b2-a4079dcd40fd",
  "senderRole": "USER",
  "senderName": "홍길동",
  "content": "재부팅 후에도 같은 증상입니다.",
  "createdAt": "2026-08-02T10:00:00+09:00",
  "room": {
    "roomId": "7c2f8f17-8f18-4d10-bcd1-9d20d1c71a01",
    "asTicketId": "4aef8ef7-1dc7-45d1-bfc2-bb0cfdaf7f8a",
    "status": "ACTIVE",
    "ticketStatus": "OPEN",
    "lastMessage": "재부팅 후에도 같은 증상입니다.",
    "adminUnreadCount": 1,
    "userUnreadCount": 0,
    "canSendMessage": true
  }
}
```

발신자도 방 topic을 구독한다. 프론트엔드는 optimistic message를 `clientMessageId`로 찾아 canonical event로 치환한다. 서버 snapshot 전체를 매 메시지마다 보내지 않는다.

## 방·관리자 목록 event

```json
{
  "type": "ROOM_UPDATED",
  "roomId": "7c2f8f17-8f18-4d10-bcd1-9d20d1c71a01",
  "room": { "roomId": "7c2f8f17-8f18-4d10-bcd1-9d20d1c71a01", "status": "ACTIVE" },
  "refreshRequired": true
}
```

```json
{
  "type": "ROOM_REMOVED",
  "roomId": "7c2f8f17-8f18-4d10-bcd1-9d20d1c71a01",
  "room": null,
  "refreshRequired": false
}
```

예약·티켓 상태처럼 상세 구조가 달라진 경우 방 구독자는 `refreshRequired=true`를 받고 REST 상세를 다시 조회한다. 관리자 큐는 요약 patch 또는 제거 event만 적용한다.

## 개인 오류 event

```json
{
  "clientMessageId": "6dff10b8-c102-438c-b9a7-cd74565498d5",
  "code": "SUPPORT_CHAT_INVALID_MESSAGE",
  "message": "메시지 내용을 확인해 주세요.",
  "retryable": false
}
```

DB 예외, SQL, stack trace, 내부 ID는 전송하지 않는다. 프론트엔드는 `clientMessageId`에 해당하는 optimistic message를 실패 상태로 바꾼다.

## polling fallback과 재동기화

- STOMP 연결 중: 사용자 상세, 관리자 상세, 관리자 목록의 주기 polling을 중단한다.
- 연결 실패·오프라인: 기존 REST 조회를 `pollingIntervalMs` 주기로 사용한다.
- 재연결 성공: 방 상세와 관리자 목록을 즉시 invalidate/refetch한다.
- 게시 실패: DB commit은 유지한다. 클라이언트는 재연결 REST 재동기화로 복구한다.

## 관측 지표

| 지표 | 의미 |
|---|---|
| `support.chat.messages{outcome=success|failure}` | SEND 처리 성공/실패 건수 |
| `support.chat.message.processing` | DB 저장부터 publish 호출까지 처리 시간 |
| `support.chat.connections{outcome=success|failure|disconnected}` | CONNECT 인증 결과와 연결 종료 건수 |
| `support.chat.subscriptions{outcome=success|failure}` | 방/관리자/개인 queue 구독 권한 검사 결과 |
| application warning log | commit 후 event 게시 실패 |

Spring Actuator `/actuator/metrics`에서 위 meter를 확인한다. 로그에는 JWT, 메시지 본문, SQL 상세를 남기지 않는다.

## 부하 테스트 시나리오

1. 300개 CONNECT를 30초에 걸쳐 증가시키고 CONNECT 성공률과 p95를 측정한다.
2. 각 연결이 개인 오류 queue와 자기 방 topic을 구독한다.
3. USER 150명과 ADMIN 10명이 초당 합계 30건을 10분간 SEND한다.
4. 전송의 5%는 같은 `clientMessageId`로 한 번 재시도한다.
5. 10% 연결을 강제 종료하고 5초 자동 재연결과 REST 재동기화를 확인한다.
6. 관리자 큐 구독자가 모든 `ROOM_UPDATED`/`ROOM_REMOVED`를 적용하는지 확인한다.

성공 기준:

- 인증되지 않은 CONNECT와 권한 없는 SUBSCRIBE 성공 0건
- 중복 `clientMessageId`의 DB row 증가 0건
- 메시지 저장 성공 대비 canonical room event 수신율 99% 이상(재동기화 후 100%)
- SEND 처리 p95 500ms 이하(비LLM API 목표와 동일)
- 오류율 1% 이하
- 재연결 후 REST snapshot과 화면 cache의 최종 메시지 ID 일치

simple broker는 단일 API 인스턴스 기준이다. 다중 인스턴스 부하 검증 전에는 외부 broker relay, WebSocket session routing, fan-out 전략을 별도 설계해야 한다.

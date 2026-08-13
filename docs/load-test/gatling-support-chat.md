# 상담 STOMP Gatling 실행 가이드

## 목적과 범위

이 하네스는 AWS Loadgen EC2에서 단일 WAS의 상담 STOMP Smoke와 baseline
ramp-up을 같은 방식으로 재현하기 위한 것이다. 스레드 풀, WebSocket executor,
HikariCP, 애플리케이션 런타임 설정은 변경하지 않는다. 실제 AWS 대규모 실행과
튜닝도 이 작업의 범위가 아니다.

실행 순서는 반드시 `전용 데이터 준비 → 실제 로그인 토큰 준비 → Smoke → DB 검증
→ connection baseline → message baseline`이다. Smoke가 실패하면 baseline을
실행하지 않는다.

## 확인한 실제 계약

데이터 준비와 frame은 현재 코드와 Flyway 스키마를 기준으로 한다.

- 인증: `POST /api/auth/login`, body는 `email`, `password`, 응답의
  `accessToken`을 사용한다.
- 사용자: `users.role`은 `USER` 또는 `ADMIN`이고 비밀번호는 기존 bcrypt
  검증을 통과해야 한다.
- 티켓: `as_tickets.user_id`, `assigned_admin_id`, `status='ASSIGNED'`를 사용한다.
- 상담방: `support_chat_rooms.user_id`, `as_ticket_id`, `status='ACTIVE'`를
  사용한다.
- 메시지 멱등 키: `support_chat_messages(sender_user_id, client_message_id)`의
  partial unique index가 적용되어 있다.
- STOMP endpoint: `/ws/support-chat`
- CONNECT native header: `Authorization:Bearer {accessToken}`
- room subscription: `/topic/support-chat/rooms/{roomId}`
- error subscription: `/user/queue/support-chat-errors`
- SEND destination: `/app/support-chat/messages`
- canonical event: `type=MESSAGE_CREATED`와 원래 `clientMessageId`를 포함한다.

## 테스트 데이터와 안전장치

`scripts/prepare-data.sh`는 `psql`로 다음 전용 데이터만 만든다.

| 종류 | 수 | 식별 방식 |
| --- | ---: | --- |
| USER | 150 | `loadtest-user-NNN@example.invalid` |
| ADMIN | 10 | `loadtest-admin-NNN@example.invalid` |
| AS ticket | 150 | `30000000-...-NNNNNNNNNNNN` UUID |
| ACTIVE room | 150 | `40000000-...-NNNNNNNNNNNN` UUID |

UUID와 email이 결정적이고 `ON CONFLICT` upsert를 사용하므로 반복 실행해도
행이 늘어나지 않는다. 첫 번째 USER, 첫 번째 ADMIN, 첫 번째 room이 Smoke
데이터다. 비밀번호 hash는 DB의 `pgcrypto`로 매 실행 갱신한다.

스크립트는 `LOADTEST_CONFIRM_NON_PROD=YES`가 없으면 즉시 중단한다. 데이터
준비 시 deterministic load-test room의 기존 메시지만 삭제하고 unread/last
message를 초기화한다. 실제 로그인으로 생긴 load-test 계정의 refresh token도
다음 준비 시 정리하므로 반복 실행으로 인증 행이 계속 늘어나지 않는다. 따라서
운영 DB에 이 스크립트를 실행해서는 안 되며,
별도 RDS 데이터베이스 또는 별도 load-test DB만 사용해야 한다.

## 토큰 준비

`scripts/prepare-tokens.py`는 JWT secret을 알거나 복사하지 않는다. 준비된
160개 계정으로 실제 `/api/auth/login`을 순차 호출하고 access token만 추출한다.
기본 0.6초 간격은 동일 IP 로그인 기본 제한인 120회/분을 넘지 않기 위한 값이다.
Smoke에서는 `--smoke-only`로 첫 USER/ADMIN 두 계정만 로그인하고, baseline
직전에는 옵션 없이 전체 160개 토큰을 준비한다.

다음 파일은 `loadtest/gatling/runtime/`에 생성되며 Git에서 무시된다.

- `accounts.csv`: DB에서 읽은 비민감 계정/room manifest
- `tokens.csv`: 실제 access token
- `smoke.csv`: Smoke USER/ADMIN/room
- `baseline-actors.csv`: 전체 300 connection actor
- `baseline-{20,50,100,150,200,300}.csv`: 단계별 feeder

기본 access token TTL은 15분이다. 6단계 baseline은 9분이고 토큰 준비에는
약 96초가 걸린다. 각 baseline 직전에 토큰을 다시 준비하고
`--minimum-valid-seconds 660`으로 가장 먼저 발급된 토큰의 남은 TTL을
검사한다. 서버 TTL을 15분보다 짧게 구성했다면 baseline을 실행하기 전에
TTL과 stage 상수를 다시 검토해야 한다.

## 300 CONNECT 모델

문서의 `300 CONNECT`는 동시 WebSocket 연결 수이고, `USER 150명 + ADMIN
10명`은 고유 계정 수라서 같은 숫자가 아니다. 이 하네스는 이를 숨기지 않고
다음 1:1 연결 모델을 사용한다.

```text
150 USER identities  -> room 001..150에 USER-side socket 150개
10 ADMIN identities  -> 같은 room 001..150에 ADMIN-side socket 150개
                         (ADMIN 1명당 15개 socket)
합계                  -> 150개 room, 160개 identity, 300 CONNECT
```

feeder는 같은 room의 USER/ADMIN actor를 교대로 배치한다. 따라서 모든 단계는
`20=10+10`, `50=25+25`, ..., `300=150+150`으로 양쪽 연결이 균형을 이룬다.
이는 실제 상담의 1:1 room 구조를 유지하면서 관리자 한 명이 여러 상담을 동시에
구독할 수 있다는 현재 권한 모델을 반영한다.

## Smoke Simulation

`SupportChatSmokeSimulation`은 USER 1 connection과 ADMIN 1 connection이 같은
room topic과 각자의 error queue를 구독한 뒤 동시에 다음을 수행한다.

- USER → room: `gatling-smoke-user` 5건
- ADMIN → room: `gatling-smoke-admin` 5건
- ADMIN 연결이 USER canonical 5건, USER 연결이 ADMIN canonical 5건을 별도 검증
- 매 SEND마다 새 UUID `clientMessageId`
- 송신 시점부터 같은 ID의 canonical `MESSAGE_CREATED`까지 `Chat Roundtrip`
- canonical 직후 100ms 동안 같은 연결에서 동일 ID가 다시 오면 duplicate
- CONNECT 응답과 SUBSCRIBE 직후 ERROR guard, STOMP/application error frame 집계

Smoke gate는 CONNECT 2/2, SUBSCRIBE 4/4, SEND 10,
MESSAGE_CREATED 10, missing 0, duplicate 0, error 0, Gatling failed request 0을
요구한다. 이후 `verify-smoke.sh`가 DB 메시지 10행과 서로 다른
`client_message_id` 10개를 확인한다.

현재 Spring simple broker는 SUBSCRIBE의 `receipt` header에 `RECEIPT` frame을
보내지 않는다. 하네스는 200ms 동안 `ERROR`를 감시해 명시적 거부를 실패로
기록하고, 정상 room 구독 여부는 Smoke에서 양쪽 연결이 자기 SEND의 canonical
event를 실제 수신하는 것으로 확정한다. connection-only baseline의 SUBSCRIBE
성공 수는 이 ERROR guard 기준이다.

## Baseline Simulation

연결 비용과 메시지 처리량을 섞지 않도록 두 Simulation으로 나눈다.

- `SupportChatConnectionBaselineSimulation`: CONNECT와 두 SUBSCRIBE 후 유지,
  SEND 없음
- `SupportChatMessageBaselineSimulation`: 같은 연결 모델에서 각 VU가
  `pace(1 second)`로 작은 메시지를 전송하고 canonical event를 기다림

코드 상수는 다음과 같다.

| 상수 | 값 | 의미 |
| --- | ---: | --- |
| `VU_STAGES` | 20, 50, 100, 150, 200, 300 | 단계별 목표 동시 연결 |
| `RAMP_UP` | 15초 | 0에서 목표 VU까지 연결 |
| `STAGE_HOLD` | 45초 | 목표 VU 유지 |
| `RAMP_DOWN` | 15초 | actor가 자연 종료되는 구간 |
| `RECOVERY` | 15초 | 다음 단계 전 무부하 회복 |
| `ACTOR_LIFETIME` | 60초 | ramp-up + hold |
| `MESSAGE_PACE` | 1초 | VU별 목표 SEND 간격 |

message baseline은 canonical 응답을 기다리는 closed workload다. 정상 구간에서는
VU당 1 message/s를 제공하지만 응답이 5초 timeout에 가까워지면 실제 offered
rate가 낮아진다. 이 감소 자체가 포화 신호이므로 Gatling의 stage별 request rate,
latency, timeout을 함께 해석한다.

## 수집 지표와 결과 파일

Gatling HTML/report에는 다음 request/check 이름이 기록된다.

- `WebSocket handshake`
- `STOMP CONNECT send`
- `STOMP CONNECT`
- `STOMP SUBSCRIBE room send`
- `STOMP SUBSCRIBE errors send`
- `STOMP SEND`
- `Chat Roundtrip`
- `USER to ADMIN canonical #1..#5`
- `ADMIN to USER canonical #1..#5`

`Chat Roundtrip`의 p50/p95/p99와 request/s는 Gatling report에서 확인한다.
추가 JSON `loadtest/results/summary-*.json`에는 다음 필드가 기록된다.

- CONNECT attempted/succeeded/failed
- SUBSCRIBE attempted/succeeded/failed
- SEND count
- MESSAGE_CREATED count
- missing count
- duplicate count
- error frame count
- Chat Roundtrip p50/p95/p99 milliseconds
- canonical messages/s와 전체 elapsed seconds

`loadtest/results/`의 실제 결과와 `runtime/` token/feeder는 Git에서 무시된다.

## Loadgen EC2 실행 명령

Amazon Linux 계열 Loadgen에 Java 21, Python 3, PostgreSQL client를 설치하고
repository를 checkout한 상태를 전제로 한다. 실제 값은 shell 환경에만 둔다.

```bash
cd /opt/buildgraph
export LOADTEST_DATABASE_URL='postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/buildgraph'
export LOADTEST_CONFIRM_NON_PROD='YES'
export LOADTEST_ACCOUNT_PASSWORD='use-a-temporary-strong-password'
export LOADTEST_HTTP_BASE_URL='http://172.31.10.173:8080'
export LOADTEST_WS_URL='ws://172.31.10.173:8080/ws/support-chat'
export LOADTEST_RESULTS_DIR='../results'

cd loadtest/gatling
./scripts/prepare-data.sh
python3 ./scripts/prepare-tokens.py --smoke-only --minimum-valid-seconds 120

../../apps/api/gradlew -p . gatlingRun \
  --simulation com.buildgraph.loadtest.SupportChatSmokeSimulation --no-daemon
./scripts/verify-smoke.sh
```

Smoke와 DB 검증이 모두 성공한 경우에만 baseline을 실행한다. 각 baseline 직전에
토큰을 새로 준비한다.

```bash
./scripts/prepare-data.sh
python3 ./scripts/prepare-tokens.py --minimum-valid-seconds 660
../../apps/api/gradlew -p . gatlingRun \
  --simulation com.buildgraph.loadtest.SupportChatConnectionBaselineSimulation --no-daemon

./scripts/prepare-data.sh
python3 ./scripts/prepare-tokens.py --minimum-valid-seconds 660
../../apps/api/gradlew -p . gatlingRun \
  --simulation com.buildgraph.loadtest.SupportChatMessageBaselineSimulation --no-daemon
```

필수 환경 변수는 `LOADTEST_DATABASE_URL`, `LOADTEST_CONFIRM_NON_PROD`,
`LOADTEST_ACCOUNT_PASSWORD`, `LOADTEST_HTTP_BASE_URL`, `LOADTEST_WS_URL`,
`LOADTEST_RESULTS_DIR`이다.
실제 비밀번호, RDS endpoint, JWT, JWT secret은 파일이나 Git에 저장하지 않는다.

## 실행 전후 확인

1. WAS `/actuator/health`(management port 9091)가 `UP`인지 확인한다.
2. `prepare-data.sh` 출력이 USER 150, ADMIN 10, room 150인지 확인한다.
3. Smoke JSON과 Gatling report가 모두 성공인지 확인한다.
4. `verify-smoke.sh`가 DB 10행/고유 ID 10개를 통과하는지 확인한다.
5. 그 후에만 connection baseline과 message baseline을 각각 실행한다.
6. 결과 해석 시 WAS의 `/actuator/prometheus` STOMP executor/custom metric과
   Loadgen CPU/network도 함께 보존한다.

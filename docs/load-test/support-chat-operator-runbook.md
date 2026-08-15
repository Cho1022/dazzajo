# 상담 채팅 부하 테스트 운영자 실행서

이 문서는 긴 명령을 다시 조합하지 않고도 동일한 상담 STOMP 테스트를 반복하기 위한 실행서다. 스크립트는 AWS EC2 자체를 시작하거나 중지하지 않으며, 스레드 풀·Hikari·애플리케이션 값을 변경하지 않는다.

## 1. 최초 한 번: 환경 파일 준비

Loadgen EC2의 repository에서 실행한다.

```bash
cd /opt/buildgraph/loadtest/gatling
cp .env.loadtest.example .env.loadtest
chmod 600 .env.loadtest
vi .env.loadtest
```

다음 값을 실제 loadtest 전용 값으로 교체한다.

- `LOADTEST_DATABASE_URL`: 운영 DB가 아닌 loadtest RDS
- `LOADTEST_ACCOUNT_PASSWORD`: 테스트 계정용 임시 비밀번호
- `LOADTEST_HTTP_BASE_URL`: WAS의 `8080` 주소
- `LOADTEST_WS_URL`: WAS의 `/ws/support-chat` 주소
- `LOADTEST_MANAGEMENT_BASE_URL`: Loadgen에서 접근 가능한 WAS `9091` 주소

`.env.loadtest`와 실제 토큰 파일은 Git에서 무시된다.

## 2. WAS와 DB 사전 점검

AWS 콘솔에서 RDS가 `available`, WAS EC2가 `running`인지 먼저 확인한다. 그다음 Loadgen에서 다음 한 줄만 실행한다.

```bash
bash ./scripts/preflight.sh
```

이 명령은 다음을 읽기 전용으로 확인한다.

1. `curl`, `git`, Java 21, `psql`, Python 3 존재
2. loadtest 전용 확인값과 필수 환경변수
3. PostgreSQL `SELECT 1`
4. `/actuator/health`의 `UP`
5. Prometheus inbound/outbound executor 지표 8개

한 항목이라도 실패하면 이후 테스트를 실행하지 않는다.

## 3. Smoke

```bash
bash ./scripts/run-smoke.sh
```

내부 실행 순서는 다음과 같다.

```text
preflight
→ 전용 USER/ADMIN/티켓/상담방 준비
→ 실제 로그인 토큰 2개 발급
→ USER와 ADMIN 양방향 10건 전송
→ Gatling summary 검증
→ PostgreSQL 10행·고유 clientMessageId 10개 검증
```

마지막에 `Smoke passed`가 출력되어야 한다.

## 4. Baseline

연결 비용과 메시지 처리 비용을 분리해 실행한다.

```bash
bash ./scripts/run-baseline.sh connection
bash ./scripts/run-baseline.sh message
```

두 테스트를 한 번에 순서대로 실행하려면 다음을 사용한다.

```bash
bash ./scripts/run-baseline.sh all
```

`connection`, `message`, `all`은 먼저 Smoke를 자동 실행한다. 각 본 테스트 직전에는 데이터를 초기화하고 160개 실제 로그인 토큰을 새로 발급한다.

## 5. 500ms Stress

같은 Git SHA와 같은 HTTP·WebSocket 대상에서 `message` baseline이 wrapper 검증을 통과한 경우에만 실행된다.

```bash
bash ./scripts/run-baseline.sh stress
```

조건이 맞지 않으면 stress를 시작하지 않고 message baseline 재실행 명령을 출력한다.

## 6. 결과 ZIP

```bash
bash ./scripts/collect-results.sh
```

결과는 `loadtest/artifacts/support-chat-<UTC 시각>.zip`에 생성된다. ZIP에는 다음만 들어간다.

- Gatling HTML report와 simulation log
- `summary-*.json`
- Git SHA, branch, 대상 URL, 파일 목록 manifest

다음은 포함하지 않는다.

- `runtime/`의 JWT·feeder
- `.env.loadtest`
- RDS 비밀번호

결과 파일에서 Bearer JWT 형식이 발견되면 ZIP 생성을 거부한다.

## 7. 성공 후 기록할 값

- 실행 시각과 Git SHA
- CONNECT·SUBSCRIBE 성공/실패
- SEND와 `MESSAGE_CREATED` 수
- missing·duplicate·ERROR frame 수
- Chat Roundtrip p50/p95/p99
- 완료 messages/s
- inbound/outbound active thread와 queue 최대값
- Hikari pending
- WAS CPU·컨테이너 메모리·OOM·restart
- RDS CPU·connection·latency

이 값들을 함께 봐야 `corePoolSize`, DB pool, WAS 사양 중 무엇을 다음 실험 변수로 삼을지 결정할 수 있다.

# Support Chat 단일 WAS 부하 테스트 배포

이 문서는 운영 배포와 분리된 `loadtest` 프로필로 사용자-관리자 STOMP 상담 채팅 WAS 한 대를 AWS에서 기동하는 절차만 다룬다. 부하 시나리오 실행과 스레드 풀·큐·Hikari 튜닝은 이 단계의 범위가 아니다.

## 런타임 의존성

| 구성 요소 | 필요 여부 | 근거 |
| --- | --- | --- |
| RDS PostgreSQL | 필수 | Flyway/JPA 기동, JWT 사용자의 DB 확인, 상담방 ACL, 메시지·unread 트랜잭션이 PostgreSQL을 사용한다. |
| ElastiCache Redis | 불필요 | 상담 채팅 경로는 Redis를 사용하지 않는다. Redis는 Google OAuth runtime store와 Build Chat cache용이며, loadtest 프로필은 관련 cache/prewarm을 끄고 Redis health indicator를 제외한다. |
| Amazon MQ RabbitMQ | 불필요 | 상담 메시지는 Spring simple broker의 `/topic`으로 publish된다. RabbitMQ는 Agent·가격·추천 이벤트 worker용이며, loadtest 프로필은 listener auto-start와 세 worker를 끈다. |
| XGBoost scorer | 불필요 | support chat과 무관하며 reranker와 shadow probe를 기존 스위치로 끈다. |
| OpenAI/Naver/Google OAuth | 불필요 | support chat은 외부 API를 호출하지 않는다. 키를 비워 두고 RAG·가격 수집·prewarm을 끈다. |

RabbitMQ publisher와 Redis template 빈은 애플리케이션 컨텍스트에 남아 있지만 연결은 해당 기능을 호출할 때 지연 생성된다. loadtest WAS는 그 기능을 호출하지 않는다. `management.health.redis.enabled=false`와 `management.health.rabbit.enabled=false`는 사용하지 않는 외부 서비스가 support-chat health를 DOWN으로 만들지 않게 한다.

`QuoteDraftHistoryEvaluationDispatcher`는 별도 on/off 스위치가 없어 애플리케이션 준비 시 대기 건 확인용 DB 조회를 한 번 수행할 수 있다. 새 feature flag를 만들지 않는다는 제약 때문에 코드는 변경하지 않았고, 전역 `BUILDGRAPH_SCHEDULING_ENABLED=false`로 반복 `@Scheduled` 실행만 막는다.

## Loadtest 프로필

`application-loadtest.yml`은 다음만 변경한다.

- 애플리케이션 포트는 기존 `8080` 유지
- management 포트 `9091`
- `health`, `info`, `metrics`, `prometheus` 노출
- `http.server.requests`, `support.chat.message.processing` histogram 활성화
- 기존 설정 스위치로 scheduler, Rabbit listener/worker, 가격 수집, AI/RAG prewarm·외부 호출, 추천 scorer·재학습 비활성화
- 사용하지 않는 Redis/Rabbit health indicator 제외

Tomcat thread, STOMP executor, queue, Hikari pool 값은 덮어쓰지 않는다. `application.yml`의 현재 값이 baseline이다.

## STOMP executor 메트릭

Spring Boot의 executor 자동 계측이 WebSocket message broker executor를 다음 Prometheus 시계열로 노출한다. inbound와 outbound는 `name` label로 구분한다.

| Prometheus metric | label | 의미 |
| --- | --- | --- |
| `executor_pool_size_threads` | `name="clientInboundChannelExecutor"` | inbound 현재 pool thread 수 |
| `executor_active_threads` | `name="clientInboundChannelExecutor"` | inbound 실행 중 thread 수 |
| `executor_queued_tasks` | `name="clientInboundChannelExecutor"` | inbound queue 대기 task 수 |
| `executor_completed_tasks_total` | `name="clientInboundChannelExecutor"` | inbound 완료 task 누계 |
| `executor_pool_size_threads` | `name="clientOutboundChannelExecutor"` | outbound 현재 pool thread 수 |
| `executor_active_threads` | `name="clientOutboundChannelExecutor"` | outbound 실행 중 thread 수 |
| `executor_queued_tasks` | `name="clientOutboundChannelExecutor"` | outbound queue 대기 task 수 |
| `executor_completed_tasks_total` | `name="clientOutboundChannelExecutor"` | outbound 완료 task 누계 |

기존 custom meter도 그대로 유지된다.

- `support_chat_connections_total` (`outcome=success|failure|disconnected`)
- `support_chat_subscriptions_total` (`outcome=success|failure`)
- `support_chat_messages_total` (`outcome=success|failure`)
- `support_chat_message_processing_seconds`와 histogram bucket/count/sum

## 환경 변수 준비

실제 비밀값은 커밋하지 않는다. 예제를 복사한 뒤 EC2에서만 채운다.

```bash
cd /opt/buildgraph
cp infra/loadtest/.env.loadtest.example infra/loadtest/.env.loadtest
chmod 600 infra/loadtest/.env.loadtest
```

반드시 교체할 값은 다음과 같다.

- `LOADTEST_WAS_IMAGE`: immutable git SHA tag의 ECR API image URI
- `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD`: loadtest RDS 접속 정보
- `BUILDGRAPH_AUTH_JWT_SECRET`: 32바이트 이상 랜덤 secret
- `BUILDGRAPH_CORS_ALLOWED_ORIGINS`: load generator 또는 smoke UI origin

Redis endpoint, RabbitMQ endpoint, OpenAI/Naver/Google secret은 필요하지 않다.

## AWS 기동

ECR 로그인 후 repository root에서 실행한다.

```bash
docker compose \
  -f infra/loadtest/compose.was.yml \
  --env-file infra/loadtest/.env.loadtest \
  config --quiet

docker compose \
  -f infra/loadtest/compose.was.yml \
  --env-file infra/loadtest/.env.loadtest \
  up -d
```

API `8080`은 ALB 또는 허용된 load generator에서만 접근시키고, management `9091`은 Prometheus/운영자 보안 그룹에서만 허용한다. 인터넷 전체에 `9091`을 열지 않는다.

## 기동 확인

```bash
curl -fsS http://127.0.0.1:9091/actuator/health
curl -fsS http://127.0.0.1:9091/actuator/prometheus \
  | grep -E 'client(Inbound|Outbound)ChannelExecutor'
```

성공 기준은 health HTTP 200/`UP`, prometheus HTTP 200, inbound/outbound 각각 네 executor metric 시계열 출력이다. 이 확인이 끝나도 부하 실행이나 pool tuning은 시작하지 않는다.

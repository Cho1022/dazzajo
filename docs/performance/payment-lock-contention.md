# 결제·취소 비관적 락의 커넥션 점유 비용 검증

## 검증 질문

동일한 조립 요청(`Request`)의 행 잠금을 기다리는 요청들이 HikariCP 커넥션을 점유해 풀을 고갈시키고, 관계없는 다른 조립 요청의 조회까지 지연시키거나 실패하게 만드는가?

이 검증은 결제 완료·사용자 취소 경쟁 상태를 막기 위해 적용한 PostgreSQL 비관적 락의 비용을 확인한다. 제품 코드나 Hikari 설정을 바꾸지 않고, 실제 PostgreSQL과 현재 API를 사용한다.

## 실험 자산

- `tools/run_payment_lock_contention.ps1`: fixture 준비·정리, 외부 트랜잭션의 락 보유, k6 실행, Hikari·PostgreSQL 지표 수집과 중앙값 계산
- `infra/k6/payment-lock-contention.js`: Control GET과 Hot Request 취소·결제 완료 요청 실행
- `tools/payment_lock_contention_fixture.sql`: Hot Request 1개와 Control Request 1개 생성
- `tools/payment_lock_contention_cleanup.sql`: 실행별 fixture 정리

원본 실행 결과는 `.qa-results/payment-lock-contention/<RunId>/`에 생성된다. `.qa-results/`는 Git에서 제외되며 커밋하지 않는다.

## 환경

| 항목 | 값 |
|---|---:|
| PostgreSQL | 실제 Docker PostgreSQL |
| Hikari `maximumPoolSize` | 25 |
| Hikari `connectionTimeout` | 1,500ms |
| Control 부하 | 서로 다른 Control Request 상세 GET, 10 RPS |
| 실행 시간 | 조건별 10초 |
| 관측 간격 | Hikari·DB lock 약 200ms |
| 반복 | 조건별 3회, 중앙값 사용 |
| fixture | Hot Request 1개, Control Request 1개 |

DB lock 수집의 실제 중앙 간격은 203ms, Hikari 수집의 실제 중앙 간격은 210.1ms였다. 3회 반복은 로컬 실행 안정성을 확인하기 위한 것이며 통계적 성능 보장을 의미하지 않는다.

## 시나리오

### Baseline

별도 lock holder 없이 Control Request 상세 GET만 10 RPS로 10초 실행한다.

### Controlled contention

별도 PostgreSQL connection과 transaction이 Hot Request를 `SELECT FOR UPDATE`로 잠근다. 첫 Hot Request waiter가 확인된 시점부터 5초 동안 잠금을 유지한다. 그동안 동일 Hot Request에 사용자 취소를 각각 10개, 25개, 50개 동시에 전송하고 Control GET도 10 RPS로 실행한다.

제품 코드에는 지연이나 테스트용 분기를 추가하지 않는다.

### Realistic contention

인위적인 lock holder 없이 동일 Hot Request에 실제 결제 완료 1건과 사용자 취소 1건을 동시에 실행한다. 결제·취소 상태 정책과 멱등 처리 경로는 제품 코드 그대로 사용한다.

## 핵심 결과

아래 값은 조건별 3회 결과의 중앙값이다. `pending`은 run별 Hikari pending 최대값의 중앙값이고, `timeout`은 run 동안 증가한 Hikari timeout counter의 중앙값이다.

| 조건 | Control p50 | Control p95 | Control p99 | p95 변화 | Hikari pending | Hikari timeout |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 6.691ms | 13.591ms | 21.700ms | 기준 | 0 | 0 |
| controlled-10 | 6.837ms | 14.150ms | 21.930ms | +4.11% | 0 | 0 |
| controlled-25 | 18.470ms | 1,506.938ms | 1,509.005ms | +10,988.01% | 14 | 32 |
| controlled-50 | 17.470ms | 1,505.703ms | 1,519.559ms | +10,978.93% | 38 | 59 |
| realistic | 6.830ms | 16.464ms | 23.590ms | +21.14% | 0 | 0 |

통제 실험에서 확인한 DB lock waiter 최대값의 중앙값은 동시 요청 수에 따라 10, 25, 25였다. 최대 대기 시간 중앙값은 각각 4,983.187ms, 5,479.071ms, 5,096.390ms였다.

HTTP와 상태 무결성 결과는 다음과 같다.

- `controlled-10`: Control 5xx 0건, Hot 2xx 30건
- `controlled-25`: Control 5xx 91건, Hot 2xx 75건
- `controlled-50`: Control 5xx 95건, Hot 2xx 75건, Hot 5xx 75건
- `realistic`: Hot 2xx 3건, 정상 `409 CONFLICT_STATE` 3건, 서버 5xx 0건
- 모든 조건에서 `Request=CANCELLED + Payment=PAID` 금지 상태 0건
- 모든 조건에서 부분 상태 반영 0건

`controlled-25`와 `controlled-50`의 API 로그에는 `total=25, active=25, idle=0` 및 `request timed out after 1500ms`가 기록됐다. Hikari timeout에는 같은 시간대 scheduled task의 커넥션 획득 실패도 일부 포함될 수 있으므로 HTTP 5xx 수와 정확히 일치하지 않는다.

## 해석과 결정

동일 Request의 락 waiter가 10개일 때는 25개 pool에 여유가 있어 관계없는 Control Request의 p95 변화가 작았다.

락 waiter가 pool 크기인 25개에 도달하자 모든 커넥션이 잠금 대기에 점유됐다. 이후 들어온 관계없는 Control Request는 커넥션을 받지 못하고 약 1.5초의 `connectionTimeout` 부근에서 실패했다. 50개 동시 요청에서는 Hot Request 일부도 커넥션을 얻지 못했다.

반면 실제 결제 완료 1건과 사용자 취소 1건의 경쟁에서는 Hikari pending·timeout과 DB lock waiter가 발생하지 않았다. 세 번 모두 한 작업이 성공하고 후행 작업은 `409 CONFLICT_STATE`로 종료됐으며 금지 상태와 부분 반영도 없었다.

따라서 현재 결제 완료·사용자 취소 경로는 PostgreSQL 비관적 락을 유지한다. 이 결과만으로 requestId 기반 로컬 락이나 Redis 분산 락을 추가하지 않는다.

## 한계

- 로컬 Docker Desktop 환경의 결과이며 운영 인프라의 처리량이나 지연으로 일반화하지 않는다.
- 통제 실험은 위험을 관측하기 위해 외부 transaction이 첫 waiter 확인 후 5초 동안 강제로 락을 보유한다.
- 조건별 3회 중앙값은 안정성 확인용이며 충분한 통계 표본이 아니다.
- `controlled-25`와 `controlled-50`에서는 k6의 VU 한도 때문에 조건별 3회 합계 18개의 iteration이 drop됐다.
- `realistic` 첫 실행에서 Control GET 1건이 Docker/k6 transport timeout(`status=0`)으로 기록됐다. 당시 Hikari pending·timeout, DB waiter, 서버 5xx는 모두 0이어서 DB 락 전파로 판정하지 않았다.
- 가장 높은 경합의 한 실행에서는 로컬 호스트 과부하로 DB 관측 간격이 최대 1,891ms까지 벌어졌다.
- 동일 Request에 대한 결제 재시도나 웹훅 재전송 구조가 바뀌어 실제 동시성이 증가하면 이 실험을 다시 실행하고 애플리케이션 키 락 또는 빠른 충돌 정책의 필요성을 재검토해야 한다.

## 재현 방법

### 1. 서비스 실행

API와 PostgreSQL을 포함한 로컬 서비스를 실행한다.

```powershell
docker compose up -d postgres redis rabbitmq mailpit xgb-reranker api
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

API와 실행기가 동일한 PostgreSQL database를 사용해야 한다. 기본 Compose 환경은 `buildgraph`를 사용한다.

### 2. 전체 실험 실행

저장소 루트에서 다음 명령을 실행한다.

```powershell
.\tools\run_payment_lock_contention.ps1 `
  -Repeats 3 `
  -ControlledFanOut 10,25,50 `
  -Duration 10s `
  -ControlRate 10 `
  -SampleIntervalMs 200
```

별도 database에 API를 연결한 경우 실행기에도 같은 이름을 전달한다.

```powershell
.\tools\run_payment_lock_contention.ps1 `
  -PostgresDatabase buildgraph_lock_perf `
  -Repeats 3 `
  -ControlledFanOut 10,25,50 `
  -Duration 10s `
  -ControlRate 10 `
  -SampleIntervalMs 200 `
  -RunId paylock-v3
```

### 3. 결과 확인

실행이 끝나면 다음 파일을 확인한다.

- `.qa-results/payment-lock-contention/<RunId>/summary.csv`: 조건별 3회 중앙값
- `.qa-results/payment-lock-contention/<RunId>/runs.json`: 개별 run의 HTTP·Hikari·DB·최종 상태
- `.qa-results/payment-lock-contention/<RunId>/<Condition>-rN/hikari.csv`: Hikari 시계열
- `.qa-results/payment-lock-contention/<RunId>/<Condition>-rN/db-locks.csv`: DB waiter와 `pg_blocking_pids` 시계열
- `.qa-results/payment-lock-contention/<RunId>/<Condition>-rN/k6-summary.json`: k6 원본 요약

정상 종료 후 해당 RunId의 fixture, idle collector session, container stop marker가 남지 않아야 한다.

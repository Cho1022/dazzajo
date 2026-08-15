\# STOMP 메시지 처리 한계 탐색 사전 계획



\## 실험 목적



JVM Heap 상한을 `-Xmx1024m`으로 제한해 OOM과 메시지 미수신을 제거한

상태에서 현재 시스템의 다음 포화 지점을 찾는다.



STOMP Inbound Executor를 미리 병목으로 단정하지 않고 다음 중 어떤 자원이

먼저 한계에 도달하는지 계측한다.



\- STOMP Inbound Executor

\- WAS CPU

\- JVM·컨테이너 메모리

\- HikariCP Connection Pool

\- RDS 쓰기 처리

\- Load Generator



\## 기존 기준선



\- 최대 WebSocket 연결: 300

\- 메시지 Pace: VU당 1초

\- 전송·DB 저장·실시간 수신: 50,020 / 50,020 / 50,020

\- 미수신: 0건

\- p95: 16ms

\- p99: 44ms

\- 평균 완료 처리량: 94.970 msg/s

\- Grafana 순간 처리량: 약 290 msg/s

\- Inbound Active Threads: 최대 4

\- Inbound Queue: 최대 약 30

\- Hikari Pending: 0

\- 컨테이너 최대 메모리: 991MiB

\- OOM·재시작: 0회



\## 독립 변수



메시지 Pace만 변경한다.



```text

기존: VU당 1초

Stress: VU당 500ms


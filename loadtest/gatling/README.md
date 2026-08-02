# Support chat Gatling harness

이 프로젝트는 사용자–관리자 1:1 상담 STOMP 서버의 Smoke와 AWS Loadgen
Baseline을 실행한다. 애플리케이션 튜닝값은 포함하지 않는다.

- Java 21
- Gatling 3.15.1 / Gradle plugin 3.15.1.2
- 실제 STOMP 1.2 text frame
- 기본 대상: `ws://172.31.10.173:8080/ws/support-chat`

실행 순서와 안전 조건은
[`docs/load-test/gatling-support-chat.md`](../../docs/load-test/gatling-support-chat.md)를 따른다.

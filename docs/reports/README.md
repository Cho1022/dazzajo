# Report artifact policy

이 디렉터리에는 사람이 읽는 Markdown 요약과 재사용 템플릿만 추적한다.

- 실행별 raw JSON, screenshot, HTML, ZIP은 GitHub Actions artifact 또는 외부 저장소에 보관한다.
- 테스트·평가의 canonical 입력과 golden oracle은 `tools/` 및 테스트 fixture에 유지한다.
- 저장소 다이어트 이전 raw 증거는 [`v1-rfq-baseline`](https://github.com/Cho1022/dazzajo/tree/v1-rfq-baseline/docs/reports)에서 확인할 수 있다.
- benchmark 도구는 이 경로에 raw 파일을 다시 생성할 수 있지만 `.gitignore`에 의해 추적되지 않는다.

`docs/reports/danawa-price-trend-manual-verification.tsv`는 자동 생성 결과가 아니라 부품 286개 수동 검증 원본이므로 예외적으로 유지한다.

`apps/web/public/downloads/pc-agent/agent.exe`는 현재 웹 다운로드와 Agent 자동 업데이트가 직접 사용하는 배포 원본이다. 별도 릴리스 저장소와 배포 검증이 마련되기 전에는 report artifact로 취급해 삭제하지 않는다.

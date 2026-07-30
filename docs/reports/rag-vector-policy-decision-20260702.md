# RAG Vector 경로별 정책 결정 보고서 - 2026-07-02

## 결론

현재 기본값 `RAG_VECTOR_ENABLED=true`는 유지한다. `vector-off` 계열은 평균 latency가 10~16ms 수준으로 빠르지만, `REQUIREMENT_PARSE`, `BUILD_RECOMMEND`, `PUBLIC_SEARCH`, `BUILD_EXPLAIN`에서 결과가 거의 비어 품질 기준으로 탈락이다.

경로별 override도 이번 단계에서는 기본값을 바꾸지 않는다. `RAG_VECTOR_REQUIREMENT_PARSE_ENABLED`, `RAG_VECTOR_BUILD_RECOMMEND_ENABLED`, `RAG_VECTOR_AS_ANALYZE_ENABLED`, `RAG_VECTOR_PUBLIC_SEARCH_ENABLED`는 전역값 상속을 유지한다.

## 근거

기준 파일: [`rag-retrieval-benchmark-20260703.md`](rag-retrieval-benchmark-20260703.md), [`v1-rfq-baseline`의 JSON 원본](https://github.com/Cho1022/dazzajo/blob/v1-rfq-baseline/docs/reports/rag-retrieval-benchmark-20260703.json)

실행 전 `POST /api/admin/rag-embeddings/backfill`로 reusable RAG chunk 29개 전체에 `text-embedding-3-small` embedding을 백필했다. 2026-07-03 재측정에서는 변경된 chunk 3개가 갱신됐고 `embeddedTotal=29` 상태에서 fresh benchmark를 실행했다.

| variant | purpose | cases | top1 hit | topK hit | avg latency |
|---|---:|---:|---:|---:|---:|
| vector-on | REQUIREMENT_PARSE | 90 | 78.9% | 100.0% | 297ms |
| vector-on | BUILD_RECOMMEND | 20 | 75.0% | 100.0% | 298ms |
| vector-on | AS_ANALYZE | 50 | 78.0% | 100.0% | 303ms |
| vector-on | BUILD_EXPLAIN | 10 | 100.0% | 100.0% | 297ms |
| vector-on | PUBLIC_SEARCH | 20 | 90.0% | 100.0% | 305ms |
| vector-off | REQUIREMENT_PARSE | 90 | 0.0% | 0.0% | 13ms |
| vector-off | BUILD_RECOMMEND | 20 | 0.0% | 0.0% | 11ms |
| vector-off | AS_ANALYZE | 50 | 2.0% | 2.0% | 13ms |
| vector-off | BUILD_EXPLAIN | 10 | 0.0% | 0.0% | 14ms |
| vector-off | PUBLIC_SEARCH | 20 | 0.0% | 0.0% | 11ms |

## 운영 정책

- public `/api/rag/search`는 관리자/검증 검색 품질이 중요하므로 vector 유지.
- `AS_ANALYZE`는 topK 100%로 현재 기준 통과이므로 vector 유지.
- `BUILD_EXPLAIN`은 topK 100%로 vector 유지.
- `REQUIREMENT_PARSE`와 `BUILD_RECOMMEND`는 topK 100%로 목표권에 들어왔지만 top1 안정성은 아직 낮다. 다음 개선 대상은 vector on/off가 아니라 top1 rerank 품질이다.

## 다음 개선 기준

- `REQUIREMENT_PARSE` topK hit 95% 이상 유지, top1 hit 85% 이상 목표.
- `BUILD_RECOMMEND` topK hit 95% 이상 유지, top1 hit 85% 이상 목표.
- `AS_ANALYZE`, `BUILD_EXPLAIN`, `PUBLIC_SEARCH`는 현재 수준보다 하락하지 않을 것.
- latency는 Build/AS Chat 전체 체감에서 LLM 호출 시간이 지배적이므로, retrieval 260~360ms는 현재 허용 범위다.

## 재실험 명령

```powershell
python tools\benchmark_rag_retrieval.py --variant-label vector-on --fresh
```

경로별 override를 비교할 때는 API 환경변수를 바꾸고 같은 명령을 다른 label로 실행한다.

```powershell
$env:RAG_VECTOR_REQUIREMENT_PARSE_ENABLED="false"
docker compose up --build -d api
python tools\benchmark_rag_retrieval.py --variant-label requirement-vector-off
```

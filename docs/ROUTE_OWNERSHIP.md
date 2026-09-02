# ROUTE_OWNERSHIP.md

## 목적

이 문서는 BuildGraph 3주 MVP에서 frontend route, frontend file, backend package, DB table, API endpoint의 주 owner를 고정한다.
한 route나 API는 반드시 한 명의 주 owner만 가진다. 협업이 필요한 경우 협업자를 별도 컬럼에 적는다.

## 공통 개발 원칙

- `products` 도메인은 사용하지 않고 `parts` 도메인을 사용한다.
- API path의 `{id}`와 frontend route param은 모두 `public_id`다.
- 내부 DB `BIGINT id`는 frontend에 노출하지 않는다.
- Auth 기능 owner와 Auth 공통/관리자 권한 owner는 분리한다.
- AdminShell owner와 각 admin page 내부 owner는 분리한다.
- 조립 기사 중개 요청·제안·가상 결제 상태·진행 상태는 V1에 포함한다. 실제 주문, PG 결제, 배송사 연동, 재고 차감, 타임세일은 포함하지 않는다.
- 직접 Tool check는 `tool_invocations`에 저장하지 않는다. Agent/recommend 내부 Tool 호출만 저장한다.
- 관리자 API는 `ADMIN` 권한 필요 여부를 명확히 유지한다.

## 병렬 개발 동결 규칙

MVP 기준 결정값:

- 세 문서의 API path, enum/status, owner, DB table, `public_id` 규칙은 기능 구현 전에 동결한다.
- path의 `{id}`와 route param의 `:buildId`, `:ticketId`, `:agentSessionId`는 모두 `public_id` 문자열이다.
- 내부 DB `BIGINT id`는 public API, route, frontend DTO, audit log `target_id`에 노출하지 않는다.
- `products`, 실제 주문, PG 결제, 배송사 연동, 재고 차감, 타임세일 도메인은 V1에서 추가하지 않는다. `assembly_payments`는 실제 결제가 아닌 가상 상태 기록이다.
- owner 변경, API path 변경, enum/status 변경, table 추가/삭제는 이 문서, `DB_SCHEMA.md`, `API_CONTRACT.md`를 같은 PR에서 동시에 수정해야 한다.
- 병렬 개발 중 임시 필드가 필요하면 public DTO에 노출하지 말고 feature 내부 mock이나 테스트 fixture로만 둔다.

## frontend 폴더 규칙

| 영역 | 폴더 규칙 |
|---|---|
| Quote/Build | `apps/web/src/features/quote/**` |
| Parts/Price/Tool | `apps/web/src/features/parts/**` |
| Agent/RAG/Admin evidence | `apps/web/src/features/admin/agent/**` 또는 `apps/web/src/features/admin/evidence/**` |
| Support/AS | `apps/web/src/features/support/**` |
| Auth 화면 | `apps/web/src/features/auth/**` |
| Admin shell/common | `apps/web/src/features/admin/shell/**`, `apps/web/src/components/**` |
| API client | 각 feature 내부 `*Api.ts` 또는 공통 `apps/web/src/lib/api.ts` |

공통 UI를 변경할 때는 아래 공유 지점 수정 권한 표를 따른다. 기능별 화면 owner는 자기 feature 폴더 내부 컴포넌트를 우선 사용하고, 공통 컴포넌트는 직접 수정 가능 범위를 넘기지 않는다.

## backend package 규칙

| 영역 | package 규칙 |
|---|---|
| Auth/User | `com.buildgraph.prototype.user`, `com.buildgraph.prototype.auth` |
| Quote/Build | `com.buildgraph.prototype.build`, `com.buildgraph.prototype.requirement` |
| Parts/Price/Tool | `com.buildgraph.prototype.part`, `com.buildgraph.prototype.price`, `com.buildgraph.prototype.tool` |
| Agent/RAG | `com.buildgraph.prototype.agent`, `com.buildgraph.prototype.rag` |
| Support/AS | `com.buildgraph.prototype.log`, `com.buildgraph.prototype.ticket` |
| Admin | `com.buildgraph.prototype.admin` |
| Common/Infra | `com.buildgraph.prototype.common`, config, security, migration |

## 공유 지점 수정 권한

5번 owner가 병목이 되지 않도록 공통 파일은 "승인만 필요한 변경"과 "5번만 직접 수정 가능한 변경"을 분리한다. "PR reviewer 필수"가 `예`인 항목은 주 owner가 직접 구현하지 않았더라도 해당 reviewer 승인 없이는 merge하지 않는다.

| 공유 지점 | 주 owner | 협업자 | 직접 수정 가능 범위 | PR reviewer 필수 |
|---|---|---|---|---|
| `/my/quotes` route | 1번 | 2번 | 1번은 build history 화면, 2번은 가격 알림 widget 및 조립 요청 상태 진입점과 관련 API 연결만 수정 가능 | 2번 변경 포함 시 1번, build history 변경 포함 시 2번 |
| `/builds/:buildId` route | 1번 | 2번, 3번 | 1번은 화면 composition과 `GET /api/builds/{id}`, 2번은 part 표시 DTO, 3번은 evidence link 표시만 수정 가능 | 2번 또는 3번 데이터 필드 변경 시 해당 owner |
| `/builds/:buildId/change-part` route | 1번 | 2번 | 1번은 교체 flow와 route state, 2번은 parts 검색/필터와 category별 후보 DTO만 수정 가능 | 예, 1번과 2번 상호 review |
| `/admin` route | 5번 | 2번, 3번, 4번 | 5번은 shell, guard, dashboard frame을 수정한다. 각 도메인 owner는 자기 admin summary card의 데이터 mapping만 수정 가능 | 도메인 card 변경 시 5번 |
| AdminShell | 5번 | 2번, 3번, 4번 | 승인만 필요한 변경: nav item label/order, 각 owner의 admin route link 추가. 5번만 직접 수정 가능한 변경: guard, layout slot contract, admin 권한 분기, dashboard 공통 query | 예, 5번 |
| Auth 화면 | 1번 | 5번 | 1번은 `/login`, `/signup`, `/auth/callback`, `/admin/login` 화면 state, form validation, Auth API 연결을 수정한다. token 저장 helper와 admin route guard 변경은 5번과 합의한다 | token/guard 변경 시 5번 |
| Auth API/User | 1번 | 5번 | 1번은 auth endpoint, users, JWT, refresh, OAuth 구현을 수정한다. 5번은 공통 API client, `RequireAdmin`, admin guard, security allowlist를 검토한다 | auth/token/security 변경 시 5번 |
| `components/**` | 5번 | 모든 화면 owner | 승인만 필요한 변경: 기존 prop을 깨지 않는 style variant, 접근성 label, 빈 상태 문구. 5번만 직접 수정 가능한 변경: prop rename/remove, layout primitive, table/form control contract, global theme token | 예, 5번 |
| `apps/web/src/lib/api.ts` | 5번 | 모든 API owner | 승인만 필요한 변경: owner별 endpoint wrapper 추가, typed DTO import 추가. 5번만 직접 수정 가능한 변경: auth header, refresh retry, base URL, error normalization, pagination 공통 처리 | error/auth/pagination 변경 시 5번 |
| `config/security` | 5번 | 모든 API owner | 5번만 직접 수정 가능: Spring Security chain, CORS, role mapping, JWT filter, public path allowlist. 각 owner는 필요한 path 권한을 문서와 PR 설명에 적는다 | 예, 5번 |
| Flyway migration | 5번 | 모든 DB table owner | 승인만 필요한 변경: 자기 도메인 table/index 초안 SQL. 5번만 직접 수정 가능한 변경: migration 번호, 실행 순서, extension, 공통 enum/check constraint, FK 순서 조정 | 예, 5번 |

## 담당자별 소유 범위

### 1번: Quote/Auth

| 항목 | 내용 |
|---|---|
| 담당 화면 route | `/`, `/requirements/new`, `/builds/latest`, `/builds/:buildId`, `/builds/:buildId/change-part`, `/my/quotes`, `/my/profile`, `/login`, `/signup`, `/auth/callback`, `/admin/login`, `/admin/build-graph-layouts` |
| frontend files | `features/quote/**`, `features/auth/**` |
| backend packages | `build`, `requirement`, `user`, `auth` |
| DB tables | `requirements`, `builds`, `build_items`, `users`, `user_auth_providers`, `refresh_tokens` |
| API endpoints | `POST /api/requirements/parse`, `POST /api/builds/recommend`, `POST /api/builds/from-chat`, `POST /api/build-graphs/resolve`, `GET /api/builds/{id}`, `GET /api/builds/history`, `POST /api/builds/{id}/change-part`, `POST /api/users`, `POST /api/users/me/password-verification`, `PATCH /api/users/me`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/google/start`, `GET /api/auth/google/callback`, `POST /api/auth/exchange` |
| 협업자 | Auth 공통/token/guard/security는 5번, Tool/RAG 근거는 3번, parts 데이터는 2번, 관리자 관계도 배치 API는 5번 admin shell/security/migration과 협업 |

Auth 화면과 Auth/User API 구현 주 owner는 1번이다. 5번은 `apps/web/src/lib/api.ts`, `RequireAdmin`, admin guard, security allowlist, migration 순서 관점에서 협업한다.

관리자 관계도 배치 API `GET/PUT/DELETE /api/admin/build-graph-layouts/default`는 견적 관계도 기능 owner인 1번이 좌표 계약과 저장 형식을 담당하고, 5번은 `/admin` shell, admin guard, security allowlist, Flyway migration 번호/순서를 검토한다.

### 2번: Parts/Price/Tool

| 항목 | 내용 |
|---|---|
| 담당 화면 route | `/self-quote`, `/parts`, `/admin/parts`, `/admin/price-jobs`, `/my/quotes`의 가격 알림 영역 |
| frontend files | `features/parts/**`, `features/admin/pages/AdminPartsPage.tsx`, `features/admin/pages/AdminPriceJobsPage.tsx` |
| backend packages | `part`, `price`, `tool`, `quote` |
| DB tables | `parts`, `price_snapshots`, `part_external_offers`, `part_catalog_refresh_jobs`, `part_catalog_candidates`, `manufacturer_sources`, `manufacturer_posts`, `quote_drafts`, `quote_draft_items`, `price_alerts`, `price_jobs`, `pipeline_job_runs`, `compatibility_rules`, `benchmark_summaries` |
| API endpoints | `GET /api/parts`, `GET /api/parts/{id}`, `GET /api/parts/{id}/price-history`, `GET /api/quote-drafts/current`, `PUT /api/quote-drafts/current/apply-ai-build`, `PUT/PATCH/DELETE /api/quote-drafts/current/items/{partId}`, `GET /api/price-alerts`, `POST /api/price-alerts`, `GET /api/admin/price-jobs`, `POST /api/admin/price-jobs/run`, `GET /api/admin/pipeline-job-runs`, `GET/POST /api/admin/parts`, `GET /api/admin/parts/quality-report`, `GET/PATCH/DELETE /api/admin/parts/{id}`, `POST /api/admin/parts/{id}/restore`, `POST /api/admin/parts/{id}/manual-price`, `PATCH /api/admin/parts/{id}/external-offer`, `POST /api/admin/parts/catalog/refresh`, `POST /api/admin/parts/external-offers/refresh`, `POST /api/admin/parts/danawa-price-snapshots/refresh`, `POST /api/admin/parts/danawa-price-trends/refresh`, source/post/candidate CRUD under `/api/admin/manufacturer-*`, `POST /api/admin/manufacturer-sources/{id}/scan`, `POST /api/admin/manufacturer-sources/scan`, `POST /api/admin/manufacturer-posts/{id}/ai-asset-draft`, `POST /api/admin/part-catalog-candidates/{id}/approve|reject|refresh-offers`, `GET/POST /api/admin/part-alias-rules`, `GET /api/admin/part-alias-review-items`, `GET /api/admin/part-alias-review-items/summary`, `POST /api/admin/part-alias-review-items/{id}/resolve|ignore`, 5개 Tool API |
| 협업자 | `price_jobs`, catalog refresh, external offer refresh, manufacturer release intake infra 실행 환경은 5번, build 연동은 1번, Agent Tool 이력과 AI 분류 고도화는 3번 |

`part_catalog_candidates.source_product_key` 생성과 유지보수는 2번 Parts/Price 서버 책임이다. 관리자 UI와 후보 수정 API는 상품명, 검색어, 가격, 공급처, URL 같은 보정 필드만 다루고 내부 dedupe key를 입력받지 않는다.

`price_jobs`의 주 owner는 2번이고 협업자는 5번이다.

`pipeline_job_runs`(스케줄 파이프라인 잡 실행 이력, V91)의 주 owner는 2번이고 협업자는 5번·3번이다. 공통 기록기 `PipelineJobRunRecorder`는 `common` 패키지라 5번이 검토하고, 추천 shadow 보존 잡 기록은 3번 도메인과 걸친다. 조회 API `GET /api/admin/pipeline-job-runs`는 `/admin/price-jobs` 화면의 자동 실행 이력 패널이 소비한다.

### 3번: Agent/RAG/Tool Evidence

| 항목 | 내용 |
|---|---|
| 담당 화면 route | `/support/ai-chat`, `/admin/agent-sessions`, `/admin/agent-sessions/:id`, `/admin/tool-invocations`, `/admin/tool-invocations/:id`, `/admin/rag-evidence`, `/admin/rag-evidence/:id` |
| frontend files | `features/support/**` 중 AS AI Chat 화면/API, `features/admin/agent/**`, `features/admin/evidence/**` |
| backend packages | `agent`, `rag`, `recommendation` |
| DB tables | `agent_sessions`, `tool_invocations`, `rag_evidence`, `as_chat_sessions`, `as_chat_messages`, `llm_generations`, `recommendation_events`, `recommendation_model_versions`, `recommendation_shadow_scores`, `recommendation_training_datasets`, `recommendation_training_dataset_items`, `recommendation_training_jobs`, `as_ticket_labels` 협업 |
| API endpoints | `POST /api/ai/build-chat`, `GET /api/public/home`, `GET /api/home`, `GET /api/recommendations/home-builds`, `GET /api/recommendations/home-parts`, `POST /api/recommendation-events`, `POST /api/recommendation-events/bulk/async`, `POST /api/admin/recommendation-feedback/as-tickets/{id}`, `POST /api/admin/recommendation-feedback/home-parts`, `GET /api/admin/recommendation-models`, `GET /api/admin/recommendation-models/summary`, `GET /api/admin/recommendation-shadow/summary`, `GET /api/admin/recommendation-drift`, `GET /api/ai/as-chat`, `POST /api/ai/as-chat`, `POST /api/ai/as-chat/stream`, `POST /api/ai/agent-sessions`, `POST /api/ai/agent-sessions/{id}/run`, `GET /api/ai/agent-sessions/{id}`, `GET /api/rag/search`, `GET /api/rag/evidence/{id}`, `POST /api/admin/rag-embeddings/backfill`, `GET /api/admin/agent-sessions`, `GET /api/admin/agent-sessions/{id}`, `GET /api/admin/tool-invocations`, `GET /api/admin/tool-invocations/{id}`, `GET /api/admin/rag-evidence`, `GET /api/admin/rag-evidence/{id}` |
| 협업자 | 추천 결과 UI는 1번, Tool 판정 로직은 2번, AS 원인 후보는 4번 |

XGBoost reranker는 Build Chat에서 shadow scoring만 수행하고, 홈 하단 추천부품은 `GET /api/recommendations/home-parts`에서 보이는 랭킹으로 사용한다. 3번은 추천 이벤트 수집, 홈 추천부품 관리자 라벨, 모델 버전/점수 기록, 학습 dataset/job 운영 API, Python worker/scorer, Docker scorer 운영 설정을 담당한다. 관리자 라벨은 학습 이벤트만 남기며 `parts.status`나 사용자 노출 여부를 직접 바꾸지 않는다. Tool `FAIL` 후보를 되살리거나 기존 견적 추천 순서를 바꾸지 않는다. AS feedback은 4번의 `as_tickets`와 `agent_log_summaries`를 읽어 `as_ticket_labels`를 저장하고, 조건이 맞을 때만 관리자 확정 negative 이벤트를 남긴다. 티켓 상태와 후보 JSON은 수정하지 않는다.

홈 추천부품 XGBoost 학습 운영 endpoint:

- `GET /api/admin/recommendation-training/overview`
- `GET|POST|PATCH /api/admin/recommendation-training-datasets`
- `POST /api/admin/recommendation-training-datasets/{id}/lock`
- `POST /api/admin/recommendation-training-datasets/{id}/archive`
- `GET /api/admin/recommendation-training-datasets/{id}/items`
- `POST /api/admin/recommendation-training-datasets/{id}/items/bulk-include`
- `POST /api/admin/recommendation-training-datasets/{id}/items/bulk-exclude`
- `GET|POST /api/admin/recommendation-training-jobs`
- `POST /api/admin/recommendation-models/{id}/activate`
- `POST /api/admin/recommendation-models/{id}/retire`

학습 Job 생성은 API 서버가 DB에 `QUEUED` row를 만드는 것까지만 담당한다. 실제 Python 학습은 `xgb-reranker` worker가 수행한다. 학습 성공 모델은 `SHADOW` 상태이며, 관리자 수동 activate가 scorer reload에 성공해야 `ACTIVE`로 바뀐다.

### 4번: PC Agent/AS

| 항목 | 내용 |
|---|---|
| 담당 화면 route | `/support/new`, `/support/:ticketId`, `/admin/as-tickets`, `/admin/as-tickets/:ticketId`, `/admin/support-chat-sessions` |
| frontend files | `features/support/**` 중 AS 접수/티켓/사용자-관리자 상담방 전역 위젯, `features/admin/as-tickets/**` |
| backend packages | `agent`, `log`, `ticket` |
| DB tables | `agent_log_uploads`, `agent_log_bundles`, `agent_upload_jobs`, `agent_log_summaries`, `as_tickets`, `as_ticket_labels`, `remote_support_sessions`, `visit_support_reservations`, `support_chat_rooms`, `support_chat_messages` |
| API endpoints | `POST /api/agent/devices/register`, `POST /api/agent/consents`, `POST /api/agent/heartbeat`, `POST /api/agent/log-uploads`, `POST /api/users/me/agent-diagnosis-requests`, `WS /ws/pc-agent/diagnosis`, `POST /api/agent-logs/upload`, `GET /api/agent-logs/{id}`, `POST /api/as-tickets`, `GET /api/as-tickets/{id}`, `GET /api/as-tickets/{id}/remote-support`, `PUT /api/as-tickets/{id}/remote-support/access-code`, `GET /api/support/chat-sessions/current`, `GET /api/support/chat-sessions/{id}`, `PUT /api/support/chat-sessions/{id}/visit-reservation`, `GET /api/admin/support/chat-sessions`, `GET /api/admin/support/chat-sessions/{id}`, `PUT /api/admin/support/chat-sessions/{id}/visit-reservation`, `DELETE /api/admin/support/chat-sessions/{id}/visit-reservation`, `GET /api/admin/as-tickets`, `GET /api/admin/as-tickets/{id}`, `PATCH /api/admin/as-tickets/{id}`, `POST /api/admin/as-tickets/{id}/assign-to-me`, `POST /api/admin/as-tickets/{id}/request-more-info`, `POST /api/admin/as-tickets/{id}/approve-remote-support`, `GET /api/admin/as-tickets/{id}/remote-support`, `GET /api/admin/as-tickets/{id}/remote-support/access-code`, `POST /api/admin/as-tickets/{id}/remote-support/start`, `POST /api/admin/as-tickets/{id}/remote-support/complete`, `DELETE /api/admin/as-tickets/{id}`, `STOMP /ws/support-chat`, `SEND /app/support-chat/messages`, `SUBSCRIBE /topic/support-chat/**` |
| 협업자 | Auth/guard는 5번, AS 원인 후보 Agent와 추천 학습 bridge는 3번. 상담방은 `support_chat_*` 전용 테이블로 3번 AS AI Chat(`as_chat_*`)과 완전히 분리 |

### 5번: AdminShell/Auth Common/Infra

| 항목 | 내용 |
|---|---|
| 담당 화면 route | `/admin` shell/guard/dashboard, `/admin/load-tests` |
| frontend files | `features/admin/shell/**`, `components/**`, `apps/web/src/lib/api.ts`, `features/auth/RequireAdmin.tsx`, `features/admin/pages/AdminLoadTestsPage.tsx` |
| backend packages | `admin`, `common`, config/security |
| DB tables | `admin_audit_logs` |
| API endpoints | `GET /api/admin/dashboard`, `GET /api/admin/audit-logs/recent`, `GET /api/health` |
| 협업자 | Auth/User 구현은 1번, domain admin page 내부는 각 도메인 owner, `price_jobs` infra는 2번과 협업 |

## route ownership

| Route | 주 owner | 협업자 | 연결 API |
|---|---|---|---|
| `/` | 1번 | 2번 | `POST /api/ai/build-chat`, `POST /api/build-graphs/resolve`, `POST /api/parts/compatible-candidates`, `GET /api/quote-drafts/current`(챗봇이 견적 문맥 어휘에서 선조회), `PUT /api/quote-drafts/current/apply-ai-build`, `GET /api/public/home`, `GET /api/home`, `GET /api/recommendations/home-builds`, `GET /api/recommendations/home-parts`, `POST /api/recommendation-events`, `POST /api/recommendation-events/bulk/async` |
| `/requirements/new` | 1번 | 3번 | `POST /api/requirements/parse`, `POST /api/builds/recommend` |
| `/builds/latest` | 1번 | 3번 | 프론트 세션 보관 AI 추천 조합 표시, `POST /api/build-graphs/resolve`, `POST /api/builds/from-chat` |
| `/builds/:buildId` | 1번 | 2번, 3번 | `GET /api/builds/{id}`, `GET /api/rag/evidence/{id}` |
| `/builds/:buildId/change-part` | 1번 | 2번 | `POST /api/builds/{id}/change-part`, `GET /api/parts` |
| `/my/profile` | 1번 | 5번 | `GET /api/auth/me`, `POST /api/users/me/password-verification`, `PATCH /api/users/me` |
| `/my/quotes` | 1번 | 2번 | `GET /api/builds/history`, `GET /api/price-alerts`, `POST /api/price-alerts`, `GET /api/assembly-requests` |
| `/self-quote` | 2번 | 1번, 3번, 5번 | `GET /api/parts`(후보 패널은 `compatibilitySource=QUOTE_DRAFT_CURRENT`), `GET /api/parts/{id}/price-history`, `GET /api/quote-drafts/current`, `GET /api/quote-drafts/current/history`, `GET /api/quote-drafts/current/history/{id}/comparison`, `POST /api/quote-drafts/current/history/{id}/restore`, `POST /api/build-graphs/resolve`, `POST /api/builds/from-chat`, `POST /api/ai/build-chat`(`BOARD_PART_FOCUS`, `QUOTE_DRAFT_HISTORY` capability), `PUT /api/quote-drafts/current/apply-ai-build`, `PUT/PATCH/DELETE /api/quote-drafts/current/items/{partId}`, 5개 Tool API |
| `/parts` | 2번 | 5번 | `GET /api/parts`, `GET /api/quote-drafts/current`, `PUT/PATCH/DELETE /api/quote-drafts/current/items/{partId}`, `GET /api/parts/{id}/price-history` |
| `/checkout` | 2번 | 1번, 5번 | `GET /api/quote-drafts/current`, `POST /api/build-graphs/resolve`, `POST /api/assembly-requests` |
| `/checkout/offers/:requestId` | 2번 | 1번, 5번 | `GET /api/assembly-requests/{id}`, `POST /api/assembly-requests/{id}/offers/{offerId}/select` |
| `/checkout/payment/:requestId` | 2번 | 1번, 5번 | `GET /api/assembly-requests/{id}`, `POST /api/assembly-requests/{id}/payments/attempts`, `POST /api/payments/attempts/{id}/mock-result`, `POST /api/payments/attempts/{id}/complete`, `GET /api/users/me/points`, `POST /api/assembly-requests/{id}/payments/points/confirm` |
| `/checkout/complete/:requestId` | 2번 | 1번, 5번 | `GET /api/assembly-requests/{id}` |
| `/my/assembly-requests` | 2번 | 1번, 5번 | `GET /api/assembly-requests` |
| `/my/assembly-requests/:requestId` | 2번 | 1번, 5번 | `GET /api/assembly-requests/{id}`, `POST /api/assembly-requests/{id}/cancel` |
| `/technician/apply` | 2번 | 5번 | `POST /api/technician/applications`, `GET/PATCH /api/technician/profile` |
| `/technician` | 2번 | 5번 | `GET /api/technician/profile`, `GET /api/technician/assembly-requests?scope=OPEN` |
| `/technician/requests/:requestId` | 2번 | 5번 | `GET /api/technician/assembly-requests/{id}`, `POST /api/technician/assembly-requests/{id}/offers`, `PATCH /api/technician/offers/{id}`, `POST /api/technician/offers/{id}/withdraw` |
| `/technician/jobs` | 2번 | 5번 | `GET /api/technician/assembly-requests?scope=SELECTED`, `GET /api/technician/assembly-requests/{id}` |
| `/parts/:partId` | 2번 | 5번 | `GET /api/parts/{id}`, `PUT /api/quote-drafts/current/items/{partId}`, `POST /api/recommendation-events` |
| `/login` | 1번 | 5번 | `POST /api/auth/login`, `GET /api/auth/google/start` |
| `/signup` | 1번 | 5번 | `POST /api/users`, `GET /api/auth/google/start` |
| `/auth/callback` | 1번 | 5번 | `POST /api/auth/exchange` |
| `/admin/login` | 1번 | 5번 | `POST /api/auth/login`, `GET /api/auth/google/start`, `POST /api/auth/exchange` |
| `/support/new` | 4번 | 5번 | `POST /api/agent-logs/upload`, `POST /api/as-tickets` |
| `/support/ai-chat` | 3번 | 4번, 5번 | `GET /api/ai/as-chat`, `POST /api/ai/as-chat/stream`, `POST /api/ai/as-chat` |
| `/support/:ticketId` | 4번 | - | `GET /api/as-tickets/{id}`, 전역 위젯 `GET /api/support/chat-sessions/current?asTicketId={id}` |
| `/admin` | 5번 | 2번, 3번, 4번 | `GET /api/admin/dashboard`, `GET /api/admin/audit-logs/recent` |
| `/admin/parts` | 2번 | 5번, 3번 | `GET/POST /api/admin/parts`, `GET /api/admin/parts/quality-report`, `GET/PATCH/DELETE /api/admin/parts/{id}`, `POST /api/admin/parts/{id}/restore`, `POST /api/admin/parts/{id}/manual-price`, `PATCH /api/admin/parts/{id}/external-offer`, `GET /api/parts/{id}/price-history`, `POST /api/admin/parts/catalog/refresh`, `POST /api/admin/parts/external-offers/refresh`, `POST /api/admin/parts/danawa-price-snapshots/refresh`, `POST /api/admin/parts/danawa-price-trends/refresh`, source/post/candidate CRUD under `/api/admin/manufacturer-*`, `POST /api/admin/manufacturer-sources/{id}/scan`, `POST /api/admin/manufacturer-sources/scan`, `POST /api/admin/manufacturer-posts/{id}/ai-asset-draft`, `POST /api/admin/part-catalog-candidates/{id}/approve|reject|refresh-offers`, `GET/POST /api/admin/part-alias-rules`, `GET /api/admin/part-alias-review-items`, `GET /api/admin/part-alias-review-items/summary`, `POST /api/admin/part-alias-review-items/{id}/resolve|ignore` |
| `/admin/assembly` | 2번 | 5번 | 내부 기사 CRUD, 외부 기사 신청 승인·거절·정지 `/api/admin/technicians*`, 요청·제안·상태 운영 `/api/admin/assembly-requests*` |
| `/admin/price-jobs` | 2번 | 5번 | `GET /api/admin/price-jobs`, `POST /api/admin/price-jobs/run`, `GET /api/admin/pipeline-job-runs` |
| `/admin/build-graph-layouts` | 1번 | 5번 | `GET/PUT/DELETE /api/admin/build-graph-layouts/default` |
| `/admin/load-tests` | 5번 | 2번, 3번, 4번 | k6 smoke/load report, `GET /api/health` smoke |
| `/admin/support-chat-sessions` | 4번 | 5번 | `GET /api/admin/support/chat-sessions`, `GET /api/admin/support/chat-sessions/{id}`, STOMP `/app/support-chat/messages`, `/topic/support-chat/admin-queue` |
| `/admin/agent-sessions` | 3번 | 5번 | `GET /api/admin/agent-sessions` |
| `/admin/agent-sessions/:id` | 3번 | 5번 | `GET /api/admin/agent-sessions/{id}` |
| `/admin/tool-invocations` | 3번 | 5번 | `GET /api/admin/tool-invocations` |
| `/admin/tool-invocations/:id` | 3번 | 5번 | `GET /api/admin/tool-invocations/{id}` |
| `/admin/rag-evidence` | 3번 | 5번 | `GET /api/admin/rag-evidence` |
| `/admin/rag-evidence/:id` | 3번 | 5번 | `GET /api/admin/rag-evidence/{id}` |
| `/admin/as-tickets` | 4번 | 5번 | `GET /api/admin/as-tickets`, `DELETE /api/admin/as-tickets/{id}` |
| `/admin/as-tickets/:ticketId` | 4번 | 5번 | `GET /api/admin/as-tickets/{id}`, `PATCH /api/admin/as-tickets/{id}`, `DELETE /api/admin/as-tickets/{id}` |

관리자 상세 route는 AdminShell을 경유하지만 화면 내부의 주 owner는 각 도메인 owner다.

## API ownership

| API | 주 owner | 협업자 |
|---|---|---|
| `POST /api/users` | 1번 | 5번 |
| `POST /api/auth/login` | 1번 | 5번 |
| `POST /api/auth/refresh` | 1번 | 5번 |
| `POST /api/auth/logout` | 1번 | 5번 |
| `GET /api/auth/me` | 1번 | 5번 |
| `GET /api/auth/google/start` | 1번 | 5번 |
| `GET /api/auth/google/callback` | 1번 | 5번 |
| `POST /api/auth/exchange` | 1번 | 5번 |
| `POST /api/requirements/parse` | 1번 | - |
| `POST /api/builds/recommend` | 1번 | 2번, 3번 |
| `POST /api/builds/from-chat` | 1번 | 3번 |
| `POST /api/ai/build-chat` | 3번 | 1번, 2번 |
| `POST /api/build-graphs/resolve` | 1번 | 2번, 3번 |
| `GET /api/builds/{id}` | 1번 | 2번, 3번 |
| `GET /api/builds/history` | 1번 | - |
| `POST /api/builds/{id}/change-part` | 1번 | 2번 |
| `GET/PUT/DELETE /api/admin/build-graph-layouts/default` | 1번 | 5번 |
| `GET /api/parts` | 2번 | - |
| `POST /api/parts/compatible-candidates` | 2번 | 1번 |
| `GET /api/parts/{id}` | 2번 | - |
| `GET /api/parts/{id}/price-history` | 2번 | 3번 |
| `GET /api/quote-drafts/current` | 2번 | 5번 |
| `PUT /api/quote-drafts/current/apply-ai-build` | 2번 | 1번, 5번 |
| `PUT /api/quote-drafts/current/items/{partId}` | 2번 | 5번 |
| `PATCH /api/quote-drafts/current/items/{partId}` | 2번 | 5번 |
| `DELETE /api/quote-drafts/current/items/{partId}` | 2번 | 5번 |
| `GET /api/quote-drafts/current/history` | 2번 | 3번, 5번 |
| `GET /api/quote-drafts/current/history/{id}/comparison` | 2번 | 3번, 5번 |
| `POST /api/quote-drafts/current/history/{id}/restore` | 2번 | 3번, 5번 |
| `GET /api/price-alerts` | 2번 | 1번 |
| `POST /api/price-alerts` | 2번 | 1번 |
| `GET /api/admin/price-jobs` | 2번 | 5번 |
| `POST /api/admin/price-jobs/run` | 2번 | 5번 |
| `GET /api/admin/pipeline-job-runs` | 2번 | 3번, 5번 |
| `GET /api/admin/parts` | 2번 | 5번 |
| `POST /api/admin/parts` | 2번 | 5번 |
| `GET /api/admin/parts/{id}` | 2번 | 5번 |
| `PATCH /api/admin/parts/{id}` | 2번 | 5번 |
| `DELETE /api/admin/parts/{id}` | 2번 | 5번 |
| `POST /api/admin/parts/{id}/restore` | 2번 | 5번 |
| `POST /api/admin/parts/{id}/manual-price` | 2번 | 5번 |
| `PATCH /api/admin/parts/{id}/external-offer` | 2번 | 5번 |
| `POST /api/admin/parts/catalog/refresh` | 2번 | 5번 |
| `POST /api/admin/parts/external-offers/refresh` | 2번 | 5번 |
| `POST /api/admin/parts/danawa-price-snapshots/refresh` | 2번 | 5번 |
| `POST /api/admin/parts/danawa-price-trends/refresh` | 2번 | 5번 |
| `GET /api/admin/manufacturer-sources` | 2번 | 5번 |
| `POST /api/admin/manufacturer-sources` | 2번 | 5번 |
| `GET/PATCH/DELETE /api/admin/manufacturer-sources/{id}` | 2번 | 5번 |
| `POST /api/admin/manufacturer-sources/{id}/restore` | 2번 | 5번 |
| `POST /api/admin/manufacturer-sources/{id}/scan` | 2번 | 3번, 5번 |
| `POST /api/admin/manufacturer-sources/scan` | 2번 | 3번, 5번 |
| `GET /api/admin/manufacturer-posts` | 2번 | 3번, 5번 |
| `POST /api/admin/manufacturer-posts` | 2번 | 5번 |
| `GET/PATCH/DELETE /api/admin/manufacturer-posts/{id}` | 2번 | 5번 |
| `POST /api/admin/manufacturer-posts/{id}/restore` | 2번 | 5번 |
| `POST /api/admin/manufacturer-posts/{id}/create-candidate` | 2번 | 5번, 3번 |
| `POST /api/admin/manufacturer-posts/{id}/ai-asset-draft` | 2번 | 3번, 5번 |
| `GET /api/admin/part-catalog-candidates` | 2번 | 5번 |
| `GET/PATCH/DELETE /api/admin/part-catalog-candidates/{id}` | 2번 | 5번 |
| `POST /api/admin/part-catalog-candidates/{id}/restore` | 2번 | 5번 |
| `POST /api/admin/part-catalog-candidates/{id}/approve` | 2번 | 5번 |
| `POST /api/admin/part-catalog-candidates/{id}/reject` | 2번 | 5번 |
| `POST /api/admin/part-catalog-candidates/{id}/refresh-offers` | 2번 | 5번 |
| `GET/POST /api/admin/part-alias-rules` | 2번 | 3번, 5번 |
| `GET /api/admin/part-alias-review-items` | 2번 | 3번, 5번 |
| `GET /api/admin/part-alias-review-items/summary` | 2번 | 3번, 5번 |
| `POST /api/admin/part-alias-review-items/{id}/resolve` | 2번 | 3번, 5번 |
| `POST /api/admin/part-alias-review-items/{id}/ignore` | 2번 | 3번, 5번 |
| `GET /api/demo/manufacturer-release-feed.xml` | 2번 | 5번 |
| `POST /api/tools/compatibility/check` | 2번 | 3번 |
| `POST /api/tools/power/check` | 2번 | 3번 |
| `POST /api/tools/size/check` | 2번 | 3번 |
| `POST /api/tools/performance/check` | 2번 | 3번 |
| `POST /api/tools/price/check` | 2번 | 3번 |
| `GET /api/public/home` | 3번 | 1번, 2번 |
| `GET /api/home` | 3번 | 1번, 2번 |
| GET /api/recommendations/home-parts | 3번 | 1번 |
| `GET /api/recommendations/home-builds` | 3번 | 1번 |
| `POST /api/recommendation-events` | 3번 | 1번, 2번 |
| `POST /api/recommendation-events/bulk/async` | 3번 | 1번, 2번 |
| `/api/admin/recommendation-*` 전체 (models·feedback·training) | 3번 | 5번 |
| `GET /api/ai/as-chat` | 3번 | 4번, 5번 |
| `POST /api/ai/as-chat` | 3번 | 4번, 5번 |
| `POST /api/ai/as-chat/stream` | 3번 | 4번, 5번 |
| `GET /api/support/chat-sessions/current` | 4번 | 3번, 5번 |
| `GET /api/support/chat-sessions/{id}` | 4번 | 3번, 5번 |
| `STOMP SEND /app/support-chat/messages` | 4번 | 3번, 5번 |
| `PUT /api/support/chat-sessions/{id}/visit-reservation` | 4번 | 5번 |
| `GET /api/admin/support/chat-sessions` | 4번 | 3번, 5번 |
| `GET /api/admin/support/chat-sessions/{id}` | 4번 | 3번, 5번 |
| `PUT /api/admin/support/chat-sessions/{id}/visit-reservation` | 4번 | 5번 |
| `DELETE /api/admin/support/chat-sessions/{id}/visit-reservation` | 4번 | 5번 |
| `STOMP /ws/support-chat`, `/topic/support-chat/**`, `/user/queue/support-chat-errors` | 4번 | 5번 |
| `POST /api/ai/agent-sessions` | 3번 | - |
| `POST /api/ai/agent-sessions/{id}/run` | 3번 | - |
| `GET /api/ai/agent-sessions/{id}` | 3번 | - |
| `GET /api/rag/search` | 3번 | - |
| `GET /api/rag/evidence/{id}` | 3번 | - |
| `GET /api/admin/agent-sessions` | 3번 | 5번 |
| `GET /api/admin/agent-sessions/{id}` | 3번 | 5번 |
| `GET /api/admin/tool-invocations` | 3번 | 5번 |
| `GET /api/admin/tool-invocations/{id}` | 3번 | 5번 |
| `GET /api/admin/rag-evidence` | 3번 | 5번 |
| `GET /api/admin/rag-evidence/{id}` | 3번 | 5번 |
| `POST /api/admin/rag-embeddings/backfill` | 3번 | 5번 |
| `POST /api/agent/devices/register` | 4번 | 5번 |
| `POST /api/agent/consents` | 4번 | 5번 |
| `POST /api/agent/heartbeat` | 4번 | 5번 |
| `POST /api/users/me/agent-diagnosis-requests` | 4번 | 5번 |
| `WS /ws/pc-agent/diagnosis` | 4번 | 5번 |
| `POST /api/agent/log-uploads` | 4번 | 5번 |
| `POST /api/agent-logs/upload` | 4번 | - |
| `GET /api/agent-logs/{id}` | 4번 | - |
| `POST /api/as-tickets` | 4번 | 3번 |
| `GET /api/as-tickets/{id}` | 4번 | - |
| `GET /api/admin/as-tickets` | 4번 | 5번 |
| `GET /api/admin/as-tickets/{id}` | 4번 | 5번 |
| `PATCH /api/admin/as-tickets/{id}` | 4번 | 5번 |
| `DELETE /api/admin/as-tickets/{id}` | 4번 | 5번 |
| `GET /api/admin/dashboard` | 5번 | 2번, 3번, 4번 |
| `GET /api/admin/audit-logs/recent` | 5번 | - |
| `GET /api/health` | 5번 | - |

## 내부 service 경계

`POST /api/builds/recommend`는 1번 owner API지만, 추천 과정에서 남기는 Agent/RAG/Tool 추적 데이터는 3번 owner 영역이다.

- 1번은 추천 API request/response, build 저장 transaction orchestration, build/build_items 저장을 담당한다.
- 2번은 Tool 판정 로직과 parts/price 데이터 조회 contract를 담당한다.
- 3번은 `agent_sessions`, `tool_invocations`, `rag_evidence` 저장 방식과 관리자 상세 조회 contract를 담당한다.
- 1번은 3번 table을 직접 insert/update하지 않고, 3번이 제공하는 내부 Agent trace service를 호출한다.
- 3번은 2번의 Tool 직접 check API 호출을 `tool_invocations`에 저장하지 않는다. `tool_invocations`에는 Agent/recommend 내부 Tool 호출 이력만 저장한다.
- `/support/ai-chat`은 3번 owner API/화면이지만 AS 티켓을 기준으로 동작하므로 4번과 협업한다.
- 3번은 AS Chat에서 `as_tickets`를 읽기만 하고 `cause_candidates`, `upgrade_candidates`, `status`를 수정하지 않는다.
- AS Chat 대화 이력은 `as_chat_sessions`, `as_chat_messages`에 저장하고, 원인 후보를 티켓에 반영하는 작업은 4번 API가 별도로 결정한다.
- 사용자-관리자 상담방은 4번 owner API/전역 위젯이며 기존 `/support/ai-chat`을 대체하지 않는다. AS 티켓 생성 시 상담방을 만들고, 티켓이 없는 사용자는 전역 위젯에서 `/support/new`로 유도한다.
- 사용자-관리자 상담방은 `support_chat_rooms`, `support_chat_messages` 전용 테이블을 쓰며 `as_chat_*`(3번 AS AI Chat)와 공유하지 않는다. LLM/RAG/Tool 호출을 수행하지 않고 `role=USER|ADMIN|SYSTEM`과 unread/last-message 컬럼만 사용한다.
- AS Chat profile 비교와 `llm_generations` 기록은 3번 owner 범위다. 기본 사용자 요청은 profile 1개만 실행하고, OpenAI profile 비교는 benchmark 명령에서만 수행한다.
- `/api/ai/build-chat`의 `X-BuildGraph-AI-Profile` header는 3번 benchmark용이다. UI는 header를 보내지 않고, 1번/프론트 owner는 기존 응답 shape만 소비한다.
- 서버 `BuildChatIntentRouter` decision(SIMULATE_REPLACEMENT/BUILD_RECOMMEND/SUPPORT_GUIDANCE/OPEN_DRAFT_HISTORY/LOCATE_BOARD_PART/EXPLAIN_BUILD_SCORE/ASK_CLARIFICATION/UNSUPPORTED)과 LLM intent 판정은 3번 AI 계약이다. `SUPPORT_GUIDANCE`는 쇼핑몰에서 증상을 인지하고 서버가 증상 범주별로 고정한 일반적 가능성(`possibleCauses`)과 PC Agent 다운로드, 4번 소유 `/support/new` 진입을 안내하는 접수 전 계약이다. 위험도·확정 원인·지원 방식·로그 근거는 만들지 않으며, 동의 로그 기반 진단은 4번 소유 agent-token `/api/agent/diagnosis-chat`이 담당한다. `OPEN_DRAFT_HISTORY`는 `/self-quote`가 `QUOTE_DRAFT_HISTORY` capability를 보낸 경우에만 변경 기록·비교·복원 확인 패널을 여는 읽기 전용 명령이며 실제 복원은 2번 API의 사용자 확인 후 수행한다. `LOCATE_BOARD_PART`는 `/self-quote`가 `BOARD_PART_FOCUS` capability를 보낸 순수 위치 질문에만 optional read-only `boardFocus`를 반환하며, quote draft·URL·선택 카테고리를 변경하지 않는다. 2번 Parts UI는 이 값을 배치도·실장도·3D의 페이지 로컬 강조 상태로만 소비한다. `최소 견적` 3안, 게임·해상도·목표 FPS가 명확한 GPU 변경, 현재 draft의 호환 케이스 복구는 3번 서버의 deterministic DB·Tool 경로가 담당한다. 응답의 `actions`에는 화면 이동(`OPEN_ROUTE`)만 나가고 draft mutation action은 포함하지 않는다. route를 만드는 책임은 3번 서버(`PartRouteResolver`)이고, 프론트는 자기 allowlist로 재검증한 뒤 `navigate()`를 실행하며, 실제 견적초안 저장은 2번 quote draft API가 수행한다. 견적 변경(BUILD_MODIFY) 요청은 3번 서버가 `변경 미리보기` 카드(`tier=draft-edit`, `badges=[DRAFT_EDIT_PREVIEW]`)로 응답하고, 사용자가 카드의 적용 버튼 또는 바로 다음 고확신 확인 문장을 보낼 때만 2번 `PUT /api/quote-drafts/current/apply-ai-build`로 실제 견적초안에 반영한다. 관리자 화면 자동 이동은 허용하지 않는다.
- `PART_DETAIL` 자동 이동은 3번 owner 계약이다(2026-07 PR #263·#264로 복구). 3번 서버 `PartRouteResolver`가 ACTIVE 상품 1건으로 특정한 경우에만 `actions=[OPEN_ROUTE {route: /parts/{publicId}}]`를 내려보낸다. 후보가 2~4개면 화면을 옮기지 않고 `quickReplies`에 각 후보의 `{정확한 상품명} 상세페이지로 이동해` 칩만 담아 채팅에서 되묻는다(이때 `actions`는 비어 있고 `quickReplyKind=ROUTE_CHOICE`가 함께 온다). 후보가 5개 이상이면 해당 카테고리 후보 목록(`/self-quote?category=...&q=...`)으로 대신 보내고, 답변 문구도 '상세페이지' 약속 대신 목록 안내로 교정한다. 후보가 0개면 이동하지 않고 취급하지 않는다는 사실을 문장으로 알린다. 목록 대체 이동의 `q`에는 리졸버가 실제 매칭에 사용한 검색 토큰을 그대로 싣는다 — 서버가 찾은 후보 수와 도착 화면의 결과 수가 어긋나면 안 된다. 도착 화면 `/parts/:partId` 자체는 2번 owner이고, route 생성은 3번, `navigate()` 실행과 allowlist 재검증은 프론트다. 사용자가 부품 카드를 눌러 직접 들어오는 기존 진입도 그대로 유지된다.

## 1주차 완료 기준

| 담당자 | 완료 기준 |
|---|---|
| 1번 | `/requirements/new`에서 `POST /api/requirements/parse`와 `POST /api/builds/recommend` mock 또는 dev API를 호출하고, `/builds/:buildId`가 `BuildDto`의 `items`, `totalPrice`, `confidence`, `warnings`, `evidenceIds`, `changeableCategories`를 렌더링한다. `/builds/:buildId/change-part`는 `POST /api/builds/{id}/change-part`의 성공/409 응답을 화면에서 구분한다. `/login`, `/signup`, `/auth/callback`, `/admin/login`과 Auth/User API는 `API_CONTRACT.md`/`openapi.yaml` 계약과 충돌하지 않게 연결한다. |
| 2번 | `GET /api/parts`, `GET /api/parts/{id}`, `GET /api/parts/{id}/price-history`, 5개 Tool API, `GET/POST /api/price-alerts`, `GET /api/admin/price-jobs`, `POST /api/admin/price-jobs/run`, `POST /api/admin/parts/catalog/refresh`, `POST /api/admin/parts/external-offers/refresh`, `POST /api/admin/parts/danawa-price-snapshots/refresh`, `POST /api/admin/parts/danawa-price-trends/refresh`가 계약 DTO로 응답한다. pagination 기본값/최대값, `price_jobs` 중복 실행 409, seed 기준 `parts` 조회 제외 조건, 내부 자산 갱신이 사용자 조회 중 외부 API를 호출하지 않는 조건, 가격 이력 조회가 `price_snapshots`만 읽는 조건, 다나와 백업/월별 추이 수집이 `parts.price`를 변경하지 않는 조건을 contract test로 확인한다. |
| 3번 | `POST /api/ai/agent-sessions`, `POST /api/ai/agent-sessions/{id}/run`, `GET /api/ai/agent-sessions/{id}`, admin Agent/RAG/Tool 상세 API가 public_id만 반환한다. 실행 중 세션 재실행 409, 금지 상태 전이 409, `stateTimeline`/`requestPayload`/`resultPayload` DTO shape를 contract test로 확인한다. |
| 4번 | `POST /api/agent-logs/upload`가 JSONL 파일 크기/MIME/확장자/라인 validation을 수행하고 `FILE_VALIDATION_ERROR`를 반환할 수 있다. `GET /api/agent-logs/{id}`, `POST/GET /api/as-tickets`, `PATCH /api/admin/as-tickets/{id}`가 본인 소유 404, 금지 상태 전이 409, soft delete 조회 제외를 contract test로 확인한다. |
| 5번 | AdminShell, `RequireAdmin`, `apps/web/src/lib/api.ts`, `config/security` review, Flyway 순서 검증, `GET /api/health`, `GET /api/admin/dashboard`, `GET /api/admin/audit-logs/recent`가 최소 DTO로 연결된다. admin 401/403 분기, public API BIGINT 비노출, migration 순서 검증을 contract test로 확인한다. |

## contract test 최소 세트

| 테스트 | 기준 |
|---|---|
| public API BIGINT 비노출 | 모든 public/admin response의 `id`, `*Id`, `targetId`는 UUID 문자열 또는 stable key이며 숫자 PK를 반환하지 않는다. |
| 401/403 권한 분기 | 인증 없음은 401, 인증은 있으나 `ADMIN` 권한이 없는 admin API 접근은 403이다. |
| 사용자 본인 자원 접근 | build, ticket, agent log, agent session이 본인 소유가 아니면 404를 반환한다. |
| 금지된 상태 전이 | `agent_sessions`, `as_tickets`, `price_jobs`, `price_alerts`, `agent_log_uploads`의 허용되지 않은 전이는 409 `CONFLICT_STATE`다. |
| soft delete 조회 제외 | `deleted_at IS NOT NULL`인 업무 리소스는 목록/상세에서 제외하고 상세 조회는 404다. |
| Flyway migration 순서 | extension, parent table, child table, FK 추가 순서가 `DB_SCHEMA.md`의 권장 순서와 충돌하지 않는다. |
| JSONL 업로드 validation | 크기, MIME/확장자, JSONL 파싱 실패는 400 `FILE_VALIDATION_ERROR`다. |
| pagination 기본값/최대값 | `page` 기본값은 0, `size` 기본값은 20, 최대값은 100이며 초과 시 400 `VALIDATION_ERROR`다. |

## owner별 route/API smoke test 출력 형식

각 owner는 1주차 종료 전 아래 형식의 smoke test 결과를 PR에 붙인다.

```text
owner: 1
route: /builds/:buildId
api: GET /api/builds/{id}
auth: USER
status: 200
responseIdKind: public_id
checked:
  - noBigintId
  - dtoFieldsMatch
  - ownerResourceOnly
```

## 공통 UI 수정 규칙

- `components/**`와 AdminShell 변경은 5번 주 owner가 승인한다.
- 각 기능 owner는 자기 feature 폴더 내부 컴포넌트를 우선 사용한다.
- 공통 table, badge, panel, form control을 변경할 때는 영향 route를 PR에 적는다.
- Auth layout과 Auth/User API는 1번 owner가 작업하되 admin guard와 token 공통 전달 정책은 5번 owner가 관리한다.

## PR 규칙

- PR 제목은 영역을 드러낸다. 예: `docs: add MVP API contract`.
- PR 설명에는 변경한 route, API, DB table, owner를 적는다.
- V1 제외 항목을 다시 포함하는 변경은 별도 팀 결정 없이는 금지한다.
- enum/status 추가나 의미 변경은 `DB_SCHEMA.md`와 `API_CONTRACT.md`를 함께 수정한다.
- API 추가/삭제/field 변경은 `API_CONTRACT.md`와 이 문서를 함께 수정한다.
- DB table/column/index/FK 변경은 `DB_SCHEMA.md`, 관련 API DTO가 있으면 `API_CONTRACT.md`, owner 영향이 있으면 이 문서를 함께 수정한다.
- 공통 파일 변경은 공유 지점 수정 권한 표의 reviewer 필수 여부를 PR description에 체크리스트로 남긴다.
- 병렬 개발 동결 이후 P0 계약 항목은 미정 상태로 남기지 않고 MVP 기준 결정값을 문서에 적는다.

## 수정 금지 규칙

- 다른 담당자 feature 폴더를 임의로 리팩터링하지 않는다.
- `products` 도메인 파일/문서를 추가하지 않는다.
- 조립 기사 중개와 가상 결제 상태 외의 실제 주문, PG 결제, 배송사 연동, 재고 차감, 타임세일 API/route/table은 V1에 추가하지 않는다.
- public route/API에서 내부 `BIGINT id`를 노출하지 않는다.
- AWS 공용 DB에서 직접 DDL을 수정하지 않는다.

## Codex 작업 규칙

- 작업 시작 전 관련 owner 문서를 확인한다.
- 불명확한 owner는 임의로 정하지 않고 주 owner와 협업자를 분리해 기록한다.
- 문서 변경 시 세 문서의 용어, enum, id 규칙이 같은지 확인한다.
- API path, enum/status, owner, DB table, public_id 규칙, error code, pagination 기본값, 권한 정책 중 하나라도 바꾸면 관련 문서를 같은 작업에서 동시에 수정한다.
- 새 기능을 추가하지 않고 계약 불일치만 고치는 경우에도 변경 이유를 PR에 적는다.
- 대화에서 확정한 결정값을 축소하거나 삭제하지 않는다.

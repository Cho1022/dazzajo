\set ON_ERROR_STOP on

BEGIN;

SELECT id AS fixture_user_id
FROM users
WHERE email = 'user@example.com'
  AND deleted_at IS NULL
\gset

SELECT id AS fixture_technician_id
FROM technicians
WHERE deleted_at IS NULL
ORDER BY id
LIMIT 1
\gset

INSERT INTO assembly_requests (
    request_no, user_id, idempotency_key, status, service_type, region,
    preferred_date, delivery_method, as_policy_accepted,
    estimated_parts_price, item_count, quote_signature, request_fingerprint,
    compatibility_snapshot, created_at, updated_at
) VALUES (
    'PL-' || md5(:'run_id' || '-hot'), :fixture_user_id, :'run_id' || '-hot',
    'MATCHED', 'ASSEMBLY_ONLY', '서울', current_date + 1, 'PICKUP', true,
    100000, 1, md5(:'run_id' || '-hot-signature'), md5(:'run_id' || '-hot-fingerprint'),
    '{}'::jsonb, now(), now()
)
RETURNING id AS hot_request_id, public_id::text AS hot_request_public_id
\gset

INSERT INTO assembly_offers (
    assembly_request_id, technician_id, status, technician_snapshot,
    confirmed_parts_price, assembly_fee, delivery_fee, final_price,
    lead_time_days, stock_status, selected_at, created_at, updated_at
) VALUES (
    :hot_request_id, :fixture_technician_id, 'SELECTED', '{}'::jsonb,
    100000, 10000, 0, 110000, 1, 'perf lock fixture', now(), now(), now()
)
RETURNING id AS hot_offer_id
\gset

UPDATE assembly_requests
SET selected_offer_id = :hot_offer_id
WHERE id = :hot_request_id;

INSERT INTO assembly_payments (
    assembly_request_id, amount, method, provider, currency,
    paid_amount, status, created_at, updated_at
) VALUES (
    :hot_request_id, 110000, 'VIRTUAL', 'LEGACY_VIRTUAL', 'KRW',
    0, 'PENDING', now(), now()
)
RETURNING id AS hot_payment_id
\gset

INSERT INTO assembly_request_status_history (
    assembly_request_id, actor_user_id, from_status, to_status, note, created_at
) VALUES (
    :hot_request_id, :fixture_user_id, 'OFFERED', 'MATCHED', 'perf lock hot fixture', now()
);

INSERT INTO assembly_requests (
    request_no, user_id, idempotency_key, status, service_type, region,
    preferred_date, delivery_method, as_policy_accepted,
    estimated_parts_price, item_count, quote_signature, request_fingerprint,
    compatibility_snapshot, created_at, updated_at
) VALUES (
    'PL-' || md5(:'run_id' || '-control'), :fixture_user_id, :'run_id' || '-control',
    'MATCHED', 'ASSEMBLY_ONLY', '서울', current_date + 1, 'PICKUP', true,
    100000, 1, md5(:'run_id' || '-control-signature'), md5(:'run_id' || '-control-fingerprint'),
    '{}'::jsonb, now(), now()
)
RETURNING id AS control_request_id, public_id::text AS control_request_public_id
\gset

INSERT INTO assembly_offers (
    assembly_request_id, technician_id, status, technician_snapshot,
    confirmed_parts_price, assembly_fee, delivery_fee, final_price,
    lead_time_days, stock_status, selected_at, created_at, updated_at
) VALUES (
    :control_request_id, :fixture_technician_id, 'SELECTED', '{}'::jsonb,
    100000, 10000, 0, 110000, 1, 'perf control fixture', now(), now(), now()
)
RETURNING id AS control_offer_id
\gset

UPDATE assembly_requests
SET selected_offer_id = :control_offer_id
WHERE id = :control_request_id;

INSERT INTO assembly_payments (
    assembly_request_id, amount, method, provider, currency,
    paid_amount, status, created_at, updated_at
) VALUES (
    :control_request_id, 110000, 'VIRTUAL', 'LEGACY_VIRTUAL', 'KRW',
    0, 'PENDING', now(), now()
);

INSERT INTO assembly_request_status_history (
    assembly_request_id, actor_user_id, from_status, to_status, note, created_at
) VALUES (
    :control_request_id, :fixture_user_id, 'OFFERED', 'MATCHED', 'perf lock control fixture', now()
);

COMMIT;

SELECT :hot_request_id || '|' || :'hot_request_public_id' || '|' ||
       :control_request_id || '|' || :'control_request_public_id';

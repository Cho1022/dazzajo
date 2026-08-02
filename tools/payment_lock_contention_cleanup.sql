\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE payment_lock_cleanup_requests ON COMMIT DROP AS
SELECT id
FROM assembly_requests
WHERE idempotency_key IN (:'run_id' || '-hot', :'run_id' || '-control');

DELETE FROM point_transactions points
USING assembly_payments payment
WHERE points.assembly_payment_id = payment.id
  AND payment.assembly_request_id IN (SELECT id FROM payment_lock_cleanup_requests);

UPDATE assembly_requests
SET selected_offer_id = NULL
WHERE id IN (SELECT id FROM payment_lock_cleanup_requests);

DELETE FROM assembly_requests
WHERE id IN (SELECT id FROM payment_lock_cleanup_requests);

COMMIT;

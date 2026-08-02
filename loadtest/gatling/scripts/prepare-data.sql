\set ON_ERROR_STOP on

SELECT :'loadtest_confirm_non_prod' = 'YES' AS loadtest_confirmed \gset
\if :loadtest_confirmed
\else
  \echo 'Refusing to prepare data: LOADTEST_CONFIRM_NON_PROD must be YES.'
  \quit 3
\endif

BEGIN;

-- Real login creates refresh-token rows. Clear only the dedicated load-test
-- accounts so repeated preparation does not grow authentication test data.
DELETE FROM refresh_tokens refresh_token
USING users load_user
WHERE refresh_token.user_id = load_user.id
  AND (
    load_user.email LIKE 'loadtest-user-%@example.invalid'
    OR load_user.email LIKE 'loadtest-admin-%@example.invalid'
  );

WITH source AS (
  SELECT i,
         ('10000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid AS public_id,
         format('loadtest-user-%s@example.invalid', lpad(i::text, 3, '0')) AS email,
         format('Loadtest User %s', lpad(i::text, 3, '0')) AS name
  FROM generate_series(1, 150) AS i
)
INSERT INTO users (public_id, email, password_hash, name, role, terms_accepted_at, updated_at, deleted_at)
SELECT public_id,
       email,
       crypt(:'loadtest_password', gen_salt('bf', 10)),
       name,
       'USER',
       now(),
       now(),
       NULL
FROM source
ON CONFLICT (email) DO UPDATE
SET public_id = EXCLUDED.public_id,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    role = 'USER',
    updated_at = now(),
    deleted_at = NULL;

WITH source AS (
  SELECT i,
         ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid AS public_id,
         format('loadtest-admin-%s@example.invalid', lpad(i::text, 3, '0')) AS email,
         format('Loadtest Admin %s', lpad(i::text, 3, '0')) AS name
  FROM generate_series(1, 10) AS i
)
INSERT INTO users (public_id, email, password_hash, name, role, terms_accepted_at, updated_at, deleted_at)
SELECT public_id,
       email,
       crypt(:'loadtest_password', gen_salt('bf', 10)),
       name,
       'ADMIN',
       now(),
       now(),
       NULL
FROM source
ON CONFLICT (email) DO UPDATE
SET public_id = EXCLUDED.public_id,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    role = 'ADMIN',
    updated_at = now(),
    deleted_at = NULL;

WITH source AS (
  SELECT i,
         ('30000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid AS public_id,
         format('loadtest-user-%s@example.invalid', lpad(i::text, 3, '0')) AS user_email,
         format('loadtest-admin-%s@example.invalid', lpad((((i - 1) % 10) + 1)::text, 3, '0')) AS admin_email
  FROM generate_series(1, 150) AS i
)
INSERT INTO as_tickets (
  public_id, user_id, assigned_admin_id, symptom, status,
  cause_candidates, upgrade_candidates, created_at, updated_at, deleted_at
)
SELECT source.public_id,
       load_user.id,
       load_admin.id,
       'Gatling support chat load-test ticket',
       'ASSIGNED',
       '[]'::jsonb,
       '[]'::jsonb,
       now(),
       now(),
       NULL
FROM source
JOIN users load_user ON load_user.email = source.user_email
JOIN users load_admin ON load_admin.email = source.admin_email
ON CONFLICT (public_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    assigned_admin_id = EXCLUDED.assigned_admin_id,
    symptom = EXCLUDED.symptom,
    status = 'ASSIGNED',
    updated_at = now(),
    deleted_at = NULL;

WITH source AS (
  SELECT i,
         ('40000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid AS public_id,
         ('30000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid AS ticket_public_id
  FROM generate_series(1, 150) AS i
)
INSERT INTO support_chat_rooms (
  public_id, user_id, as_ticket_id, status, title,
  last_message_preview, last_message_at,
  user_unread_count, admin_unread_count,
  created_at, updated_at, deleted_at
)
SELECT source.public_id,
       ticket.user_id,
       ticket.id,
       'ACTIVE',
       format('Loadtest support room %s', lpad(source.i::text, 3, '0')),
       NULL,
       NULL,
       0,
       0,
       now(),
       now(),
       NULL
FROM source
JOIN as_tickets ticket ON ticket.public_id = source.ticket_public_id
ON CONFLICT (public_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    as_ticket_id = EXCLUDED.as_ticket_id,
    status = 'ACTIVE',
    title = EXCLUDED.title,
    last_message_preview = NULL,
    last_message_at = NULL,
    user_unread_count = 0,
    admin_unread_count = 0,
    updated_at = now(),
    deleted_at = NULL;

-- This removes messages only from deterministic load-test rooms. It makes the
-- post-Smoke DB assertion repeatable without touching any application data.
DELETE FROM support_chat_messages message
USING support_chat_rooms room
WHERE message.room_id = room.id
  AND room.public_id::text LIKE '40000000-0000-0000-0000-%';

UPDATE support_chat_rooms
SET last_message_preview = NULL,
    last_message_at = NULL,
    user_unread_count = 0,
    admin_unread_count = 0,
    updated_at = now()
WHERE public_id::text LIKE '40000000-0000-0000-0000-%';

COMMIT;

SELECT count(*) AS loadtest_users
FROM users
WHERE email LIKE 'loadtest-user-%@example.invalid';

SELECT count(*) AS loadtest_admins
FROM users
WHERE email LIKE 'loadtest-admin-%@example.invalid';

SELECT count(*) AS active_loadtest_rooms
FROM support_chat_rooms
WHERE public_id::text LIKE '40000000-0000-0000-0000-%'
  AND status = 'ACTIVE'
  AND deleted_at IS NULL;

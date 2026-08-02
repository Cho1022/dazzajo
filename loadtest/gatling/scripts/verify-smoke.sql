\set ON_ERROR_STOP on

WITH smoke_room AS (
  SELECT id
  FROM support_chat_rooms
  WHERE public_id = '40000000-0000-0000-0000-000000000001'::uuid
), result AS (
  SELECT count(*) FILTER (WHERE message.content = 'gatling-smoke-user') AS user_messages,
         count(*) FILTER (WHERE message.content = 'gatling-smoke-admin') AS admin_messages,
         count(*) FILTER (
           WHERE message.content IN ('gatling-smoke-user', 'gatling-smoke-admin')
         ) AS total_messages,
         count(DISTINCT message.client_message_id) FILTER (
           WHERE message.content IN ('gatling-smoke-user', 'gatling-smoke-admin')
         ) AS distinct_client_message_ids
  FROM support_chat_messages message
  JOIN smoke_room ON smoke_room.id = message.room_id
)
SELECT user_messages,
       admin_messages,
       total_messages,
       distinct_client_message_ids,
       user_messages = 5
         AND admin_messages = 5
         AND total_messages = 10
         AND distinct_client_message_ids = 10 AS smoke_db_ok
FROM result
\gset

\if :smoke_db_ok
  \echo 'Smoke DB verification passed: 10 rows and 10 distinct clientMessageId values.'
\else
  \echo 'Smoke DB verification failed.'
  \quit 3
\endif

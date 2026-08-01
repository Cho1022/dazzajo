ALTER TABLE support_chat_messages
  ADD COLUMN client_message_id UUID;

CREATE UNIQUE INDEX ux_support_chat_messages_sender_client_message
  ON support_chat_messages(sender_user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

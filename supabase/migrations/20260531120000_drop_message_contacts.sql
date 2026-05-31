-- Drop message_contacts table — PII storage is no longer needed in a separate table.
-- Sender email is now kept directly on the messages table for the duration of the
-- reply pipeline and cleaned up as part of message lifecycle.

DROP TABLE IF EXISTS public.message_contacts CASCADE;

-- Drop reply_send_logs table and its associated RLS policies
-- We are moving to console-only logging for outbound mail events

DROP TABLE IF EXISTS public.reply_send_logs CASCADE;

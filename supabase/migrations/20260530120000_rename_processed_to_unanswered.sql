-- Migration: Rename message status 'processed' to 'unanswered'
-- Clarity: Messages start as 'unanswered' after ingestion, then move to 'replied' or 'sending'

BEGIN;

-- 1) Update existing messages
UPDATE public.messages SET processing_status = 'unanswered' WHERE processing_status = 'processed';

-- 2) Change default value for the column
ALTER TABLE public.messages ALTER COLUMN processing_status SET DEFAULT 'unanswered';

COMMIT;

-- Trim whitespace from reply template subjects so outbound mail is not RFC 2047
-- encoded solely due to trailing spaces (Stalwart mail-builder behavior).
-- Subjects that are already MIME encoded-words should be corrected via the API
-- (normalizeEmailSubject on save) or re-saved from the admin UI.

UPDATE public.reply_templates
SET subject = btrim(subject)
WHERE subject IS DISTINCT FROM btrim(subject);

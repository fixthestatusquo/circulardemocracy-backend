-- View for DEFAULT_DOMAIN ingestion: mailbox addresses with email_domain for indexed filtering.

BEGIN;

CREATE OR REPLACE VIEW public.stalwart_mailbox_addresses AS
SELECT DISTINCT ON (lower(trim(s.mailbox_address)))
  trim(s.mailbox_address) AS mailbox_address,
  split_part(lower(trim(s.mailbox_address)), '@', 2) AS email_domain
FROM (
  SELECT p.email AS mailbox_address
  FROM public.politicians p
  WHERE p.active
    AND p.email IS NOT NULL
    AND trim(p.email) <> ''
  UNION ALL
  SELECT ae AS mailbox_address
  FROM public.politicians p
  CROSS JOIN LATERAL unnest(COALESCE(p.additional_emails, ARRAY[]::text[])) AS ae
  WHERE p.active
    AND ae IS NOT NULL
    AND trim(ae) <> ''
  UNION ALL
  SELECT c.technical_email AS mailbox_address
  FROM public.campaigns c
  WHERE c.status IN ('active', 'unconfirmed')
    AND c.technical_email IS NOT NULL
    AND trim(c.technical_email) <> ''
) s(mailbox_address)
WHERE position('@' IN s.mailbox_address) > 0
ORDER BY lower(trim(s.mailbox_address)), trim(s.mailbox_address);

CREATE INDEX IF NOT EXISTS idx_politicians_active_email_domain
  ON public.politicians (split_part(lower(trim(email)), '@', 2))
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_campaigns_technical_email_domain
  ON public.campaigns (split_part(lower(trim(technical_email)), '@', 2))
  WHERE status IN ('active', 'unconfirmed')
    AND technical_email IS NOT NULL
    AND trim(technical_email) <> '';

GRANT SELECT ON public.stalwart_mailbox_addresses TO service_role;

COMMIT;

BEGIN;

-- The local cache must never resurrect an explicitly deleted cloud record.
-- A restore operation must be designed separately, with explicit authorization.
CREATE OR REPLACE FUNCTION public.seven_mail_preserve_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seven_mail_preserve_account_tombstone ON public.desktop_mail_accounts;
CREATE TRIGGER seven_mail_preserve_account_tombstone
BEFORE UPDATE ON public.desktop_mail_accounts
FOR EACH ROW EXECUTE FUNCTION public.seven_mail_preserve_tombstone();

DROP TRIGGER IF EXISTS seven_mail_preserve_message_tombstone ON public.desktop_mail_messages;
CREATE TRIGGER seven_mail_preserve_message_tombstone
BEFORE UPDATE ON public.desktop_mail_messages
FOR EACH ROW EXECUTE FUNCTION public.seven_mail_preserve_tombstone();

COMMIT;

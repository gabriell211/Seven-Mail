BEGIN;

-- The local cache must never resurrect an explicitly deleted cloud record.
-- A restore operation must be designed separately, with explicit authorization.
CREATE OR REPLACE FUNCTION public.seven_mail_preserve_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Mail identity conflict' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Mail record is deleted' USING ERRCODE = '23514';
  END IF;
  -- Server-owned monotonic version; no dependence on device clock.
  NEW.updated_at := GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := NEW.updated_at;
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

-- Reject rather than silently accept conflicting writes. The original record
-- is preserved by the transaction, and the desktop can surface the conflict.
CREATE OR REPLACE FUNCTION public.seven_mail_guard_workspace_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $
DECLARE
  old_version timestamptz := GREATEST(OLD.updated_at, OLD.deleted_at);
  new_version timestamptz := GREATEST(NEW.updated_at, NEW.deleted_at);
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Workspace identity conflict' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Workspace restoration requires explicit authorization' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF new_version < old_version OR
     (new_version = old_version AND OLD.deleted_at IS NULL AND NEW.payload IS DISTINCT FROM OLD.payload) THEN
    RAISE EXCEPTION 'Workspace version conflict' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS seven_mail_guard_workspace_version ON public.workspace_documents;
CREATE TRIGGER seven_mail_guard_workspace_version
BEFORE UPDATE ON public.workspace_documents
FOR EACH ROW EXECUTE FUNCTION public.seven_mail_guard_workspace_version();

-- Deleting an account and its cloud message mirror is one transaction.
CREATE OR REPLACE FUNCTION public.seven_mail_cascade_account_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.desktop_mail_messages
    SET deleted_at = NEW.deleted_at
    WHERE owner_id = NEW.owner_id AND account_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS seven_mail_cascade_account_tombstone ON public.desktop_mail_accounts;
CREATE TRIGGER seven_mail_cascade_account_tombstone
AFTER UPDATE OF deleted_at ON public.desktop_mail_accounts
FOR EACH ROW EXECUTE FUNCTION public.seven_mail_cascade_account_tombstone();

CREATE OR REPLACE FUNCTION public.seven_mail_guard_message_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $
DECLARE
  account_deleted timestamptz;
BEGIN
  SELECT deleted_at INTO account_deleted FROM public.desktop_mail_accounts
    WHERE id = NEW.account_id AND owner_id = NEW.owner_id FOR SHARE;
  IF NOT FOUND OR account_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Mail account unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS seven_mail_guard_message_account ON public.desktop_mail_messages;
CREATE TRIGGER seven_mail_guard_message_account
BEFORE INSERT ON public.desktop_mail_messages
FOR EACH ROW EXECUTE FUNCTION public.seven_mail_guard_message_account();

-- Published only when all synchronization guards have been installed.
CREATE OR REPLACE VIEW public.seven_mail_sync_capabilities AS
SELECT 2::integer AS protocol_version;
REVOKE ALL ON public.seven_mail_sync_capabilities FROM PUBLIC;
GRANT SELECT ON public.seven_mail_sync_capabilities TO authenticated;

COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('seven_mail_ci.user_id', 'owner-a', true);
INSERT INTO desktop_mail_accounts(id,display_name,email,provider)
VALUES ('00000000-0000-4000-8000-000000000001','A','a@example.invalid','imap'),
       ('00000000-0000-4000-8000-000000000002','A2','a2@example.invalid','imap');
INSERT INTO desktop_mail_messages(id,account_id,folder,received_at,subject)
VALUES ('msg-a','00000000-0000-4000-8000-000000000001','INBOX',now(),'original');
INSERT INTO workspace_documents(id,kind,payload)
VALUES ('00000000-0000-4000-8000-000000000003','note','{"body":"private"}');
DO $$
DECLARE old_version timestamptz; new_version timestamptz;
BEGIN
  IF (SELECT protocol_version FROM seven_mail_sync_capabilities) <> 2 THEN
    RAISE EXCEPTION 'protocol version missing';
  END IF;
  SELECT updated_at INTO STRICT old_version FROM desktop_mail_messages WHERE id='msg-a';
  UPDATE desktop_mail_messages SET subject='updated',updated_at='2000-01-01' WHERE id='msg-a'
  RETURNING updated_at INTO STRICT new_version;
  IF new_version <= old_version THEN RAISE EXCEPTION 'version not monotonic'; END IF;
  BEGIN
    UPDATE desktop_mail_messages SET account_id='00000000-0000-4000-8000-000000000002' WHERE id='msg-a';
    RAISE EXCEPTION 'message reassignment permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE workspace_documents SET id='00000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'workspace identity changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM desktop_mail_messages WHERE id='msg-a';
    RAISE EXCEPTION 'physical deletion permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('seven_mail_ci.user_id', 'owner-b', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM desktop_mail_accounts) OR EXISTS (SELECT 1 FROM desktop_mail_messages)
     OR EXISTS (SELECT 1 FROM workspace_documents) THEN
    RAISE EXCEPTION 'cross-owner read permitted';
  END IF;
  UPDATE desktop_mail_messages SET subject='intrusion' WHERE id='msg-a';
  IF FOUND THEN RAISE EXCEPTION 'cross-owner update permitted'; END IF;
  BEGIN
    INSERT INTO desktop_mail_messages(id,account_id,folder,received_at)
    VALUES ('bad-b','00000000-0000-4000-8000-000000000001','INBOX',now());
    RAISE EXCEPTION 'cross-owner account insertion permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO desktop_mail_accounts(id,display_name,email,provider)
VALUES ('00000000-0000-4000-8000-000000000005','B','b@example.invalid','imap');
INSERT INTO desktop_mail_messages(id,account_id,folder,received_at)
VALUES ('msg-b','00000000-0000-4000-8000-000000000005','INBOX',now());
SELECT set_config('seven_mail_ci.user_id', 'owner-a', true);
UPDATE desktop_mail_accounts SET deleted_at=now() WHERE id='00000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desktop_mail_messages WHERE id='msg-a' AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cascade missing';
  END IF;
  BEGIN
    UPDATE desktop_mail_messages SET deleted_at=NULL WHERE id='msg-a';
    RAISE EXCEPTION 'resurrection permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO desktop_mail_messages(id,account_id,folder,received_at)
    VALUES ('late-a','00000000-0000-4000-8000-000000000001','INBOX',now());
    RAISE EXCEPTION 'insert into deleted account permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE workspace_documents SET deleted_at=now();
  BEGIN
    UPDATE workspace_documents SET deleted_at=NULL;
    RAISE EXCEPTION 'workspace resurrection permitted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('seven_mail_ci.user_id', 'owner-b', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desktop_mail_messages WHERE id='msg-b' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'other owner affected by deletion';
  END IF;
END $$;
ROLLBACK;

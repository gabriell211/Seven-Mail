BEGIN;

-- Seven Mail desktop cloud mirror.
-- Requires Managed Neon Auth before this migration is applied because auth.user_id()
-- is used as the RLS identity. Provider passwords/tokens are NEVER stored here.

CREATE TABLE IF NOT EXISTS workspace_documents (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  kind text NOT NULL CHECK (kind IN (
    'calendar','contact','task','note','rule','category','saved-search','settings'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workspace_owner_kind_updated
  ON workspace_documents(owner_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_owner_live
  ON workspace_documents(owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE workspace_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_documents_owner ON workspace_documents;
CREATE POLICY workspace_documents_owner
  ON workspace_documents
  FOR ALL
  TO authenticated
  USING (owner_id = auth.user_id())
  WITH CHECK (owner_id = auth.user_id());

CREATE TABLE IF NOT EXISTS desktop_mail_accounts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  display_name text NOT NULL,
  email citext NOT NULL,
  provider text NOT NULL,
  color text NOT NULL DEFAULT '#7868ff',
  is_default boolean NOT NULL DEFAULT false,
  username text,
  imap_host text,
  imap_port integer,
  smtp_host text,
  smtp_port integer,
  security_mode text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_desktop_accounts_owner
  ON desktop_mail_accounts(owner_id, updated_at DESC);

ALTER TABLE desktop_mail_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS desktop_mail_accounts_owner ON desktop_mail_accounts;
CREATE POLICY desktop_mail_accounts_owner
  ON desktop_mail_accounts
  FOR ALL
  TO authenticated
  USING (owner_id = auth.user_id())
  WITH CHECK (owner_id = auth.user_id());

CREATE TABLE IF NOT EXISTS desktop_mail_messages (
  id text PRIMARY KEY,
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  account_id uuid NOT NULL,
  remote_id text,
  remote_folder text,
  folder text NOT NULL,
  subject text NOT NULL DEFAULT '',
  preview text NOT NULL DEFAULT '',
  sender jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  received_at timestamptz NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  is_flagged boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  body_html text,
  body_text text,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_desktop_messages_owner_account_date
  ON desktop_mail_messages(owner_id, account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_desktop_messages_owner_folder_date
  ON desktop_mail_messages(owner_id, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_desktop_messages_owner_unread
  ON desktop_mail_messages(owner_id, received_at DESC)
  WHERE is_read = false AND deleted_at IS NULL;

ALTER TABLE desktop_mail_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS desktop_mail_messages_owner ON desktop_mail_messages;
CREATE POLICY desktop_mail_messages_owner
  ON desktop_mail_messages
  FOR ALL
  TO authenticated
  USING (owner_id = auth.user_id())
  WITH CHECK (owner_id = auth.user_id());

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON workspace_documents, desktop_mail_accounts, desktop_mail_messages
  TO authenticated;

COMMIT;

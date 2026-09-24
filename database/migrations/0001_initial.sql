BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS app_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  profile_id uuid REFERENCES app_profiles(id) ON DELETE CASCADE,
  email citext NOT NULL,
  display_name text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gmail','microsoft','yahoo','icloud','imap','pop3')),
  color text NOT NULL DEFAULT '#7868ff',
  is_default boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  auth_type text NOT NULL DEFAULT 'oauth2',
  imap_host text,
  imap_port integer,
  smtp_host text,
  smtp_port integer,
  pop_host text,
  pop_port integer,
  security_mode text CHECK (security_mode IS NULL OR security_mode IN ('tls','starttls','plain')),
  sync_window_days integer,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, email, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_owner ON mail_accounts(owner_id);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_profile ON mail_accounts(profile_id);

CREATE TABLE IF NOT EXISTS account_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  email citext NOT NULL,
  display_name text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, email)
);

CREATE TABLE IF NOT EXISTS mail_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  remote_id text,
  parent_id uuid REFERENCES mail_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  path text NOT NULL,
  unread_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_favorite boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  sync_token text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, path)
);

CREATE INDEX IF NOT EXISTS idx_mail_folders_account ON mail_folders(account_id);
CREATE INDEX IF NOT EXISTS idx_mail_folders_parent ON mail_folders(parent_id);

CREATE TABLE IF NOT EXISTS mail_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  provider_thread_id text,
  subject_key text,
  latest_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  unread_count integer NOT NULL DEFAULT 0,
  is_muted boolean NOT NULL DEFAULT false,
  is_ignored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mail_threads_account_latest ON mail_threads(account_id, latest_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_threads_owner_latest ON mail_threads(owner_id, latest_message_at DESC);

CREATE TABLE IF NOT EXISTS mail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES mail_folders(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES mail_threads(id) ON DELETE SET NULL,
  remote_id text NOT NULL,
  internet_message_id text,
  subject text NOT NULL DEFAULT '',
  preview text NOT NULL DEFAULT '',
  sender jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc jsonb NOT NULL DEFAULT '[]'::jsonb,
  bcc jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_text text,
  body_html text,
  size_bytes bigint NOT NULL DEFAULT 0,
  received_at timestamptz,
  sent_at timestamptz,
  is_read boolean NOT NULL DEFAULT false,
  is_flagged boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  is_draft boolean NOT NULL DEFAULT false,
  is_spam boolean NOT NULL DEFAULT false,
  is_phishing boolean NOT NULL DEFAULT false,
  importance text,
  has_attachments boolean NOT NULL DEFAULT false,
  snoozed_until timestamptz,
  deleted_at timestamptz,
  provider_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(subject,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(preview,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_text,'')), 'C')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, remote_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_account_folder_date ON mail_messages(account_id, folder_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_owner_date ON mail_messages(owner_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON mail_messages(account_id, folder_id, received_at DESC) WHERE is_read = false AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_flagged ON mail_messages(account_id, received_at DESC) WHERE is_flagged = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_thread ON mail_messages(thread_id, received_at);
CREATE INDEX IF NOT EXISTS idx_messages_search ON mail_messages USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_messages_subject_trgm ON mail_messages USING gin(subject gin_trgm_ops);

CREATE TABLE IF NOT EXISTS mail_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  remote_id text,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  content_id text,
  is_inline boolean NOT NULL DEFAULT false,
  object_key text,
  checksum_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON mail_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_name ON mail_attachments USING gin(file_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS message_categories (
  message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY(message_id, category_id)
);

CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid REFERENCES mail_accounts(id) ON DELETE CASCADE,
  remote_id text,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#7868ff',
  is_visible boolean NOT NULL DEFAULT true,
  is_shared boolean NOT NULL DEFAULT false,
  is_read_only boolean NOT NULL DEFAULT false,
  sync_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendars_owner ON calendars(owner_id);
CREATE INDEX IF NOT EXISTS idx_calendars_account ON calendars(account_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  remote_id text,
  uid text,
  title text NOT NULL,
  description text,
  location text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  timezone text,
  recurrence_rule text,
  recurrence_id text,
  status text,
  busy_status text,
  is_private boolean NOT NULL DEFAULT false,
  online_meeting_url text,
  reminder_minutes integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_calendar_start ON calendar_events(calendar_id, start_at);
CREATE INDEX IF NOT EXISTS idx_events_owner_start ON calendar_events(owner_id, start_at);

CREATE TABLE IF NOT EXISTS event_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  email citext NOT NULL,
  name text,
  attendee_type text NOT NULL DEFAULT 'required',
  response_status text,
  is_organizer boolean NOT NULL DEFAULT false,
  UNIQUE(event_id, email)
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid REFERENCES mail_accounts(id) ON DELETE CASCADE,
  remote_id text,
  first_name text,
  last_name text,
  display_name text NOT NULL,
  nickname text,
  company text,
  job_title text,
  notes text,
  photo_object_key text,
  emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  phones jsonb NOT NULL DEFAULT '[]'::jsonb,
  addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  important_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_favorite boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_name ON contacts(owner_id, display_name);
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm ON contacts USING gin(display_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_group_members (
  group_id uuid NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY(group_id, contact_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid REFERENCES mail_accounts(id) ON DELETE SET NULL,
  related_message_id uuid REFERENCES mail_messages(id) ON DELETE SET NULL,
  list_name text NOT NULL DEFAULT 'Meu dia',
  title text NOT NULL,
  notes text,
  priority text NOT NULL DEFAULT 'normal',
  starts_at timestamptz,
  due_at timestamptz,
  reminder_at timestamptz,
  recurrence_rule text,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_due ON tasks(owner_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_open ON tasks(owner_id, due_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_pinned boolean NOT NULL DEFAULT false,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid REFERENCES mail_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  stop_processing boolean NOT NULL DEFAULT false,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_owner_priority ON automation_rules(owner_id, priority);

CREATE TABLE IF NOT EXISTS saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  query jsonb NOT NULL,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS app_settings (
  owner_id uuid PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  cursor text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_success_at timestamptz,
  last_error text,
  retry_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, resource_type, resource_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_account ON sync_checkpoints(account_id, resource_type);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_id uuid REFERENCES mail_accounts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_owner_created ON audit_events(owner_id, created_at DESC);

COMMIT;

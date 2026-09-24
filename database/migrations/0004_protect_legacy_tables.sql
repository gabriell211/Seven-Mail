BEGIN;

-- The desktop client accesses only workspace_documents, desktop_mail_accounts,
-- and desktop_mail_messages through the Data API. The original relational tables
-- are reserved for server-side use. Enabling RLS without policies denies access
-- to the authenticated and anonymous Data API roles, even when broad GRANTs
-- were issued while provisioning the Data API.
ALTER TABLE app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

COMMIT;

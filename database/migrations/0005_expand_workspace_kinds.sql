BEGIN;

ALTER TABLE workspace_documents
  DROP CONSTRAINT IF EXISTS workspace_documents_kind_check;

ALTER TABLE workspace_documents
  ADD CONSTRAINT workspace_documents_kind_check
  CHECK (kind IN (
    'calendar','calendar-list','contact','contact-group','task','note','rule',
    'category','saved-search','signature','settings','draft','template',
    'content-block','folder-pref','profile','extension'
  ));

COMMIT;

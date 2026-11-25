CREATE TABLE messages (
    row_id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 180),
    message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 180),
    received_ms INTEGER NOT NULL,
    folder TEXT NOT NULL,
    subject TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipients TEXT NOT NULL,
    body TEXT NOT NULL,
    categories TEXT NOT NULL,
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    UNIQUE(account_id, message_id)
);
CREATE INDEX messages_account_date ON messages(account_id, received_ms DESC, message_id DESC);
CREATE INDEX messages_account_folder_date ON messages(account_id, folder, received_ms DESC, message_id DESC);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    subject, sender, recipients, body, categories,
    content='messages', content_rowid='row_id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, subject, sender, recipients, body, categories)
    VALUES (new.row_id, new.subject, new.sender, new.recipients, new.body, new.categories);
END;
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, sender, recipients, body, categories)
    VALUES ('delete', old.row_id, old.subject, old.sender, old.recipients, old.body, old.categories);
END;
CREATE TRIGGER messages_fts_update AFTER UPDATE OF subject, sender, recipients, body, categories ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, subject, sender, recipients, body, categories)
    VALUES ('delete', old.row_id, old.subject, old.sender, old.recipients, old.body, old.categories);
    INSERT INTO messages_fts(rowid, subject, sender, recipients, body, categories)
    VALUES (new.row_id, new.subject, new.sender, new.recipients, new.body, new.categories);
END;
PRAGMA application_id = 1397571913;
PRAGMA user_version = 1;

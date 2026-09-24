# Seven Mail Architecture

## Runtime

The desktop application uses React/TypeScript for presentation and Tauri 2 with Rust for native capabilities.

- Windows local data: `%APPDATA%\\Seven Mail`
- Linux local data: `$XDG_DATA_HOME/seven-mail` or `~/.local/share/seven-mail`
- Neon/PostgreSQL: durable application data and sync state
- Local filesystem: cache, pending operations and recovery state only

## Offline queue

Operations are immutable JSON envelopes and move through these directories:

```text
queue/
├── pending/
├── processing/
├── completed/
└── failed/
```

The application never treats cache files as authoritative cloud data. A restart can safely resume from `pending` or reconcile `processing`.

## Storage boundaries

### Neon

Neon is the durable source for:

- Accounts metadata
- Folders and indexed mail metadata
- Threads and messages
- Calendar state
- Contacts
- Tasks and notes
- Rules and saved searches
- Sync cursors/checkpoints
- Settings and audit events

### Local app data

Local storage contains:

- Message cache required for offline reading
- Selected downloaded attachments
- Outbox and synchronization queue
- Temporary import/export files
- Local UI recovery state

Provider credentials and OAuth secrets must not be written into these folders.

## Mail provider architecture

The domain should depend on provider interfaces, not concrete services. Provider adapters can implement IMAP/SMTP, POP3, CalDAV, CardDAV or native APIs while exposing normalized domain models.

## Large mailboxes

The database migration includes indexes for account/folder/date, unread and flagged partial indexes, thread lookup, attachment file names and full-text search. Desktop rendering must remain incremental and virtualized instead of loading entire mailboxes into memory.

## Releases

Tagging a version such as `v0.1.0` triggers the desktop release workflow and publishes Windows MSI/NSIS and Linux DEB/AppImage bundles.

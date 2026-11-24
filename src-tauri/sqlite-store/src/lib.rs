//! Isolated encrypted message store. Not yet connected to desktop IPC.
pub mod legacy;
#[cfg(feature = "native-vault")]
pub mod native_vault;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::{fmt::Write as _, path::Path, sync::Mutex, time::Duration};

const SCHEMA: &str = include_str!("schema.sql");
const APPLICATION_ID: i64 = 1397571913;
static OPEN_LOCK: Mutex<()> = Mutex::new(());
pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageRecord {
    pub account_id: String,
    pub message_id: String,
    pub received_ms: i64,
    pub folder: String,
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub body: String,
    pub categories: String,
    pub payload: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageCursor {
    pub received_ms: i64,
    pub message_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagePage {
    pub records: Vec<MessageRecord>,
    pub next: Option<PageCursor>,
}

pub struct Store {
    conn: Connection,
}

fn db_error(error: rusqlite::Error) -> String { error.to_string() }

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 180 && !value.chars().any(char::is_control)
}

fn validate(record: &MessageRecord) -> Result<()> {
    if !valid_id(&record.account_id) || !valid_id(&record.message_id) {
        return Err("Identificador de mensagem inválido.".into());
    }
    let size = [&record.folder, &record.subject, &record.sender, &record.recipients,
        &record.body, &record.categories, &record.payload]
        .iter().map(|value| value.len()).sum::<usize>();
    if size > 32 * 1024 * 1024 {
        return Err("Registro excede limite de 32 MiB.".into());
    }
    Ok(())
}

fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageRecord> {
    Ok(MessageRecord {
        account_id: row.get(0)?, message_id: row.get(1)?, received_ms: row.get(2)?,
        folder: row.get(3)?, subject: row.get(4)?, sender: row.get(5)?,
        recipients: row.get(6)?, body: row.get(7)?, categories: row.get(8)?, payload: row.get(9)?,
    })
}

const COLUMNS: &str = "account_id,message_id,received_ms,folder,subject,sender,recipients,body,categories,payload";
const INSERT: &str = "INSERT INTO messages(account_id,message_id,received_ms,folder,subject,sender,recipients,body,categories,payload)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)";

impl Store {
    /// Caller supplies a dedicated 256-bit database key from the OS keyring.
    /// Never fall back to an unencrypted database or overwrite an existing file.
    pub fn open(path: &Path, key: &[u8; 32]) -> Result<Self> {
        let _guard = OPEN_LOCK.lock().map_err(|_| "Abertura do banco indisponível.".to_string())?;
        let mut conn = Connection::open_with_flags(path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)
            .map_err(db_error)?;
        let mut raw_key = String::with_capacity(67);
        raw_key.push_str("x'");
        for byte in key { write!(&mut raw_key, "{byte:02x}").map_err(|_| "Chave inválida.".to_string())?; }
        raw_key.push('\'');
        conn.pragma_update(None, "key", &raw_key).map_err(|_| "Não foi possível configurar chave SQLCipher.".to_string())?;
        drop(raw_key);
        let version: String = conn.pragma_query_value(None, "cipher_version", |row| row.get(0))
            .map_err(|_| "SQLCipher indisponível; banco não autorizado.".to_string())?;
        if version.is_empty() { return Err("SQLCipher indisponível.".into()); }
        // Authentication is required before any schema changes.
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))
            .map_err(|_| "Banco inválido ou chave incorreta.".to_string())?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;
            PRAGMA secure_delete=ON; PRAGMA synchronous=FULL;").map_err(db_error)?;
        let mode: String = conn.query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0)).map_err(db_error)?;
        if mode.to_ascii_lowercase() != "delete" { return Err("Modo de journal não confirmado.".into()); }

        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
        let schema_version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(db_error)?;
        let app_id: i64 = tx.pragma_query_value(None, "application_id", |row| row.get(0)).map_err(db_error)?;
        match (schema_version, app_id) {
            (0, 0) => {
                let existing: i64 = tx.query_row("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'", [], |row| row.get(0)).map_err(db_error)?;
                if existing != 0 { return Err("Banco existente não pertence ao Seven Mail.".into()); }
                tx.execute_batch(SCHEMA).map_err(db_error)?;
            }
            (1, APPLICATION_ID) => {}
            _ => return Err("Versão do armazenamento incompatível.".into()),
        }
        tx.commit().map_err(db_error)?;
        Ok(Self { conn })
    }

    pub fn upsert(&mut self, record: &MessageRecord) -> Result<()> {
        validate(record)?;
        let sql = format!("{INSERT} ON CONFLICT(account_id,message_id) DO UPDATE SET
            received_ms=excluded.received_ms, folder=excluded.folder, subject=excluded.subject,
            sender=excluded.sender, recipients=excluded.recipients, body=excluded.body,
            categories=excluded.categories, payload=excluded.payload");
        self.conn.execute(&sql, params![record.account_id, record.message_id, record.received_ms,
            record.folder, record.subject, record.sender, record.recipients,
            record.body, record.categories, record.payload]).map_err(db_error)?;
        Ok(())
    }

    pub fn get(&self, account: &str, id: &str) -> Result<Option<MessageRecord>> {
        if !valid_id(account) || !valid_id(id) { return Err("Identificador inválido.".into()); }
        self.conn.query_row(&format!("SELECT {COLUMNS} FROM messages WHERE account_id=?1 AND message_id=?2"),
            params![account,id], decode).optional().map_err(db_error)
    }

    pub fn remove(&mut self, account: &str, id: &str) -> Result<bool> {
        if !valid_id(account) || !valid_id(id) { return Err("Identificador inválido.".into()); }
        Ok(self.conn.execute("DELETE FROM messages WHERE account_id=?1 AND message_id=?2",
            params![account,id]).map_err(db_error)? != 0)
    }

    pub fn page(&self, account: &str, folder: Option<&str>, cursor: Option<&PageCursor>, limit: usize) -> Result<MessagePage> {
        if !valid_id(account) || cursor.is_some_and(|c| !valid_id(&c.message_id)) { return Err("Identificador inválido.".into()); }
        let size = limit.clamp(1, 200);
        let sql = format!("SELECT {COLUMNS} FROM messages
            WHERE account_id=?1 AND (?2 IS NULL OR folder=?2)
            AND (?3 IS NULL OR received_ms < ?3 OR (received_ms=?3 AND message_id < ?4))
            ORDER BY received_ms DESC, message_id DESC LIMIT ?5");
        let mut stmt = self.conn.prepare(&sql).map_err(db_error)?;
        let mut records = stmt.query_map(params![account,folder,cursor.map(|c|c.received_ms),
            cursor.map(|c|c.message_id.as_str()),(size+1) as i64],decode).map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;
        let next = if records.len()>size {
            records.pop();
            records.last().map(|r| PageCursor{received_ms:r.received_ms,message_id:r.message_id.clone()})
        } else { None };
        Ok(MessagePage{records,next})
    }

    pub fn search(&self, account: &str, query: &str, limit: usize) -> Result<Vec<String>> {
        if !valid_id(account) || query.len()>1024 { return Err("Consulta inválida.".into()); }
        // Quote each term: user input cannot change FTS grammar or query SQL.
        let terms = query.split_whitespace().take(32)
            .filter(|term| term.chars().any(char::is_alphanumeric))
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>();
        if terms.is_empty() { return Ok(Vec::new()); }
        let expression = terms.join(" AND ");
        let mut stmt = self.conn.prepare("SELECT m.message_id FROM messages_fts
            JOIN messages m ON m.row_id=messages_fts.rowid
            WHERE messages_fts MATCH ?1 AND m.account_id=?2
            ORDER BY bm25(messages_fts), m.received_ms DESC, m.message_id DESC LIMIT ?3").map_err(db_error)?;
        let rows = stmt.query_map(params![expression,account,limit.clamp(1,200) as i64], |row| row.get(0)).map_err(db_error)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
    }

    /// Non-destructive import: identical records are idempotent, conflicts
    /// abort the entire transaction. The source is never modified.
    pub fn import_verified<I>(&mut self, records: I) -> Result<usize>
    where I: IntoIterator<Item=Result<MessageRecord>> {
        self.import_transaction(records, None)
    }

    /// Staging database only: the exact destination count must equal the
    /// verified source inventory before any imported records commit.
    pub fn import_exact_snapshot<I>(&mut self, records: I, expected: usize) -> Result<usize>
    where I: IntoIterator<Item=Result<MessageRecord>> {
        self.import_transaction(records, Some(expected))
    }

    fn import_transaction<I>(&mut self, records: I, expected: Option<usize>) -> Result<usize>
    where I: IntoIterator<Item=Result<MessageRecord>> {
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
        let mut count = 0usize;
        for item in records {
            let record = item?;
            validate(&record)?;
            let sql = format!("{INSERT} ON CONFLICT(account_id,message_id) DO NOTHING");
            tx.execute(&sql, params![record.account_id,record.message_id,record.received_ms,record.folder,
                record.subject,record.sender,record.recipients,record.body,record.categories,record.payload]).map_err(db_error)?;
            let actual = tx.query_row(&format!("SELECT {COLUMNS} FROM messages WHERE account_id=?1 AND message_id=?2"),
                params![record.account_id,record.message_id],decode).map_err(db_error)?;
            if actual != record { return Err("Conflito na migração; transação cancelada.".into()); }
            count += 1;
        }
        if let Some(expected) = expected {
            let actual: i64 = tx.query_row("SELECT count(*) FROM messages", [], |row| row.get(0)).map_err(db_error)?;
            if count != expected || actual != expected as i64 {
                return Err("Contagem de destino diverge do snapshot; transação cancelada.".into());
            }
        }
        tx.execute("INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1)", []).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(count)
    }

    pub fn verify(&self) -> Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA cipher_integrity_check").map_err(db_error)?;
        if stmt.query([]).map_err(db_error)?.next().map_err(db_error)?.is_some() {
            return Err("Falha na integridade criptográfica.".into());
        }
        let mut stmt = self.conn.prepare("PRAGMA integrity_check").map_err(db_error)?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;
        if rows.as_slice() != ["ok"] { return Err("Falha de integridade SQLite.".into()); }
        Ok(())
    }
}

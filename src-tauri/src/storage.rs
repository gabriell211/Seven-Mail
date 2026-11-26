use crate::{local_crypto, models::{AccountProfile, MailMessage, QueueOperation, QueuedAttachment, RuntimeInfo}};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{fs, io::{self, Write}, path::{Path, PathBuf}};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
    pub message_cache: PathBuf,
    pub search_index: PathBuf,
    pub attachment_cache: PathBuf,
    pub queue: PathBuf,
    pub queue_attachments: PathBuf,
    pub pending: PathBuf,
    pub processing: PathBuf,
    pub completed: PathBuf,
    pub failed: PathBuf,
}

impl AppPaths {
    pub fn data_root() -> Result<PathBuf, String> {
        #[cfg(target_os = "windows")]
        let root = dirs::data_dir()
            .ok_or_else(|| "Não foi possível localizar o diretório APPDATA.".to_string())?
            .join("Seven Mail");

        #[cfg(not(target_os = "windows"))]
        let root = dirs::data_local_dir()
            .or_else(dirs::data_dir)
            .ok_or_else(|| "Não foi possível localizar o diretório de dados do usuário.".to_string())?
            .join("seven-mail");

        Ok(root)
    }

    pub fn resolve() -> Result<Self, String> {
        let root = Self::data_root()?;
        let paths = Self {
            config: root.join("config"),
            cache: root.join("cache"),
            message_cache: root.join("cache").join("messages"),
            search_index: root.join("cache").join("search-index"),
            attachment_cache: root.join("cache").join("attachments"),
            queue: root.join("queue"),
            queue_attachments: root.join("queue").join("attachments"),
            pending: root.join("queue").join("pending"),
            processing: root.join("queue").join("processing"),
            completed: root.join("queue").join("completed"),
            failed: root.join("queue").join("failed"),
            root,
        };

        paths.ensure()?;
        local_crypto::migrate_local_data(&paths.root)?;
        Ok(paths)
    }

    fn ensure(&self) -> Result<(), String> {
        for dir in [
            &self.root,
            &self.config,
            &self.cache,
            &self.message_cache,
            &self.search_index,
            &self.attachment_cache,
            &self.queue,
            &self.queue_attachments,
            &self.pending,
            &self.processing,
            &self.completed,
            &self.failed,
        ] {
            fs::create_dir_all(dir).map_err(io_error)?;
        }
        Ok(())
    }

    pub fn runtime_info(&self) -> RuntimeInfo {
        RuntimeInfo {
            platform: std::env::consts::OS.to_string(),
            data_dir: self.root.display().to_string(),
            cache_dir: self.cache.display().to_string(),
            queue_dir: self.queue.display().to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

fn io_error(error: io::Error) -> String {
    error.to_string()
}

fn safe_component(value: &str) -> Result<&str, String> {
    let device = value.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || ["COM", "LPT"].iter().any(|prefix| {
            device.strip_prefix(*prefix).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
            })
        });
    if value.is_empty()
        || value.len() > 180
        || value.trim() != value
        || value.ends_with('.')
        || value.contains("..")
        || value.chars().any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        || reserved
    {
        return Err("Identificador inválido para armazenamento local.".to_string());
    }
    Ok(value)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Caminho local inválido.".to_string())?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    local_crypto::write(path, &bytes)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = local_crypto::read(path)?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

pub fn list_accounts(paths: &AppPaths) -> Result<Vec<AccountProfile>, String> {
    let path = paths.config.join("accounts-cache.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_json(&path)
}

pub fn save_account(paths: &AppPaths, account: AccountProfile) -> Result<(), String> {
    safe_component(&account.id)?;
    let mut accounts = list_accounts(paths)?;
    if let Some(index) = accounts.iter().position(|item| item.id == account.id) {
        accounts[index] = account;
    } else {
        accounts.push(account);
    }
    write_json(&paths.config.join("accounts-cache.json"), &accounts)
}

pub fn set_default_account(paths: &AppPaths, account_id: &str) -> Result<Vec<AccountProfile>, String> {
    safe_component(account_id)?;
    let mut accounts = list_accounts(paths)?;
    if !accounts.iter().any(|account| account.id == account_id) {
        return Err("Conta não encontrada.".to_string());
    }

    for account in &mut accounts {
        account.is_default = account.id == account_id;
    }

    write_json(&paths.config.join("accounts-cache.json"), &accounts)?;
    Ok(accounts)
}

fn remove_account_operations(dir: &Path, account_id: &str) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(operation) = read_json::<QueueOperation>(&path) {
            if operation.account_id == account_id {
                fs::remove_file(path).map_err(io_error)?;
            }
        }
    }
    Ok(())
}

pub fn delete_account(paths: &AppPaths, account_id: &str) -> Result<Vec<AccountProfile>, String> {
    safe_component(account_id)?;
    let mut accounts = list_accounts(paths)?;
    let removed_default = accounts
        .iter()
        .find(|account| account.id == account_id)
        .map(|account| account.is_default)
        .unwrap_or(false);

    accounts.retain(|account| account.id != account_id);
    if removed_default && !accounts.is_empty() && !accounts.iter().any(|account| account.is_default) {
        accounts[0].is_default = true;
    }

    write_json(&paths.config.join("accounts-cache.json"), &accounts)?;

    let message_dir = paths.message_cache.join(account_id);
    if message_dir.exists() {
        fs::remove_dir_all(message_dir).map_err(io_error)?;
    }
    let index_dir = paths.search_index.join(account_id);
    if index_dir.exists() {
        fs::remove_dir_all(index_dir).map_err(io_error)?;
    }

    for dir in [&paths.pending, &paths.processing, &paths.completed, &paths.failed] {
        remove_account_operations(dir, account_id)?;
    }

    Ok(accounts)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexEntry {
    message_id: String,
    account_id: String,
    text: String,
}

fn normalize_search_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_alphanumeric() || ch == '@' || ch == '.' { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_index_path(paths: &AppPaths, account_id: &str, message_id: &str) -> Result<PathBuf, String> {
    safe_component(account_id)?;
    safe_component(message_id)?;
    Ok(paths.search_index.join(account_id).join(format!("{}.json", message_id)))
}

fn index_message(paths: &AppPaths, message: &MailMessage) -> Result<(), String> {
    let recipients = message.to.iter()
        .map(|item| format!("{} {}", item.name.as_deref().unwrap_or(""), item.email))
        .collect::<Vec<_>>()
        .join(" ");
    let text = normalize_search_text(&format!(
        "{} {} {} {} {} {} {}",
        message.subject,
        message.preview,
        message.body_text.as_deref().unwrap_or(""),
        message.from.name.as_deref().unwrap_or(""),
        message.from.email,
        recipients,
        message.categories.join(" "),
    ));
    write_json(
        &search_index_path(paths, &message.account_id, &message.id)?,
        &SearchIndexEntry {
            message_id: message.id.clone(),
            account_id: message.account_id.clone(),
            text,
        },
    )
}

pub fn search_cached_message_ids(
    paths: &AppPaths,
    account_id: Option<&str>,
    query: &str,
) -> Result<Vec<String>, String> {
    let query = normalize_search_text(query);
    let tokens = query.split_whitespace().filter(|value| !value.is_empty()).collect::<Vec<_>>();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let root = match account_id {
        Some(id) => {
            safe_component(id)?;
            paths.search_index.join(id)
        }
        None => paths.search_index.clone(),
    };

    let mut matches = Vec::new();
    fn walk(dir: &Path, tokens: &[&str], output: &mut Vec<String>) -> Result<(), String> {
        if !dir.exists() { return Ok(()); }
        for entry in fs::read_dir(dir).map_err(io_error)? {
            let path = entry.map_err(io_error)?.path();
            if path.is_dir() {
                walk(&path, tokens, output)?;
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("json") { continue; }
            let Ok(entry) = read_json::<SearchIndexEntry>(&path) else { continue; };
            if tokens.iter().all(|token| entry.text.contains(token)) {
                output.push(entry.message_id);
            }
        }
        Ok(())
    }
    walk(&root, &tokens, &mut matches)?;
    Ok(matches)
}

pub fn cache_message(paths: &AppPaths, message: &MailMessage) -> Result<(), String> {
    safe_component(&message.account_id)?;
    safe_component(&message.id)?;
    let path = paths
        .message_cache
        .join(&message.account_id)
        .join(format!("{}.json", message.id));
    write_json(&path, message)?;
    index_message(paths, message)
}

fn raw_message_path(paths: &AppPaths, account_id: &str, message_id: &str) -> Result<PathBuf, String> {
    safe_component(account_id)?;
    safe_component(message_id)?;
    Ok(paths
        .message_cache
        .join(account_id)
        .join("_raw")
        .join(format!("{}.eml", message_id)))
}

pub fn cache_raw_message(paths: &AppPaths, account_id: &str, message_id: &str, raw: &[u8]) -> Result<(), String> {
    let path = raw_message_path(paths, account_id, message_id)?;
    let parent = path.parent().ok_or_else(|| "Caminho de mensagem inválido.".to_string())?;
    fs::create_dir_all(parent).map_err(io_error)?;
    local_crypto::write(&path, raw)
}

pub fn read_raw_message(paths: &AppPaths, account_id: &str, message_id: &str) -> Result<Vec<u8>, String> {
    let path = raw_message_path(paths, account_id, message_id)?;
    local_crypto::read(&path).map_err(|error| format!("Fonte original da mensagem indisponível: {error}"))
}

pub fn update_message_metadata(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    importance: Option<String>,
    snoozed_until: Option<String>,
    is_muted: Option<bool>,
    is_phishing: Option<bool>,
    is_important: Option<bool>,
) -> Result<MailMessage, String> {
    safe_component(account_id)?;
    safe_component(message_id)?;
    let path = paths
        .message_cache
        .join(account_id)
        .join(format!("{}.json", message_id));
    if !path.exists() {
        return Err("Mensagem não encontrada no cache local.".to_string());
    }

    let mut message = read_json::<MailMessage>(&path)?;
    if let Some(value) = importance {
        if !matches!(value.as_str(), "low" | "normal" | "high") {
            return Err("Prioridade inválida.".to_string());
        }
        message.importance = Some(value);
    }
    if snoozed_until.is_some() {
        message.snoozed_until = snoozed_until;
    }
    if let Some(value) = is_muted {
        message.is_muted = value;
    }
    if let Some(value) = is_phishing {
        message.is_phishing = value;
    }
    if let Some(value) = is_important {
        message.is_important = value;
    }

    write_json(&path, &message)?;
    Ok(message)
}

fn collect_messages(dir: &Path, output: &mut Vec<MailMessage>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.is_dir() {
            collect_messages(&path, output)?;
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) == Some("json") {
            if let Ok(message) = read_json::<MailMessage>(&path) {
                output.push(message);
            }
        }
    }
    Ok(())
}

pub fn list_cached_messages(paths: &AppPaths, account_id: Option<&str>) -> Result<Vec<MailMessage>, String> {
    let mut messages = Vec::new();

    match account_id {
        Some(id) => {
            safe_component(id)?;
            collect_messages(&paths.message_cache.join(id), &mut messages)?;
        }
        None => collect_messages(&paths.message_cache, &mut messages)?,
    }

    messages.sort_by(|a, b| b.received_at.cmp(&a.received_at));
    Ok(messages)
}

/// Detach unverified or stale remote identities before accepting a new
/// mailbox generation. Keep the original metadata and raw source locally.
pub fn prepare_imap_generation(
    paths: &AppPaths,
    account_id: &str,
    remote_folder: &str,
    validity: u32,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    safe_component(account_id)?;
    if validity == 0 {
        return Err("UIDVALIDITY inválido.".to_string());
    }
    let folder = if remote_folder.eq_ignore_ascii_case("INBOX") { "INBOX" } else { remote_folder };
    let key = format!("{:x}", Sha256::digest(folder.as_bytes()));
    let state = paths.root.join("state").join("imap").join(account_id);
    let recovery = state.join("recovery").join(&key);
    for mut message in list_cached_messages(paths, Some(account_id))? {
        let same_folder = message.remote_folder.as_deref().map(|value| {
            value == folder || (folder == "INBOX" && value.eq_ignore_ascii_case("INBOX"))
        }).unwrap_or(false);
        if !same_folder { continue; }
        let Some(uid) = message.remote_id.as_deref().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        if message.id == crate::imap_sync::remote_message_id(account_id, folder, validity, uid) {
            continue;
        }
        safe_component(&message.id)?;
        let backup = recovery.join(format!("{}.json", message.id));
        if !backup.exists() {
            write_json(&backup, &message)?;
        }
        // Never let a stale local message retain a live remote UID.
        // Keep the original ID so the existing encrypted raw source remains available.
        message.remote_id = None;
        message.remote_folder = None;
        message.folder = "Recuperados IMAP".to_string();
        cache_message(paths, &message)?;
    }
    write_json(&state.join(format!("{key}.json")), &serde_json::json!({
        "mailbox": folder, "uidValidity": validity,
    }))
}

pub fn cached_remote_uids(
    paths: &AppPaths,
    account_id: &str,
    remote_folder: &str,
) -> Result<Vec<u32>, String> {
    let mut uids = list_cached_messages(paths, Some(account_id))?
        .into_iter()
        .filter(|message| message.remote_folder.as_deref() == Some(remote_folder))
        .filter_map(|message| message.remote_id.and_then(|value| value.parse::<u32>().ok()))
        .collect::<Vec<_>>();
    uids.sort_unstable();
    uids.dedup();
    Ok(uids)
}

pub fn update_cached_remote_flags(
    paths: &AppPaths,
    account_id: &str,
    remote_folder: &str,
    uid_validity: u32,
    uid: u32,
    is_read: bool,
    is_flagged: bool,
) -> Result<bool, String> {
    safe_component(account_id)?;
    if uid_validity == 0 || uid == 0 {
        return Err("Identidade IMAP inválida.".into());
    }
    let id = crate::imap_sync::remote_message_id(account_id, remote_folder, uid_validity, uid);
    safe_component(&id)?;
    let path = paths.message_cache.join(account_id).join(format!("{id}.json"));
    // Resolve the exact generation-scoped record instead of decrypting and
    // sorting the entire account cache for each returned UID.
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {}
        Ok(_) => return Err("Arquivo de mensagem IMAP inválido.".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(io_error(error)),
    }
    let mut message: MailMessage = read_json(&path)?;
    if message.id != id || message.account_id != account_id ||
        message.remote_folder.as_deref() != Some(remote_folder) ||
        message.remote_id.as_deref() != Some(uid.to_string().as_str()) {
        return Err("Identidade da mensagem IMAP diverge do arquivo.".into());
    }
    if message.is_read == is_read && message.is_flagged == is_flagged {
        return Ok(true);
    }
    message.is_read = is_read;
    message.is_flagged = is_flagged;
    cache_message(paths, &message)?;
    Ok(true)
}

fn remote_uid_missing(remote_uids: &std::collections::HashSet<u32>, uid: u32) -> bool {
    !remote_uids.contains(&uid)
}

pub fn reconcile_remote_uids(
    paths: &AppPaths,
    account_id: &str,
    remote_folder: &str,
    remote_uids: &std::collections::HashSet<u32>,
) -> Result<usize, String> {
    let messages = list_cached_messages(paths, Some(account_id))?;
    let mut removed = 0usize;
    for message in messages {
        if message.remote_folder.as_deref() != Some(remote_folder) {
            continue;
        }
        let Some(uid) = message.remote_id.as_deref().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        if !remote_uid_missing(remote_uids, uid) {
            continue;
        }
        let path = paths.message_cache.join(account_id).join(format!("{}.json", message.id));
        if path.exists() {
            fs::remove_file(&path).map_err(io_error)?;
        }
        let index = search_index_path(paths, account_id, &message.id)?;
        if index.exists() {
            fs::remove_file(index).map_err(io_error)?;
        }
        let raw = raw_message_path(paths, account_id, &message.id)?;
        if raw.exists() {
            fs::remove_file(raw).map_err(io_error)?;
        }
        removed += 1;
    }
    Ok(removed)
}

// Serialize the state transitions of the single-instance queue. Never hold
// this mutex across a network call, SMTP submission, or IMAP operation.
static QUEUE_TRANSITIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn queue_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    QUEUE_TRANSITIONS.lock().map_err(|_| "Fila local indisponível após falha interna.".to_string())
}

pub fn queue_operation(paths: &AppPaths, operation: &QueueOperation) -> Result<(), String> {
    let _guard = queue_guard()?;
    safe_component(&operation.id)?;
    safe_component(&operation.account_id)?;
    let path = paths.pending.join(format!("{}.json", operation.id));
    let name = format!("{}.json", operation.id);
    if path.exists() || [&paths.processing, &paths.completed, &paths.failed].iter().any(|dir| dir.join(&name).exists()) {
        return Err("Operação já existe na fila.".to_string());
    }
    write_json(&path, operation)
}

fn list_operations(dir: &Path) -> Result<Vec<QueueOperation>, String> {
    let mut operations = Vec::new();
    if !dir.exists() {
        return Ok(operations);
    }

    for entry in fs::read_dir(dir).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(operation) = read_json::<QueueOperation>(&path) {
            operations.push(operation);
        }
    }

    operations.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(operations)
}

pub fn list_queue(paths: &AppPaths) -> Result<Vec<QueueOperation>, String> {
    let mut operations = list_operations(&paths.pending)?;
    // Failed items remain inspectable. They are never selected by the worker.
    operations.extend(list_operations(&paths.failed)?);
    operations.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(operations)
}

pub fn claim_next_send_due(paths: &AppPaths) -> Result<Option<QueueOperation>, String> {
    let now = chrono::Utc::now();
    claim_next_matching(paths, |operation| {
        if operation.kind != "send" && operation.kind != "redirect" {
            return false;
        }

        operation
            .payload
            .get("sendAt")
            .and_then(|value| value.as_str())
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|when| when.with_timezone(&chrono::Utc) <= now)
            .unwrap_or(true)
    })
}

fn safe_attachment_name(value: &str) -> String {
    let value = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') { ch } else { '_' })
        .collect::<String>();
    let trimmed = value.trim_matches(['.', ' ']);
    if trimmed.is_empty() { "arquivo".into() } else { trimmed.chars().take(120).collect() }
}

fn dangerous_attachment(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "exe" | "msi" | "bat" | "cmd" | "com" | "scr" | "pif" | "ps1" | "vbs" | "vbe" | "js" | "jse" | "wsf" | "wsh" | "hta" | "reg" | "lnk"
    )
}

// Read at most one byte beyond the authorized limit, even if a source grows
// after its metadata was inspected.
fn read_attachment_bounded(mut reader: impl io::Read, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    (&mut reader).take(limit + 1).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err("Anexo excede o limite autorizado de armazenamento.".into());
    }
    Ok(bytes)
}

pub(crate) fn staging_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Diretório de anexos inválido.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Diretório de anexos contém ponto de reanálise.".into());
        }
    }
    Ok(())
}

pub(crate) fn prepare_attachment_directory(root: &Path, operation_id: &str) -> Result<PathBuf, String> {
    safe_component(operation_id)?;
    staging_directory(root)?;
    let destination = root.join(operation_id);
    fs::create_dir_all(&destination).map_err(io_error)?;
    staging_directory(&destination)?;
    Ok(destination)
}

pub fn stage_attachments(
    paths: &AppPaths,
    operation_id: &str,
    sources: &[String],
    max_file_mb: u64,
    max_total_mb: u64,
) -> Result<Vec<QueuedAttachment>, String> {
    safe_component(operation_id)?;
    if sources.len() > 256 { return Err("Quantidade de anexos acima do limite.".into()); }
    let destination = prepare_attachment_directory(&paths.queue_attachments, operation_id)?;
    let max_file = max_file_mb.clamp(1, 250) * 1024 * 1024;
    let max_total = max_total_mb.clamp(max_file_mb.clamp(1, 250), 500) * 1024 * 1024;
    let mut output: Vec<QueuedAttachment> = Vec::new();
    let mut total = 0u64;

    let result = (|| -> Result<(), String> {
        for source in sources {
            let source_path = Path::new(source);
            if dangerous_attachment(source_path) {
                return Err("Extensão de anexo bloqueada por segurança.".into());
            }
            let metadata = fs::symlink_metadata(source_path).map_err(io_error)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Anexo deve ser um arquivo regular.".into());
            }
            let file = fs::File::open(source_path).map_err(io_error)?;
            let remaining = max_total.saturating_sub(total).min(max_file);
            if file.metadata().map_err(io_error)?.len() > remaining {
                return Err("Anexo excede o limite individual ou total.".into());
            }
            let source_bytes = read_attachment_bounded(file, remaining)?;
            let size = source_bytes.len() as u64;
            total += size;
            let original_name = source_path.file_name().and_then(|value| value.to_str()).unwrap_or("arquivo");
            let name = safe_attachment_name(original_name);
            // Names do not depend on the number of existing entries, which
            // may change during concurrent staging or attachment removal.
            let staged_path = destination.join(format!("{}-{name}", uuid::Uuid::new_v4()));
            local_crypto::write(&staged_path, &source_bytes)?;
            output.push(QueuedAttachment {
                name, path: staged_path.display().to_string(), size,
                inline: false, content_id: None,
            });
        }
        Ok(())
    })();
    if let Err(error) = result {
        // Remove only files created by this invocation; preserve earlier drafts.
        for attachment in &output { let _ = fs::remove_file(&attachment.path); }
        return Err(error);
    }
    Ok(output)
}

pub fn stage_message_as_eml(
    paths: &AppPaths,
    operation_id: &str,
    account_id: &str,
    message_id: &str,
    suggested_name: &str,
) -> Result<QueuedAttachment, String> {
    safe_component(operation_id)?;
    safe_component(account_id)?;
    safe_component(message_id)?;

    let raw = read_raw_message(paths, account_id, message_id)?;
    if raw.len() as u64 > 64 * 1024 * 1024 {
        return Err("A mensagem excede o limite de 64 MB para encaminhamento como anexo.".to_string());
    }

    let destination = prepare_attachment_directory(&paths.queue_attachments, operation_id)?;

    let mut base = safe_attachment_name(suggested_name);
    if !base.to_ascii_lowercase().ends_with(".eml") {
        base.push_str(".eml");
    }
    let staged_path = destination.join(format!("{}-{base}", uuid::Uuid::new_v4()));
    local_crypto::write(&staged_path, &raw)?;

    Ok(QueuedAttachment {
        name: base,
        path: staged_path.display().to_string(),
        size: raw.len() as u64,
        inline: false,
        content_id: None,
    })
}

pub fn cancel_operation(paths: &AppPaths, operation_id: &str) -> Result<bool, String> {
    let _guard = queue_guard()?;
    safe_component(operation_id)?;
    let pending = paths.pending.join(format!("{operation_id}.json"));
    // Removing the pending entry is the cancellation decision. If the
    // sender has already claimed it, leave its attachments untouched.
    match fs::remove_file(&pending) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(io_error(error)),
    }

    let attachments = paths.queue_attachments.join(operation_id);
    match fs::remove_dir_all(attachments) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
    }

    Ok(true)
}

pub fn claim_next_mail_action(paths: &AppPaths, account_id: &str) -> Result<Option<QueueOperation>, String> {
    safe_component(account_id)?;
    claim_next_matching(paths, |operation| {
        operation.account_id == account_id
            && matches!(operation.kind.as_str(), "read" | "flag" | "move" | "copy")
    })
}

fn claim_next_matching(
    paths: &AppPaths,
    predicate: impl Fn(&QueueOperation) -> bool,
) -> Result<Option<QueueOperation>, String> {
    let _guard = queue_guard()?;
    let now = chrono::Utc::now();
    let Some(operation) = list_operations(&paths.pending)?
        .into_iter()
        .filter(|operation| {
            operation
                .payload
                .get("_nextAttemptAt")
                .and_then(|value| value.as_str())
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|when| when.with_timezone(&chrono::Utc) <= now)
                .unwrap_or(true)
        })
        .find(predicate)
    else {
        return Ok(None);
    };

    safe_component(&operation.id)?;
    let source = paths.pending.join(format!("{}.json", operation.id));
    let destination = paths.processing.join(format!("{}.json", operation.id));
    if destination.exists() {
        return Err("Operação duplicada em processamento; recuperação necessária.".into());
    }
    // A cancellation or another process may have won the atomic claim.
    match fs::rename(source, destination) {
        Ok(()) => Ok(Some(operation)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
    }
}

pub fn complete(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    let _guard = queue_guard()?;
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{}.json", operation_id));
    if !source.exists() {
        return Ok(());
    }
    let destination = paths.completed.join(format!("{}.json", operation_id));
    if destination.exists() {
        return Err("Operação concluída já existe; recuperação necessária.".into());
    }
    fs::rename(source, destination).map_err(io_error)?;
    let attachments = paths.queue_attachments.join(operation_id);
    if attachments.exists() {
        fs::remove_dir_all(attachments).map_err(io_error)?;
    }
    Ok(())
}

fn fail_locked(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{}.json", operation_id));
    if !source.exists() {
        return Ok(());
    }
    let destination = paths.failed.join(format!("{}.json", operation_id));
    if destination.exists() {
        return Err("Operação já existe na fila de falhas.".to_string());
    }
    fs::rename(source, destination).map_err(io_error)
}


const MAX_QUEUE_ATTEMPTS: u32 = 8;

fn set_delivery_state(operation: &mut QueueOperation, state: &str) -> Result<(), String> {
    let payload = operation.payload.as_object_mut()
        .ok_or_else(|| "Operação de fila possui payload inválido.".to_string())?;
    payload.insert("_deliveryState".into(), serde_json::Value::String(state.into()));
    Ok(())
}

pub fn mark_smtp_submission(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    let _guard = queue_guard()?;
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{operation_id}.json"));
    let mut operation = read_json::<QueueOperation>(&source)?;
    set_delivery_state(&mut operation, "submitting")?;
    write_json(&source, &operation)
}

pub fn quarantine_operation(paths: &AppPaths, operation_id: &str, state: &str) -> Result<(), String> {
    let _guard = queue_guard()?;
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{operation_id}.json"));
    let destination = paths.failed.join(format!("{operation_id}.json"));
    if destination.exists() {
        return Err("Operação já existe na fila de falhas; recuperação manual necessária.".to_string());
    }
    let mut operation = read_json::<QueueOperation>(&source)?;
    set_delivery_state(&mut operation, state)?;
    write_json(&source, &operation)?;
    fs::rename(source, destination).map_err(io_error)
}

/// Run once during single-instance startup, before accepting queue commands.
/// Legacy processing records cannot prove whether the provider accepted them.
pub fn recover_interrupted_operations(paths: &AppPaths) -> Result<(), String> {
    for entry in fs::read_dir(&paths.processing).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let operation = read_json::<QueueOperation>(&path)?;
        safe_component(&operation.id)?;
        let name = format!("{}.json", operation.id);
        if path.file_name().and_then(|value| value.to_str()) != Some(name.as_str()) {
            return Err("Identificador da operação interrompida não corresponde ao arquivo.".to_string());
        }
        let pending = paths.pending.join(&name);
        if pending.exists() {
            // Preserve duplicate records left by an older interrupted retry,
            // but remove them from the active queue before recovery.
            let conflicts = paths.queue.join("recovery-conflicts");
            fs::create_dir_all(&conflicts).map_err(io_error)?;
            fs::rename(&pending, conflicts.join(format!("{}-{}", uuid::Uuid::new_v4(), name))).map_err(io_error)?;
        }
        quarantine_operation(paths, &operation.id, "delivery_unknown")?;
    }
    Ok(())
}

pub fn retry_later(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    let _guard = queue_guard()?;
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{}.json", operation_id));
    if !source.exists() {
        return Ok(());
    }

    let mut operation = read_json::<QueueOperation>(&source)?;
    operation.attempts = operation.attempts.saturating_add(1);
    if operation.attempts >= MAX_QUEUE_ATTEMPTS {
        set_delivery_state(&mut operation, "retry_exhausted")?;
        write_json(&source, &operation)?;
        return fail_locked(paths, operation_id);
    }
    set_delivery_state(&mut operation, "retry_pending")?;
    let exponent = operation.attempts.min(8);
    let delay_seconds = (5u64.saturating_mul(1u64 << exponent)).min(15 * 60);
    let next = chrono::Utc::now() + chrono::Duration::seconds(delay_seconds as i64);
    if let Some(payload) = operation.payload.as_object_mut() {
        payload.insert(
            "_nextAttemptAt".to_string(),
            serde_json::Value::String(next.to_rfc3339()),
        );
    }

    let destination = paths.pending.join(format!("{}.json", operation_id));
    if destination.exists() {
        return Err("Operação pendente duplicada; recuperação necessária.".into());
    }
    // Update the claimed record first, then move it back into pending.
    // There must never be two live copies of the same operation.
    write_json(&source, &operation)?;
    fs::rename(source, destination).map_err(io_error)
}


pub fn apply_message_action(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    action: &str,
) -> Result<MailMessage, String> {
    safe_component(account_id)?;
    safe_component(message_id)?;

    let path = paths
        .message_cache
        .join(account_id)
        .join(format!("{}.json", message_id));

    if !path.exists() {
        return Err("Mensagem não encontrada no cache local.".to_string());
    }

    let mut message = read_json::<MailMessage>(&path)?;

    match action {
        "read" => message.is_read = true,
        "unread" => message.is_read = false,
        "flag" => message.is_flagged = true,
        "unflag" => message.is_flagged = false,
        "pin" => message.is_pinned = true,
        "unpin" => message.is_pinned = false,
        "archive" => message.folder = "Arquivados".to_string(),
        "delete" => message.folder = "Lixeira".to_string(),
        "spam" => message.folder = "Spam".to_string(),
        "inbox" => message.folder = "Caixa de entrada".to_string(),
        _ => return Err("Ação de mensagem não suportada.".to_string()),
    }

    write_json(&path, &message)?;

    if matches!(action, "pin" | "unpin") || message.remote_id.is_none() || message.remote_folder.as_deref() == Some("POP3") {
        return Ok(message);
    }

    let mailbox = message.remote_folder.clone().unwrap_or_else(|| "INBOX".to_string());
    let (kind, mut payload) = match action {
        "read" => ("read", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "read": true})),
        "unread" => ("read", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "read": false})),
        "flag" => ("flag", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "flagged": true})),
        "unflag" => ("flag", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "flagged": false})),
        "archive" => ("move", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "target": "archive"})),
        "delete" => ("move", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "target": "trash"})),
        "spam" => ("move", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "target": "spam"})),
        "inbox" => ("move", serde_json::json!({"remoteId": message.remote_id, "mailbox": mailbox, "target": "inbox"})),
        _ => unreachable!(),
    };

    payload["messageId"] = serde_json::Value::String(message.id.clone());
    queue_operation(
        paths,
        &QueueOperation {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.to_string(),
            account_id: account_id.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            attempts: 0,
            payload,
        },
    )?;

    Ok(message)
}

pub fn rename_cached_folder(
    paths: &AppPaths,
    account_id: &str,
    old_path: &str,
    old_label: &str,
    new_path: &str,
    new_label: &str,
) -> Result<usize, String> {
    safe_component(account_id)?;
    let directory = paths.message_cache.join(account_id);
    if !directory.exists() {
        return Ok(0);
    }

    let mut updated = 0usize;
    for entry in fs::read_dir(&directory).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(mut message) = read_json::<MailMessage>(&path) else {
            continue;
        };
        if message.remote_folder.as_deref() == Some(old_path) || message.folder == old_label {
            message.remote_folder = Some(new_path.to_string());
            message.folder = new_label.to_string();
            write_json(&path, &message)?;
            updated += 1;
        }
    }
    Ok(updated)
}

pub fn remove_cached_folder(
    paths: &AppPaths,
    account_id: &str,
    remote_path: &str,
    label: &str,
) -> Result<usize, String> {
    safe_component(account_id)?;
    let directory = paths.message_cache.join(account_id);
    if !directory.exists() {
        return Ok(0);
    }

    let mut removed = 0usize;
    for entry in fs::read_dir(&directory).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(message) = read_json::<MailMessage>(&path) else {
            continue;
        };
        if message.remote_folder.as_deref() == Some(remote_path) || message.folder == label {
            fs::remove_file(&path).map_err(io_error)?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn move_message_to_folder(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    target_path: &str,
    target_label: &str,
) -> Result<MailMessage, String> {
    safe_component(account_id)?;
    safe_component(message_id)?;

    if target_path.trim().is_empty() || target_label.trim().is_empty() {
        return Err("A pasta de destino é inválida.".to_string());
    }

    let path = paths
        .message_cache
        .join(account_id)
        .join(format!("{}.json", message_id));

    if !path.exists() {
        return Err("Mensagem não encontrada no cache local.".to_string());
    }

    let mut message = read_json::<MailMessage>(&path)?;
    let source_mailbox = message.remote_folder.clone().unwrap_or_else(|| "INBOX".to_string());

    if message.remote_id.is_none() || message.remote_folder.as_deref() == Some("POP3") {
        return Err("A mensagem não possui uma identidade IMAP remota confirmada.".to_string());
    }

    // The source folder remains authoritative until the server applies the move.
    // Updating the remote folder optimistically would bind its UID to a different mailbox.
    message.folder = target_label.trim().to_string();
    write_json(&path, &message)?;

    queue_operation(
        paths,
        &QueueOperation {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "move".to_string(),
            account_id: account_id.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            attempts: 0,
            payload: serde_json::json!({
                "remoteId": message.remote_id,
                "mailbox": source_mailbox,
                "messageId": message.id.clone(),
                "targetMailbox": target_path.trim(),
            }),
        },
    )?;

    Ok(message)
}

fn overwrite_and_remove(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink() {
        return Err("Limpeza interrompida: link simbólico inesperado.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Limpeza interrompida: ponto de reanálise inesperado.".into());
        }
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(io_error)? {
            overwrite_and_remove(&entry.map_err(io_error)?.path())?;
        }
        fs::remove_dir(path).map_err(io_error)?;
        return Ok(());
    }

    if metadata.is_file() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err("Limpeza interrompida: arquivo com links físicos adicionais.".into());
            }
        }
        let len = metadata.len();
        let mut file = fs::OpenOptions::new().write(true).open(path).map_err(io_error)?;
        let zeros = vec![0u8; 64 * 1024];
        let mut remaining = len;
        while remaining > 0 {
            let size = usize::try_from(remaining.min(zeros.len() as u64)).map_err(|error| error.to_string())?;
            file.write_all(&zeros[..size]).map_err(io_error)?;
            remaining -= size as u64;
        }
        file.sync_all().map_err(io_error)?;
        drop(file);
        fs::remove_file(path).map_err(io_error)?;
    }
    Ok(())
}

pub fn secure_clear_local_data(paths: &AppPaths) -> Result<(), String> {
    for target in [
        paths.cache.clone(),
        paths.queue.clone(),
        paths.root.join("state"),
    ] {
        if target.exists() {
            overwrite_and_remove(&target)?;
        }
    }
    paths.ensure()?;
    Ok(())
}

pub fn prune_message_cache(paths: &AppPaths, retention_days: u32) -> Result<usize, String> {
    if retention_days == 0 {
        return Ok(0);
    }

    let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days.clamp(1, 3650) as i64);
    let messages = list_cached_messages(paths, None)?;
    let mut removed = 0usize;

    for message in messages {
        let Ok(received) = chrono::DateTime::parse_from_rfc3339(&message.received_at) else {
            continue;
        };
        if received.with_timezone(&chrono::Utc) >= cutoff {
            continue;
        }

        safe_component(&message.account_id)?;
        safe_component(&message.id)?;
        let message_path = paths
            .message_cache
            .join(&message.account_id)
            .join(format!("{}.json", message.id));
        if message_path.exists() {
            fs::remove_file(&message_path).map_err(io_error)?;
        }

        if let Ok(raw_path) = raw_message_path(paths, &message.account_id, &message.id) {
            if raw_path.exists() {
                fs::remove_file(raw_path).map_err(io_error)?;
            }
        }

        removed += 1;
    }

    Ok(removed)
}

pub fn clear_cache(paths: &AppPaths) -> Result<(), String> {
    for directory in [&paths.message_cache, &paths.search_index, &paths.attachment_cache] {
        if directory.exists() {
            fs::remove_dir_all(directory).map_err(io_error)?;
        }
        fs::create_dir_all(directory).map_err(io_error)?;
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    #[ignore = "requires isolated protocol CI key"]
    fn interrupted_smtp_queue_preserves_data_without_automatic_replay() {
        assert_eq!(std::env::var("SEVEN_MAIL_PROTOCOL_E2E").as_deref(), Ok("1"));
        let root = std::env::temp_dir().join(format!("seven-mail-queue-{}", uuid::Uuid::new_v4()));
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
        }
        let _cleanup = Cleanup(root.clone());
        let paths = AppPaths {
            config: root.join("config"), cache: root.join("cache"),
            message_cache: root.join("cache/messages"), search_index: root.join("cache/search-index"),
            attachment_cache: root.join("cache/attachments"), queue: root.join("queue"),
            queue_attachments: root.join("queue/attachments"), pending: root.join("queue/pending"),
            processing: root.join("queue/processing"), completed: root.join("queue/completed"),
            failed: root.join("queue/failed"), root,
        };
        paths.ensure().unwrap();
        let operation = QueueOperation {
            id: uuid::Uuid::new_v4().to_string(), kind: "send".into(),
            account_id: "ci-account".into(), created_at: chrono::Utc::now().to_rfc3339(),
            attempts: 0, payload: serde_json::json!({"subject":"original"}),
        };
        let name = format!("{}.json", operation.id);
        let attachment_dir = paths.queue_attachments.join(&operation.id);
        fs::create_dir(&attachment_dir).unwrap();
        local_crypto::write(&attachment_dir.join("attachment"), b"preserved").unwrap();
        queue_operation(&paths, &operation).unwrap();
        assert!(queue_operation(&paths, &operation).is_err());
        assert_eq!(claim_next_send_due(&paths).unwrap().unwrap().id, operation.id);
        assert!(!cancel_operation(&paths, &operation.id).unwrap());
        mark_smtp_submission(&paths, &operation.id).unwrap();
        // A legacy retry may have left a second pending record before crash.
        fs::copy(paths.processing.join(&name), paths.pending.join(&name)).unwrap();
        recover_interrupted_operations(&paths).unwrap();
        assert!(claim_next_send_due(&paths).unwrap().is_none());
        assert!(!paths.processing.join(&name).exists());
        assert!(!paths.pending.join(&name).exists());
        let failed = read_json::<QueueOperation>(&paths.failed.join(&name)).unwrap();
        assert_eq!(failed.payload["_deliveryState"], "delivery_unknown");
        assert_eq!(failed.payload["subject"], "original");
        assert_eq!(local_crypto::read(&attachment_dir.join("attachment")).unwrap(), b"preserved");
        assert_eq!(fs::read_dir(paths.queue.join("recovery-conflicts")).unwrap().count(), 1);
        assert!(queue_operation(&paths, &operation).is_err());
        recover_interrupted_operations(&paths).unwrap();
        assert!(claim_next_send_due(&paths).unwrap().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn staging_rejects_symlink_root_and_operation_directory() {
        let root = std::env::temp_dir().join(format!("seven-mail-stage-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let queue = root.join("queue");
        let external = root.join("external");
        fs::create_dir(&queue).unwrap();
        fs::create_dir(&external).unwrap();
        let linked_root = root.join("linked-root");
        std::os::unix::fs::symlink(&external, &linked_root).unwrap();
        assert!(prepare_attachment_directory(&linked_root, "op").is_err());
        assert!(!external.join("op").exists());
        std::os::unix::fs::symlink(&external, queue.join("op")).unwrap();
        assert!(prepare_attachment_directory(&queue, "op").is_err());
        assert!(prepare_attachment_directory(&queue, "../outside").is_err());
        assert_eq!(prepare_attachment_directory(&queue, "valid").unwrap(), queue.join("valid"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn attachment_reader_checks_actual_bytes_and_exact_boundary() {
        assert_eq!(read_attachment_bounded(&b"1234"[..], 4).unwrap(), b"1234");
        assert!(read_attachment_bounded(&b"12345"[..], 4).is_err());
        assert!(read_attachment_bounded(&b"1"[..], 0).is_err());
        assert!(read_attachment_bounded(&b""[..], 0).unwrap().is_empty());
    }

    #[test]
    fn queue_transition_lock_excludes_competing_workers() {
        let guard = queue_guard().unwrap();
        let other = std::thread::spawn(|| {
            assert!(matches!(QUEUE_TRANSITIONS.try_lock(), Err(std::sync::TryLockError::WouldBlock)));
        });
        other.join().unwrap();
        drop(guard);
        assert!(queue_guard().is_ok());
    }

    #[test]
    fn delivery_state_requires_an_object_and_preserves_message_payload() {
        let mut operation = QueueOperation {
            id: "op".into(), kind: "send".into(), account_id: "account".into(),
            created_at: "2026-01-01T00:00:00Z".into(), attempts: 0,
            payload: serde_json::json!({"subject": "original"}),
        };
        set_delivery_state(&mut operation, "delivery_unknown").unwrap();
        assert_eq!(operation.payload["subject"], "original");
        assert_eq!(operation.payload["_deliveryState"], "delivery_unknown");
        operation.payload = serde_json::Value::Null;
        assert!(set_delivery_state(&mut operation, "submitting").is_err());
    }

    #[test]
    fn security_rejects_path_traversal_components() {
        for value in ["../segredo", "conta/fora", r"conta\fora", "..", "", ".", "C:", "arquivo:stream", "NUL.txt", "COM1", "lpt²", "conta.", "conta ", "a\n", "a\0"] {
            assert!(safe_component(value).is_err(), "{value} deveria ser rejeitado");
        }
        assert!(safe_component("account-123_ABC").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn secure_cleanup_does_not_follow_links_to_external_files() {
        let root = std::env::temp_dir().join(format!("seven-mail-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let original = root.join("original");
        fs::write(&original, b"preserve").unwrap();
        let symlink = root.join("symlink");
        std::os::unix::fs::symlink(&original, &symlink).unwrap();
        assert!(overwrite_and_remove(&symlink).is_err());
        let hardlink = root.join("hardlink");
        fs::hard_link(&original, &hardlink).unwrap();
        assert!(overwrite_and_remove(&hardlink).is_err());
        assert_eq!(fs::read(&original).unwrap(), b"preserve");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn synchronization_detects_only_missing_remote_uids() {
        let remote = HashSet::from([1_u32, 3, 5, 8]);
        assert!(!remote_uid_missing(&remote, 1));
        assert!(!remote_uid_missing(&remote, 8));
        assert!(remote_uid_missing(&remote, 2));
        assert!(remote_uid_missing(&remote, 13));
    }

    #[test]
    fn load_normalizes_large_search_batch() {
        let mut checksum = 0usize;
        for index in 0..50_000usize {
            let input = format!("Cliente {index} <user{index}@example.com> — Assunto Importante!");
            let normalized = normalize_search_text(&input);
            assert!(normalized.contains("example.com"));
            checksum = checksum.wrapping_add(normalized.len());
        }
        assert!(checksum > 1_000_000);
    }
}

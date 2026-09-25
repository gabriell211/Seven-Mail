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
    pub fn resolve() -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        let root = dirs::data_dir()
            .ok_or_else(|| "Não foi possível localizar o diretório APPDATA.".to_string())?
            .join("Seven Mail");

        #[cfg(not(target_os = "windows"))]
        let root = dirs::data_local_dir()
            .or_else(dirs::data_dir)
            .ok_or_else(|| "Não foi possível localizar o diretório de dados do usuário.".to_string())?
            .join("seven-mail");

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
    if value.is_empty()
        || value.len() > 180
        || value.contains('/')
        || value.contains(char::from(92))
        || value.contains("..")
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
    uid: u32,
    is_read: bool,
    is_flagged: bool,
) -> Result<bool, String> {
    let remote_id = uid.to_string();
    let Some(mut message) = list_cached_messages(paths, Some(account_id))?
        .into_iter()
        .find(|message| {
            message.remote_folder.as_deref() == Some(remote_folder)
                && message.remote_id.as_deref() == Some(remote_id.as_str())
        })
    else {
        return Ok(false);
    };

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

pub fn queue_operation(paths: &AppPaths, operation: &QueueOperation) -> Result<(), String> {
    safe_component(&operation.id)?;
    safe_component(&operation.account_id)?;
    let path = paths.pending.join(format!("{}.json", operation.id));
    if path.exists() {
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
    list_operations(&paths.pending)
}

pub fn claim_next_kind(paths: &AppPaths, kind: &str) -> Result<Option<QueueOperation>, String> {
    claim_next_matching(paths, |operation| operation.kind == kind)
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

pub fn stage_attachments(
    paths: &AppPaths,
    operation_id: &str,
    sources: &[String],
    max_file_mb: u64,
    max_total_mb: u64,
) -> Result<Vec<QueuedAttachment>, String> {
    safe_component(operation_id)?;
    let destination = paths.queue_attachments.join(operation_id);
    fs::create_dir_all(&destination).map_err(io_error)?;

    let mut output = Vec::new();
    let mut total = 0u64;
    let offset = fs::read_dir(&destination)
        .map_err(io_error)?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .count();

    for (index, source) in sources.iter().enumerate() {
        let source_path = Path::new(source);
        if !source_path.is_file() {
            return Err(format!("Anexo não encontrado: {}", source_path.display()));
        }
        if dangerous_attachment(source_path) {
            return Err(format!("Extensão de anexo bloqueada por segurança: {}", source_path.display()));
        }

        let metadata = fs::metadata(source_path).map_err(io_error)?;
        let max_file = max_file_mb.clamp(1, 250) * 1024 * 1024;
        let max_total = max_total_mb.clamp(max_file_mb.clamp(1, 250), 500) * 1024 * 1024;
        if metadata.len() > max_file {
            return Err(format!("Cada anexo deve ter no máximo {max_file_mb} MB."));
        }
        total = total.saturating_add(metadata.len());
        if total > max_total {
            return Err(format!("O total de anexos desta mensagem não pode exceder {max_total_mb} MB."));
        }

        let original_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("arquivo");
        let name = safe_attachment_name(original_name);
        let staged_name = format!("{:03}-{name}", offset + index);
        let staged_path = destination.join(staged_name);
        let source_bytes = fs::read(source_path).map_err(io_error)?;
        local_crypto::write(&staged_path, &source_bytes)?;

        output.push(QueuedAttachment {
            name,
            path: staged_path.display().to_string(),
            size: metadata.len(),
            inline: false,
            content_id: None,
        });
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

    let destination = paths.queue_attachments.join(operation_id);
    fs::create_dir_all(&destination).map_err(io_error)?;

    let mut base = safe_attachment_name(suggested_name);
    if !base.to_ascii_lowercase().ends_with(".eml") {
        base.push_str(".eml");
    }
    let staged_path = destination.join(format!("000-{base}"));
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
    safe_component(operation_id)?;
    let pending = paths.pending.join(format!("{operation_id}.json"));
    let existed = pending.exists();

    if existed {
        fs::remove_file(&pending).map_err(io_error)?;
    }

    let attachments = paths.queue_attachments.join(operation_id);
    if attachments.exists() {
        fs::remove_dir_all(attachments).map_err(io_error)?;
    }

    Ok(existed)
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
    fs::rename(source, destination).map_err(io_error)?;
    Ok(Some(operation))
}

pub fn complete(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{}.json", operation_id));
    if !source.exists() {
        return Ok(());
    }
    let destination = paths.completed.join(format!("{}.json", operation_id));
    fs::rename(source, destination).map_err(io_error)?;
    let attachments = paths.queue_attachments.join(operation_id);
    if attachments.exists() {
        fs::remove_dir_all(attachments).map_err(io_error)?;
    }
    Ok(())
}

pub fn fail(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{}.json", operation_id));
    if !source.exists() {
        return Ok(());
    }
    let destination = paths.failed.join(format!("{}.json", operation_id));
    fs::rename(source, destination).map_err(io_error)
}


pub fn retry_later(paths: &AppPaths, operation_id: &str) -> Result<(), String> {
    safe_component(operation_id)?;
    let source = paths.processing.join(format!("{}.json", operation_id));
    if !source.exists() {
        return Ok(());
    }

    let mut operation = read_json::<QueueOperation>(&source)?;
    operation.attempts = operation.attempts.saturating_add(1);
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
    write_json(&destination, &operation)?;
    fs::remove_file(source).map_err(io_error)
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

    if matches!(action, "pin" | "unpin") || message.remote_folder.as_deref() == Some("POP3") {
        return Ok(message);
    }

    let mailbox = message.remote_folder.clone().unwrap_or_else(|| "INBOX".to_string());
    let (kind, payload) = match action {
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

    message.folder = target_label.trim().to_string();
    message.remote_folder = Some(target_path.trim().to_string());
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
                "targetMailbox": target_path.trim(),
            }),
        },
    )?;

    Ok(message)
}

fn overwrite_and_remove(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(io_error)? {
            overwrite_and_remove(&entry.map_err(io_error)?.path())?;
        }
        fs::remove_dir(path).map_err(io_error)?;
        return Ok(());
    }

    if path.is_file() {
        let len = fs::metadata(path).map_err(io_error)?.len();
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
    fn security_rejects_path_traversal_components() {
        for value in ["../segredo", "conta/fora", r"conta\fora", "..", ""] {
            assert!(safe_component(value).is_err(), "{value} deveria ser rejeitado");
        }
        assert!(safe_component("account-123_ABC").is_ok());
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

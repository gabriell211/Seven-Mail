use crate::models::{AccountProfile, MailMessage, QueueOperation, QueuedAttachment, RuntimeInfo};
use serde::{de::DeserializeOwned, Serialize};
use std::{fs, io::{self, Write}, path::{Path, PathBuf}};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
    pub message_cache: PathBuf,
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
            queue: root.join("queue"),
            queue_attachments: root.join("queue").join("attachments"),
            pending: root.join("queue").join("pending"),
            processing: root.join("queue").join("processing"),
            completed: root.join("queue").join("completed"),
            failed: root.join("queue").join("failed"),
            root,
        };

        paths.ensure()?;
        Ok(paths)
    }

    fn ensure(&self) -> Result<(), String> {
        for dir in [
            &self.root,
            &self.config,
            &self.cache,
            &self.message_cache,
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
    let mut file = fs::File::create(path).map_err(io_error)?;
    file.write_all(&bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(io_error)?;
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

    for dir in [&paths.pending, &paths.processing, &paths.completed, &paths.failed] {
        remove_account_operations(dir, account_id)?;
    }

    Ok(accounts)
}

pub fn cache_message(paths: &AppPaths, message: &MailMessage) -> Result<(), String> {
    safe_component(&message.account_id)?;
    safe_component(&message.id)?;
    let path = paths
        .message_cache
        .join(&message.account_id)
        .join(format!("{}.json", message.id));
    write_json(&path, message)
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
        if operation.kind != "send" {
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
        if metadata.len() > 25 * 1024 * 1024 {
            return Err("Cada anexo deve ter no máximo 25 MB.".to_string());
        }
        total = total.saturating_add(metadata.len());
        if total > 100 * 1024 * 1024 {
            return Err("O total de anexos desta mensagem não pode exceder 100 MB.".to_string());
        }

        let original_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("arquivo");
        let name = safe_attachment_name(original_name);
        let staged_name = format!("{:03}-{name}", offset + index);
        let staged_path = destination.join(staged_name);
        fs::copy(source_path, &staged_path).map_err(io_error)?;

        output.push(QueuedAttachment {
            name,
            path: staged_path.display().to_string(),
            size: metadata.len(),
        });
    }

    Ok(output)
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
            && matches!(operation.kind.as_str(), "read" | "flag" | "move")
    })
}

fn claim_next_matching(
    paths: &AppPaths,
    predicate: impl Fn(&QueueOperation) -> bool,
) -> Result<Option<QueueOperation>, String> {
    let Some(operation) = list_operations(&paths.pending)?
        .into_iter()
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
    let destination = paths.pending.join(format!("{}.json", operation_id));
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

    if matches!(action, "pin" | "unpin") {
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

pub fn clear_cache(paths: &AppPaths) -> Result<(), String> {
    if paths.message_cache.exists() {
        fs::remove_dir_all(&paths.message_cache).map_err(io_error)?;
    }
    fs::create_dir_all(&paths.message_cache).map_err(io_error)?;
    Ok(())
}

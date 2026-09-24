use crate::models::{AccountProfile, MailMessage, QueueOperation, RuntimeInfo};
use serde::{de::DeserializeOwned, Serialize};
use std::{fs, io::{self, Write}, path::{Path, PathBuf}};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
    pub message_cache: PathBuf,
    pub queue: PathBuf,
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

pub fn claim_next(paths: &AppPaths) -> Result<Option<QueueOperation>, String> {
    let Some(operation) = list_operations(&paths.pending)?.into_iter().next() else {
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
    fs::rename(source, destination).map_err(io_error)
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

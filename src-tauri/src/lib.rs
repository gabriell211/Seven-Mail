mod credentials;
mod imap_sync;
mod models;
mod providers;
mod storage;
mod workspace;

use models::{AccountProfile, MailMessage, ProviderSettings, QueueOperation, RuntimeInfo, WorkspaceDocument};
use storage::AppPaths;

#[tauri::command]
fn runtime_info() -> Result<RuntimeInfo, String> {
    Ok(AppPaths::resolve()?.runtime_info())
}

#[tauri::command]
fn list_accounts() -> Result<Vec<AccountProfile>, String> {
    storage::list_accounts(&AppPaths::resolve()?)
}

#[tauri::command]
fn save_account(account: AccountProfile) -> Result<(), String> {
    storage::save_account(&AppPaths::resolve()?, account)
}

#[tauri::command]
fn store_secret(account_id: String, secret: String) -> Result<(), String> {
    credentials::store(&account_id, &secret)
}

#[tauri::command]
fn discover_provider(email: String) -> ProviderSettings {
    providers::discover(&email)
}

#[tauri::command]
fn test_smtp_connection(account_id: String) -> Result<bool, String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    providers::test_smtp(&account)
}

#[tauri::command]
fn test_imap_connection(account_id: String) -> Result<bool, String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::test(&account)
}

#[tauri::command]
fn sync_inbox(account_id: String, limit: Option<u32>) -> Result<usize, String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::sync_latest(&paths, &account, limit.unwrap_or(50))
}

#[tauri::command]
fn flush_mail_actions(account_id: String) -> Result<usize, String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::flush_actions(&paths, &account)
}

#[tauri::command]
fn list_cached_messages(account_id: Option<String>) -> Result<Vec<MailMessage>, String> {
    storage::list_cached_messages(&AppPaths::resolve()?, account_id.as_deref())
}

#[tauri::command]
fn cache_message(message: MailMessage) -> Result<(), String> {
    storage::cache_message(&AppPaths::resolve()?, &message)
}

#[tauri::command]
fn queue_operation(operation: QueueOperation) -> Result<(), String> {
    storage::queue_operation(&AppPaths::resolve()?, &operation)
}

#[tauri::command]
fn list_queue() -> Result<Vec<QueueOperation>, String> {
    storage::list_queue(&AppPaths::resolve()?)
}

#[tauri::command]
fn flush_outbox() -> Result<usize, String> {
    let paths = AppPaths::resolve()?;
    let accounts = storage::list_accounts(&paths)?;
    let mut sent = 0usize;

    loop {
        let Some(operation) = storage::claim_next_kind(&paths, "send")? else {
            break;
        };

        let Some(account) = accounts.iter().find(|item| item.id == operation.account_id) else {
            storage::fail(&paths, &operation.id)?;
            continue;
        };

        match providers::send_queued(account, &operation) {
            Ok(()) => {
                storage::complete(&paths, &operation.id)?;
                sent += 1;
            }
            Err(error) => {
                storage::retry_later(&paths, &operation.id)?;
                if sent == 0 {
                    return Err(error);
                }
                break;
            }
        }
    }

    Ok(sent)
}

#[tauri::command]
fn message_action(account_id: String, message_id: String, action: String) -> Result<MailMessage, String> {
    storage::apply_message_action(&AppPaths::resolve()?, &account_id, &message_id, &action)
}

#[tauri::command]
fn clear_cache() -> Result<(), String> {
    storage::clear_cache(&AppPaths::resolve()?)
}

#[tauri::command]
fn list_workspace(kind: String) -> Result<Vec<WorkspaceDocument>, String> {
    workspace::list(&AppPaths::resolve()?, &kind)
}

#[tauri::command]
fn upsert_workspace(document: WorkspaceDocument) -> Result<WorkspaceDocument, String> {
    workspace::upsert(&AppPaths::resolve()?, document)
}

#[tauri::command]
fn delete_workspace(kind: String, id: String) -> Result<(), String> {
    workspace::delete(&AppPaths::resolve()?, &kind, &id)
}

#[tauri::command]
fn search_workspace(query: String) -> Result<Vec<WorkspaceDocument>, String> {
    workspace::search(&AppPaths::resolve()?, &query)
}

#[tauri::command]
fn export_workspace() -> Result<Vec<WorkspaceDocument>, String> {
    workspace::export_all(&AppPaths::resolve()?)
}

#[tauri::command]
fn import_workspace(documents: Vec<WorkspaceDocument>) -> Result<usize, String> {
    workspace::import_all(&AppPaths::resolve()?, documents)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            list_accounts,
            save_account,
            store_secret,
            discover_provider,
            test_smtp_connection,
            test_imap_connection,
            sync_inbox,
            flush_mail_actions,
            list_cached_messages,
            cache_message,
            queue_operation,
            list_queue,
            flush_outbox,
            message_action,
            clear_cache,
            list_workspace,
            upsert_workspace,
            delete_workspace,
            search_workspace,
            export_workspace,
            import_workspace
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Seven Mail");
}

mod models;
mod storage;

use models::{AccountProfile, MailMessage, QueueOperation, RuntimeInfo};
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
fn store_secret(_account_id: String, _secret: String) -> Result<(), String> {
    Ok(())
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
fn claim_next_operation() -> Result<Option<QueueOperation>, String> {
    storage::claim_next(&AppPaths::resolve()?)
}

#[tauri::command]
fn complete_operation(operation_id: String) -> Result<(), String> {
    storage::complete(&AppPaths::resolve()?, &operation_id)
}

#[tauri::command]
fn fail_operation(operation_id: String) -> Result<(), String> {
    storage::fail(&AppPaths::resolve()?, &operation_id)
}

#[tauri::command]
fn clear_cache() -> Result<(), String> {
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            list_accounts,
            save_account,
            store_secret,
            list_cached_messages,
            cache_message,
            queue_operation,
            list_queue,
            claim_next_operation,
            complete_operation,
            fail_operation,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Seven Mail");
}

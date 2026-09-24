mod credentials;
mod imap_sync;
mod models;
mod providers;
mod storage;
mod workspace;

use models::{AccountProfile, MailFolder, MailMessage, ProviderSettings, QueueOperation, QueuedAttachment, RuntimeInfo, WorkspaceDocument};
use storage::AppPaths;
use std::sync::Mutex;
use tauri::Manager;

struct DesktopState {
    close_to_tray: Mutex<bool>,
}

#[tauri::command]
fn runtime_info() -> Result<RuntimeInfo, String> {
    Ok(AppPaths::resolve()?.runtime_info())
}

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<'_, DesktopState>) -> Result<(), String> {
    let mut value = state
        .close_to_tray
        .lock()
        .map_err(|_| "Estado do desktop indisponível.".to_string())?;
    *value = enabled;
    Ok(())
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
fn set_default_account(account_id: String) -> Result<Vec<AccountProfile>, String> {
    storage::set_default_account(&AppPaths::resolve()?, &account_id)
}

#[tauri::command]
fn delete_account(account_id: String) -> Result<Vec<AccountProfile>, String> {
    let paths = AppPaths::resolve()?;
    let accounts = storage::delete_account(&paths, &account_id)?;
    credentials::delete(&account_id)?;
    Ok(accounts)
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
fn list_mail_folders(account_id: String) -> Result<Vec<MailFolder>, String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::list_folders(&account)
}

#[tauri::command]
fn sync_mail_folder(
    account_id: String,
    path: String,
    label: String,
    limit: Option<u32>,
) -> Result<usize, String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::sync_folder(&paths, &account, &path, &label, limit.unwrap_or(50))
}

#[tauri::command]
fn create_mail_folder(account_id: String, name: String) -> Result<(), String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::create_folder(&account, &name)
}

#[tauri::command]
fn rename_mail_folder(account_id: String, path: String, name: String) -> Result<(), String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::rename_folder(&account, &path, &name)
}

#[tauri::command]
fn delete_mail_folder(account_id: String, path: String) -> Result<(), String> {
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::delete_folder(&account, &path)
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
fn stage_attachments(operation_id: String, sources: Vec<String>) -> Result<Vec<QueuedAttachment>, String> {
    storage::stage_attachments(&AppPaths::resolve()?, &operation_id, &sources)
}

#[tauri::command]
fn cancel_operation(operation_id: String) -> Result<bool, String> {
    storage::cancel_operation(&AppPaths::resolve()?, &operation_id)
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
        let Some(operation) = storage::claim_next_send_due(&paths)? else {
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
fn move_message_to_folder(
    account_id: String,
    message_id: String,
    target_path: String,
    target_label: String,
) -> Result<MailMessage, String> {
    storage::move_message_to_folder(
        &AppPaths::resolve()?,
        &account_id,
        &message_id,
        &target_path,
        &target_label,
    )
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
        .manage(DesktopState {
            close_to_tray: Mutex::new(true),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Seven Mail")
                .build(),
        )
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };

            let open = MenuItem::with_id(app, "open", "Abrir Seven Mail", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("Seven Mail")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopState>();
                let close_to_tray = state
                    .close_to_tray
                    .lock()
                    .map(|value| *value)
                    .unwrap_or(false);

                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            set_close_to_tray,
            list_accounts,
            save_account,
            set_default_account,
            delete_account,
            store_secret,
            discover_provider,
            test_smtp_connection,
            test_imap_connection,
            sync_inbox,
            list_mail_folders,
            sync_mail_folder,
            create_mail_folder,
            rename_mail_folder,
            delete_mail_folder,
            flush_mail_actions,
            list_cached_messages,
            cache_message,
            queue_operation,
            stage_attachments,
            cancel_operation,
            list_queue,
            flush_outbox,
            message_action,
            move_message_to_folder,
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

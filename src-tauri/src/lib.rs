mod app_lock;
mod cloud_binding;
mod credentials;
mod dav_sync;
mod dav_xml;
mod imap_sync;
mod interchange;
mod ldap_sync;
mod local_crypto;
mod models;
mod oauth;
mod pop3_sync;
mod provider_native;
mod providers;
mod smime;
mod storage;
#[path = "../storage_guard.rs"]
pub mod storage_guard;
mod updater;
mod workspace;

#[cfg(test)]
mod protocol_e2e;

use models::{AccountProfile, DavSyncResult, DirectoryContact, MailAttachmentInfo, MailAttachmentPreview, MailFolder, MailMessage, OutboxFlushResult, ProviderSettings, QueueOperation, QueuedAttachment, RuntimeInfo, WorkspaceDocument};
use storage::AppPaths;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct DesktopState {
    close_to_tray: Mutex<bool>,
}

#[tauri::command]
fn runtime_info() -> Result<RuntimeInfo, String> {
    Ok(AppPaths::resolve()?.runtime_info())
}

#[tauri::command]
fn get_cloud_binding() -> Result<Option<cloud_binding::CloudBinding>, String> {
    app_lock::require_unlocked()?;
    cloud_binding::get(&AppPaths::resolve()?)
}

#[tauri::command]
fn set_cloud_binding(owner_id: String, enabled: bool) -> Result<cloud_binding::CloudBinding, String> {
    app_lock::require_unlocked()?;
    cloud_binding::set(&AppPaths::resolve()?, &owner_id, enabled)
}

#[tauri::command]
fn check_for_update() -> Result<updater::UpdateInfo, String> {
    updater::check()
}

#[tauri::command]
fn download_update(info: updater::UpdateInfo) -> Result<String, String> {
    app_lock::require_unlocked()?;
    updater::download(&info)
}

#[tauri::command]
fn install_update(path: String) -> Result<String, String> {
    app_lock::require_unlocked()?;
    updater::install(&path)
}

#[tauri::command]
fn open_default_mail_settings() -> Result<String, String> {
    app_lock::require_unlocked()?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps")
            .spawn()
            .map_err(|error| format!("Não foi possível abrir Aplicativos padrão: {error}"))?;
        return Ok("Escolha Seven Mail como aplicativo padrão para e-mail e MAILTO.".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let desktop = "com.sevenmail.desktop.desktop";
        let mailto = std::process::Command::new("xdg-settings")
            .args(["set", "default-url-scheme-handler", "mailto", desktop])
            .status();
        let mime = std::process::Command::new("xdg-mime")
            .args(["default", desktop, "message/rfc822"])
            .status();

        if mailto.as_ref().map(|status| status.success()).unwrap_or(false)
            || mime.as_ref().map(|status| status.success()).unwrap_or(false)
        {
            return Ok("Seven Mail foi registrado como cliente de e-mail padrão quando suportado pelo ambiente desktop.".to_string());
        }
        return Err("O ambiente Linux não permitiu alterar o cliente padrão automaticamente. Use as configurações de Aplicativos padrão do sistema.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.Desktop-Settings.extension")
            .spawn()
            .map_err(|error| format!("Não foi possível abrir os Ajustes do Sistema: {error}"))?;
        return Ok("Abra os ajustes de aplicativos padrão e selecione Seven Mail para e-mail.".to_string());
    }

    #[allow(unreachable_code)]
    Err("Configuração de cliente padrão não disponível nesta plataforma.".to_string())
}

#[tauri::command]
fn initial_open_requests() -> Vec<String> {
    std::env::args().skip(1).collect()
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
    app_lock::require_unlocked()?;
    storage::list_accounts(&AppPaths::resolve()?)
}

#[tauri::command]
fn save_account(account: AccountProfile) -> Result<(), String> {
    app_lock::require_unlocked()?;
    credentials::validate_account_id(&account.id)?;
    credentials::validate_account_id(account.credential_account_id())?;
    oauth::validate_account_endpoints(&account)?;
    storage::save_account(&AppPaths::resolve()?, account)
}

#[tauri::command]
fn set_default_account(account_id: String) -> Result<Vec<AccountProfile>, String> {
    app_lock::require_unlocked()?;
    storage::set_default_account(&AppPaths::resolve()?, &account_id)
}

#[tauri::command]
fn delete_account(account_id: String) -> Result<Vec<AccountProfile>, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    credentials::validate_account_id(&account_id)?;
    let accounts = storage::delete_account(&paths, &account_id)?;
    credentials::delete(&account_id)?;
    Ok(accounts)
}

#[tauri::command]
fn store_secret(account_id: String, secret: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    credentials::store(&account_id, &secret)
}

#[tauri::command]
fn has_app_lock() -> Result<bool, String> {
    app_lock::configured()
}

#[tauri::command]
fn set_app_lock(pin: String, current_pin: Option<String>) -> Result<(), String> {
    app_lock::configure(&pin, current_pin.as_deref())
}

#[tauri::command]
fn verify_app_lock(pin: String) -> Result<bool, String> {
    app_lock::unlock(&pin)
}

#[tauri::command]
fn clear_app_lock(pin: String) -> Result<(), String> {
    app_lock::disable(&pin)
}

#[tauri::command]
fn is_app_locked() -> Result<bool, String> {
    app_lock::is_locked()
}

#[tauri::command]
fn lock_app() -> Result<(), String> {
    app_lock::lock()
}

#[tauri::command]
fn app_lock_activity(minutes: Option<u64>) -> Result<bool, String> {
    app_lock::activity(minutes)
}

#[tauri::command]
fn oauth_exchange_code(
    account_id: String,
    code: String,
    verifier: String,
    redirect_uri: Option<String>,
) -> Result<oauth::OAuthAuthorizationStatus, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    oauth::exchange_code(&account, &code, &verifier, redirect_uri.as_deref()).map(Into::into)
}

#[tauri::command]
fn provider_oauth_exchange_code(
    account_id: String,
    code: String,
    verifier: String,
    redirect_uri: Option<String>,
) -> Result<oauth::OAuthAuthorizationStatus, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    oauth::provider_exchange_code(&account, &code, &verifier, redirect_uri.as_deref()).map(Into::into)
}

#[tauri::command]
fn provider_oauth_status(account_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    oauth::provider_status(&account_id)
}

#[tauri::command]
fn provider_oauth_clear(account_id: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    oauth::provider_clear(&account_id)
}

#[tauri::command]
fn oauth_refresh(account_id: String) -> Result<oauth::OAuthAuthorizationStatus, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    oauth::refresh(&account).map(Into::into)
}

#[tauri::command]
fn oauth_status(account_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    oauth::status(&account_id)
}

#[tauri::command]
fn oauth_clear(account_id: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    oauth::clear(&account_id)
}

#[tauri::command]
fn discover_provider(email: String) -> ProviderSettings {
    providers::discover(&email)
}

#[tauri::command]
fn provider_capabilities(account_id: String) -> Result<provider_native::ProviderCapabilities, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    Ok(provider_native::capabilities(&account))
}

#[tauri::command]
fn provider_corporate_catalog(account_id: String) -> Result<serde_json::Value, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    provider_native::corporate_catalog(&account)
}

#[tauri::command]
fn provider_sensitivity_rights(account_id: String, label_id: String, owner_email: Option<String>) -> Result<serde_json::Value, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    provider_native::sensitivity_rights(&account, &label_id, owner_email.as_deref())
}

#[tauri::command]
fn provider_message_policy(account_id: String, message_id: String) -> Result<provider_native::MessagePolicy, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    provider_native::message_policy(&paths, &account, &message_id)
}

#[tauri::command]
fn send_message_reaction(account_id: String, message_id: String, emoji: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let accounts = storage::list_accounts(&paths)?;
    let account = accounts
        .iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    let message = storage::list_cached_messages(&paths, Some(&account_id))?
        .into_iter()
        .find(|item| item.id == message_id)
        .ok_or_else(|| "Mensagem não encontrada no cache.".to_string())?;
    let internet_id = provider_native::internet_message_id(&paths, &account_id, &message_id)?;
    providers::send_email_reaction(
        account,
        &message.from.email,
        &message.subject,
        &internet_id,
        &emoji,
    )
}

#[tauri::command]
fn provider_recall_message(account_id: String, message_id: String) -> Result<String, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    provider_native::recall_message(&paths, &account, &message_id)
}

#[tauri::command]
fn sync_ldap(account_id: String) -> Result<Vec<DirectoryContact>, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    ldap_sync::sync(&account)
}

#[tauri::command]
fn test_ldap_connection(account_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    ldap_sync::test(&account)
}

#[tauri::command]
fn sync_dav(account_id: String) -> Result<DavSyncResult, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    dav_sync::sync(&account)
}

#[tauri::command]
fn test_dav_connection(account_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    dav_sync::test(&account)
}

#[tauri::command]
fn put_dav_calendar(account_id: String, event_id: String, ics: String, resource: Option<dav_xml::DavResource>, create: Option<bool>) -> Result<dav_xml::DavResource, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    dav_sync::put_calendar(&account, &event_id, &ics, resource.as_ref(), create.unwrap_or(false))
}

#[tauri::command]
fn delete_dav_calendar(account_id: String, resource: Option<dav_xml::DavResource>) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    dav_sync::delete_calendar(&account, resource.as_ref())
}

#[tauri::command]
fn put_dav_contact(account_id: String, contact_id: String, vcard: String, resource: Option<dav_xml::DavResource>, create: Option<bool>) -> Result<dav_xml::DavResource, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    dav_sync::put_contact(&account, &contact_id, &vcard, resource.as_ref(), create.unwrap_or(false))
}

#[tauri::command]
fn delete_dav_contact(account_id: String, resource: Option<dav_xml::DavResource>) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    dav_sync::delete_contact(&account, resource.as_ref())
}

#[tauri::command]
fn import_smime_identity(
    account_id: String,
    path: String,
    password: String,
) -> Result<smime::SmimeIdentityStatus, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    if !storage::list_accounts(&paths)?.iter().any(|item| item.id == account_id) {
        return Err("Conta não encontrada.".to_string());
    }
    smime::import_identity(&paths, &account_id, &path, &password)
}

#[tauri::command]
fn smime_identity_status(account_id: String) -> Result<smime::SmimeIdentityStatus, String> {
    app_lock::require_unlocked()?;
    smime::identity_status(&AppPaths::resolve()?, &account_id)
}

#[tauri::command]
fn remove_smime_identity(account_id: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    smime::remove_identity(&AppPaths::resolve()?, &account_id)
}

#[tauri::command]
fn import_smime_recipient_certificate(email: String, path: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    smime::import_recipient_certificate(&AppPaths::resolve()?, &email, &path)
}

#[tauri::command]
fn has_smime_recipient_certificate(email: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    Ok(smime::has_recipient_certificate(&AppPaths::resolve()?, &email))
}

#[tauri::command]
fn inspect_smime_message(account_id: String, message_id: String) -> Result<smime::SmimeInspection, String> {
    app_lock::require_unlocked()?;
    smime::inspect_message(&AppPaths::resolve()?, &account_id, &message_id)
}

#[tauri::command]
fn test_smtp_connection(account_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    providers::test_smtp(&account)
}

#[tauri::command]
fn test_imap_connection(account_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        pop3_sync::test(&account)
    } else {
        imap_sync::test(&account)
    }
}

#[tauri::command]
async fn wait_for_mail_push(
    account_id: String,
    folder_path: Option<String>,
    timeout_seconds: Option<u64>,
) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    let folder = folder_path.unwrap_or_else(|| "INBOX".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        imap_sync::wait_for_folder_change(&account, &folder, timeout_seconds.unwrap_or(55))
    })
    .await
    .map_err(|error| format!("Falha ao aguardar push IMAP: {error}"))?
}

#[tauri::command]
fn sync_inbox(account_id: String, limit: Option<u32>) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        pop3_sync::sync_latest(&paths, &account, limit.unwrap_or(50))
    } else {
        imap_sync::sync_latest(&paths, &account, limit.unwrap_or(50))
    }
}

#[tauri::command]
fn list_mail_folders(account_id: String) -> Result<Vec<MailFolder>, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        // POP3 does not expose remote folders. Showing Archive/Spam/Trash here
        // would make the UI claim capabilities the protocol does not have.
        Ok(vec![
            MailFolder { name: "Caixa de entrada".into(), path: "INBOX".into(), role: "inbox".into() },
        ])
    } else {
        imap_sync::list_folders(&account)
    }
}

#[tauri::command]
fn sync_mail_folder(
    account_id: String,
    path: String,
    label: String,
    limit: Option<u32>,
) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        if path.eq_ignore_ascii_case("INBOX") {
            pop3_sync::sync_latest(&paths, &account, limit.unwrap_or(50))
        } else {
            Err("POP3 não oferece sincronização de pastas remotas. Use a Caixa de entrada.".to_string())
        }
    } else {
        imap_sync::sync_folder(&paths, &account, &path, &label, limit.unwrap_or(50))
    }
}

#[tauri::command]
fn create_mail_folder(account_id: String, name: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::create_folder(&account, &name)
}

#[tauri::command]
fn rename_mail_folder(
    account_id: String,
    path: String,
    label: String,
    name: String,
) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::rename_folder(&account, &path, &name)?;
    storage::rename_cached_folder(&paths, &account.id, &path, &label, &name, &name)?;
    Ok(())
}

#[tauri::command]
fn delete_mail_folder(
    account_id: String,
    path: String,
    label: String,
) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    imap_sync::delete_folder(&account, &path)?;
    storage::remove_cached_folder(&paths, &account.id, &path, &label)?;
    Ok(())
}

#[tauri::command]
fn flush_mail_actions(account_id: String) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        Ok(0)
    } else {
        imap_sync::flush_actions(&paths, &account)
    }
}

#[tauri::command]
fn list_cached_messages(account_id: Option<String>) -> Result<Vec<MailMessage>, String> {
    app_lock::require_unlocked()?;
    storage::list_cached_messages(&AppPaths::resolve()?, account_id.as_deref())
}

#[tauri::command]
fn search_cached_message_ids(account_id: Option<String>, query: String) -> Result<Vec<String>, String> {
    app_lock::require_unlocked()?;
    storage::search_cached_message_ids(&AppPaths::resolve()?, account_id.as_deref(), &query)
}

#[tauri::command]
fn cache_message(message: MailMessage) -> Result<(), String> {
    app_lock::require_unlocked()?;
    storage::cache_message(&AppPaths::resolve()?, &message)
}

#[tauri::command]
fn queue_operation(operation: QueueOperation) -> Result<(), String> {
    app_lock::require_unlocked()?;
    storage::queue_operation(&AppPaths::resolve()?, &operation)
}

#[tauri::command]
fn stage_attachments(
    operation_id: String,
    sources: Vec<String>,
    max_file_mb: Option<u64>,
    max_total_mb: Option<u64>,
) -> Result<Vec<QueuedAttachment>, String> {
    app_lock::require_unlocked()?;
    storage::stage_attachments(
        &AppPaths::resolve()?,
        &operation_id,
        &sources,
        max_file_mb.unwrap_or(25),
        max_total_mb.unwrap_or(100),
    )
}

#[tauri::command]
fn stage_message_as_eml(
    operation_id: String,
    account_id: String,
    message_id: String,
    suggested_name: String,
) -> Result<QueuedAttachment, String> {
    app_lock::require_unlocked()?;
    storage::stage_message_as_eml(
        &AppPaths::resolve()?,
        &operation_id,
        &account_id,
        &message_id,
        &suggested_name,
    )
}

#[tauri::command]
fn cancel_operation(operation_id: String) -> Result<bool, String> {
    app_lock::require_unlocked()?;
    storage::cancel_operation(&AppPaths::resolve()?, &operation_id)
}

#[tauri::command]
fn list_queue() -> Result<Vec<QueueOperation>, String> {
    app_lock::require_unlocked()?;
    storage::list_queue(&AppPaths::resolve()?)
}

#[tauri::command]
fn flush_outbox() -> Result<OutboxFlushResult, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let accounts = storage::list_accounts(&paths)?;
    let mut sent = 0usize;
    let mut sent_operation_ids = Vec::new();
    let mut sent_account_ids = Vec::new();
    let mut sent_copy_warnings = Vec::new();
    let mut delivery_warnings = Vec::new();

    loop {
        let Some(operation) = storage::claim_next_send_due(&paths)? else {
            break;
        };

        let Some(account) = accounts.iter().find(|item| item.id == operation.account_id) else {
            storage::quarantine_operation(&paths, &operation.id, "account_missing")?;
            delivery_warnings.push(format!("{}: conta de envio não encontrada.", operation.id));
            continue;
        };

        let submission_started = std::cell::Cell::new(false);
        match providers::send_queued_raw_with_checkpoint(account, &operation, || {
            storage::mark_smtp_submission(&paths, &operation.id)?;
            submission_started.set(true);
            Ok(())
        }) {
            Ok(raw) => {
                // SMTP success is final for the queue item. A failure to mirror
                // the copy into IMAP Sent must never trigger a duplicate resend.
                storage::complete(&paths, &operation.id)?;
                sent += 1;
                sent_operation_ids.push(operation.id.clone());
                if !sent_account_ids.iter().any(|value| value == &account.id) {
                    sent_account_ids.push(account.id.clone());
                }

                if operation.kind == "send" && !account.incoming_protocol.eq_ignore_ascii_case("pop3") {
                    if let Err(error) = imap_sync::ensure_sent_copy(
                        &paths,
                        account,
                        &operation.id,
                        &raw,
                        100,
                    ) {
                        sent_copy_warnings.push(format!("{}: {error}", account.email));
                    }
                }
            }
            Err(error) => {
                if submission_started.get() {
                    // A transport failure after submission might mean the SMTP
                    // server accepted the message but its response was lost.
                    storage::quarantine_operation(&paths, &operation.id, "delivery_unknown")?;
                    delivery_warnings.push(format!("{}: entrega não confirmada; confira Enviados antes de reenviar.", operation.id));
                } else {
                    storage::retry_later(&paths, &operation.id)?;
                    delivery_warnings.push(format!("{}: envio não iniciado: {error}", operation.id));
                }
                // Continue draining other due messages, even when one fails.
            }
        }
    }

    Ok(OutboxFlushResult {
        sent,
        sent_operation_ids,
        sent_account_ids,
        sent_copy_warnings,
        delivery_warnings,
    })
}

#[tauri::command]
fn message_action(account_id: String, message_id: String, action: String) -> Result<MailMessage, String> {
    app_lock::require_unlocked()?;
    storage::apply_message_action(&AppPaths::resolve()?, &account_id, &message_id, &action)
}

#[tauri::command]
fn move_message_to_folder(
    account_id: String,
    message_id: String,
    target_path: String,
    target_label: String,
) -> Result<MailMessage, String> {
    app_lock::require_unlocked()?;
    storage::move_message_to_folder(
        &AppPaths::resolve()?,
        &account_id,
        &message_id,
        &target_path,
        &target_label,
    )
}

#[tauri::command]
fn move_message_to_account(
    source_account_id: String,
    message_id: String,
    target_account_id: String,
    target_mailbox: Option<String>,
) -> Result<(), String> {
    app_lock::require_unlocked()?;
    if source_account_id == target_account_id {
        return Err("Escolha uma conta diferente para mover a mensagem.".to_string());
    }

    let paths = AppPaths::resolve()?;
    let accounts = storage::list_accounts(&paths)?;
    let target = accounts
        .iter()
        .find(|item| item.id == target_account_id)
        .ok_or_else(|| "Conta de destino não encontrada.".to_string())?;
    let raw = storage::read_raw_message(&paths, &source_account_id, &message_id)?;
    let mailbox = target_mailbox.as_deref().unwrap_or("INBOX");
    imap_sync::append_raw_message(target, mailbox, &raw)?;

    storage::apply_message_action(&paths, &source_account_id, &message_id, "delete")?;
    if let Some(source) = accounts.iter().find(|item| item.id == source_account_id) {
        if !source.incoming_protocol.eq_ignore_ascii_case("pop3") {
            let _ = imap_sync::flush_actions(&paths, source);
        }
    }
    Ok(())
}

#[tauri::command]
fn clear_cache() -> Result<(), String> {
    app_lock::require_unlocked()?;
    storage::clear_cache(&AppPaths::resolve()?)
}

#[tauri::command]
fn prune_message_cache(retention_days: u32) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    storage::prune_message_cache(&AppPaths::resolve()?, retention_days)
}

#[tauri::command]
fn secure_clear_local_data() -> Result<(), String> {
    app_lock::require_unlocked()?;
    storage::secure_clear_local_data(&AppPaths::resolve()?)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    app_lock::require_unlocked()?;
    interchange::read_text_file(&path)
}

#[tauri::command]
fn read_file_data_url(path: String) -> Result<String, String> {
    app_lock::require_unlocked()?;
    interchange::read_file_data_url(&path)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    app_lock::require_unlocked()?;
    interchange::write_text_file(&path, &content)
}

#[tauri::command]
fn export_pst(account_id: Option<String>, path: String) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    interchange::export_pst(&AppPaths::resolve()?, account_id.as_deref(), &path)
}

#[tauri::command]
fn import_pst(account_id: String, path: String) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    interchange::import_pst(&paths, &account, &path)
}

#[tauri::command]
fn import_eml(account_id: String, path: String) -> Result<MailMessage, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    interchange::import_eml(&paths, &account, &path)
}

#[tauri::command]
fn import_msg(account_id: String, path: String) -> Result<MailMessage, String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let account = storage::list_accounts(&paths)?
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| "Conta não encontrada.".to_string())?;
    interchange::import_msg(&paths, &account, &path)
}

#[tauri::command]
fn read_oft_template(path: String) -> Result<serde_json::Value, String> {
    app_lock::require_unlocked()?;
    interchange::read_oft_template(&path)
}

#[tauri::command]
fn save_original_message(
    account_id: String,
    message_id: String,
    destination: String,
) -> Result<(), String> {
    app_lock::require_unlocked()?;
    interchange::save_original_message(
        &AppPaths::resolve()?,
        &account_id,
        &message_id,
        &destination,
    )
}

#[tauri::command]
fn read_message_source(account_id: String, message_id: String) -> Result<String, String> {
    app_lock::require_unlocked()?;
    interchange::read_message_source(&AppPaths::resolve()?, &account_id, &message_id)
}

#[tauri::command]
fn list_message_attachments(account_id: String, message_id: String) -> Result<Vec<MailAttachmentInfo>, String> {
    app_lock::require_unlocked()?;
    interchange::list_message_attachments(&AppPaths::resolve()?, &account_id, &message_id)
}

#[tauri::command]
fn preview_message_attachment(
    account_id: String,
    message_id: String,
    index: usize,
) -> Result<MailAttachmentPreview, String> {
    app_lock::require_unlocked()?;
    interchange::preview_message_attachment(
        &AppPaths::resolve()?,
        &account_id,
        &message_id,
        index,
    )
}

#[tauri::command]
fn stage_message_attachments(
    operation_id: String,
    account_id: String,
    message_id: String,
) -> Result<Vec<QueuedAttachment>, String> {
    app_lock::require_unlocked()?;
    interchange::stage_message_attachments(
        &AppPaths::resolve()?,
        &operation_id,
        &account_id,
        &message_id,
    )
}

#[tauri::command]
fn cache_message_attachment(
    account_id: String,
    message_id: String,
    index: usize,
) -> Result<String, String> {
    app_lock::require_unlocked()?;
    interchange::cache_message_attachment(&AppPaths::resolve()?, &account_id, &message_id, index)
}

#[tauri::command]
fn save_message_attachment(
    account_id: String,
    message_id: String,
    index: usize,
    destination: String,
) -> Result<(), String> {
    app_lock::require_unlocked()?;
    interchange::save_message_attachment(&AppPaths::resolve()?, &account_id, &message_id, index, &destination)
}

#[tauri::command]
fn save_all_message_attachments(
    account_id: String,
    message_id: String,
    directory: String,
) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    interchange::save_all_message_attachments(&AppPaths::resolve()?, &account_id, &message_id, &directory)
}

#[tauri::command]
fn update_message_metadata(
    account_id: String,
    message_id: String,
    importance: Option<String>,
    snoozed_until: Option<String>,
    is_muted: Option<bool>,
    is_phishing: Option<bool>,
    is_important: Option<bool>,
) -> Result<MailMessage, String> {
    app_lock::require_unlocked()?;
    storage::update_message_metadata(
        &AppPaths::resolve()?,
        &account_id,
        &message_id,
        importance,
        snoozed_until,
        is_muted,
        is_phishing,
        is_important,
    )
}

#[tauri::command]
fn copy_message_to_folder(
    account_id: String,
    message_id: String,
    target_path: String,
) -> Result<(), String> {
    app_lock::require_unlocked()?;
    let paths = AppPaths::resolve()?;
    let message = storage::list_cached_messages(&paths, Some(&account_id))?
        .into_iter()
        .find(|item| item.id == message_id)
        .ok_or_else(|| "Mensagem não encontrada.".to_string())?;
    if message.remote_folder.as_deref() == Some("POP3") {
        return Err("A mensagem não possui uma identidade IMAP remota confirmada.".to_string());
    }
    let remote_id = message.remote_id.ok_or_else(|| "Mensagem local não possui UID remoto.".to_string())?;
    let mailbox = message.remote_folder.ok_or_else(|| "Pasta IMAP remota não confirmada.".to_string())?;
    storage::queue_operation(&paths, &QueueOperation {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "copy".to_string(),
        account_id,
        created_at: chrono::Utc::now().to_rfc3339(),
        attempts: 0,
        payload: serde_json::json!({
            "remoteId": remote_id,
            "mailbox": mailbox,
            "messageId": message_id,
            "targetMailbox": target_path,
        }),
    })
}

#[tauri::command]
fn list_workspace(kind: String) -> Result<Vec<WorkspaceDocument>, String> {
    app_lock::require_unlocked()?;
    workspace::list(&AppPaths::resolve()?, &kind)
}

#[tauri::command]
fn list_workspace_for_sync(kind: String) -> Result<Vec<WorkspaceDocument>, String> {
    app_lock::require_unlocked()?;
    workspace::list_for_sync(&AppPaths::resolve()?, &kind)
}

#[tauri::command]
fn upsert_workspace(document: WorkspaceDocument) -> Result<WorkspaceDocument, String> {
    app_lock::require_unlocked()?;
    workspace::upsert(&AppPaths::resolve()?, document)
}

#[tauri::command]
fn delete_workspace(kind: String, id: String) -> Result<WorkspaceDocument, String> {
    app_lock::require_unlocked()?;
    workspace::delete(&AppPaths::resolve()?, &kind, &id)
}

#[tauri::command]
fn search_workspace(query: String) -> Result<Vec<WorkspaceDocument>, String> {
    app_lock::require_unlocked()?;
    workspace::search(&AppPaths::resolve()?, &query)
}

#[tauri::command]
fn export_workspace() -> Result<Vec<WorkspaceDocument>, String> {
    app_lock::require_unlocked()?;
    workspace::export_all(&AppPaths::resolve()?)
}

#[tauri::command]
fn import_workspace(documents: Vec<WorkspaceDocument>) -> Result<usize, String> {
    app_lock::require_unlocked()?;
    workspace::import_all(&AppPaths::resolve()?, documents)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let requests = argv.into_iter().skip(1).collect::<Vec<_>>();
            if !requests.is_empty() {
                let _ = app.emit("seven-mail:desktop-open", requests);
            }
        }))
        .manage(DesktopState {
            close_to_tray: Mutex::new(true),
        })
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Seven Mail")
                .build(),
        )
        .setup(|app| {
            // Hold the storage lock before any cache migration or recovery.
            let root = AppPaths::data_root().map_err(std::io::Error::other)?;
            let guard = storage_guard::StorageGuard::desktop(&root).map_err(std::io::Error::other)?;
            app.manage(guard);
            let paths = AppPaths::resolve().map_err(std::io::Error::other)?;
            storage::recover_interrupted_operations(&paths).map_err(std::io::Error::other)?;
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
            check_for_update,
            download_update,
            install_update,
            initial_open_requests,
            set_close_to_tray,
            open_default_mail_settings,
            get_cloud_binding,
            set_cloud_binding,
            list_accounts,
            save_account,
            set_default_account,
            delete_account,
            store_secret,
            has_app_lock,
            set_app_lock,
            verify_app_lock,
            clear_app_lock,
            is_app_locked,
            lock_app,
            app_lock_activity,
            oauth_exchange_code,
            provider_oauth_exchange_code,
            provider_oauth_status,
            provider_oauth_clear,
            oauth_refresh,
            oauth_status,
            oauth_clear,
            discover_provider,
            provider_capabilities,
            provider_corporate_catalog,
            provider_sensitivity_rights,
            provider_message_policy,
            send_message_reaction,
            provider_recall_message,
            import_smime_identity,
            smime_identity_status,
            remove_smime_identity,
            import_smime_recipient_certificate,
            has_smime_recipient_certificate,
            inspect_smime_message,
            sync_ldap,
            test_ldap_connection,
            sync_dav,
            test_dav_connection,
            put_dav_calendar,
            delete_dav_calendar,
            put_dav_contact,
            delete_dav_contact,
            test_smtp_connection,
            test_imap_connection,
            wait_for_mail_push,
            sync_inbox,
            list_mail_folders,
            sync_mail_folder,
            create_mail_folder,
            rename_mail_folder,
            delete_mail_folder,
            flush_mail_actions,
            list_cached_messages,
            search_cached_message_ids,
            cache_message,
            queue_operation,
            stage_attachments,
            stage_message_as_eml,
            cancel_operation,
            list_queue,
            flush_outbox,
            message_action,
            move_message_to_folder,
            move_message_to_account,
            clear_cache,
            prune_message_cache,
            secure_clear_local_data,
            read_text_file,
            read_file_data_url,
            write_text_file,
            export_pst,
            import_pst,
            import_eml,
            import_msg,
            read_oft_template,
            save_original_message,
            read_message_source,
            list_message_attachments,
            preview_message_attachment,
            stage_message_attachments,
            cache_message_attachment,
            save_message_attachment,
            save_all_message_attachments,
            update_message_metadata,
            copy_message_to_folder,
            list_workspace,
            list_workspace_for_sync,
            upsert_workspace,
            delete_workspace,
            search_workspace,
            export_workspace,
            import_workspace
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Seven Mail");
}

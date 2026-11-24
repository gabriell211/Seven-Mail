const SERVICE: &str = "Seven Mail";
const APP_LOCK_ID: &str = "__app_lock__";
const LOCAL_STORAGE_KEY_ID: &str = "__local_storage_key__";

fn validate_identifier(value: &str, max_len: usize) -> Result<(), String> {
    if value.is_empty()
        || value.len() > max_len
        || value.trim() != value
        || value.chars().any(char::is_control)
        || value.contains('/')
        || value.contains(char::from(92))
        || value.contains("..")
    {
        return Err("Identificador de credencial inválido.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_account_id(account_id: &str) -> Result<(), String> {
    validate_identifier(account_id, 180)?;
    if account_id.starts_with("__") {
        return Err("Identificador de credencial reservado.".into());
    }
    Ok(())
}

// Only this module may address the reserved keyring namespace.
fn entry(id: &str) -> Result<keyring::Entry, String> {
    validate_identifier(id, 256)?;
    keyring::Entry::new(SERVICE, id).map_err(|error| error.to_string())
}

pub fn store(account_id: &str, secret: &str) -> Result<(), String> {
    validate_account_id(account_id)?;
    if secret.trim().is_empty() {
        return Err("O segredo não pode ser vazio.".to_string());
    }
    entry(account_id)?
        .set_password(secret)
        .map_err(|error| error.to_string())
}

pub fn load(account_id: &str) -> Result<String, String> {
    validate_account_id(account_id)?;
    #[cfg(test)]
    if std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1") {
        if let Ok(secret) = std::env::var("SEVEN_MAIL_TEST_SECRET") {
            if !secret.is_empty() {
                return Ok(secret);
            }
        }
    }

    entry(account_id)?
        .get_password()
        .map_err(|error| error.to_string())
}


pub fn delete(account_id: &str) -> Result<(), String> {
    validate_account_id(account_id)?;
    match entry(account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn scoped_id(scope: &str, account_id: &str) -> Result<String, String> {
    validate_account_id(account_id)?;
    if scope.is_empty() || scope.len() > 48 || !scope.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') || scope.contains("__") {
        return Err("Escopo de credencial inválido.".to_string());
    }
    Ok(format!("__{scope}__{account_id}"))
}

pub fn store_scoped(scope: &str, account_id: &str, secret: &str) -> Result<(), String> {
    let id = scoped_id(scope, account_id)?;
    if secret.trim().is_empty() {
        return Err("O segredo não pode ser vazio.".into());
    }
    entry(&id)?.set_password(secret).map_err(|error| error.to_string())
}

pub fn load_scoped(scope: &str, account_id: &str) -> Result<Option<String>, String> {
    let id = scoped_id(scope, account_id)?;
    match entry(&id)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn delete_scoped(scope: &str, account_id: &str) -> Result<(), String> {
    let id = scoped_id(scope, account_id)?;
    match entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}


pub fn has_app_lock() -> Result<bool, String> {
    match entry(APP_LOCK_ID)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

pub fn set_app_lock(pin: &str) -> Result<(), String> {
    let value = pin.trim();
    if value.len() < 4 || value.len() > 64 {
        return Err("O PIN deve ter entre 4 e 64 caracteres.".to_string());
    }
    entry(APP_LOCK_ID)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

pub fn verify_app_lock(pin: &str) -> Result<bool, String> {
    match entry(APP_LOCK_ID)?.get_password() {
        Ok(stored) => Ok(stored.as_bytes() == pin.as_bytes()),
        Err(keyring::Error::NoEntry) => Ok(true),
        Err(error) => Err(error.to_string()),
    }
}

pub fn clear_app_lock() -> Result<(), String> {
    match entry(APP_LOCK_ID)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}


pub fn load_local_storage_key() -> Result<Option<String>, String> {
    #[cfg(test)]
    if std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1") {
        // Fixed 32-byte key used only by the isolated CI protocol test.
        return Ok(Some("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=".to_string()));
    }

    match entry(LOCAL_STORAGE_KEY_ID)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn store_local_storage_key(value: &str) -> Result<(), String> {
    #[cfg(test)]
    if std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1") {
        return Ok(());
    }

    if value.trim().is_empty() {
        return Err("Chave de armazenamento local inválida.".to_string());
    }
    entry(LOCAL_STORAGE_KEY_ID)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod namespace_tests {
    use super::*;

    #[test]
    fn account_credentials_cannot_access_reserved_keyring_entries() {
        for id in [APP_LOCK_ID, LOCAL_STORAGE_KEY_ID, "__oauth__account", "__smime__account", " account", "account\0", "account\n", ""] {
            assert!(validate_account_id(id).is_err(), "reserved or malformed ID accepted");
            assert!(store(id, "test").is_err());
            assert!(load(id).is_err());
            assert!(delete(id).is_err());
        }
    }

    #[test]
    fn scoped_credentials_keep_legacy_names_but_reject_namespace_injection() {
        assert_eq!(scoped_id("oauth", "account-123").unwrap(), "__oauth__account-123");
        assert!(scoped_id("oauth", LOCAL_STORAGE_KEY_ID).is_err());
        assert!(scoped_id("oauth__other", "account").is_err());
        assert!(scoped_id("oauth/other", "account").is_err());
        assert!(scoped_id("oauth", &"a".repeat(180)).is_ok());
    }
}

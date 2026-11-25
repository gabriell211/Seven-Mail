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

// PBKDF2-HMAC-SHA256 with a fresh 128-bit salt. OpenSSL is already a
// dependency of the native client, so no new dependency or lockfile is needed.
const PIN_ITERATIONS: usize = 600_000;
const PIN_PREFIX: &str = "pbkdf2-sha256-v1";
const PIN_SALT_LEN: usize = 16;
const PIN_HASH_LEN: usize = 32;

fn derive_pin(pin: &str, salt: &[u8; PIN_SALT_LEN]) -> Result<[u8; PIN_HASH_LEN], String> {
    let mut hash = [0u8; PIN_HASH_LEN];
    openssl::pkcs5::pbkdf2_hmac(
        pin.as_bytes(), salt, PIN_ITERATIONS, openssl::hash::MessageDigest::sha256(), &mut hash,
    ).map_err(|_| "Falha ao proteger o PIN.".to_string())?;
    Ok(hash)
}

fn encode_pin(pin: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    let mut salt = [0u8; PIN_SALT_LEN];
    openssl::rand::rand_bytes(&mut salt).map_err(|_| "Falha ao gerar salt do PIN.".to_string())?;
    let hash = derive_pin(pin, &salt)?;
    Ok(format!("{PIN_PREFIX}${}${}${}", PIN_ITERATIONS, BASE64.encode(salt), BASE64.encode(hash)))
}

/// Return (matched, legacy). Legacy values were at most 64 bytes and are
/// upgraded only after successful verification. The new format exceeds 64 bytes.
fn verify_pin_record(record: &str, pin: &str) -> Result<(bool, bool), String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    if pin.len() > 64 { return Ok((false, false)); }
    if record.len() <= 64 {
        if record.len() < 4 || record.trim() != record {
            return Err("Registro de PIN legado inválido.".into());
        }
        let matched = record.len() == pin.len() && openssl::memcmp::eq(record.as_bytes(), pin.as_bytes());
        return Ok((matched, true));
    }
    if record.len() > 256 { return Err("Registro de PIN inválido.".into()); }
    let mut fields = record.split('
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
mod native_backend_tests {
    #[test]
    #[ignore = "requires an unlocked native OS credential store"]
    fn native_backend_roundtrip() {
        // Never use the real application's service or credential names.
        let id = uuid::Uuid::new_v4().to_string();
        let service = "Seven Mail CI storage smoke";
        let entry = keyring::Entry::new(service, &id).expect("native entry");
        struct Cleanup(keyring::Entry);
        impl Drop for Cleanup {
            fn drop(&mut self) { let _ = self.0.delete_credential(); }
        }
        let cleanup = Cleanup(entry);
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)));
        let secret = uuid::Uuid::new_v4().to_string();
        cleanup.0.set_password(&secret).expect("native write");
        let reopened = keyring::Entry::new(service, &id).expect("reopen native entry");
        assert_eq!(reopened.get_password().expect("native read"), secret);
        reopened.delete_credential().expect("native delete");
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)));
    }
}
);
    if fields.next() != Some(PIN_PREFIX) || fields.next() != Some("600000") {
        return Err("Formato de PIN não suportado.".into());
    }
    let salt: [u8; PIN_SALT_LEN] = BASE64.decode(fields.next().unwrap_or_default())
        .ok().and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| "Salt do PIN inválido.".to_string())?;
    let hash: [u8; PIN_HASH_LEN] = BASE64.decode(fields.next().unwrap_or_default())
        .ok().and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| "Hash do PIN inválido.".to_string())?;
    if fields.next().is_some() { return Err("Registro de PIN inválido.".into()); }
    let actual = derive_pin(pin, &salt)?;
    Ok((openssl::memcmp::eq(&hash, &actual), false))
}

pub fn set_app_lock(pin: &str) -> Result<(), String> {
    let value = pin.trim();
    if value.len() < 4 || value.len() > 64 {
        return Err("O PIN deve ter entre 4 e 64 caracteres.".to_string());
    }
    entry(APP_LOCK_ID)?
        .set_password(&encode_pin(value)?)
        .map_err(|_| "Não foi possível persistir o PIN protegido.".to_string())
}

pub fn verify_app_lock(pin: &str) -> Result<bool, String> {
    let vault = entry(APP_LOCK_ID)?;
    let stored = match vault.get_password() {
        Ok(stored) => stored,
        Err(keyring::Error::NoEntry) => return Err("Registro de PIN indisponível durante a verificação.".into()),
        Err(_) => return Err("Cofre do PIN indisponível.".into()),
    };
    let (matched, legacy) = verify_pin_record(&stored, pin)?;
    if matched && legacy {
        vault.set_password(&encode_pin(pin)?)
            .map_err(|_| "Não foi possível migrar o PIN existente.".to_string())?;
    }
    Ok(matched)
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
mod native_backend_tests {
    #[test]
    #[ignore = "requires an unlocked native OS credential store"]
    fn native_backend_roundtrip() {
        // Never use the real application's service or credential names.
        let id = uuid::Uuid::new_v4().to_string();
        let service = "Seven Mail CI storage smoke";
        let entry = keyring::Entry::new(service, &id).expect("native entry");
        struct Cleanup(keyring::Entry);
        impl Drop for Cleanup {
            fn drop(&mut self) { let _ = self.0.delete_credential(); }
        }
        let cleanup = Cleanup(entry);
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)));
        let secret = uuid::Uuid::new_v4().to_string();
        cleanup.0.set_password(&secret).expect("native write");
        let reopened = keyring::Entry::new(service, &id).expect("reopen native entry");
        assert_eq!(reopened.get_password().expect("native read"), secret);
        reopened.delete_credential().expect("native delete");
        assert!(matches!(cleanup.0.get_password(), Err(keyring::Error::NoEntry)));
    }
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

#[cfg(test)]
mod pin_tests {
    use super::*;

    #[test]
    fn hashes_are_salted_and_verify_only_correct_pin() {
        let first = encode_pin("1234").unwrap();
        let second = encode_pin("1234").unwrap();
        assert_ne!(first, second);
        assert!(first.len() > 64);
        assert_eq!(verify_pin_record(&first, "1234").unwrap(), (true, false));
        assert_eq!(verify_pin_record(&first, "4321").unwrap(), (false, false));
    }

    #[test]
    fn legacy_pin_can_be_verified_before_upgrade() {
        assert_eq!(verify_pin_record("1234", "1234").unwrap(), (true, true));
        assert_eq!(verify_pin_record("1234", "12345").unwrap(), (false, true));
        assert_eq!(verify_pin_record("1234", "4321").unwrap(), (false, true));
    }

    #[test]
    fn malformed_records_and_unbounded_iterations_are_rejected() {
        let record = encode_pin("1234").unwrap();
        assert!(verify_pin_record(&record.replace("$600000$", "$999999999$"), "1234").is_err());
        assert!(verify_pin_record(&format!("{record}$extra"), "1234").is_err());
        assert!(verify_pin_record(&"x".repeat(257), "1234").is_err());
    }
}

const SERVICE: &str = "Seven Mail";
const APP_LOCK_ID: &str = "__app_lock__";

fn validate_account_id(account_id: &str) -> Result<(), String> {
    if account_id.is_empty()
        || account_id.len() > 180
        || account_id.contains('/')
        || account_id.contains(char::from(92))
        || account_id.contains("..")
    {
        return Err("Identificador de conta inválido.".to_string());
    }
    Ok(())
}

fn entry(account_id: &str) -> Result<keyring::Entry, String> {
    validate_account_id(account_id)?;
    keyring::Entry::new(SERVICE, account_id).map_err(|error| error.to_string())
}

pub fn store(account_id: &str, secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("O segredo não pode ser vazio.".to_string());
    }
    entry(account_id)?
        .set_password(secret)
        .map_err(|error| error.to_string())
}

pub fn load(account_id: &str) -> Result<String, String> {
    entry(account_id)?
        .get_password()
        .map_err(|error| error.to_string())
}


pub fn delete(account_id: &str) -> Result<(), String> {
    match entry(account_id)?.delete_credential() {
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

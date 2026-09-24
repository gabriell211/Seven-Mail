const SERVICE: &str = "Seven Mail";

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

use crate::{local_crypto, storage::AppPaths};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

static BINDING_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudBinding {
    pub owner_id: String,
    pub enabled: bool,
}

fn validate_owner(owner_id: &str) -> Result<(), String> {
    if owner_id.is_empty() || owner_id.len() > 256 || owner_id.trim() != owner_id
        || owner_id.chars().any(char::is_control)
    {
        return Err("Identidade de sincronização inválida.".to_string());
    }
    Ok(())
}

fn read_binding(paths: &AppPaths) -> Result<Option<CloudBinding>, String> {
    let path = paths.config.join("cloud-owner.json");
    if !path.try_exists().map_err(|error| error.to_string())? {
        return Ok(None);
    }
    let binding: CloudBinding = serde_json::from_slice(&local_crypto::read(&path)?)
        .map_err(|error| error.to_string())?;
    validate_owner(&binding.owner_id)?;
    Ok(Some(binding))
}

pub fn get(paths: &AppPaths) -> Result<Option<CloudBinding>, String> {
    let _guard = BINDING_LOCK.lock().map_err(|_| "Falha ao consultar identidade local.".to_string())?;
    read_binding(paths)
}

fn next_binding(previous: Option<CloudBinding>, owner_id: &str, enabled: bool) -> Result<CloudBinding, String> {
    validate_owner(owner_id)?;
    if let Some(previous) = previous {
        if previous.owner_id != owner_id {
            return Err("Este armazenamento local pertence a outra identidade de sincronização.".to_string());
        }
    } else if !enabled {
        return Err("Não há sincronização local autorizada.".to_string());
    }
    Ok(CloudBinding { owner_id: owner_id.to_owned(), enabled })
}

pub fn set(paths: &AppPaths, owner_id: &str, enabled: bool) -> Result<CloudBinding, String> {
    let _guard = BINDING_LOCK.lock().map_err(|_| "Falha ao configurar identidade local.".to_string())?;
    let binding = next_binding(read_binding(paths)?, owner_id, enabled)?;
    let bytes = serde_json::to_vec(&binding).map_err(|error| error.to_string())?;
    local_crypto::write(&paths.config.join("cloud-owner.json"), &bytes)?;
    Ok(binding)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_workspace_cannot_be_reassigned_after_signout_or_optout() {
        let first = next_binding(None, "owner-a", true).unwrap();
        assert!(next_binding(Some(first.clone()), "owner-b", true).is_err());
        let disabled = next_binding(Some(first), "owner-a", false).unwrap();
        assert!(!disabled.enabled);
        assert!(next_binding(Some(disabled.clone()), "owner-b", true).is_err());
        assert!(next_binding(Some(disabled), "owner-a", true).unwrap().enabled);
    }

    #[test]
    fn malformed_owner_and_optout_without_binding_are_rejected() {
        assert!(next_binding(None, "", true).is_err());
        assert!(next_binding(None, "owner\n", true).is_err());
        assert!(next_binding(None, "owner", false).is_err());
    }
}

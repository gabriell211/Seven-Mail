use crate::{models::AccountProfile, oauth, storage::{self, AppPaths}};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub native_api: bool,
    pub recall: bool,
    pub reactions: bool,
    pub reaction_policy: bool,
    pub sensitivity_labels: bool,
    pub retention_labels: bool,
    pub usage_rights: bool,
    pub push: bool,
}

fn microsoft(account: &AccountProfile) -> bool {
    let provider = account.provider.to_ascii_lowercase();
    let domain = account.email.rsplit_once('@').map(|(_, value)| value.to_ascii_lowercase()).unwrap_or_default();
    provider.contains("microsoft")
        || provider.contains("office")
        || matches!(domain.as_str(), "outlook.com" | "hotmail.com" | "live.com" | "office365.com")
        || account.oauth_authorization_url.as_deref().unwrap_or("").contains("microsoftonline.com")
}

pub fn capabilities(account: &AccountProfile) -> ProviderCapabilities {
    let graph = microsoft(account) && account.oauth_enabled;
    ProviderCapabilities {
        native_api: graph,
        recall: graph,
        reactions: false,
        reaction_policy: graph,
        sensitivity_labels: graph,
        retention_labels: graph,
        usage_rights: graph,
        push: !account.incoming_protocol.eq_ignore_ascii_case("pop3"),
    }
}

fn graph_client(account: &AccountProfile) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300)))
        .build()
        .map_err(|error| format!("Falha ao preparar API do provedor: {error}"))
}

fn bearer(account: &AccountProfile) -> Result<String, String> {
    if !microsoft(account) || !account.oauth_enabled {
        return Err("Esta conta não possui API nativa Microsoft OAuth habilitada.".to_string());
    }
    oauth::access_token(account)
}

fn graph_get(account: &AccountProfile, url: &str) -> Result<Value, String> {
    let token = bearer(account)?;
    graph_client(account)?
        .get(url)
        .bearer_auth(token)
        .send()
        .map_err(|error| format!("Falha ao consultar Microsoft Graph: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Microsoft Graph recusou a consulta: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("Resposta Microsoft Graph inválida: {error}"))
}

pub fn corporate_catalog(account: &AccountProfile) -> Result<Value, String> {
    let sensitivity = graph_get(
        account,
        "https://graph.microsoft.com/v1.0/security/dataSecurityAndGovernance/sensitivityLabels",
    );
    let retention = graph_get(
        account,
        "https://graph.microsoft.com/v1.0/security/labels/retentionLabels",
    );

    Ok(json!({
        "capabilities": capabilities(account),
        "sensitivityLabels": sensitivity.as_ref().ok().and_then(|value| value.get("value")).cloned().unwrap_or_else(|| json!([])),
        "retentionLabels": retention.as_ref().ok().and_then(|value| value.get("value")).cloned().unwrap_or_else(|| json!([])),
        "sensitivityError": sensitivity.err(),
        "retentionError": retention.err(),
    }))
}

pub fn sensitivity_rights(account: &AccountProfile, label_id: &str, owner_email: Option<&str>) -> Result<Value, String> {
    let label_id = label_id.trim();
    if label_id.is_empty() {
        return Err("Rótulo de sensibilidade inválido.".to_string());
    }
    let token = bearer(account)?;
    let url = format!(
        "https://graph.microsoft.com/v1.0/security/dataSecurityAndGovernance/sensitivityLabels/{label_id}/rights"
    );
    let client = graph_client(account)?;
    let mut request = client.get(url).bearer_auth(token);
    if let Some(owner) = owner_email.filter(|value| !value.trim().is_empty()) {
        request = request.query(&[("ownerEmail", owner)]);
    }
    request
        .send()
        .map_err(|error| format!("Falha ao consultar direitos do rótulo: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Consulta de direitos recusada: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("Resposta de direitos inválida: {error}"))
}

fn internet_message_id(paths: &AppPaths, account_id: &str, message_id: &str) -> Result<String, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let text = String::from_utf8_lossy(&raw);
    let unfolded = Regex::new(r"\r?\n[ \t]+").map_err(|error| error.to_string())?.replace_all(&text, " ");
    let regex = Regex::new(r"(?im)^Message-ID:\s*(<[^\r\n>]+>|[^\r\n]+)")
        .map_err(|error| error.to_string())?;
    regex
        .captures(&unfolded)
        .and_then(|value| value.get(1))
        .map(|value| value.as_str().trim().to_string())
        .ok_or_else(|| "Message-ID original não encontrado. Sincronize novamente a mensagem antes de recolher.".to_string())
}

pub fn recall_message(paths: &AppPaths, account: &AccountProfile, local_message_id: &str) -> Result<String, String> {
    if !capabilities(account).recall {
        return Err("O provedor desta conta não oferece recall pela API configurada.".to_string());
    }

    let internet_id = internet_message_id(paths, &account.id, local_message_id)?;
    let filter = format!("internetMessageId eq '{}'", internet_id.replace(''', "''"));
    let token = bearer(account)?;
    let client = graph_client(account)?;
    let search = client
        .get("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages")
        .bearer_auth(&token)
        .query(&[("$filter", filter.as_str()), ("$select", "id,internetMessageId,subject")])
        .send()
        .map_err(|error| format!("Falha ao localizar mensagem enviada: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Microsoft Graph recusou a busca da mensagem: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("Resposta de busca inválida: {error}"))?;

    let graph_id = search
        .get("value")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "A mensagem não foi encontrada em Itens enviados pelo provedor.".to_string())?;

    let response = client
        .post(format!("https://graph.microsoft.com/beta/me/mailFolders/sentitems/messages/{graph_id}/recall"))
        .bearer_auth(token)
        .json(&json!({}))
        .send()
        .map_err(|error| format!("Falha ao solicitar recall: {error}"))?;

    if response.status().is_success() {
        return Ok("Solicitação de recall enviada ao provedor. O resultado depende dos destinatários e das políticas da organização.".to_string());
    }

    let status = response.status();
    let detail = response.text().unwrap_or_default();
    Err(format!("O provedor recusou o recall ({status}): {detail}"))
}

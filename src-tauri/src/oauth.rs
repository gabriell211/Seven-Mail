use crate::{credentials, models::AccountProfile};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const TOKEN_SCOPE: &str = "oauth";
const PROVIDER_TOKEN_SCOPE: &str = "oauth-provider";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenState {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub scope: Option<String>,
}

/// Public IPC response: credentials remain exclusively in the native keyring.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthAuthorizationStatus {
    pub authorized: bool,
    pub expires_at: Option<i64>,
    pub scope: Option<String>,
}

impl From<OAuthTokenState> for OAuthAuthorizationStatus {
    fn from(state: OAuthTokenState) -> Self {
        Self { authorized: true, expires_at: state.expires_at, scope: state.scope }
    }
}

pub fn validate_account_endpoints(account: &AccountProfile) -> Result<(), String> {
    for endpoint in [account.oauth_authorization_url.as_deref(), account.oauth_token_url.as_deref()]
        .into_iter().flatten().filter(|value| !value.trim().is_empty())
    {
        validate_token_endpoint(endpoint)?;
    }
    Ok(())
}

fn token_endpoint(account: &AccountProfile) -> Result<&str, String> {
    let endpoint = account
        .oauth_token_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Configure a URL de token OAuth da conta.".to_string())?;
    validate_token_endpoint(endpoint)?;
    Ok(endpoint)
}

fn validate_token_endpoint(endpoint: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| "URL OAuth inválida.".to_string())?;
    if url.scheme() != "https" || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("A URL de token OAuth deve utilizar HTTPS, sem credenciais ou fragmentos.".to_string());
    }
    Ok(())
}

fn client_id(account: &AccountProfile) -> Result<&str, String> {
    account
        .oauth_client_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Configure o Client ID OAuth da conta.".to_string())
}

fn redirect_uri<'a>(account: &'a AccountProfile, supplied: Option<&'a str>) -> &'a str {
    supplied
        .filter(|value| !value.trim().is_empty())
        .or(account.oauth_redirect_uri.as_deref().filter(|value| !value.trim().is_empty()))
        .unwrap_or("seven-mail://oauth/callback")
}

fn store(token_scope: &str, account_id: &str, state: &OAuthTokenState) -> Result<(), String> {
    let serialized = serde_json::to_string(state).map_err(|error| error.to_string())?;
    credentials::store_scoped(token_scope, account_id, &serialized)
}

fn load(token_scope: &str, account_id: &str) -> Result<Option<OAuthTokenState>, String> {
    let Some(raw) = credentials::load_scoped(token_scope, account_id)? else {
        return Ok(None);
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("Token OAuth armazenado inválido: {error}"))
}

fn parse_token_response(
    account: &AccountProfile,
    token_scope: &str,
    response: Value,
    previous_refresh: Option<String>,
) -> Result<OAuthTokenState, String> {
    let access_token = response
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "O provedor OAuth não retornou access_token.".to_string())?
        .to_string();

    let refresh_token = response
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(previous_refresh);

    let expires_at = response
        .get("expires_in")
        .and_then(Value::as_i64)
        .map(|seconds| chrono::Utc::now().timestamp() + seconds.max(60));

    let state = OAuthTokenState {
        access_token,
        refresh_token,
        token_type: response.get("token_type").and_then(Value::as_str).map(ToOwned::to_owned),
        expires_at,
        scope: response.get("scope").and_then(Value::as_str).map(ToOwned::to_owned),
    };
    store(token_scope, account.credential_account_id(), &state)?;
    Ok(state)
}

fn http_client(account: &AccountProfile) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300)))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Falha ao preparar OAuth: {error}"))
}

fn exchange_code_for_scope(
    account: &AccountProfile,
    token_scope: &str,
    code: &str,
    verifier: &str,
    supplied_redirect_uri: Option<&str>,
) -> Result<OAuthTokenState, String> {
    validate_account_endpoints(account)?;
    if !account.oauth_enabled {
        return Err("OAuth não está ativado nesta conta.".to_string());
    }

    let response = http_client(account)?
        .post(token_endpoint(account)?)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id(account)?),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri(account, supplied_redirect_uri)),
        ])
        .send()
        .map_err(|error| format!("Falha ao trocar código OAuth: {error}"))?
        .error_for_status()
        .map_err(|error| format!("O provedor recusou a troca OAuth: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("Resposta OAuth inválida: {error}"))?;

    parse_token_response(account, token_scope, response, None)
}

fn refresh_for_scope(account: &AccountProfile, token_scope: &str) -> Result<OAuthTokenState, String> {
    let current = load(token_scope, account.credential_account_id())?
        .ok_or_else(|| "A conta ainda não foi autorizada para este recurso OAuth.".to_string())?;
    let refresh_token = current
        .refresh_token
        .clone()
        .ok_or_else(|| "O provedor não forneceu refresh token. Autorize a conta novamente.".to_string())?;

    let response = http_client(account)?
        .post(token_endpoint(account)?)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id(account)?),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .map_err(|error| format!("Falha ao renovar OAuth: {error}"))?
        .error_for_status()
        .map_err(|error| format!("O provedor recusou a renovação OAuth: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("Resposta OAuth inválida: {error}"))?;

    parse_token_response(account, token_scope, response, Some(refresh_token))
}

fn access_token_for_scope(account: &AccountProfile, token_scope: &str) -> Result<String, String> {
    let state = load(token_scope, account.credential_account_id())?
        .ok_or_else(|| "A conta ainda não foi autorizada para este recurso OAuth.".to_string())?;

    let expires_soon = state
        .expires_at
        .map(|value| value <= chrono::Utc::now().timestamp() + 90)
        .unwrap_or(false);

    if expires_soon && state.refresh_token.is_some() {
        return Ok(refresh_for_scope(account, token_scope)?.access_token);
    }
    Ok(state.access_token)
}

pub fn exchange_code(
    account: &AccountProfile,
    code: &str,
    verifier: &str,
    supplied_redirect_uri: Option<&str>,
) -> Result<OAuthTokenState, String> {
    exchange_code_for_scope(account, TOKEN_SCOPE, code, verifier, supplied_redirect_uri)
}

pub fn refresh(account: &AccountProfile) -> Result<OAuthTokenState, String> {
    refresh_for_scope(account, TOKEN_SCOPE)
}

pub fn access_token(account: &AccountProfile) -> Result<String, String> {
    access_token_for_scope(account, TOKEN_SCOPE)
}

pub fn status(account_id: &str) -> Result<bool, String> {
    Ok(load(TOKEN_SCOPE, account_id)?.is_some())
}

pub fn clear(account_id: &str) -> Result<(), String> {
    credentials::delete_scoped(TOKEN_SCOPE, account_id)
}

pub fn provider_exchange_code(
    account: &AccountProfile,
    code: &str,
    verifier: &str,
    supplied_redirect_uri: Option<&str>,
) -> Result<OAuthTokenState, String> {
    exchange_code_for_scope(account, PROVIDER_TOKEN_SCOPE, code, verifier, supplied_redirect_uri)
}

pub fn provider_access_token(account: &AccountProfile) -> Result<String, String> {
    access_token_for_scope(account, PROVIDER_TOKEN_SCOPE)
}

pub fn provider_status(account_id: &str) -> Result<bool, String> {
    Ok(load(PROVIDER_TOKEN_SCOPE, account_id)?.is_some())
}

pub fn provider_scopes(account_id: &str) -> Result<Vec<String>, String> {
    let scopes = load(PROVIDER_TOKEN_SCOPE, account_id)?
        .and_then(|state| state.scope)
        .unwrap_or_default()
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect();
    Ok(scopes)
}

pub fn provider_clear(account_id: &str) -> Result<(), String> {
    credentials::delete_scoped(PROVIDER_TOKEN_SCOPE, account_id)
}

#[cfg(test)]
mod endpoint_tests {
    use super::validate_token_endpoint;

    #[test]
    fn token_endpoint_requires_https_and_no_embedded_credentials() {
        assert!(validate_token_endpoint("https://login.example.com/token").is_ok());
        for endpoint in ["http://login.example.com/token", "file:///token", "https://user:pass@example.com/token", "https://example.com/token#secret"] {
            assert!(validate_token_endpoint(endpoint).is_err());
        }
    }
}

#[cfg(test)]
mod ipc_security_tests {
    use super::*;

    #[test]
    fn authorization_response_contains_no_credentials() {
        let status = OAuthAuthorizationStatus::from(OAuthTokenState {
            access_token: "secret-access".into(),
            refresh_token: Some("secret-refresh".into()),
            token_type: Some("Bearer".into()),
            expires_at: Some(42),
            scope: Some("mail".into()),
        });
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["authorized"], true);
        assert!(json.get("accessToken").is_none());
        assert!(json.get("refreshToken").is_none());
        assert!(!json.to_string().contains("secret-"));
    }
}

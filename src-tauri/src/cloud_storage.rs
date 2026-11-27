//! External storage grants are isolated from mail, Gemini and Seven Cloud.
use crate::{app_lock,credentials,gemini,gemini_google};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD,Engine as _};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{io::Read,net::TcpListener,sync::Mutex,time::Duration};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

const VAULT:&str="external-storage";
const GOOGLE_SCOPE:&str="https://www.googleapis.com/auth/drive.appdata";
const MS_SCOPE:&str="Files.ReadWrite.AppFolder";
static OPERATION:Mutex<()>=Mutex::new(());
static PENDING:Mutex<Option<String>>=Mutex::new(None);
#[derive(Clone,Copy,Deserialize,Serialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Provider{GoogleDrive,OneDrive}
impl Provider{
    fn id(self)->&'static str{match self{Self::GoogleDrive=>"google_drive",Self::OneDrive=>"one_drive"}}
    fn authorization(self)->&'static str{match self{Self::GoogleDrive=>"https://accounts.google.com/o/oauth2/v2/auth",Self::OneDrive=>"https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"}}
    fn token(self)->&'static str{match self{Self::GoogleDrive=>"https://oauth2.googleapis.com/token",Self::OneDrive=>"https://login.microsoftonline.com/consumers/oauth2/v2.0/token"}}
    fn scope(self)->&'static str{match self{Self::GoogleDrive=>GOOGLE_SCOPE,Self::OneDrive=>MS_SCOPE}}
    fn scopes(self)->String{match self{Self::GoogleDrive=>format!("{} openid email",GOOGLE_SCOPE),Self::OneDrive=>format!("{} offline_access",MS_SCOPE)}}
    fn default_client(self)->&'static str{match self{Self::GoogleDrive=>gemini::google_client_default(),Self::OneDrive=>option_env!("SEVEN_MAIL_ONEDRIVE_CLIENT_ID").unwrap_or_default()}}
    fn valid_client(self,value:&str)->bool{match self{Self::GoogleDrive=>value.len()<=256&&value.ends_with(".apps.googleusercontent.com")&&value.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'.'|b'_')),Self::OneDrive=>Uuid::parse_str(value).is_ok()}}
}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant{provider:Provider,client_id:String,client_secret:String,access_token:String,refresh_token:String,expires_at:i64,account_label:String}
#[derive(Deserialize)]
struct Token{access_token:String,refresh_token:Option<String>,expires_in:i64,token_type:String,scope:Option<String>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status{provider:Provider,connected:bool,expires_at:Option<i64>,account_label:Option<String>,default_configured:bool}
fn http()->Result<reqwest::blocking::Client,String>{reqwest::blocking::Client::builder().https_only(true).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(20)).connect_timeout(Duration::from_secs(10)).build().map_err(|_|"Não foi possível iniciar conexão segura.".into())}
fn json<T:serde::de::DeserializeOwned>(response:reqwest::blocking::Response)->Result<T,String>{
    if !response.status().is_success(){return Err(format!("O serviço recusou a solicitação (HTTP {}).",response.status().as_u16()));}
    let mut bytes=Vec::new();response.take(256*1024+1).read_to_end(&mut bytes).map_err(|_|"Falha ao ler a resposta.")?;
    if bytes.len()>256*1024{return Err("Resposta acima do limite.".into());}
    serde_json::from_slice(&bytes).map_err(|_|"Resposta inválida do serviço.".into())
}
fn valid_token(value:&str)->bool{!value.is_empty()&&value.len()<=16384&&value.bytes().all(|b|b.is_ascii_graphic())}
fn valid_secret(value:&str)->bool{value.len()<=512&&value.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.'))}
fn has_scope(provider:Provider,scopes:&str)->bool{
    scopes.split_whitespace().any(|scope|scope.eq_ignore_ascii_case(provider.scope())||(provider==Provider::OneDrive&&scope.strip_prefix("https://graph.microsoft.com/").is_some_and(|s|s.eq_ignore_ascii_case(MS_SCOPE))))
}
fn validate_token(provider:Provider,token:&Token,initial:bool)->Result<i64,String>{
    if !token.token_type.eq_ignore_ascii_case("Bearer")||!valid_token(&token.access_token)||!(1..=86400).contains(&token.expires_in){return Err("Credencial de autorização inválida.".into());}
    if (initial||token.scope.is_some())&&!has_scope(provider,token.scope.as_deref().unwrap_or_default()){return Err("A permissão da pasta do aplicativo não foi concedida.".into());}
    if token.refresh_token.as_deref().is_some_and(|value|!valid_token(value)){return Err("Credencial de renovação inválida.".into());}
    Ok(chrono::Utc::now().timestamp()+token.expires_in)
}
fn load(provider:Provider)->Result<Option<Grant>,String>{
    let Some(raw)=credentials::load_scoped(VAULT,provider.id())? else{return Ok(None);};
    let grant:Grant=serde_json::from_str(&raw).map_err(|_|"Credencial de nuvem inválida.")?;
    if grant.provider!=provider||!provider.valid_client(&grant.client_id)||!valid_secret(&grant.client_secret)||!valid_token(&grant.access_token)||!valid_token(&grant.refresh_token){return Err("Credencial de nuvem inválida.".into());}
    Ok(Some(grant))
}
fn save(grant:&Grant)->Result<(),String>{credentials::store_scoped(VAULT,grant.provider.id(),&serde_json::to_string(grant).map_err(|_|"Credencial inválida.")?)}
fn status(provider:Provider,grant:Option<&Grant>)->Status{
    Status{provider,connected:grant.is_some(),expires_at:grant.map(|g|g.expires_at),account_label:grant.map(|g|g.account_label.clone()),default_configured:provider.valid_client(provider.default_client())}
}
fn verify_folder(grant:&Grant)->Result<String,String>{
    let client=http()?;
    let response=match grant.provider{
        Provider::GoogleDrive=>client.get("https://www.googleapis.com/drive/v3/files").query(&[("spaces","appDataFolder"),("pageSize","1"),("fields","files(id)")]),
        Provider::OneDrive=>client.get("https://graph.microsoft.com/v1.0/me/drive/special/approot").query(&[("$select","id")]),
    }.bearer_auth(&grant.access_token).send().map_err(|_|"Falha ao verificar a pasta do aplicativo.")?;
    let data:serde_json::Value=json(response)?;
    let valid=match grant.provider{Provider::GoogleDrive=>data.get("files").is_some_and(serde_json::Value::is_array),Provider::OneDrive=>data.get("id").and_then(serde_json::Value::as_str).is_some_and(|s|!s.is_empty())};
    if !valid{return Err("A pasta do aplicativo não está disponível.".into());}
    // Only display a provider-verified identity, never expose tokens.
    match grant.provider{
        Provider::GoogleDrive=>{
            let identity:serde_json::Value=json(client.get("https://openidconnect.googleapis.com/v1/userinfo").bearer_auth(&grant.access_token).send().map_err(|_|"Falha ao verificar identidade Google.")?)?;
            if identity.get("email_verified").and_then(serde_json::Value::as_bool)!=Some(true){return Err("Identidade Google não verificada.".into());}
            let email=identity.get("email").and_then(serde_json::Value::as_str).filter(|s|s.len()<=254&&s.contains('@')&&!s.chars().any(char::is_control)).ok_or("Identidade Google inválida.")?;
            Ok(email.to_owned())
        },
        // The app-folder scope does not authorize reading the user's broader profile.
        Provider::OneDrive=>Ok("Conta Microsoft autorizada".into()),
    }
}
#[tauri::command]
pub async fn external_storage_status()->Result<Vec<Status>,String>{
    tauri::async_runtime::spawn_blocking(||{
        app_lock::require_unlocked()?;
        [Provider::GoogleDrive,Provider::OneDrive].into_iter().map(|p|Ok(status(p,load(p)?.as_ref()))).collect()
    }).await.map_err(|_|"Falha ao consultar conexões.".to_string())?
}
#[tauri::command]
pub fn external_storage_cancel(attempt_id:String)->Result<(),String>{
    let mut pending=PENDING.lock().map_err(|_|"Autorização indisponível.")?;
    if pending.as_deref()==Some(&attempt_id){*pending=None;}Ok(())
}
#[tauri::command]
pub async fn external_storage_connect(app:tauri::AppHandle,provider:Provider,attempt_id:String,client_id:String,client_secret:String)->Result<Status,String>{
    tauri::async_runtime::spawn_blocking(move||{
        app_lock::require_unlocked()?;
        let _operation=OPERATION.try_lock().map_err(|_|"Outra operação de nuvem está em andamento.")?;
        if Uuid::parse_str(&attempt_id).is_err(){return Err("Solicitação inválida.".into());}
        let client_id=if client_id.trim().is_empty(){provider.default_client().to_owned()}else{client_id.trim().to_owned()};
        if !provider.valid_client(&client_id)||!valid_secret(&client_secret)||(provider==Provider::OneDrive&&!client_secret.is_empty()){return Err("Configure um cliente OAuth desktop válido para este serviço.".into());}
        *PENDING.lock().map_err(|_|"Autorização indisponível.")?=Some(attempt_id.clone());
        let check=||{app_lock::require_unlocked()?;if PENDING.lock().map_err(|_|"Autorização indisponível.")?.as_deref()!=Some(attempt_id.as_str()){return Err("Autorização cancelada.".into());}Ok(())};
        let result=(||{
            let listener=TcpListener::bind(("127.0.0.1",0)).map_err(|_|"Retorno local indisponível.")?;
            let port=listener.local_addr().map_err(|_|"Porta local indisponível.")?.port();
            let redirect=format!("http://127.0.0.1:{port}/");
            let verifier=gemini_google::random()?;let state=gemini_google::random()?;
            let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));let scopes=provider.scopes();
            let mut url=reqwest::Url::parse(provider.authorization()).map_err(|_|"Endpoint inválido.")?;
            url.query_pairs_mut().extend_pairs([("client_id",client_id.as_str()),("redirect_uri",redirect.as_str()),("response_type","code"),("scope",scopes.as_str()),("state",state.as_str()),("code_challenge",challenge.as_str()),("code_challenge_method","S256")]);
            if provider==Provider::GoogleDrive{url.query_pairs_mut().append_pair("access_type","offline").append_pair("prompt","consent");}
            else{url.query_pairs_mut().append_pair("prompt","select_account").append_pair("response_mode","query");}
            check()?;app.opener().open_url(url.as_str(),None::<&str>).map_err(|_|"Não foi possível abrir o navegador.")?;
            let code=gemini_google::await_callback(listener,&state,&check)?;check()?;
            let mut form=vec![("grant_type","authorization_code"),("client_id",client_id.as_str()),("code",code.as_str()),("code_verifier",verifier.as_str()),("redirect_uri",redirect.as_str())];
            if !client_secret.is_empty(){form.push(("client_secret",client_secret.as_str()));}
            let token:Token=json(http()?.post(provider.token()).form(&form).send().map_err(|_|"Falha ao concluir a autorização.")?)?;
            let expires_at=validate_token(provider,&token,true)?;
            let refresh_token=token.refresh_token.ok_or("O serviço não concedeu autorização offline.")?;
            let mut grant=Grant{provider,client_id,client_secret,access_token:token.access_token,refresh_token,expires_at,account_label:String::new()};
            grant.account_label=verify_folder(&grant)?;check()?;
            let pending=PENDING.lock().map_err(|_|"Autorização indisponível.")?;
            if pending.as_deref()!=Some(attempt_id.as_str()){return Err("Autorização cancelada.".into());}
            app_lock::require_unlocked()?;save(&grant)?;Ok(status(provider,Some(&grant)))
        })();
        let _=external_storage_cancel(attempt_id);result
    }).await.map_err(|_|"Falha ao conectar armazenamento.".to_string())?
}
#[tauri::command]
pub async fn external_storage_verify(provider:Provider)->Result<Status,String>{
    tauri::async_runtime::spawn_blocking(move||{
        app_lock::require_unlocked()?;
        let _operation=OPERATION.try_lock().map_err(|_|"Outra operação de nuvem está em andamento.")?;
        let mut grant=load(provider)?.ok_or("Conecte sua conta primeiro.")?;
        if grant.expires_at<=chrono::Utc::now().timestamp()+120{
            let mut form=vec![("grant_type","refresh_token"),("client_id",grant.client_id.as_str()),("refresh_token",grant.refresh_token.as_str())];
            if !grant.client_secret.is_empty(){form.push(("client_secret",grant.client_secret.as_str()));}
            let token:Token=json(http()?.post(provider.token()).form(&form).send().map_err(|_|"Falha ao renovar autorização.")?)?;
            grant.expires_at=validate_token(provider,&token,false)?;
            grant.access_token=token.access_token;if let Some(refresh)=token.refresh_token{grant.refresh_token=refresh;}
            app_lock::require_unlocked()?;save(&grant)?;
        }
        grant.account_label=verify_folder(&grant)?;app_lock::require_unlocked()?;save(&grant)?;Ok(status(provider,Some(&grant)))
    }).await.map_err(|_|"Falha ao verificar armazenamento.".to_string())?
}
#[tauri::command]
pub async fn external_storage_disconnect(provider:Provider)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{app_lock::require_unlocked()?;let _operation=OPERATION.try_lock().map_err(|_|"Outra operação de nuvem está em andamento.")?;credentials::delete_scoped(VAULT,provider.id())}).await.map_err(|_|"Falha ao desconectar armazenamento.".to_string())?
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn scopes_are_restricted_and_separate(){
        assert!(has_scope(Provider::GoogleDrive,GOOGLE_SCOPE));
        assert!(!has_scope(Provider::GoogleDrive,"https://mail.google.com/ https://www.googleapis.com/auth/drive"));
        assert!(has_scope(Provider::OneDrive,"https://graph.microsoft.com/Files.ReadWrite.AppFolder offline_access"));
        assert!(!has_scope(Provider::OneDrive,"Files.ReadWrite.All"));
        assert_ne!(Provider::GoogleDrive.id(),Provider::OneDrive.id());
    }
    #[test]
    fn only_valid_desktop_clients_are_accepted(){
        assert!(Provider::GoogleDrive.valid_client("123-test.apps.googleusercontent.com"));
        assert!(!Provider::GoogleDrive.valid_client("https://example.com"));
        assert!(Provider::OneDrive.valid_client("12345678-1234-1234-1234-123456789abc"));
        assert!(!Provider::OneDrive.valid_client("example"));
    }
}

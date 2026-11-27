//! Dedicated Google OAuth desktop flow. No Gmail token is reused.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{io::{Read,Write},net::{TcpListener,TcpStream},time::{Duration,Instant}};

const TOKEN_URL:&str="https://oauth2.googleapis.com/token";
const SCOPE:&str="https://www.googleapis.com/auth/generative-language.retriever";
const EMAIL_SCOPE:&str="https://www.googleapis.com/auth/userinfo.email";
const MAX_RESPONSE:u64=256*1024;

#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GoogleGrant{
    client_id:String,
    client_secret:String,
    pub(crate) project:String,
    pub(crate) email:String,
    access_token:String,
    refresh_token:String,
    expires_at:i64,
}
#[derive(Deserialize)]
struct TokenResponse{
    access_token:String,
    refresh_token:Option<String>,
    expires_in:i64,
    token_type:String,
    scope:Option<String>,
}
#[derive(Deserialize)]
struct Identity{email:String,email_verified:bool}

fn client()->Result<reqwest::blocking::Client,String>{
    reqwest::blocking::Client::builder().https_only(true).timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_|"Não foi possível iniciar OAuth Google.".into())
}
fn json<T:serde::de::DeserializeOwned>(response:reqwest::blocking::Response)->Result<T,String>{
    if !response.status().is_success(){return Err(format!("Google OAuth recusou a solicitação (HTTP {}).",response.status().as_u16()));}
    let mut body=Vec::new();
    response.take(MAX_RESPONSE+1).read_to_end(&mut body).map_err(|_|"Falha ao ler resposta OAuth.")?;
    if body.len() as u64>MAX_RESPONSE{return Err("Resposta OAuth acima do limite.".into());}
    serde_json::from_slice(&body).map_err(|_|"Resposta OAuth inválida.".into())
}
pub(crate) fn random()->Result<String,String>{
    let mut bytes=[0u8;32];
    openssl::rand::rand_bytes(&mut bytes).map_err(|_|"Falha ao gerar segredo OAuth.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn valid_client(value:&str)->bool{
    value.len()<=256&&value.ends_with(".apps.googleusercontent.com")&&value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'.'||b==b'_')
}
fn valid_project(value:&str)->bool{
    (6..=30).contains(&value.len())&&value.as_bytes()[0].is_ascii_lowercase()&&value.as_bytes()[value.len()-1].is_ascii_alphanumeric()&&value.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')
}
fn valid_secret(value:&str)->bool{
    value.len()<=512&&value.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.'))
}
fn valid_token(value:&str)->bool{
    !value.is_empty()&&value.len()<=8192&&value.bytes().all(|b|b.is_ascii_graphic())
}
fn valid_email(value:&str)->bool{
    !value.is_empty()&&value.len()<=254&&value.contains('@')&&!value.chars().any(char::is_whitespace)&&!value.chars().any(char::is_control)
}
impl GoogleGrant{
    pub(crate) fn valid(&self)->bool{
        valid_client(&self.client_id)&&valid_secret(&self.client_secret)&&valid_project(&self.project)&&valid_email(&self.email)&&valid_token(&self.access_token)&&valid_token(&self.refresh_token)&&self.expires_at>0
    }
    pub(crate) fn needs_refresh(&self)->bool{self.expires_at<=chrono::Utc::now().timestamp()+120}
    pub(crate) fn apply(&self,request:reqwest::blocking::RequestBuilder)->reqwest::blocking::RequestBuilder{
        request.bearer_auth(&self.access_token).header("x-goog-user-project",&self.project)
    }
    pub(crate) fn refresh(&mut self)->Result<(),String>{
        if !self.needs_refresh(){return Ok(());}
        let mut form=vec![("grant_type","refresh_token"),("client_id",self.client_id.as_str()),("refresh_token",self.refresh_token.as_str())];
        if !self.client_secret.is_empty(){form.push(("client_secret",self.client_secret.as_str()));}
        let result:TokenResponse=json(client()?.post(TOKEN_URL).form(&form).send().map_err(|_|"Falha ao renovar autorização Google.")?)?;
        verify_token(&result,false)?;
        self.expires_at=expiration(result.expires_in)?;
        self.access_token=result.access_token;
        if let Some(refresh)=result.refresh_token{if !valid_token(&refresh){return Err("Refresh token inválido.".into());}self.refresh_token=refresh;}
        Ok(())
    }
}
fn expiration(seconds:i64)->Result<i64,String>{
    if !(1..=86400).contains(&seconds){return Err("Validade OAuth inválida.".into());}
    Ok(chrono::Utc::now().timestamp()+seconds)
}
fn verify_token(value:&TokenResponse,initial:bool)->Result<(),String>{
    if !valid_token(&value.access_token)||!value.token_type.eq_ignore_ascii_case("Bearer"){return Err("Token Google inválido.".into());}
    expiration(value.expires_in)?;
    if initial||value.scope.is_some(){
        let scopes=value.scope.as_deref().unwrap_or_default();
        if !scopes.split_whitespace().any(|s|s==SCOPE){return Err("A permissão Gemini não foi concedida.".into());}
    }
    Ok(())
}
fn parse_callback(target:&str,state:&str)->Result<Option<String>,String>{
    if target.len()>8192||!target.starts_with("/?"){return Ok(None);}
    let url=reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_|"Callback OAuth inválido.")?;
    let params:Vec<_>=url.query_pairs().collect();
    let read=|name:&str|->Option<&str>{let mut v=params.iter().filter(|(k,_)|k==name);let first=v.next()?.1.as_ref();if v.next().is_some(){None}else{Some(first)}};
    if read("state")!=Some(state){return Ok(None);}
    if read("error").is_some(){return Err("Autorização recusada ou cancelada.".into());}
    let code=read("code").filter(|v|valid_token(v)).ok_or("Código OAuth inválido.")?;
    Ok(Some(code.to_owned()))
}
fn response(stream:&mut TcpStream,success:bool){
    let status=if success{"200 OK"}else{"400 Bad Request"};
    let body=if success{"Autorizacao recebida. Volte ao Seven Mail."}else{"Solicitacao invalida. Volte ao Seven Mail."};
    let _=write!(stream,"HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",body.len());
}
pub(crate) fn await_callback(listener:TcpListener,state:&str,check_active:impl Fn()->Result<(),String>)->Result<String,String>{
    listener.set_nonblocking(true).map_err(|_|"Listener OAuth indisponível.")?;
    let deadline=Instant::now()+Duration::from_secs(180);
    while Instant::now()<deadline{
        check_active()?;
        match listener.accept(){
            Ok((mut stream,_))=>{
                let _=stream.set_read_timeout(Some(Duration::from_secs(1)));
                let _=stream.set_write_timeout(Some(Duration::from_secs(1)));
                let mut request=Vec::new();
                let mut byte=[0u8;1];
                let start=Instant::now();
                while request.len()<8192&&start.elapsed()<Duration::from_secs(2){
                    match stream.read(&mut byte){Ok(1)=>{request.push(byte[0]);if request.ends_with(b"\r\n"){break;}},_=>break}
                }
                let line=std::str::from_utf8(&request).unwrap_or_default();
                let target=line.strip_prefix("GET ").and_then(|v|v.split_once(" HTTP/").map(|(target,_)|target));
                let parsed=match target{Some(target)=>parse_callback(target,state),None=>Ok(None)};
                match parsed{Ok(Some(code))=>{response(&mut stream,true);return Ok(code);},Ok(None)=>response(&mut stream,false),Err(error)=>{response(&mut stream,false);return Err(error);}}
            }
            Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(100)),
            Err(_)=>return Err("Falha no retorno OAuth local.".into()),
        }
    }
    Err("Tempo limite para autorização. Tente novamente.".into())
}
pub(crate) fn authorize(
    client_id:String,client_secret:String,project:String,expected_email:Option<String>,
    open:impl FnOnce(&str)->Result<(),String>,check_active:impl Fn()->Result<(),String>,
)->Result<GoogleGrant,String>{
    if !valid_client(&client_id)||!valid_secret(&client_secret)||!valid_project(&project){return Err("Informe Client ID de aplicativo desktop e ID de projeto Google Cloud válidos.".into());}
    if expected_email.as_deref().is_some_and(|v|!valid_email(v)){return Err("E-mail da conta inválido.".into());}
    let listener=TcpListener::bind(("127.0.0.1",0)).map_err(|_|"Não foi possível abrir retorno OAuth local.")?;
    let port=listener.local_addr().map_err(|_|"Porta OAuth indisponível.")?.port();
    let redirect=format!("http://127.0.0.1:{port}/");
    let verifier=random()?;
    let state=random()?;
    let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let scopes=format!("{SCOPE} {EMAIL_SCOPE} openid");
    let mut url=reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|_|"Endpoint Google inválido.")?;
    url.query_pairs_mut().extend_pairs([("client_id",client_id.as_str()),("redirect_uri",redirect.as_str()),("response_type","code"),("scope",scopes.as_str()),("state",state.as_str()),("code_challenge",challenge.as_str()),("code_challenge_method","S256"),("access_type","offline"),("prompt","consent")]);
    if let Some(email)=expected_email.as_deref(){url.query_pairs_mut().append_pair("login_hint",email);}
    check_active()?;
    open(url.as_str())?;
    let code=await_callback(listener,&state,&check_active)?;
    check_active()?;
    let mut form=vec![("grant_type","authorization_code"),("client_id",client_id.as_str()),("code",code.as_str()),("code_verifier",verifier.as_str()),("redirect_uri",redirect.as_str())];
    if !client_secret.is_empty(){form.push(("client_secret",client_secret.as_str()));}
    let http=client()?;
    let result:TokenResponse=json(http.post(TOKEN_URL).form(&form).send().map_err(|_|"Falha ao trocar código Google.")?)?;
    verify_token(&result,true)?;
    let identity:Identity=json(http.get("https://openidconnect.googleapis.com/v1/userinfo").bearer_auth(&result.access_token).send().map_err(|_|"Falha ao confirmar a conta Google.")?)?;
    if !identity.email_verified||!valid_email(&identity.email)||expected_email.as_deref().is_some_and(|email|!email.eq_ignore_ascii_case(&identity.email)){
        return Err("A conta Google autorizada não corresponde à conta selecionada.".into());
    }
    let refresh_token=result.refresh_token.filter(|v|valid_token(v)).ok_or("Google não retornou autorização offline. Autorize novamente.")?;
    let grant=GoogleGrant{client_id,client_secret,project,email:identity.email,expires_at:expiration(result.expires_in)?,access_token:result.access_token,refresh_token};
    check_active()?;
    if !grant.valid(){return Err("Autorização Google inválida.".into());}
    Ok(grant)
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn callback_rejects_wrong_state_duplicates_and_wrong_path(){
        assert_eq!(parse_callback("/?state=abc&code=123","abc").unwrap(),Some("123".into()));
        for target in ["/?state=wrong&code=123","/?state=abc&state=abc&code=123","/other?state=abc&code=123"]{assert_eq!(parse_callback(target,"abc").unwrap(),None);}
        assert!(parse_callback("/?state=abc&error=access_denied","abc").is_err());
        assert!(parse_callback("/?state=abc&code=1&code=2","abc").is_err());
    }
    #[test]
    fn google_project_and_client_are_validated(){
        assert!(valid_project("seven-mail-test"));
        assert!(!valid_project("other/project"));
        assert!(valid_client("123-example.apps.googleusercontent.com"));
        assert!(!valid_client("https://evil.example"));
    }
    #[test]
    fn token_requires_gemini_scope_and_bearer(){
        let token=TokenResponse{access_token:"example".into(),refresh_token:None,expires_in:3600,token_type:"Bearer".into(),scope:Some(SCOPE.into())};
        assert!(verify_token(&token,true).is_ok());
        let wrong=TokenResponse{scope:Some("https://mail.google.com/".into()),..token};
        assert!(verify_token(&wrong,true).is_err());
    }
}

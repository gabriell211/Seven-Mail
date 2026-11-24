use crate::{
    credentials,
    models::{AccountProfile, MailAddress, MailMessage},
    oauth,
    providers,
    storage::{self, AppPaths},
};
use async_native_tls::{TlsConnector, TlsStream};
use async_std::{
    io::{prelude::BufReadExt, BufReader, ReadExt, WriteExt},
    net::TcpStream,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use mail_parser::{MessageParser, MimeHeaders};
use std::{collections::{HashMap, HashSet}, hash::{Hash, Hasher}, sync::{LazyLock, Mutex}, time::Duration};

type PopStream = BufReader<TlsStream<TcpStream>>;

fn pop3_settings(account: &AccountProfile) -> Result<(String, u16, String), String> {
    let settings = providers::settings_for(account);
    let host = settings.pop3_host
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("O provedor {} não oferece POP3. Use IMAP.", account.provider))?;
    let port = settings.pop3_port.unwrap_or(995);
    let mode = settings.pop3_security_mode.unwrap_or_else(|| "tls".to_string());
    Ok((host, port, mode))
}

fn message_id(account_id: &str, uidl: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    uidl.hash(&mut hasher);
    format!("{account_id}-pop3-{:016x}", hasher.finish())
}

const MAX_STATUS: usize = 8 * 1024;
const MAX_LINE: usize = 1024 * 1024;
const MAX_UIDL: usize = 16 * 1024 * 1024;
const MAX_MESSAGE: usize = 64 * 1024 * 1024;

static ACTIVE_ACCOUNTS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

struct AccountSyncGuard(String);

impl AccountSyncGuard {
    fn acquire(account_id: &str) -> Result<Self, String> {
        let mut active = ACTIVE_ACCOUNTS.lock().map_err(|_| "Sincronização POP3 indisponível.".to_string())?;
        if !active.insert(account_id.to_owned()) {
            return Err("Já existe uma sincronização POP3 em andamento para esta conta.".into());
        }
        Ok(Self(account_id.to_owned()))
    }
}

impl Drop for AccountSyncGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_ACCOUNTS.lock() {
            active.remove(&self.0);
        }
    }
}

fn validate_auth_value(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 64 * 1024 || value.chars().any(char::is_control) {
        return Err("Credencial POP3 possui caracteres inválidos.".into());
    }
    Ok(())
}

fn positive_status(line: &str) -> bool {
    let status = line.trim_end_matches(['\r', '\n']);
    status == "+OK" || status.starts_with("+OK ")
}

async fn bounded_line<R: async_std::io::BufRead + Unpin>(stream: &mut R, limit: usize) -> Result<Vec<u8>, String> {
    let mut line = Vec::new();
    let read = (&mut *stream).take((limit + 1) as u64).read_until(b'\n', &mut line)
        .await.map_err(|error| error.to_string())?;
    if read == 0 || read > limit || !line.ends_with(b"\n") {
        return Err("Resposta POP3 incompleta ou acima do limite.".into());
    }
    Ok(line)
}

async fn status_line<R: async_std::io::BufRead + Unpin>(stream: &mut R) -> Result<String, String> {
    String::from_utf8(bounded_line(stream, MAX_STATUS).await?)
        .map_err(|_| "Status POP3 inválido.".into())
}

async fn read_status(stream: &mut PopStream) -> Result<String, String> {
    let line = status_line(stream).await?;
    if !positive_status(&line) {
        return Err(format!("Servidor POP3 recusou o comando: {}", line.trim()));
    }
    Ok(line)
}

async fn command(stream: &mut PopStream, value: &str) -> Result<String, String> {
    if value.contains(['\r', '\n', '\0']) {
        return Err("Comando POP3 inválido.".into());
    }
    stream.get_mut().write_all(format!("{value}\r\n").as_bytes()).await.map_err(|error| error.to_string())?;
    stream.get_mut().flush().await.map_err(|error| error.to_string())?;
    read_status(stream).await
}

async fn multiline(stream: &mut PopStream, limit: usize) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    loop {
        let mut line = bounded_line(stream, MAX_LINE).await?;
        if line == b".\r\n" || line == b".\n" {
            break;
        }
        if line.starts_with(b"..") {
            line.remove(0);
        }
        if line.len() > limit.saturating_sub(output.len()) {
            return Err("Resposta POP3 acima do limite de armazenamento.".into());
        }
        output.extend_from_slice(&line);
    }
    Ok(output)
}

fn timeout_for(account: &AccountProfile) -> Duration {
    Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300))
}

async fn connect_bounded(account: &AccountProfile) -> Result<PopStream, String> {
    async_std::future::timeout(timeout_for(account), connect(account)).await
        .map_err(|_| "Tempo limite de autenticação/TLS POP3 excedido.".to_string())?
}

async fn connect(account: &AccountProfile) -> Result<PopStream, String> {
    let (host, port, mode) = pop3_settings(account)?;
    let address = format!("{host}:{port}");
    let timeout = Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let tcp = async_std::future::timeout(timeout, TcpStream::connect(&address))
        .await
        .map_err(|_| format!("Tempo limite de conexão POP3 excedido ({:?}).", timeout))?
        .map_err(|error| format!("Falha ao conectar ao POP3 {address}: {error}"))?;

    let connector = TlsConnector::new().use_sni(true);
    #[cfg(test)]
    let connector = if std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1") {
        // GreenMail uses an ephemeral self-signed certificate in CI.
        // This relaxation is compiled only into tests.
        connector
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
    } else {
        connector
    };

    let tls = if mode.eq_ignore_ascii_case("starttls") {
        let mut plain = BufReader::new(tcp);
        let greeting = status_line(&mut plain).await?;
        if !positive_status(&greeting) {
            return Err(format!("Servidor POP3 recusou a conexão: {}", greeting.trim()));
        }
        plain.get_mut().write_all(b"STLS\r\n").await.map_err(|error| error.to_string())?;
        plain.get_mut().flush().await.map_err(|error| error.to_string())?;
        let response = status_line(&mut plain).await?;
        if !positive_status(&response) {
            return Err(format!("STARTTLS POP3 recusado: {}", response.trim()));
        }
        connector
            .connect(&host, plain.into_inner())
            .await
            .map_err(|error| format!("TLS POP3 após STLS falhou: {error}"))?
    } else if mode.eq_ignore_ascii_case("tls") {
        connector
            .connect(&host, tcp)
            .await
            .map_err(|error| format!("TLS POP3 falhou: {error}"))?
    } else {
        return Err("POP3 sem TLS não é permitido. Use TLS direto ou STARTTLS.".to_string());
    };
    let mut stream = BufReader::new(tls);
    if !mode.eq_ignore_ascii_case("starttls") {
        read_status(&mut stream).await?;
    }

    if !account.can("read") {
        return Err("A conta compartilhada não possui permissão de leitura.".to_string());
    }
    let username = account.username.as_deref().unwrap_or(&account.email);
    validate_auth_value(username)?;
    if account.oauth_enabled {
        let token = oauth::access_token(account)?;
        validate_auth_value(&token)?;
        let payload = STANDARD.encode(format!("user={username}\x01auth=Bearer {token}\x01\x01"));

        stream.get_mut().write_all(b"AUTH XOAUTH2\r\n").await.map_err(|error| error.to_string())?;
        stream.get_mut().flush().await.map_err(|error| error.to_string())?;
        let challenge = status_line(&mut stream).await?;
        let challenge = challenge.trim_end_matches(['\r', '\n']);
        if challenge != "+" && !challenge.starts_with("+ ") {
            return Err("Servidor POP3 recusou XOAUTH2.".into());
        }

        stream.get_mut().write_all(format!("{payload}\r\n").as_bytes()).await.map_err(|error| error.to_string())?;
        stream.get_mut().flush().await.map_err(|error| error.to_string())?;
        read_status(&mut stream).await.map_err(|_| "Autenticação OAuth POP3 recusada; confira as permissões e se POP3 está habilitado.".to_string())?;
    } else {
        let password = credentials::load(account.credential_account_id())?;
        validate_auth_value(&password)?;
        command(&mut stream, &format!("USER {username}")).await.map_err(|_| "Usuário POP3 recusado.".to_string())?;
        command(&mut stream, &format!("PASS {password}")).await.map_err(|_| "Autenticação POP3 recusada; confira a credencial e se POP3 está habilitado.".to_string())?;
    }
    Ok(stream)
}

fn parse_uidl(raw: &[u8]) -> Result<Vec<(u32, String)>, String> {
    let text = std::str::from_utf8(raw).map_err(|_| "UIDL POP3 inválido.".to_string())?;
    let mut numbers = HashSet::new();
    let mut uids = HashSet::new();
    let mut output = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_ascii_whitespace();
        let number = parts.next().and_then(|value| value.parse::<u32>().ok()).filter(|value| *value > 0)
            .ok_or_else(|| "Número de mensagem UIDL inválido.".to_string())?;
        let uid = parts.next().filter(|value| !value.is_empty() && value.len() <= 70 && value.bytes().all(|ch| (0x21..=0x7e).contains(&ch)))
            .ok_or_else(|| "Identificador UIDL inválido.".to_string())?;
        if parts.next().is_some() || !numbers.insert(number) || !uids.insert(uid) {
            return Err("Lista UIDL duplicada ou inválida.".into());
        }
        output.push((number, uid.to_owned()));
    }
    Ok(output)
}

async fn uidl(stream: &mut PopStream) -> Result<Vec<(u32, String)>, String> {
    command(stream, "UIDL").await?;
    parse_uidl(&multiline(stream, MAX_UIDL).await?)
}

fn parse_list(raw: &[u8]) -> Result<HashMap<u32, u64>, String> {
    let text = std::str::from_utf8(raw).map_err(|_| "LIST POP3 inválido.".to_string())?;
    let mut sizes = HashMap::new();
    for line in text.lines() {
        let mut parts = line.split_ascii_whitespace();
        let number = parts.next().and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0).ok_or_else(|| "Número LIST POP3 inválido.".to_string())?;
        let size = parts.next().and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| "Tamanho LIST POP3 inválido.".to_string())?;
        if parts.next().is_some() || sizes.insert(number, size).is_some() {
            return Err("Lista de tamanhos POP3 duplicada ou inválida.".into());
        }
    }
    Ok(sizes)
}

async fn list_sizes(stream: &mut PopStream) -> Result<HashMap<u32, u64>, String> {
    command(stream, "LIST").await?;
    parse_list(&multiline(stream, MAX_UIDL).await?)
}

fn eligible_entries(
    entries: Vec<(u32, String)>,
    sizes: &HashMap<u32, u64>,
    cached: &HashSet<String>,
) -> Result<(Vec<(u32, String)>, usize), String> {
    let mut eligible = Vec::new();
    let mut oversized = 0;
    if entries.len() != sizes.len() {
        return Err("LIST e UIDL POP3 divergentes.".into());
    }
    for (number, uid) in entries {
        let size = sizes.get(&number).ok_or_else(|| "Mensagem UIDL sem tamanho LIST.".to_string())?;
        if cached.contains(&uid) {
            continue;
        }
        if *size > MAX_MESSAGE as u64 {
            oversized += 1;
        } else {
            eligible.push((number, uid));
        }
    }
    Ok((eligible, oversized))
}

async fn retrieve(stream: &mut PopStream, number: u32) -> Result<Vec<u8>, String> {
    command(stream, &format!("RETR {number}")).await?;
    multiline(stream, MAX_MESSAGE).await
}

fn missing_batch(entries: Vec<(u32, String)>, cached: &HashSet<String>, limit: usize) -> Vec<(u32, String)> {
    let mut missing = entries.into_iter().filter(|(_, uid)| !cached.contains(uid)).collect::<Vec<_>>();
    missing.sort_by_key(|(number, _)| *number);
    if cached.is_empty() && missing.len() > limit {
        missing = missing.split_off(missing.len() - limit);
    } else {
        missing.truncate(limit);
    }
    missing
}

fn parse_message(account: &AccountProfile, uid: &str, raw: &[u8]) -> Result<MailMessage, String> {
    let parsed = MessageParser::default()
        .parse(raw)
        .ok_or_else(|| "Mensagem POP3 inválida.".to_string())?;

    let address = |addr: Option<&mail_parser::Addr<'_>>| MailAddress {
        name: addr.and_then(|value| value.name()).map(ToOwned::to_owned),
        email: addr.and_then(|value| value.address()).unwrap_or("desconhecido@localhost").to_owned(),
    };
    let recipients = parsed
        .to()
        .map(|items| items.iter().map(|item| MailAddress {
            name: item.name().map(ToOwned::to_owned),
            email: item.address().unwrap_or("desconhecido@localhost").to_owned(),
        }).collect())
        .unwrap_or_default();

    let body_text = parsed.body_text(0).map(|value| value.into_owned());
    let body_html = parsed.body_html(0).map(|value| value.into_owned());
    let attachment_names = (0..parsed.attachment_count())
        .filter_map(|index| parsed.attachment(index as u32))
        .map(|part| part.attachment_name().unwrap_or("anexo").to_string())
        .collect::<Vec<_>>();

    Ok(MailMessage {
        id: message_id(&account.id, uid),
        account_id: account.id.clone(),
        remote_id: Some(uid.to_string()),
        remote_folder: Some("POP3".to_string()),
        folder: "Caixa de entrada".to_string(),
        subject: parsed.subject().unwrap_or("(sem assunto)").to_owned(),
        preview: parsed.body_preview(180).map(|value| value.into_owned()).unwrap_or_default(),
        from: address(parsed.from().and_then(|value| value.first())),
        to: recipients,
        received_at: parsed.date().map(|date| date.to_rfc3339()).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        is_read: false,
        is_flagged: false,
        is_pinned: false,
        has_attachments: parsed.attachment_count() > 0,
        body_html,
        body_text,
        categories: Vec::new(),
        applied_rule_ids: Vec::new(),
        size_bytes: Some(raw.len() as u64),
        attachment_names,
        importance: Some("normal".to_string()),
        snoozed_until: None,
        is_muted: false,
        is_phishing: false,
        is_important: false,
        source_format: None,
    })
}

pub fn test(account: &AccountProfile) -> Result<bool, String> {
    async_std::task::block_on(async {
        let mut stream = connect_bounded(account).await?;
        async_std::future::timeout(timeout_for(account), command(&mut stream, "STAT")).await
            .map_err(|_| "Tempo limite STAT POP3 excedido.".to_string())??;
        let _ = async_std::future::timeout(timeout_for(account), command(&mut stream, "QUIT")).await;
        Ok(true)
    })
}

pub fn sync_latest(paths: &AppPaths, account: &AccountProfile, limit: u32) -> Result<usize, String> {
    let _guard = AccountSyncGuard::acquire(&account.id)?;
    async_std::task::block_on(async {
        let mut stream = connect_bounded(account).await?;
        let entries = async_std::future::timeout(timeout_for(account), uidl(&mut stream)).await
            .map_err(|_| "Tempo limite UIDL POP3 excedido.".to_string())??;
        let cached: HashSet<String> = storage::list_cached_messages(paths, Some(&account.id))?
            .into_iter()
            .filter(|message| message.remote_folder.as_deref() == Some("POP3"))
            .filter_map(|message| message.remote_id)
            .collect();

        let sizes = async_std::future::timeout(timeout_for(account), list_sizes(&mut stream)).await
            .map_err(|_| "Tempo limite LIST POP3 excedido.".to_string())??;
        let (eligible, oversized) = eligible_entries(entries, &sizes, &cached)?;
        let missing = missing_batch(eligible, &cached, limit.clamp(1, 200) as usize);

        let mut imported = 0usize;
        for (number, uid) in missing {
            let raw = async_std::future::timeout(timeout_for(account), retrieve(&mut stream, number)).await
                .map_err(|_| "Tempo limite RETR POP3 excedido.".to_string())??;
            let message = parse_message(account, &uid, &raw)?;
            storage::cache_raw_message(paths, &account.id, &message.id, &raw)?;
            storage::cache_message(paths, &message)?;
            imported += 1;
        }

        let _ = async_std::future::timeout(timeout_for(account), command(&mut stream, "QUIT")).await;
        if oversized > 0 {
            return Err(format!(
                "POP3: {imported} mensagens importadas; {oversized} mensagens acima de 64 MiB permanecem no servidor."
            ));
        }
        Ok(imported)
    })
}

#[cfg(test)]
mod reliability_tests {
    use super::*;

    #[test]
    fn uidl_requires_unique_valid_identifiers() {
        assert_eq!(parse_uidl(b"1 a\r\n2 b\r\n").unwrap().len(), 2);
        for bad in [b"1 a\n1 b\n".as_slice(), b"1 a\n2 a\n", b"0 a\n", b"1 a extra\n", b"1\n"] {
            assert!(parse_uidl(bad).is_err());
        }
    }

    #[test]
    fn credentials_cannot_inject_pop_commands() {
        assert!(validate_auth_value("user\r\nDELE 1").is_err());
        assert!(validate_auth_value("password\0").is_err());
        assert!(validate_auth_value("password").is_ok());
        assert!(!positive_status("+OKINVALID\r\n"));
        assert!(positive_status("+OK ready\r\n"));
    }

    #[test]
    fn subsequent_batches_drain_older_messages() {
        let entries = (1..=500).map(|number| (number, number.to_string())).collect::<Vec<_>>();
        let mut cached = HashSet::new();
        let first = missing_batch(entries.clone(), &cached, 200);
        assert_eq!(first[0].0, 301);
        cached.extend(first.into_iter().map(|(_, uid)| uid));
        let second = missing_batch(entries.clone(), &cached, 200);
        assert_eq!(second[0].0, 1);
        cached.extend(second.into_iter().map(|(_, uid)| uid));
        assert_eq!(missing_batch(entries, &cached, 200).len(), 100);
    }

    #[test]
    fn oversized_messages_do_not_consume_the_batch() {
        let entries = vec![(1, "large".into()), (2, "small".into()), (3, "cached".into())];
        let sizes = parse_list(format!("1 {}\r\n2 100\r\n3 200\r\n", MAX_MESSAGE + 1).as_bytes()).unwrap();
        let cached = HashSet::from(["cached".to_string()]);
        let (eligible, skipped) = eligible_entries(entries.clone(), &sizes, &cached).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(missing_batch(eligible, &cached, 1), vec![(2, "small".into())]);
        assert!(eligible_entries(entries, &HashMap::new(), &cached).is_err());
        assert!(parse_list(b"1 10\n1 20\n").is_err());
    }

    #[test]
    fn sync_guard_is_per_account_and_releases_on_drop() {
        let first = AccountSyncGuard::acquire("pop3-test-account-a").unwrap();
        assert!(AccountSyncGuard::acquire("pop3-test-account-a").is_err());
        let other = AccountSyncGuard::acquire("pop3-test-account-b").unwrap();
        drop(first);
        assert!(AccountSyncGuard::acquire("pop3-test-account-a").is_ok());
        drop(other);
    }

    #[test]
    fn oversized_line_is_rejected_before_unbounded_allocation() {
        async_std::task::block_on(async {
            let mut stream = BufReader::new(async_std::io::Cursor::new(b"123456789\r\n".to_vec()));
            assert!(bounded_line(&mut stream, 5).await.is_err());
        });
    }
}

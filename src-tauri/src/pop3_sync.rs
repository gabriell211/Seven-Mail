use crate::{
    credentials,
    models::{AccountProfile, MailAddress, MailMessage},
    oauth,
    storage::{self, AppPaths},
};
use async_native_tls::{TlsConnector, TlsStream};
use async_std::{
    io::{prelude::BufReadExt, BufReader, WriteExt},
    net::TcpStream,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use mail_parser::{MessageParser, MimeHeaders};
use std::{collections::HashSet, hash::{Hash, Hasher}, time::Duration};

type PopStream = BufReader<TlsStream<TcpStream>>;

fn pop3_host(account: &AccountProfile) -> String {
    account.pop3_host.clone().unwrap_or_else(|| {
        let domain = account.email.rsplit_once('@').map(|(_, domain)| domain).unwrap_or("");
        format!("pop.{domain}")
    })
}

fn message_id(account_id: &str, uidl: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    uidl.hash(&mut hasher);
    format!("{account_id}-pop3-{:016x}", hasher.finish())
}

async fn read_status(stream: &mut PopStream) -> Result<String, String> {
    let mut line = String::new();
    stream.read_line(&mut line).await.map_err(|error| error.to_string())?;
    if line.is_empty() {
        return Err("Servidor POP3 encerrou a conexão.".to_string());
    }
    if !line.starts_with("+OK") {
        return Err(format!("Servidor POP3 recusou o comando: {}", line.trim()));
    }
    Ok(line)
}

async fn command(stream: &mut PopStream, value: &str) -> Result<String, String> {
    stream.get_mut().write_all(format!("{value}\r\n").as_bytes()).await.map_err(|error| error.to_string())?;
    stream.get_mut().flush().await.map_err(|error| error.to_string())?;
    read_status(stream).await
}

async fn multiline(stream: &mut PopStream) -> Result<Vec<Vec<u8>>, String> {
    let mut lines = Vec::new();
    loop {
        let mut line = Vec::new();
        let read = stream.read_until(b'\n', &mut line).await.map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Resposta POP3 incompleta.".to_string());
        }
        if line == b".\r\n" || line == b".\n" {
            break;
        }
        if line.starts_with(b"..") {
            line.remove(0);
        }
        lines.push(line);
    }
    Ok(lines)
}

async fn connect(account: &AccountProfile) -> Result<PopStream, String> {
    let host = pop3_host(account);
    let port = account.pop3_port.unwrap_or(995);
    let address = format!("{host}:{port}");
    let timeout = Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let tcp = async_std::future::timeout(timeout, TcpStream::connect(&address))
        .await
        .map_err(|_| format!("Tempo limite de conexão POP3 excedido ({:?}).", timeout))?
        .map_err(|error| format!("Falha ao conectar ao POP3 {address}: {error}"))?;

    let tls = TlsConnector::new()
        .use_sni(true)
        .connect(&host, tcp)
        .await
        .map_err(|error| format!("TLS POP3 falhou: {error}"))?;
    let mut stream = BufReader::new(tls);
    read_status(&mut stream).await?;

    if !account.can("read") {
        return Err("A conta compartilhada não possui permissão de leitura.".to_string());
    }
    let username = account.username.as_deref().unwrap_or(&account.email);
    if account.oauth_enabled {
        let token = oauth::access_token(account)?;
        let payload = STANDARD.encode(format!("user={username}\x01auth=Bearer {token}\x01\x01"));

        stream.get_mut().write_all(b"AUTH XOAUTH2\r\n").await.map_err(|error| error.to_string())?;
        stream.get_mut().flush().await.map_err(|error| error.to_string())?;
        let mut challenge = String::new();
        stream.read_line(&mut challenge).await.map_err(|error| error.to_string())?;
        if !challenge.starts_with('+') {
            return Err(format!("Servidor POP3 recusou XOAUTH2: {}", challenge.trim()));
        }

        stream.get_mut().write_all(format!("{payload}\r\n").as_bytes()).await.map_err(|error| error.to_string())?;
        stream.get_mut().flush().await.map_err(|error| error.to_string())?;
        read_status(&mut stream).await?;
    } else {
        let password = credentials::load(account.credential_account_id())?;
        command(&mut stream, &format!("USER {username}")).await?;
        command(&mut stream, &format!("PASS {password}")).await?;
    }
    Ok(stream)
}

async fn uidl(stream: &mut PopStream) -> Result<Vec<(u32, String)>, String> {
    command(stream, "UIDL").await?;
    let lines = multiline(stream).await?;
    let mut output = Vec::new();
    for line in lines {
        let text = String::from_utf8_lossy(&line);
        let mut parts = text.split_whitespace();
        let Some(number) = parts.next().and_then(|value| value.parse::<u32>().ok()) else { continue; };
        let Some(uid) = parts.next() else { continue; };
        output.push((number, uid.to_string()));
    }
    Ok(output)
}

async fn retrieve(stream: &mut PopStream, number: u32) -> Result<Vec<u8>, String> {
    command(stream, &format!("RETR {number}")).await?;
    let lines = multiline(stream).await?;
    Ok(lines.into_iter().flatten().collect())
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
    })
}

pub fn test(account: &AccountProfile) -> Result<bool, String> {
    async_std::task::block_on(async {
        let mut stream = connect(account).await?;
        command(&mut stream, "STAT").await?;
        let _ = command(&mut stream, "QUIT").await;
        Ok(true)
    })
}

pub fn sync_latest(paths: &AppPaths, account: &AccountProfile, limit: u32) -> Result<usize, String> {
    async_std::task::block_on(async {
        let mut stream = connect(account).await?;
        let entries = uidl(&mut stream).await?;
        let cached: HashSet<String> = storage::list_cached_messages(paths, Some(&account.id))?
            .into_iter()
            .filter(|message| message.remote_folder.as_deref() == Some("POP3"))
            .filter_map(|message| message.remote_id)
            .collect();

        let mut missing = entries.into_iter()
            .filter(|(_, uid)| !cached.contains(uid))
            .collect::<Vec<_>>();
        missing.sort_by_key(|(number, _)| *number);
        let take = limit.clamp(1, 200) as usize;
        if missing.len() > take {
            missing = missing.split_off(missing.len() - take);
        }

        let mut imported = 0usize;
        for (number, uid) in missing {
            let raw = retrieve(&mut stream, number).await?;
            let message = parse_message(account, &uid, &raw)?;
            storage::cache_message(paths, &message)?;
            storage::cache_raw_message(paths, &account.id, &message.id, &raw)?;
            imported += 1;
        }

        let _ = command(&mut stream, "QUIT").await;
        Ok(imported)
    })
}

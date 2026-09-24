use crate::{
    credentials,
    models::{AccountProfile, MailAddress, MailMessage},
    providers,
    storage::{self, AppPaths},
};
use async_imap::{types::{Flag, NameAttribute}, Client};
use async_native_tls::{TlsConnector, TlsStream};
use async_std::net::TcpStream;
use futures::TryStreamExt;
use mail_parser::MessageParser;

type SecureClient = Client<TlsStream<TcpStream>>;

async fn connect(account: &AccountProfile) -> Result<SecureClient, String> {
    let settings = providers::settings_for(account);
    let address = format!("{}:{}", settings.imap_host, settings.imap_port);
    let tcp = TcpStream::connect(&address)
        .await
        .map_err(|error| format!("Falha ao conectar ao IMAP {address}: {error}"))?;

    let connector = TlsConnector::new().use_sni(true);

    if settings.security_mode.eq_ignore_ascii_case("starttls") {
        let mut client = Client::new(tcp);
        client
            .read_response()
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Servidor IMAP encerrou antes da saudação.".to_string())?;
        client
            .run_command_and_check_ok("STARTTLS", None)
            .await
            .map_err(|error| format!("STARTTLS IMAP falhou: {error}"))?;
        let tcp = client.into_inner();
        let tls = connector
            .connect(settings.imap_host.as_str(), tcp)
            .await
            .map_err(|error| format!("TLS IMAP falhou: {error}"))?;
        Ok(Client::new(tls))
    } else {
        let tls = connector
            .connect(settings.imap_host.as_str(), tcp)
            .await
            .map_err(|error| format!("TLS IMAP falhou: {error}"))?;
        let mut client = Client::new(tls);
        client
            .read_response()
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Servidor IMAP encerrou antes da saudação.".to_string())?;
        Ok(client)
    }
}

fn mail_address(address: Option<&mail_parser::Addr<'_>>) -> MailAddress {
    MailAddress {
        name: address.and_then(|value| value.name()).map(ToOwned::to_owned),
        email: address
            .and_then(|value| value.address())
            .unwrap_or("desconhecido@localhost")
            .to_owned(),
    }
}

fn recipients(addresses: Option<&mail_parser::Address<'_>>) -> Vec<MailAddress> {
    addresses
        .map(|items| {
            items
                .iter()
                .map(|item| MailAddress {
                    name: item.name().map(ToOwned::to_owned),
                    email: item.address().unwrap_or("desconhecido@localhost").to_owned(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_message(
    account: &AccountProfile,
    fetch: &async_imap::types::Fetch,
) -> Option<MailMessage> {
    let raw = fetch.body()?;
    let parsed = MessageParser::default().parse(raw)?;

    let uid = fetch.uid.unwrap_or(fetch.message);
    let flags: Vec<_> = fetch.flags().collect();
    let is_read = flags.iter().any(|flag| matches!(flag, Flag::Seen));
    let is_flagged = flags.iter().any(|flag| matches!(flag, Flag::Flagged));
    let is_draft = flags.iter().any(|flag| matches!(flag, Flag::Draft));
    let received_at = parsed
        .date()
        .map(|date| date.to_rfc3339())
        .or_else(|| fetch.internal_date().map(|date| date.to_rfc3339()))
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let body_text = parsed.body_text(0).map(|value| value.into_owned());
    let body_html = parsed.body_html(0).map(|value| value.into_owned());
    let preview = parsed
        .body_preview(180)
        .map(|value| value.into_owned())
        .unwrap_or_default();

    Some(MailMessage {
        id: format!("{}-inbox-{uid}", account.id),
        account_id: account.id.clone(),
        remote_id: Some(uid.to_string()),
        folder: if is_draft { "Rascunhos" } else { "Caixa de entrada" }.into(),
        subject: parsed.subject().unwrap_or("(sem assunto)").to_owned(),
        preview,
        from: mail_address(parsed.from().and_then(|value| value.first())),
        to: recipients(parsed.to()),
        received_at,
        is_read,
        is_flagged,
        is_pinned: false,
        has_attachments: parsed.attachment(0).is_some(),
        body_html,
        body_text,
        categories: Vec::new(),
    })
}

async fn login(account: &AccountProfile) -> Result<async_imap::Session<TlsStream<TcpStream>>, String> {
    let client = connect(account).await?;
    let password = credentials::load(&account.id)?;
    let username = account.username.as_deref().unwrap_or(&account.email);
    client
        .login(username, password)
        .await
        .map_err(|(error, _)| format!("Autenticação IMAP recusada: {error}"))
}

pub fn test(account: &AccountProfile) -> Result<bool, String> {
    async_std::task::block_on(async {
        let mut session = login(account).await?;
        session
            .select("INBOX")
            .await
            .map_err(|error| format!("Não foi possível abrir a caixa de entrada: {error}"))?;
        session.logout().await.map_err(|error| error.to_string())?;
        Ok(true)
    })
}

pub fn sync_latest(paths: &AppPaths, account: &AccountProfile, limit: u32) -> Result<usize, String> {
    let limit = limit.clamp(1, 200);

    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let mailbox = session
            .select("INBOX")
            .await
            .map_err(|error| format!("Não foi possível abrir a caixa de entrada: {error}"))?;

        if mailbox.exists == 0 {
            session.logout().await.map_err(|error| error.to_string())?;
            return Ok(0);
        }

        let end = mailbox.exists;
        let start = end.saturating_sub(limit.saturating_sub(1)).max(1);
        let sequence = format!("{start}:{end}");

        let fetch_stream = session
            .fetch(sequence, "(UID FLAGS INTERNALDATE RFC822)")
            .await
            .map_err(|error| format!("Falha ao buscar mensagens: {error}"))?;
        let fetched: Vec<_> = fetch_stream
            .try_collect()
            .await
            .map_err(|error| format!("Falha ao receber mensagens: {error}"))?;

        let mut cached = 0usize;
        for item in &fetched {
            if let Some(message) = parse_message(account, item) {
                storage::cache_message(paths, &message)?;
                cached += 1;
            }
        }

        session.logout().await.map_err(|error| error.to_string())?;
        Ok(cached)
    })
}


#[derive(Default)]
struct SpecialFolders {
    archive: Option<String>,
    trash: Option<String>,
    junk: Option<String>,
}

async fn special_folders(
    session: &mut async_imap::Session<TlsStream<TcpStream>>,
) -> Result<SpecialFolders, String> {
    let stream = session
        .list(Some(""), Some("*"))
        .await
        .map_err(|error| format!("Falha ao listar pastas IMAP: {error}"))?;
    let names: Vec<_> = stream
        .try_collect()
        .await
        .map_err(|error| format!("Falha ao receber pastas IMAP: {error}"))?;

    let mut folders = SpecialFolders::default();
    for name in names {
        let attributes = name.attributes();
        if folders.archive.is_none()
            && attributes.iter().any(|value| matches!(value, NameAttribute::Archive | NameAttribute::All))
        {
            folders.archive = Some(name.name().to_owned());
        }
        if folders.trash.is_none()
            && attributes.iter().any(|value| matches!(value, NameAttribute::Trash))
        {
            folders.trash = Some(name.name().to_owned());
        }
        if folders.junk.is_none()
            && attributes.iter().any(|value| matches!(value, NameAttribute::Junk))
        {
            folders.junk = Some(name.name().to_owned());
        }
    }

    Ok(folders)
}

async fn apply_remote_action(
    session: &mut async_imap::Session<TlsStream<TcpStream>>,
    operation: &crate::models::QueueOperation,
    folders: &SpecialFolders,
) -> Result<(), String> {
    let remote_id = operation
        .payload
        .get("remoteId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "A ação não possui UID remoto.".to_string())?;

    match operation.kind.as_str() {
        "read" => {
            let read = operation
                .payload
                .get("read")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            let query = if read { "+FLAGS.SILENT (\\Seen)" } else { "-FLAGS.SILENT (\\Seen)" };
            let stream = session
                .uid_store(remote_id, query)
                .await
                .map_err(|error| format!("Falha ao alterar leitura: {error}"))?;
            let _: Vec<_> = stream
                .try_collect()
                .await
                .map_err(|error| format!("Falha ao confirmar leitura: {error}"))?;
        }
        "flag" => {
            let flagged = operation
                .payload
                .get("flagged")
                .and_then(|value| value.as_bool())
                .unwrap_or(true);
            let query = if flagged { "+FLAGS.SILENT (\\Flagged)" } else { "-FLAGS.SILENT (\\Flagged)" };
            let stream = session
                .uid_store(remote_id, query)
                .await
                .map_err(|error| format!("Falha ao alterar sinalização: {error}"))?;
            let _: Vec<_> = stream
                .try_collect()
                .await
                .map_err(|error| format!("Falha ao confirmar sinalização: {error}"))?;
        }
        "move" => {
            let target = operation
                .payload
                .get("target")
                .and_then(|value| value.as_str())
                .unwrap_or("archive");
            let mailbox = match target {
                "archive" => folders.archive.as_deref().unwrap_or("Archive"),
                "trash" => folders.trash.as_deref().unwrap_or("Trash"),
                "spam" => folders.junk.as_deref().unwrap_or("Junk"),
                "inbox" => "INBOX",
                _ => return Err("Destino IMAP não suportado.".to_string()),
            };
            session
                .uid_mv(remote_id, mailbox)
                .await
                .map_err(|error| format!("Falha ao mover mensagem: {error}"))?;
        }
        _ => return Err("Operação IMAP não suportada.".to_string()),
    }

    Ok(())
}

pub fn flush_actions(paths: &AppPaths, account: &AccountProfile) -> Result<usize, String> {
    let Some(first) = storage::claim_next_mail_action(paths, &account.id)? else {
        return Ok(0);
    };

    async_std::task::block_on(async {
        let mut session = match login(account).await {
            Ok(session) => session,
            Err(error) => {
                storage::retry_later(paths, &first.id)?;
                return Err(error);
            }
        };

        if let Err(error) = session.select("INBOX").await {
            storage::retry_later(paths, &first.id)?;
            return Err(format!("Não foi possível abrir INBOX para sincronizar ações: {error}"));
        }

        let folders = special_folders(&mut session).await.unwrap_or_default();
        let mut applied = 0usize;
        let mut current = Some(first);

        while let Some(operation) = current {
            match apply_remote_action(&mut session, &operation, &folders).await {
                Ok(()) => {
                    storage::complete(paths, &operation.id)?;
                    applied += 1;
                }
                Err(error) => {
                    storage::retry_later(paths, &operation.id)?;
                    let _ = session.logout().await;
                    return Err(error);
                }
            }
            current = storage::claim_next_mail_action(paths, &account.id)?;
        }

        session.logout().await.map_err(|error| error.to_string())?;
        Ok(applied)
    })
}

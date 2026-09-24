use crate::{
    credentials,
    models::{AccountProfile, MailAddress, MailFolder, MailMessage},
    oauth,
    providers,
    storage::{self, AppPaths},
};
use async_imap::{types::{Flag, NameAttribute}, Client};
use async_native_tls::{TlsConnector, TlsStream};
use async_std::net::TcpStream;
use futures::TryStreamExt;
use mail_parser::{MessageParser, MimeHeaders};

type SecureClient = Client<TlsStream<TcpStream>>;

async fn connect(account: &AccountProfile) -> Result<SecureClient, String> {
    let settings = providers::settings_for(account);
    let address = format!("{}:{}", settings.imap_host, settings.imap_port);
    let timeout = std::time::Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let tcp = async_std::future::timeout(timeout, TcpStream::connect(&address))
        .await
        .map_err(|_| format!("Tempo limite de conexão IMAP excedido ({:?}).", timeout))?
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
    remote_folder: &str,
    folder_label: &str,
) -> Option<MailMessage> {
    let raw = fetch.body()?;
    let parsed = MessageParser::default().parse(raw)?;

    let uid = fetch.uid.unwrap_or(fetch.message);
    let flags: Vec<_> = fetch.flags().collect();
    let is_read = flags.iter().any(|flag| matches!(flag, Flag::Seen));
    let is_flagged = flags.iter().any(|flag| matches!(flag, Flag::Flagged));
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
    let attachment_names = (0..parsed.attachment_count())
        .filter_map(|index| parsed.attachment(index as u32))
        .map(|part| part.attachment_name().unwrap_or("anexo").to_string())
        .collect::<Vec<_>>();

    Some(MailMessage {
        id: if remote_folder.eq_ignore_ascii_case("INBOX") {
            format!("{}-inbox-{uid}", account.id)
        } else {
            format!("{}-{}-{uid}", account.id, mailbox_key(remote_folder))
        },
        account_id: account.id.clone(),
        remote_id: Some(uid.to_string()),
        remote_folder: Some(remote_folder.to_owned()),
        folder: folder_label.to_owned(),
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

struct OAuth2 {
    user: String,
    access_token: String,
}

impl async_imap::Authenticator for &OAuth2 {
    type Response = String;

    fn process(&mut self, _: &[u8]) -> Self::Response {
        format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.access_token)
    }
}

async fn login(account: &AccountProfile) -> Result<async_imap::Session<TlsStream<TcpStream>>, String> {
    let client = connect(account).await?;
    let username = account.username.clone().unwrap_or_else(|| account.email.clone());

    if account.oauth_enabled {
        let auth = OAuth2 {
            user: username,
            access_token: oauth::access_token(account)?,
        };
        client
            .authenticate("XOAUTH2", &auth)
            .await
            .map_err(|(error, _)| format!("Autenticação OAuth IMAP recusada: {error}"))
    } else {
        let password = credentials::load(&account.id)?;
        client
            .login(username, password)
            .await
            .map_err(|(error, _)| format!("Autenticação IMAP recusada: {error}"))
    }
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

fn mailbox_key(path: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn folder_identity(path: &str, attributes: &[NameAttribute<'_>]) -> (String, String) {
    if path.eq_ignore_ascii_case("INBOX") {
        return ("Caixa de entrada".into(), "inbox".into());
    }

    if attributes.iter().any(|value| matches!(value, NameAttribute::Sent)) {
        return ("Enviados".into(), "sent".into());
    }
    if attributes.iter().any(|value| matches!(value, NameAttribute::Drafts)) {
        return ("Rascunhos".into(), "drafts".into());
    }
    if attributes.iter().any(|value| matches!(value, NameAttribute::Archive | NameAttribute::All)) {
        return ("Arquivados".into(), "archive".into());
    }
    if attributes.iter().any(|value| matches!(value, NameAttribute::Junk)) {
        return ("Spam".into(), "spam".into());
    }
    if attributes.iter().any(|value| matches!(value, NameAttribute::Trash)) {
        return ("Lixeira".into(), "trash".into());
    }
    if attributes.iter().any(|value| matches!(value, NameAttribute::Flagged)) {
        return ("Sinalizadas".into(), "flagged".into());
    }

    (path.to_owned(), "custom".into())
}

pub fn list_folders(account: &AccountProfile) -> Result<Vec<MailFolder>, String> {
    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let stream = session
            .list(Some(""), Some("*"))
            .await
            .map_err(|error| format!("Falha ao listar pastas IMAP: {error}"))?;
        let names: Vec<_> = stream
            .try_collect()
            .await
            .map_err(|error| format!("Falha ao receber pastas IMAP: {error}"))?;

        let mut folders = Vec::new();
        for item in names {
            if item.attributes().iter().any(|value| matches!(value, NameAttribute::NoSelect)) {
                continue;
            }
            let path = item.name().to_owned();
            let (name, role) = folder_identity(&path, item.attributes());
            folders.push(MailFolder { name, path, role });
        }

        folders.sort_by_key(|folder| match folder.role.as_str() {
            "inbox" => 0,
            "drafts" => 1,
            "sent" => 2,
            "archive" => 3,
            "spam" => 4,
            "trash" => 5,
            "flagged" => 6,
            _ => 20,
        });

        session.logout().await.map_err(|error| error.to_string())?;
        Ok(folders)
    })
}

pub fn sync_folder(
    paths: &AppPaths,
    account: &AccountProfile,
    remote_folder: &str,
    folder_label: &str,
    limit: u32,
) -> Result<usize, String> {
    let limit = limit.clamp(1, 200);

    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let mailbox = session
            .select(remote_folder)
            .await
            .map_err(|error| format!("Não foi possível abrir {remote_folder}: {error}"))?;

        if mailbox.exists == 0 {
            let empty = std::collections::HashSet::new();
            storage::reconcile_remote_uids(paths, &account.id, remote_folder, &empty)?;
            session.logout().await.map_err(|error| error.to_string())?;
            return Ok(0);
        }

        let remote_uids = session
            .uid_search("ALL")
            .await
            .map_err(|error| format!("Falha ao consultar UIDs de {remote_folder}: {error}"))?;
        let cached_uids = storage::cached_remote_uids(paths, &account.id, remote_folder)?;
        let cached_set = cached_uids.iter().copied().collect::<std::collections::HashSet<_>>();
        let highest_cached = cached_uids.last().copied();

        let mut sorted_remote = remote_uids.iter().copied().collect::<Vec<_>>();
        sorted_remote.sort_unstable();

        let mut wanted = if let Some(highest) = highest_cached {
            sorted_remote
                .iter()
                .copied()
                .filter(|uid| *uid > highest && !cached_set.contains(uid))
                .collect::<Vec<_>>()
        } else {
            sorted_remote
                .iter()
                .rev()
                .take(limit as usize)
                .copied()
                .collect::<Vec<_>>()
        };
        wanted.sort_unstable();
        if wanted.len() > limit as usize {
            wanted = wanted.split_off(wanted.len() - limit as usize);
        }

        let mut cached = 0usize;
        if !wanted.is_empty() {
            let sequence = wanted.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
            let fetch_stream = session
                .uid_fetch(sequence, "(UID FLAGS INTERNALDATE BODY.PEEK[])")
                .await
                .map_err(|error| format!("Falha ao buscar novas mensagens: {error}"))?;
            let fetched: Vec<_> = fetch_stream
                .try_collect()
                .await
                .map_err(|error| format!("Falha ao receber novas mensagens: {error}"))?;

            for item in &fetched {
                if let Some(message) = parse_message(account, item, remote_folder, folder_label) {
                    storage::cache_message(paths, &message)?;
                    if let Some(raw) = item.body() {
                        storage::cache_raw_message(paths, &message.account_id, &message.id, raw)?;
                    }
                    cached += 1;
                }
            }
        }

        let recent_cached = cached_uids
            .iter()
            .rev()
            .take(limit as usize)
            .copied()
            .collect::<Vec<_>>();
        if !recent_cached.is_empty() {
            let sequence = recent_cached.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
            let flag_stream = session
                .uid_fetch(sequence, "(UID FLAGS)")
                .await
                .map_err(|error| format!("Falha ao atualizar flags remotas: {error}"))?;
            let flags: Vec<_> = flag_stream
                .try_collect()
                .await
                .map_err(|error| format!("Falha ao receber flags remotas: {error}"))?;
            for item in flags {
                let Some(uid) = item.uid else { continue; };
                let values: Vec<_> = item.flags().collect();
                let is_read = values.iter().any(|flag| matches!(flag, Flag::Seen));
                let is_flagged = values.iter().any(|flag| matches!(flag, Flag::Flagged));
                storage::update_cached_remote_flags(
                    paths,
                    &account.id,
                    remote_folder,
                    uid,
                    is_read,
                    is_flagged,
                )?;
            }
        }

        storage::reconcile_remote_uids(paths, &account.id, remote_folder, &remote_uids)?;
        session.logout().await.map_err(|error| error.to_string())?;
        Ok(cached)
    })
}

pub fn sync_latest(paths: &AppPaths, account: &AccountProfile, limit: u32) -> Result<usize, String> {
    sync_folder(paths, account, "INBOX", "Caixa de entrada", limit)
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
        "copy" => {
            let mailbox = operation
                .payload
                .get("targetMailbox")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Destino IMAP não informado.".to_string())?;
            session
                .uid_copy(remote_id, mailbox)
                .await
                .map_err(|error| format!("Falha ao copiar mensagem: {error}"))?;
        }
        "move" => {
            let explicit_mailbox = operation
                .payload
                .get("targetMailbox")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty());

            let mailbox = if let Some(mailbox) = explicit_mailbox {
                mailbox
            } else {
                let target = operation
                    .payload
                    .get("target")
                    .and_then(|value| value.as_str())
                    .unwrap_or("archive");
                match target {
                    "archive" => folders.archive.as_deref().unwrap_or("Archive"),
                    "trash" => folders.trash.as_deref().unwrap_or("Trash"),
                    "spam" => folders.junk.as_deref().unwrap_or("Junk"),
                    "inbox" => "INBOX",
                    _ => return Err("Destino IMAP não suportado.".to_string()),
                }
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

fn validate_folder_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
        return Err("Nome de pasta inválido.".to_string());
    }
    Ok(value.to_string())
}

pub fn create_folder(account: &AccountProfile, name: &str) -> Result<(), String> {
    let name = validate_folder_name(name)?;
    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let result = session
            .create(&name)
            .await
            .map_err(|error| format!("Falha ao criar pasta: {error}"));
        let logout = session.logout().await.map_err(|error| error.to_string());
        result?;
        logout?;
        Ok(())
    })
}

pub fn rename_folder(account: &AccountProfile, from: &str, to: &str) -> Result<(), String> {
    let from = validate_folder_name(from)?;
    let to = validate_folder_name(to)?;
    if from.eq_ignore_ascii_case("INBOX") {
        return Err("A Caixa de entrada não pode ser renomeada pelo Seven Mail.".to_string());
    }

    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let result = session
            .rename(&from, &to)
            .await
            .map_err(|error| format!("Falha ao renomear pasta: {error}"));
        let logout = session.logout().await.map_err(|error| error.to_string());
        result?;
        logout?;
        Ok(())
    })
}

pub fn delete_folder(account: &AccountProfile, path: &str) -> Result<(), String> {
    let path = validate_folder_name(path)?;
    if path.eq_ignore_ascii_case("INBOX") {
        return Err("A Caixa de entrada não pode ser excluída.".to_string());
    }

    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let result = session
            .delete(&path)
            .await
            .map_err(|error| format!("Falha ao excluir pasta: {error}"));
        let logout = session.logout().await.map_err(|error| error.to_string());
        result?;
        logout?;
        Ok(())
    })
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

        let folders = special_folders(&mut session).await.unwrap_or_default();
        let mut applied = 0usize;
        let mut current = Some(first);

        while let Some(operation) = current {
            let source_mailbox = operation
                .payload
                .get("mailbox")
                .and_then(|value| value.as_str())
                .unwrap_or("INBOX");

            if let Err(error) = session.select(source_mailbox).await {
                storage::retry_later(paths, &operation.id)?;
                let _ = session.logout().await;
                return Err(format!("Não foi possível abrir {source_mailbox} para sincronizar a ação: {error}"));
            }

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

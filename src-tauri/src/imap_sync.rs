use crate::{
    credentials,
    models::{AccountProfile, MailAddress, MailFolder, MailMessage},
    oauth,
    providers,
    storage::{self, AppPaths},
};
use async_imap::{extensions::idle::IdleResponse, types::{Flag, NameAttribute}, Client};
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
    #[cfg(test)]
    let connector = if std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1") {
        // GreenMail uses an ephemeral self-signed certificate in CI.
        // This code is not present in production builds.
        connector
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
    } else {
        connector
    };

    if settings.imap_security_mode.eq_ignore_ascii_case("starttls") {
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
    uid_validity: u32,
) -> Option<MailMessage> {
    let raw = fetch.body()?;
    let parsed = MessageParser::default().parse(raw)?;

    let uid = fetch.uid?;
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
        id: remote_message_id(&account.id, remote_folder, uid_validity, uid),
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
        source_format: None,
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
    if !account.can("read") {
        return Err("A conta compartilhada não possui permissão de leitura.".to_string());
    }
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
        let password = credentials::load(account.credential_account_id())?;
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

#[cfg(test)]
pub fn test_find_subject(
    account: &AccountProfile,
    mailbox: &str,
    subject: &str,
) -> Result<bool, String> {
    async_std::task::block_on(async {
        let mut session = login(account).await?;
        session
            .select(mailbox)
            .await
            .map_err(|error| format!("Não foi possível abrir {mailbox}: {error}"))?;

        let safe_subject = subject.replace('\\', "\\\\").replace('"', "\\\"");
        let query = format!("SUBJECT \"{safe_subject}\"");
        let matches = session
            .uid_search(query)
            .await
            .map_err(|error| format!("Falha ao procurar assunto em {mailbox}: {error}"))?;

        session.logout().await.map_err(|error| error.to_string())?;
        Ok(!matches.is_empty())
    })
}

pub(crate) fn remote_message_id(account_id: &str, folder: &str, validity: u32, uid: u32) -> String {
    let folder_key = if folder.eq_ignore_ascii_case("INBOX") {
        "inbox".to_string()
    } else {
        mailbox_key(folder)
    };
    format!("{account_id}-{folder_key}-v{validity}-{uid}")
}

fn validated_uid_validity(value: Option<u32>) -> Result<u32, String> {
    value.filter(|value| *value != 0)
        .ok_or_else(|| "O servidor IMAP não informou UIDVALIDITY válido.".to_string())
}

fn action_matches_generation(
    operation: &crate::models::QueueOperation,
    folder: &str,
    validity: u32,
) -> bool {
    let uid = operation.payload.get("remoteId").and_then(|value| value.as_str())
        .and_then(|value| value.parse::<u32>().ok()).filter(|value| *value != 0);
    let Some(uid) = uid else { return false; };
    let expected = remote_message_id(&operation.account_id, folder, validity, uid);
    operation.payload.get("messageId").and_then(|value| value.as_str()) == Some(expected.as_str())
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

    // Some IMAP servers do not advertise RFC 6154 SPECIAL-USE flags.
    // Infer common folder names so Sent/Drafts/etc. remain functional.
    let leaf = path
        .rsplit(['/', '.'])
        .next()
        .unwrap_or(path)
        .trim()
        .to_ascii_lowercase();
    if matches!(leaf.as_str(), "sent" | "sent mail" | "sent messages" | "sent items" | "enviados") {
        return ("Enviados".into(), "sent".into());
    }
    if matches!(leaf.as_str(), "drafts" | "draft" | "rascunhos") {
        return ("Rascunhos".into(), "drafts".into());
    }
    if matches!(leaf.as_str(), "junk" | "spam" | "lixo eletrônico" | "lixo eletronico") {
        return ("Spam".into(), "spam".into());
    }
    if matches!(leaf.as_str(), "trash" | "deleted items" | "lixeira") {
        return ("Lixeira".into(), "trash".into());
    }

    (path.to_owned(), "custom".into())
}

pub fn wait_for_folder_change(
    account: &AccountProfile,
    mailbox: &str,
    timeout_seconds: u64,
) -> Result<bool, String> {
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        return Ok(false);
    }
    if mailbox.trim().is_empty() {
        return Err("Pasta IMAP inválida para monitoramento.".to_string());
    }

    async_std::task::block_on(async {
        let timeout = std::time::Duration::from_secs(timeout_seconds.clamp(5, 60));
        let mut session = login(account).await?;
        session
            .select(mailbox)
            .await
            .map_err(|error| format!("Não foi possível abrir {mailbox} para IDLE: {error}"))?;

        let capabilities = session
            .capabilities()
            .await
            .map_err(|error| format!("Falha ao consultar recursos IMAP: {error}"))?;
        if !capabilities.has_str("IDLE") {
            session.logout().await.map_err(|error| error.to_string())?;
            // Preserve a bounded polling cadence on servers without IDLE
            // instead of reconnecting in a tight loop.
            async_std::task::sleep(timeout).await;
            return Ok(false);
        }

        let mut idle = session.idle();
        idle.init()
            .await
            .map_err(|error| format!("Servidor recusou IMAP IDLE em {mailbox}: {error}"))?;
        let (wait, _interrupt) = idle.wait_with_timeout(timeout);
        let outcome = wait
            .await
            .map_err(|error| format!("IMAP IDLE falhou em {mailbox}: {error}"))?;
        let changed = matches!(outcome, IdleResponse::NewData(_));
        let mut session = idle.done()
            .await
            .map_err(|error| format!("Falha ao encerrar IMAP IDLE em {mailbox}: {error}"))?;
        session.logout().await.map_err(|error| error.to_string())?;
        Ok(changed)
    })
}

fn provider_saves_sent_automatically(account: &AccountProfile) -> bool {
    matches!(account.provider.to_ascii_lowercase().as_str(), "gmail" | "microsoft")
}

fn header_search_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn ensure_sent_copy(
    paths: &AppPaths,
    account: &AccountProfile,
    operation_id: &str,
    raw: &[u8],
    limit: u32,
) -> Result<Option<MailFolder>, String> {
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        return Ok(None);
    }

    let folders = list_folders(account)?;
    let Some(sent_folder) = folders.into_iter().find(|folder| folder.role == "sent") else {
        return Err("O servidor IMAP não informou uma pasta de Enviados.".to_string());
    };
    let sent_path = sent_folder.path.clone();
    let operation_value = header_search_value(operation_id);

    let found = async_std::task::block_on(async {
        let mut session = login(account).await?;
        session
            .select(&sent_path)
            .await
            .map_err(|error| format!("Não foi possível abrir Enviados ({sent_path}): {error}"))?;

        let attempts = if provider_saves_sent_automatically(account) { 8 } else { 2 };
        let mut present = false;
        for attempt in 0..attempts {
            let query = format!("HEADER X-Seven-Mail-Operation-ID \"{operation_value}\"");
            let matches = session
                .uid_search(query)
                .await
                .map_err(|error| format!("Falha ao confirmar cópia em Enviados: {error}"))?;
            if !matches.is_empty() {
                present = true;
                break;
            }
            if attempt + 1 < attempts {
                async_std::task::sleep(std::time::Duration::from_millis(500)).await;
            }
        }

        if !present && !provider_saves_sent_automatically(account) {
            session
                .append(&sent_path, None, None, raw)
                .await
                .map_err(|error| format!("SMTP aceitou a mensagem, mas não foi possível salvar a cópia em Enviados: {error}"))?;
            present = true;
        }

        session.logout().await.map_err(|error| error.to_string())?;
        Ok::<bool, String>(present)
    })?;

    // Even for providers that save the sent copy themselves, always refresh
    // the authoritative remote folder immediately after SMTP acceptance.
    let _ = sync_folder(paths, account, &sent_folder.path, &sent_folder.name, limit.clamp(1, 200))?;

    if !found && provider_saves_sent_automatically(account) {
        return Err("SMTP aceitou a mensagem, mas a cópia ainda não apareceu na pasta Enviados do provedor.".to_string());
    }

    Ok(Some(sent_folder))
}

pub fn append_raw_message(account: &AccountProfile, mailbox: &str, raw: &[u8]) -> Result<(), String> {
    if account.incoming_protocol.eq_ignore_ascii_case("pop3") {
        return Err("A conta de destino usa POP3 e não oferece APPEND para receber mensagens.".to_string());
    }
    if mailbox.trim().is_empty() {
        return Err("A pasta de destino é inválida.".to_string());
    }

    async_std::task::block_on(async {
        let mut session = login(account).await?;
        session
            .append(mailbox, None, None, raw)
            .await
            .map_err(|error| format!("Falha ao anexar mensagem na conta de destino: {error}"))?;
        session.logout().await.map_err(|error| error.to_string())?;
        Ok(())
    })
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

fn missing_uid_batch(
    remote: &std::collections::HashSet<u32>,
    cached: &[u32],
    limit: usize,
) -> Vec<u32> {
    let cached_set = cached.iter().copied().collect::<std::collections::HashSet<_>>();
    let mut missing = remote
        .iter()
        .copied()
        .filter(|uid| !cached_set.contains(uid))
        .collect::<Vec<_>>();
    missing.sort_unstable();
    // Show recent mail first on a fresh installation. On subsequent passes
    // drain the oldest missing UIDs so newer arrivals cannot starve the backlog.
    if cached.is_empty() && missing.len() > limit {
        missing = missing.split_off(missing.len() - limit);
    } else {
        missing.truncate(limit);
    }
    missing
}

pub fn sync_folder(
    paths: &AppPaths,
    account: &AccountProfile,
    remote_folder: &str,
    folder_label: &str,
    limit: u32,
) -> Result<usize, String> {
    let limit = limit.clamp(1, 200);
    static SYNC_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SYNC_LOCK.lock().map_err(|_| "Falha ao bloquear sincronização IMAP.".to_string())?;

    async_std::task::block_on(async {
        let mut session = login(account).await?;
        let mailbox = session
            .select(remote_folder)
            .await
            .map_err(|error| format!("Não foi possível abrir {remote_folder}: {error}"))?;

        let uid_validity = validated_uid_validity(mailbox.uid_validity)?;
        storage::prepare_imap_generation(paths, &account.id, remote_folder, uid_validity)?;

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
        // The persisted cache is the set of completed UIDs, not a high-water
        // mark. Missing older UIDs must remain eligible after every batch.
        let wanted = missing_uid_batch(&remote_uids, &cached_uids, limit as usize);

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
                if let Some(message) = parse_message(account, item, remote_folder, folder_label, uid_validity) {
                    // Write the raw source first: a failed write must not
                    // publish a cached UID whose original message is missing.
                    if let Some(raw) = item.body() {
                        storage::cache_raw_message(paths, &message.account_id, &message.id, raw)?;
                    }
                    storage::cache_message(paths, &message)?;
                    cached += 1;
                }
            }
        }

        // Refresh every cached UID in bounded requests, including old mail.
        let existing = cached_uids
            .into_iter()
            .filter(|uid| remote_uids.contains(uid))
            .collect::<Vec<_>>();
        for batch in existing.chunks(limit as usize) {
            let sequence = batch.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
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

            let mailbox = match session.select(source_mailbox).await {
                Ok(mailbox) => mailbox,
                Err(error) => {
                    storage::retry_later(paths, &operation.id)?;
                    let _ = session.logout().await;
                    return Err(format!("Não foi possível abrir {source_mailbox} para sincronizar a ação: {error}"));
                }
            };
            let validity = match validated_uid_validity(mailbox.uid_validity) {
                Ok(validity) => validity,
                Err(error) => {
                    storage::retry_later(paths, &operation.id)?;
                    return Err(error);
                }
            };
            if !action_matches_generation(&operation, source_mailbox, validity) {
                // Legacy or stale actions must never affect a reused UID.
                storage::fail(paths, &operation.id)?;
                let _ = session.logout().await;
                return Err("A ação IMAP foi preservada na fila de falhas: identidade da mensagem não confirmada. Sincronize a pasta novamente.".to_string());
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

#[cfg(test)]
mod uid_batch_tests {
    use super::missing_uid_batch;
    use std::collections::HashSet;

    #[test]
    fn catches_up_after_more_than_two_hundred_arrivals() {
        let remote: HashSet<u32> = (1..=501).collect();
        let mut cached = vec![1];
        for expected in [200, 200, 100, 0] {
            let batch = missing_uid_batch(&remote, &cached, 200);
            assert_eq!(batch.len(), expected);
            cached.extend(batch);
        }
        assert_eq!(cached.into_iter().collect::<HashSet<_>>(), remote);
    }

    #[test]
    fn initial_recent_batch_does_not_lose_older_mail() {
        let remote: HashSet<u32> = (1..=500).collect();
        let mut cached = missing_uid_batch(&remote, &[], 200);
        assert_eq!(cached.first(), Some(&301));
        cached.extend(missing_uid_batch(&remote, &cached, 200));
        cached.extend(missing_uid_batch(&remote, &cached, 200));
        assert_eq!(cached.into_iter().collect::<HashSet<_>>(), remote);
    }

    #[test]
    fn repairs_existing_uid_gaps() {
        let remote = HashSet::from([1, 2, 3, 4, 5, 6]);
        assert_eq!(missing_uid_batch(&remote, &[1, 3, 6], 2), vec![2, 4]);
    }
}

#[cfg(test)]
mod generation_tests {
    use super::*;

    #[test]
    fn recreated_mailbox_cannot_reuse_local_message_identity() {
        assert_ne!(remote_message_id("account", "INBOX", 11, 1), remote_message_id("account", "INBOX", 12, 1));
        assert_eq!(remote_message_id("account", "INBOX", 11, 1), remote_message_id("account", "inbox", 11, 1));
        assert!(validated_uid_validity(None).is_err());
        assert!(validated_uid_validity(Some(0)).is_err());
    }

    #[test]
    fn only_actions_from_current_mailbox_generation_can_execute() {
        let mut operation = crate::models::QueueOperation {
            id: "op".into(), kind: "move".into(), account_id: "account".into(),
            created_at: String::new(), attempts: 0,
            payload: serde_json::json!({"remoteId": "1", "messageId": remote_message_id("account", "INBOX", 11, 1)}),
        };
        assert!(action_matches_generation(&operation, "INBOX", 11));
        assert!(!action_matches_generation(&operation, "INBOX", 12));
        assert!(!action_matches_generation(&operation, "Other", 11));
        operation.payload.as_object_mut().unwrap().remove("messageId");
        assert!(!action_matches_generation(&operation, "INBOX", 11));
    }
}

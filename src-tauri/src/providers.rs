use crate::{
    credentials,
    local_crypto,
    models::{AccountProfile, ProviderSettings, QueueOperation, QueuedAttachment},
    oauth,
    smime,
    storage::AppPaths,
};
use lettre::{
    address::Envelope,
    message::{header::{ContentType, HeaderName, HeaderValue}, Attachment, Mailbox, MessageBuilder, MultiPart, SinglePart},
    transport::smtp::authentication::{Credentials, Mechanism},
    Address, Message, SmtpTransport, Transport,
};
use std::{fs, net::IpAddr, time::Duration};
use base64::Engine as _;

// Convert bounded raster data URLs into real MIME inline attachments. Outlook
// and other clients do not reliably render data URLs in delivered mail.
fn embed_signature_images(html: &str) -> Result<(String, Vec<SinglePart>), String> {
    static IMAGE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r#"(?i)(<img\b[^>]*?\bsrc\s*=\s*["'])data:image/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})(["'])"#).expect("static image regex")
    });
    let mut output=String::with_capacity(html.len());
    let mut parts=Vec::new();
    let mut cursor=0;
    let mut total=0usize;
    for capture in IMAGE.captures_iter(html) {
        let matched=capture.get(0).expect("whole match");
        let encoded=&capture[3];
        if encoded.len()>699_056 || parts.len()>=8 {return Err("Imagem da assinatura excede o limite.".into());}
        let bytes=base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Imagem da assinatura inválida.".to_string())?;
        let kind=capture[2].to_ascii_lowercase();
        let valid=match kind.as_str() {
            "png"=>bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "jpeg"=>bytes.starts_with(b"\xff\xd8\xff"),
            "gif"=>bytes.starts_with(b"GIF87a")||bytes.starts_with(b"GIF89a"),
            _=>false,
        };
        total=total.saturating_add(bytes.len());
        if !valid||bytes.len()>512*1024||total>2*1024*1024{return Err("Imagem da assinatura inválida ou muito grande.".into());}
        let cid=format!("seven-signature-{}@seven-mail.local",uuid::Uuid::new_v4());
        let mime:ContentType=format!("image/{kind}").parse().map_err(|error|format!("MIME inválido: {error}"))?;
        parts.push(Attachment::new_inline(cid.clone()).body(bytes,mime));
        output.push_str(&html[cursor..matched.start()]);
        output.push_str(&format!("{}cid:{}{}",&capture[1],cid,&capture[4]));
        cursor=matched.end();
    }
    output.push_str(&html[cursor..]);
    Ok((output,parts))
}

pub fn discover(email: &str) -> ProviderSettings {
    let domain = email
        .rsplit_once('@')
        .map(|(_, domain)| domain.to_ascii_lowercase())
        .unwrap_or_default();

    match domain.as_str() {
        "gmail.com" | "googlemail.com" => ProviderSettings {
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            pop3_host: Some("pop.gmail.com".into()),
            pop3_port: Some(995),
            pop3_security_mode: Some("tls".into()),
            smtp_host: "smtp.gmail.com".into(),
            smtp_port: 465,
            security_mode: "tls".into(),
            imap_security_mode: "tls".into(),
            smtp_security_mode: "tls".into(),
        },
        "outlook.com" | "hotmail.com" | "live.com" | "office365.com" => ProviderSettings {
            imap_host: "outlook.office365.com".into(),
            imap_port: 993,
            pop3_host: Some("outlook.office365.com".into()),
            pop3_port: Some(995),
            pop3_security_mode: Some("tls".into()),
            smtp_host: "smtp.office365.com".into(),
            smtp_port: 587,
            security_mode: "starttls".into(),
            imap_security_mode: "tls".into(),
            smtp_security_mode: "starttls".into(),
        },
        "yahoo.com" | "yahoo.com.br" => ProviderSettings {
            imap_host: "imap.mail.yahoo.com".into(),
            imap_port: 993,
            pop3_host: Some("pop.mail.yahoo.com".into()),
            pop3_port: Some(995),
            pop3_security_mode: Some("tls".into()),
            smtp_host: "smtp.mail.yahoo.com".into(),
            smtp_port: 465,
            security_mode: "tls".into(),
            imap_security_mode: "tls".into(),
            smtp_security_mode: "tls".into(),
        },
        "icloud.com" | "me.com" | "mac.com" => ProviderSettings {
            imap_host: "imap.mail.me.com".into(),
            imap_port: 993,
            pop3_host: None,
            pop3_port: None,
            pop3_security_mode: None,
            smtp_host: "smtp.mail.me.com".into(),
            smtp_port: 587,
            security_mode: "starttls".into(),
            imap_security_mode: "tls".into(),
            smtp_security_mode: "starttls".into(),
        },
        _ => ProviderSettings {
            imap_host: format!("imap.{domain}"),
            imap_port: 993,
            pop3_host: Some(format!("pop.{domain}")),
            pop3_port: Some(995),
            pop3_security_mode: Some("tls".into()),
            smtp_host: format!("smtp.{domain}"),
            smtp_port: 465,
            security_mode: "tls".into(),
            imap_security_mode: "tls".into(),
            smtp_security_mode: "tls".into(),
        },
    }
}

pub fn settings_for(account: &AccountProfile) -> ProviderSettings {
    let discovered = discover(&account.email);
    let imap_host = account.imap_host.clone().unwrap_or_else(|| discovered.imap_host.clone());
    let imap_port = account.imap_port.unwrap_or(discovered.imap_port);
    let smtp_host = account.smtp_host.clone().unwrap_or_else(|| discovered.smtp_host.clone());
    let smtp_port = account.smtp_port.unwrap_or(discovered.smtp_port);

    // Migrate legacy accounts safely. Older Seven Mail builds stored a single
    // security mode for both protocols. IMAP 993 is implicit TLS even when
    // SMTP 587 for the same provider requires STARTTLS.
    let imap_security_mode = account.imap_security_mode.clone().unwrap_or_else(|| {
        match account.security_mode.as_deref() {
            Some(mode) if mode.eq_ignore_ascii_case("plain") => discovered.imap_security_mode.clone(),
            Some(mode) if imap_port == 993 && mode.eq_ignore_ascii_case("starttls") => "tls".to_string(),
            Some(mode) => mode.to_string(),
            None => discovered.imap_security_mode.clone(),
        }
    });
    let smtp_security_mode = account.smtp_security_mode.clone().unwrap_or_else(|| {
        account
            .security_mode
            .clone()
            .unwrap_or_else(|| discovered.smtp_security_mode.clone())
    });
    let security_mode = account
        .security_mode
        .clone()
        .unwrap_or_else(|| smtp_security_mode.clone());

    let pop3_host = account.pop3_host.clone().or_else(|| discovered.pop3_host.clone());
    let pop3_port = account.pop3_port.or(discovered.pop3_port);
    let pop3_security_mode = account.pop3_security_mode.clone().or_else(|| {
        match (pop3_port, account.security_mode.as_deref()) {
            // Same migration rule as IMAP: old profiles sometimes inherited
            // SMTP STARTTLS even though POP3S on 995 is implicit TLS.
            (_, Some(mode)) if mode.eq_ignore_ascii_case("plain") => discovered.pop3_security_mode.clone(),
            (Some(995), Some(mode)) if mode.eq_ignore_ascii_case("starttls") => Some("tls".to_string()),
            (_, Some(mode)) => Some(mode.to_string()),
            _ => discovered.pop3_security_mode.clone(),
        }
    });

    ProviderSettings {
        imap_host,
        imap_port,
        pop3_host,
        pop3_port,
        pop3_security_mode,
        smtp_host,
        smtp_port,
        security_mode,
        imap_security_mode,
        smtp_security_mode,
    }
}

// Allow user-configured SMTP hostnames and IPs when plaintext is explicitly
// selected. Never infer plaintext from the port or downgrade a failed TLS connection.
fn plaintext_smtp_host_allowed(host: &str) -> bool {
    let host = host.trim();
    let host = host.strip_prefix('[').and_then(|value| value.strip_suffix(']')).unwrap_or(host);
    if let Ok(ip) = host.parse::<IpAddr>() {
        return !ip.is_unspecified() && !ip.is_multicast()
            && ip != IpAddr::V4(std::net::Ipv4Addr::BROADCAST);
    }
    let name = host.strip_suffix('.').unwrap_or(host);
    !name.is_empty() && name.len() <= 253 && name.split('.').all(|label| {
        !label.is_empty() && label.len() <= 63
            && !label.starts_with('-') && !label.ends_with('-')
            && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn smtp_transport(account: &AccountProfile) -> Result<SmtpTransport, String> {
    if !account.can("send") {
        return Err("A conta compartilhada não possui permissão de envio.".to_string());
    }
    let settings = settings_for(account);
    let mode = settings.smtp_security_mode.to_ascii_lowercase();
    if mode == "plain" {
        if !plaintext_smtp_host_allowed(&settings.smtp_host) {
            return Err("Servidor SMTP inválido. Informe um nome de domínio ou endereço IP, sem URL, caminho ou porta.".to_string());
        }
        if account.oauth_enabled {
            return Err("SMTP com OAuth exige TLS para proteger o token de acesso.".to_string());
        }
    }
    let username = account.username.clone().unwrap_or_else(|| account.email.clone());
    let secret = if account.oauth_enabled {
        oauth::access_token(account)?
    } else {
        credentials::load(account.credential_account_id())?
    };
    let credentials = Credentials::new(username, secret);

    let builder = if mode == "plain" {
        let host = settings.smtp_host.trim();
        let host = host.strip_prefix('[').and_then(|value| value.strip_suffix(']')).unwrap_or(host);
        SmtpTransport::builder_dangerous(host)
    } else if mode == "starttls" {
        SmtpTransport::starttls_relay(&settings.smtp_host)
            .map_err(|error| error.to_string())?
    } else {
        SmtpTransport::relay(&settings.smtp_host)
            .map_err(|error| error.to_string())?
    }
    .port(settings.smtp_port)
    .credentials(credentials)
    .authentication(if account.oauth_enabled { vec![Mechanism::Xoauth2] } else { vec![Mechanism::Plain, Mechanism::Login] })
    .timeout(Some(Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300))));

    Ok(builder.build())
}

pub fn test_smtp(account: &AccountProfile) -> Result<bool, String> {
    smtp_transport(account)?
        .test_connection()
        .map_err(|error| error.to_string())
}

fn add_recipients(
    mut builder: MessageBuilder,
    raw: &str,
    field: &str,
) -> Result<(MessageBuilder, usize), String> {
    let mut count = 0usize;

    for item in raw.split([',', ';']) {
        let value = item.trim();
        if value.is_empty() {
            continue;
        }

        let mailbox: Mailbox = value
            .parse()
            .map_err(|error| format!("Destinatário inválido ({value}): {error}"))?;

        builder = match field {
            "cc" => builder.cc(mailbox),
            "bcc" => builder.bcc(mailbox),
            _ => builder.to(mailbox),
        };
        count += 1;
    }

    Ok((builder, count))
}

fn recipient_emails(values: &[&str]) -> Vec<String> {
    let mut result = Vec::new();
    for raw in values {
        for item in raw.split([',', ';']) {
            let value = item.trim();
            if value.is_empty() {
                continue;
            }
            let email = if let (Some(start), Some(end)) = (value.rfind('<'), value.rfind('>')) {
                if end > start { value[start + 1..end].trim() } else { value }
            } else {
                value
            };
            if email.contains('@') && !result.iter().any(|existing: &String| existing.eq_ignore_ascii_case(email)) {
                result.push(email.to_string());
            }
        }
    }
    result
}

fn attachment_mime(name: &str) -> &'static str {
    let extension = name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("txt") => "text/plain",
        Some("csv") => "text/csv",
        Some("html" | "htm") => "text/html",
        Some("json") => "application/json",
        Some("xml") => "application/xml",
        Some("zip") => "application/zip",
        Some("7z") => "application/x-7z-compressed",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

const MAX_SMTP_ATTACHMENT_BYTES: u64 = 250 * 1024 * 1024;
const MAX_SMTP_TOTAL_ATTACHMENT_BYTES: u64 = 500 * 1024 * 1024;
const MAX_SMTP_ATTACHMENT_COUNT: usize = 256;

fn validate_attachment_count(count: usize) -> Result<(), String> {
    if count > MAX_SMTP_ATTACHMENT_COUNT {
        return Err("Quantidade de anexos excede o limite de 256 arquivos.".into());
    }
    Ok(())
}

fn attachment_budget(used: u64) -> Result<u64, String> {
    MAX_SMTP_TOTAL_ATTACHMENT_BYTES.checked_sub(used)
        .map(|remaining| remaining.min(MAX_SMTP_ATTACHMENT_BYTES))
        .ok_or_else(|| "Total de anexos excede o limite de 500 MiB.".into())
}

fn read_staged_mail_file(
    path: &str,
    expected_operation: Option<&str>,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let paths = AppPaths::resolve()?;
    crate::storage::staging_directory(&paths.queue_attachments)?;
    let root = paths.queue_attachments.canonicalize().map_err(|error| error.to_string())?;
    let candidate = std::path::Path::new(path);
    let parent = candidate.parent().ok_or_else(|| "Caminho de anexo inválido.".to_string())?;
    crate::storage::staging_directory(parent)?;
    let metadata = fs::symlink_metadata(candidate).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Anexo não é um arquivo regular.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Anexo contém ponto de reanálise.".into());
        }
    }
    let canonical = candidate.canonicalize().map_err(|error| error.to_string())?;
    let relative = canonical.strip_prefix(&root)
        .map_err(|_| "Arquivo fora da área de anexos da fila.".to_string())?;
    let components = relative.components().collect::<Vec<_>>();
    if components.len() != 2 || !components.iter().all(|component| matches!(component, std::path::Component::Normal(_))) {
        return Err("Caminho de anexo inválido.".into());
    }
    if let Some(operation) = expected_operation {
        if components[0].as_os_str() != std::ffi::OsStr::new(operation) {
            return Err("A fonte não pertence à operação de redirecionamento.".into());
        }
    }
    if metadata.len() > max_bytes + 1024 {
        return Err("Arquivo da fila excede o limite de tamanho.".into());
    }
    use std::io::Read;
    let file = fs::File::open(&canonical).map_err(|error| error.to_string())?;
    let mut encrypted = Vec::new();
    file.take(max_bytes + 1025).read_to_end(&mut encrypted).map_err(|error| error.to_string())?;
    if encrypted.len() as u64 > max_bytes + 1024 || !local_crypto::is_encrypted(&encrypted) {
        return Err("Arquivo de fila inválido ou não criptografado.".into());
    }
    let bytes = local_crypto::decrypt_or_plain(&encrypted)?;
    if bytes.len() as u64 > max_bytes {
        return Err("Arquivo da fila excede o limite de tamanho.".into());
    }
    Ok(bytes)
}

fn redirect_queued(
    account: &AccountProfile,
    operation: &QueueOperation,
    before_submission: impl FnOnce() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    if !account.can("send") {
        return Err("A conta não possui permissão de envio.".to_string());
    }
    let target = operation.payload.get("to").and_then(|value| value.as_str()).unwrap_or("").trim();
    let source_path = operation.payload.get("sourcePath").and_then(|value| value.as_str()).unwrap_or("").trim();
    if target.is_empty() || source_path.is_empty() {
        return Err("Redirecionamento sem destino ou mensagem de origem.".to_string());
    }

    let recipient: Address = target
        .parse()
        .map_err(|error| format!("Destinatário de redirecionamento inválido: {error}"))?;
    let envelope_from: Address = account.email
        .parse()
        .map_err(|error| format!("Remetente de envelope inválido: {error}"))?;
    let envelope = Envelope::new(Some(envelope_from), vec![recipient.clone()])
        .map_err(|error| format!("Envelope SMTP inválido: {error}"))?;

    let original = read_staged_mail_file(source_path, Some(&operation.id), 64 * 1024 * 1024)
        .map_err(|error| format!("Não foi possível ler a mensagem a redirecionar: {error}"))?;
    let resent = format!(
        "Resent-Date: {}\r\nResent-From: {}\r\nResent-To: {}\r\n",
        chrono::Utc::now().to_rfc2822(),
        account.email,
        recipient
    );
    let mut raw = resent.into_bytes();
    raw.extend_from_slice(&original);

    let transport = smtp_transport(account)?;
    before_submission()?;
    transport
        .send_raw(&envelope, &raw)
        .map_err(|error| format!("Falha ao redirecionar mensagem: {error}"))?;
    Ok(raw)
}

#[cfg(test)]
pub fn send_queued_raw(account: &AccountProfile, operation: &QueueOperation) -> Result<Vec<u8>, String> {
    send_queued_raw_with_checkpoint(account, operation, || Ok(()))
}

pub fn send_queued_raw_with_checkpoint(
    account: &AccountProfile,
    operation: &QueueOperation,
    before_submission: impl FnOnce() -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    if operation.kind == "redirect" {
        return redirect_queued(account, operation, before_submission);
    }
    if operation.kind != "send" {
        return Err("Operação de fila não é um envio SMTP.".to_string());
    }

    let to = operation
        .payload
        .get("to")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let cc = operation
        .payload
        .get("cc")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let bcc = operation
        .payload
        .get("bcc")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let subject = operation
        .payload
        .get("subject")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let from_address_raw = operation
        .payload
        .get("fromAddress")
        .and_then(|value| value.as_str())
        .unwrap_or(&account.email);
    let allowed_from = std::iter::once(account.email.as_str())
        .chain(account.aliases.iter().map(String::as_str))
        .any(|value| value.eq_ignore_ascii_case(from_address_raw));
    if !allowed_from {
        return Err("Endereço remetente não pertence à conta nem aos aliases configurados.".to_string());
    }
    let priority = operation
        .payload
        .get("priority")
        .and_then(|value| value.as_str())
        .unwrap_or("normal");
    let request_read_receipt = operation
        .payload
        .get("requestReadReceipt")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let request_delivery_receipt = operation
        .payload
        .get("requestDeliveryReceipt")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let disallow_reactions = operation
        .payload
        .get("disallowReactions")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let body_text = operation
        .payload
        .get("bodyText")
        .and_then(|value| value.as_str())
        .or_else(|| operation.payload.get("body").and_then(|value| value.as_str()))
        .unwrap_or("");
    let body_html = operation
        .payload
        .get("bodyHtml")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    let calendar_ics = operation
        .payload
        .get("calendarIcs")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let calendar_method = operation
        .payload
        .get("calendarMethod")
        .and_then(|value| value.as_str())
        .unwrap_or("REQUEST")
        .to_ascii_uppercase();

    let attachments: Vec<QueuedAttachment> = operation
        .payload
        .get("attachments")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Lista de anexos inválida: {error}"))?
        .unwrap_or_default();

    let from_address = from_address_raw
        .parse()
        .map_err(|error| format!("Remetente inválido: {error}"))?;
    let from = Mailbox::new(Some(account.display_name.clone()), from_address);

    let raw_header = |name: &'static str, value: String| {
        HeaderValue::new(HeaderName::new_from_ascii_str(name), value)
    };
    let mut builder = Message::builder()
        .from(from)
        .subject(subject)
        .raw_header(raw_header("X-Seven-Mail-Operation-ID", operation.id.clone()));
    if account.is_shared_mailbox && account.send_mode.as_deref() == Some("on-behalf") {
        let owner_email = account
            .shared_owner_email
            .as_deref()
            .ok_or_else(|| "Conta proprietária ausente para envio em nome de.".to_string())?;
        let sender_address = owner_email
            .parse()
            .map_err(|error| format!("Remetente delegante inválido: {error}"))?;
        builder = builder.sender(Mailbox::new(None, sender_address));
    }
    match priority {
        "high" => {
            builder = builder
                .raw_header(raw_header("X-Priority", "1".to_string()))
                .raw_header(raw_header("Importance", "high".to_string()));
        }
        "low" => {
            builder = builder
                .raw_header(raw_header("X-Priority", "5".to_string()))
                .raw_header(raw_header("Importance", "low".to_string()));
        }
        _ => {}
    }
    if request_read_receipt {
        builder = builder.raw_header(raw_header("Disposition-Notification-To", from_address_raw.to_string()));
    }
    if request_delivery_receipt {
        builder = builder.raw_header(raw_header("Return-Receipt-To", from_address_raw.to_string()));
    }
    if disallow_reactions {
        builder = builder.raw_header(raw_header("x-ms-reactions", "disallow".to_string()));
    }
    let (builder, to_count) = add_recipients(builder, to, "to")?;
    let (builder, cc_count) = add_recipients(builder, cc, "cc")?;
    let (builder, bcc_count) = add_recipients(builder, bcc, "bcc")?;

    if to_count + cc_count + bcc_count == 0 {
        return Err("Informe pelo menos um destinatário válido.".to_string());
    }

    let (body_html,signature_images)=embed_signature_images(body_html)?;
    let mut body_part = if body_html.trim().is_empty() {
        MultiPart::alternative().singlepart(SinglePart::plain(body_text.to_owned()))
    } else {
        MultiPart::alternative_plain_html(body_text.to_owned(), body_html.to_owned())
    };

    if !calendar_ics.trim().is_empty() {
        let calendar_type: ContentType = format!(
            "text/calendar; charset=utf-8; method={}",
            calendar_method
        )
        .parse()
        .map_err(|error| format!("MIME de calendário inválido: {error}"))?;
        body_part = body_part.singlepart(
            SinglePart::builder()
                .header(calendar_type)
                .body(calendar_ics.to_owned()),
        );
    }

    validate_attachment_count(attachments.len())?;
    let mut mixed = if signature_images.is_empty() {
        MultiPart::mixed().multipart(body_part)
    } else {
        let mut related=MultiPart::related().multipart(body_part);
        for part in signature_images {related=related.singlepart(part);}
        MultiPart::mixed().multipart(related)
    };
    let mut attachment_bytes = 0u64;
    for attachment in attachments {
        let remaining = attachment_budget(attachment_bytes)?;
        let bytes = read_staged_mail_file(&attachment.path, None, remaining)
            .map_err(|error| format!("Falha ao ler o anexo {}: {error}", attachment.name))?;
        attachment_bytes = attachment_bytes.checked_add(bytes.len() as u64)
            .ok_or_else(|| "Total de anexos inválido.".to_string())?;
        let content_type: ContentType = attachment_mime(&attachment.name)
            .parse()
            .map_err(|error| format!("MIME inválido para {}: {error}", attachment.name))?;
        let part = if attachment.inline {
            Attachment::new_inline(
                attachment.content_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            ).body(bytes, content_type)
        } else {
            Attachment::new(attachment.name).body(bytes, content_type)
        };
        mixed = mixed.singlepart(part);
    }

    let message = builder.multipart(mixed).map_err(|error| error.to_string())?;
    let smime_sign = operation
        .payload
        .get("smimeSign")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let smime_encrypt = operation
        .payload
        .get("smimeEncrypt")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let transport = smtp_transport(account)?;
    let raw = if smime_sign || smime_encrypt {
        let original = message.formatted();
        let recipients = recipient_emails(&[to, cc, bcc]);
        smime::protect_message(
            &AppPaths::resolve()?,
            account,
            &recipients,
            &original,
            smime_sign,
            smime_encrypt,
        )?
    } else {
        message.formatted()
    };

    // Persist the submission boundary before calling the transport.
    before_submission()?;
    transport
        .send_raw(message.envelope(), &raw)
        .map_err(|error| error.to_string())?;

    Ok(raw)
}

#[cfg(test)]
pub fn send_queued(account: &AccountProfile, operation: &QueueOperation) -> Result<(), String> {
    send_queued_raw(account, operation).map(|_| ())
}


pub fn send_email_reaction(
    account: &AccountProfile,
    recipient: &str,
    subject: &str,
    in_reply_to: &str,
    emoji: &str,
) -> Result<(), String> {
    const ALLOWED: &[&str] = &["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏"];
    if !ALLOWED.contains(&emoji) {
        return Err("Reação não suportada pelo Seven Mail.".to_string());
    }
    let in_reply_to = in_reply_to.trim();
    if !in_reply_to.starts_with('<') || !in_reply_to.ends_with('>') {
        return Err("Message-ID original inválido para reação.".to_string());
    }

    let from_address = account.email.parse()
        .map_err(|error| format!("Remetente inválido: {error}"))?;
    let to_mailbox: Mailbox = recipient.parse()
        .map_err(|error| format!("Destinatário da reação inválido: {error}"))?;
    let reaction_type: ContentType = "text/vnd.google.email-reaction+json; charset=utf-8"
        .parse()
        .map_err(|error| format!("MIME de reação inválido: {error}"))?;
    let raw_header = |name: &'static str, value: String| {
        HeaderValue::new(HeaderName::new_from_ascii_str(name), value)
    };

    let plain = format!("{emoji} Reação enviada pelo Seven Mail");
    let html = format!("<p>{emoji} Reação enviada pelo Seven Mail</p>");
    let reaction = serde_json::json!({"version":1,"emoji":emoji}).to_string();
    let body = MultiPart::alternative()
        .singlepart(SinglePart::plain(plain))
        .singlepart(SinglePart::builder().header(reaction_type).body(reaction))
        .singlepart(SinglePart::html(html));

    let message = Message::builder()
        .from(Mailbox::new(Some(account.display_name.clone()), from_address))
        .to(to_mailbox)
        .subject(if subject.to_ascii_lowercase().starts_with("re:") { subject.to_string() } else { format!("Re: {subject}") })
        .raw_header(raw_header("In-Reply-To", in_reply_to.to_string()))
        .raw_header(raw_header("References", in_reply_to.to_string()))
        .multipart(body)
        .map_err(|error| format!("Falha ao montar reação: {error}"))?;

    smtp_transport(account)?
        .send(&message)
        .map_err(|error| format!("Falha ao enviar reação: {error}"))?;
    Ok(())
}


#[cfg(test)]
mod protocol_security_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn microsoft_and_icloud_use_tls_for_imap_and_starttls_for_smtp() {
        for email in ["test@outlook.com", "test@icloud.com"] {
            let settings = discover(email);
            assert_eq!(settings.imap_port, 993);
            assert_eq!(settings.imap_security_mode, "tls");
            assert_eq!(settings.smtp_port, 587);
            assert_eq!(settings.smtp_security_mode, "starttls");
            if email.ends_with("@outlook.com") {
                assert_eq!(settings.pop3_host.as_deref(), Some("outlook.office365.com"));
                assert_eq!(settings.pop3_port, Some(995));
                assert_eq!(settings.pop3_security_mode.as_deref(), Some("tls"));
            } else {
                assert!(settings.pop3_host.is_none(), "iCloud não oferece POP3");
            }
        }
    }

    #[test]
    fn plaintext_smtp_accepts_explicit_hostnames_and_ip_addresses() {
        for host in ["localhost", "127.0.0.1", "10.0.0.20", "192.168.1.10",
            "::1", "[::1]", "fd00::20", "smtp.example.com", "mail.example.com.br",
            "smtp.local", "mailserver", "smtp.example.com.", "203.0.113.10", "2001:db8::10"] {
            assert!(plaintext_smtp_host_allowed(host), "{host}");
        }
        for host in ["", " ", "https://smtp.example.com", "smtp.example.com:587",
            "smtp.example.com/path", "user@smtp.example.com", "bad host", "-smtp.example.com",
            "smtp..example.com", "0.0.0.0", "::", "224.0.0.1", "255.255.255.255"] {
            assert!(!plaintext_smtp_host_allowed(host), "{host}");
        }
    }

    #[test]
    fn plaintext_smtp_does_not_downgrade_incoming_protocols() {
        for profile in [
            json!({"securityMode":"plain"}),
            json!({"securityMode":"tls","smtpSecurityMode":"plain"}),
        ] {
            let mut account = json!({
                "id":"plain", "displayName":"Plain", "email":"test@outlook.com",
                "provider":"microsoft", "color":"#000000", "isDefault":true,
                "imapPort":993, "pop3Port":995, "smtpHost":"192.168.1.10", "smtpPort":25
            });
            account.as_object_mut().unwrap().extend(profile.as_object().unwrap().clone());
            let account: AccountProfile = serde_json::from_value(account).expect("valid account");
            let settings = settings_for(&account);
            assert_eq!(settings.smtp_security_mode, "plain");
            assert_eq!(settings.imap_security_mode, "tls");
            assert_eq!(settings.pop3_security_mode.as_deref(), Some("tls"));
        }
    }

    #[test]
    fn legacy_starttls_account_on_imap_993_is_migrated_to_implicit_tls() {
        let account: AccountProfile = serde_json::from_value(json!({
            "id": "legacy",
            "displayName": "Legacy",
            "email": "test@outlook.com",
            "provider": "microsoft",
            "color": "#000000",
            "isDefault": true,
            "securityMode": "starttls",
            "imapPort": 993,
            "smtpPort": 587
        }))
        .expect("valid account");

        let settings = settings_for(&account);
        assert_eq!(settings.imap_security_mode, "tls");
        assert_eq!(settings.smtp_security_mode, "starttls");
    }
}

#[cfg(test)]
mod smtp_attachment_budget_tests {
    use super::*;

    #[test]
    fn limits_attachment_count_and_actual_total_bytes() {
        assert!(validate_attachment_count(256).is_ok());
        assert!(validate_attachment_count(257).is_err());
        assert_eq!(attachment_budget(0).unwrap(), MAX_SMTP_ATTACHMENT_BYTES);
        assert_eq!(attachment_budget(MAX_SMTP_TOTAL_ATTACHMENT_BYTES - 1).unwrap(), 1);
        assert_eq!(attachment_budget(MAX_SMTP_TOTAL_ATTACHMENT_BYTES).unwrap(), 0);
        assert!(attachment_budget(MAX_SMTP_TOTAL_ATTACHMENT_BYTES + 1).is_err());
    }
}

#[cfg(test)]
mod signature_image_tests {
    use super::*;
    #[test]
    fn inline_signature_image_becomes_cid() {
        let encoded=base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n");
        let (html,parts)=embed_signature_images(&format!("<img src=\"data:image/png;base64,{encoded}\">")).unwrap();
        assert_eq!(parts.len(),1);
        assert!(html.contains("cid:seven-signature-"));
        assert!(!html.contains("data:image"));
        assert!(embed_signature_images("<img src=\"data:image/png;base64,YQ==\">").is_err());
    }
}

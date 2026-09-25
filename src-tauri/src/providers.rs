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
use std::{fs, time::Duration};

pub fn discover(email: &str) -> ProviderSettings {
    let domain = email
        .rsplit_once('@')
        .map(|(_, domain)| domain.to_ascii_lowercase())
        .unwrap_or_default();

    match domain.as_str() {
        "gmail.com" | "googlemail.com" => ProviderSettings {
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            smtp_host: "smtp.gmail.com".into(),
            smtp_port: 465,
            security_mode: "tls".into(),
        },
        "outlook.com" | "hotmail.com" | "live.com" | "office365.com" => ProviderSettings {
            imap_host: "outlook.office365.com".into(),
            imap_port: 993,
            smtp_host: "smtp.office365.com".into(),
            smtp_port: 587,
            security_mode: "starttls".into(),
        },
        "yahoo.com" | "yahoo.com.br" => ProviderSettings {
            imap_host: "imap.mail.yahoo.com".into(),
            imap_port: 993,
            smtp_host: "smtp.mail.yahoo.com".into(),
            smtp_port: 465,
            security_mode: "tls".into(),
        },
        "icloud.com" | "me.com" | "mac.com" => ProviderSettings {
            imap_host: "imap.mail.me.com".into(),
            imap_port: 993,
            smtp_host: "smtp.mail.me.com".into(),
            smtp_port: 587,
            security_mode: "starttls".into(),
        },
        _ => ProviderSettings {
            imap_host: format!("imap.{domain}"),
            imap_port: 993,
            smtp_host: format!("smtp.{domain}"),
            smtp_port: 465,
            security_mode: "tls".into(),
        },
    }
}

pub fn settings_for(account: &AccountProfile) -> ProviderSettings {
    let discovered = discover(&account.email);
    ProviderSettings {
        imap_host: account.imap_host.clone().unwrap_or(discovered.imap_host),
        imap_port: account.imap_port.unwrap_or(discovered.imap_port),
        smtp_host: account.smtp_host.clone().unwrap_or(discovered.smtp_host),
        smtp_port: account.smtp_port.unwrap_or(discovered.smtp_port),
        security_mode: account.security_mode.clone().unwrap_or(discovered.security_mode),
    }
}

fn smtp_transport(account: &AccountProfile) -> Result<SmtpTransport, String> {
    if !account.can("send") {
        return Err("A conta compartilhada não possui permissão de envio.".to_string());
    }
    let settings = settings_for(account);
    let username = account.username.clone().unwrap_or_else(|| account.email.clone());
    let secret = if account.oauth_enabled {
        oauth::access_token(account)?
    } else {
        credentials::load(account.credential_account_id())?
    };
    let credentials = Credentials::new(username, secret);

    let builder = if settings.security_mode.eq_ignore_ascii_case("starttls") {
        SmtpTransport::starttls_relay(&settings.smtp_host)
    } else {
        SmtpTransport::relay(&settings.smtp_host)
    }
    .map_err(|error| error.to_string())?
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

fn redirect_queued(account: &AccountProfile, operation: &QueueOperation) -> Result<(), String> {
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

    let original = fs::read(source_path)
        .map_err(|error| format!("Não foi possível ler a mensagem a redirecionar: {error}"))?;
    let resent = format!(
        "Resent-Date: {}\r\nResent-From: {}\r\nResent-To: {}\r\n",
        chrono::Utc::now().to_rfc2822(),
        account.email,
        recipient
    );
    let mut raw = resent.into_bytes();
    raw.extend_from_slice(&original);

    smtp_transport(account)?
        .send_raw(&envelope, &raw)
        .map_err(|error| format!("Falha ao redirecionar mensagem: {error}"))?;
    Ok(())
}

pub fn send_queued(account: &AccountProfile, operation: &QueueOperation) -> Result<(), String> {
    if operation.kind == "redirect" {
        return redirect_queued(account, operation);
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

    let mut builder = Message::builder().from(from).subject(subject);
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
    let raw_header = |name: &'static str, value: String| {
        HeaderValue::new(HeaderName::new_from_ascii_str(name), value)
    };
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
    let (builder, to_count) = add_recipients(builder, to, "to")?;
    let (builder, cc_count) = add_recipients(builder, cc, "cc")?;
    let (builder, bcc_count) = add_recipients(builder, bcc, "bcc")?;

    if to_count + cc_count + bcc_count == 0 {
        return Err("Informe pelo menos um destinatário válido.".to_string());
    }

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

    let mut mixed = MultiPart::mixed().multipart(body_part);
    for attachment in attachments {
        let bytes = local_crypto::read(std::path::Path::new(&attachment.path))
            .map_err(|error| format!("Falha ao ler o anexo {}: {error}", attachment.name))?;
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
    if smime_sign || smime_encrypt {
        let raw = message.formatted();
        let recipients = recipient_emails(&[to, cc, bcc]);
        let protected = smime::protect_message(
            &AppPaths::resolve()?,
            account,
            &recipients,
            &raw,
            smime_sign,
            smime_encrypt,
        )?;
        transport
            .send_raw(message.envelope(), &protected)
            .map_err(|error| error.to_string())?;
    } else {
        transport
            .send(&message)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

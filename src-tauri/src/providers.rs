use crate::{
    credentials,
    models::{AccountProfile, ProviderSettings, QueueOperation, QueuedAttachment},
};
use lettre::{
    message::{header::ContentType, Attachment, Mailbox, MessageBuilder, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use std::fs;

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

fn smtp_transport(account: &AccountProfile, password: String) -> Result<SmtpTransport, String> {
    let settings = settings_for(account);
    let credentials = Credentials::new(
        account.username.clone().unwrap_or_else(|| account.email.clone()),
        password,
    );

    let builder = if settings.security_mode.eq_ignore_ascii_case("starttls") {
        SmtpTransport::starttls_relay(&settings.smtp_host)
    } else {
        SmtpTransport::relay(&settings.smtp_host)
    }
    .map_err(|error| error.to_string())?
    .port(settings.smtp_port)
    .credentials(credentials);

    Ok(builder.build())
}

pub fn test_smtp(account: &AccountProfile) -> Result<bool, String> {
    let password = credentials::load(&account.id)?;
    smtp_transport(account, password)?
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

pub fn send_queued(account: &AccountProfile, operation: &QueueOperation) -> Result<(), String> {
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

    let attachments: Vec<QueuedAttachment> = operation
        .payload
        .get("attachments")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Lista de anexos inválida: {error}"))?
        .unwrap_or_default();

    let from_address = account
        .email
        .parse()
        .map_err(|error| format!("Remetente inválido: {error}"))?;
    let from = Mailbox::new(Some(account.display_name.clone()), from_address);

    let builder = Message::builder().from(from).subject(subject);
    let (builder, to_count) = add_recipients(builder, to, "to")?;
    let (builder, cc_count) = add_recipients(builder, cc, "cc")?;
    let (builder, bcc_count) = add_recipients(builder, bcc, "bcc")?;

    if to_count + cc_count + bcc_count == 0 {
        return Err("Informe pelo menos um destinatário válido.".to_string());
    }

    let body_part = if body_html.trim().is_empty() {
        MultiPart::alternative().singlepart(SinglePart::plain(body_text.to_owned()))
    } else {
        MultiPart::alternative_plain_html(body_text.to_owned(), body_html.to_owned())
    };

    let mut mixed = MultiPart::mixed().multipart(body_part);
    for attachment in attachments {
        let bytes = fs::read(&attachment.path)
            .map_err(|error| format!("Falha ao ler o anexo {}: {error}", attachment.name))?;
        let content_type: ContentType = attachment_mime(&attachment.name)
            .parse()
            .map_err(|error| format!("MIME inválido para {}: {error}", attachment.name))?;
        mixed = mixed.singlepart(Attachment::new(attachment.name).body(bytes, content_type));
    }

    let message = builder.multipart(mixed).map_err(|error| error.to_string())?;

    let password = credentials::load(&account.id)?;
    smtp_transport(account, password)?
        .send(&message)
        .map_err(|error| error.to_string())?;

    Ok(())
}

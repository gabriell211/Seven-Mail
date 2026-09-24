use crate::{
    credentials,
    models::{AccountProfile, ProviderSettings, QueueOperation},
};
use lettre::{
    message::Mailbox,
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};

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

pub fn send_queued(account: &AccountProfile, operation: &QueueOperation) -> Result<(), String> {
    if operation.kind != "send" {
        return Err("Operação de fila não é um envio SMTP.".to_string());
    }

    let to = operation
        .payload
        .get("to")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Destinatário ausente.".to_string())?;
    let subject = operation
        .payload
        .get("subject")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let body = operation
        .payload
        .get("body")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    let from_address = account.email.parse().map_err(|error| format!("Remetente inválido: {error}"))?;
    let from = Mailbox::new(Some(account.display_name.clone()), from_address);

    let mut builder = Message::builder().from(from).subject(subject);
    let mut recipient_count = 0usize;

    for raw in to.split([',', ';']) {
        let value = raw.trim();
        if value.is_empty() {
            continue;
        }
        let mailbox: Mailbox = value
            .parse()
            .map_err(|error| format!("Destinatário inválido ({value}): {error}"))?;
        builder = builder.to(mailbox);
        recipient_count += 1;
    }

    if recipient_count == 0 {
        return Err("Informe pelo menos um destinatário válido.".to_string());
    }

    let message = builder
        .body(body.to_string())
        .map_err(|error| error.to_string())?;

    let password = credentials::load(&account.id)?;
    smtp_transport(account, password)?
        .send(&message)
        .map_err(|error| error.to_string())?;

    Ok(())
}

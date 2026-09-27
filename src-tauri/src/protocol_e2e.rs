use crate::{
    imap_sync,
    models::{AccountProfile, QueueOperation},
    pop3_sync,
    providers,
    storage::{self, AppPaths},
};

fn enabled() -> bool {
    std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1")
}

fn test_account(id: &str, incoming_protocol: &str) -> AccountProfile {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "displayName": "Seven Mail CI",
        "email": "seven@test.local",
        "provider": "imap",
        "color": "#6d5dfc",
        "isDefault": true,
        "username": "seven",
        "incomingProtocol": incoming_protocol,
        "imapHost": "127.0.0.1",
        "imapPort": 3993,
        "imapSecurityMode": "tls",
        "pop3Host": "127.0.0.1",
        "pop3Port": 3995,
        "pop3SecurityMode": "tls",
        "smtpHost": "127.0.0.1",
        "smtpPort": 3025,
        "smtpSecurityMode": "plain",
        "securityMode": "tls",
        "connectionTimeoutSeconds": 10
    }))
    .expect("CI account must deserialize")
}

#[test]
fn smtp_imap_pop3_roundtrip() {
    if !enabled() {
        eprintln!("Seven Mail protocol E2E skipped (set SEVEN_MAIL_PROTOCOL_E2E=1 to enable).");
        return;
    }

    let imap_account = test_account("ci-protocol-imap", "imap");
    let pop3_account = test_account("ci-protocol-pop3", "pop3");

    assert!(
        providers::test_smtp(&imap_account).expect("SMTP connection test failed"),
        "SMTP did not confirm the connection"
    );
    assert!(
        imap_sync::test(&imap_account).expect("IMAPS connection test failed"),
        "IMAP SELECT did not confirm the connection"
    );
    assert!(
        pop3_sync::test(&pop3_account).expect("POP3S connection test failed"),
        "POP3 STAT did not confirm the connection"
    );

    let marker = uuid::Uuid::new_v4().to_string();
    let subject = format!("Seven Mail protocol E2E {marker}");
    let operation = QueueOperation {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "send".to_string(),
        account_id: imap_account.id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        attempts: 0,
        payload: serde_json::json!({
            "fromAddress": imap_account.email,
            "to": "seven@test.local",
            "cc": "",
            "bcc": "",
            "subject": subject,
            "bodyText": format!("Seven Mail SMTP -> IMAP + POP3 round-trip marker: {marker}"),
            "bodyHtml": "",
            "attachments": [],
            "priority": "normal",
            "requestReadReceipt": false,
            "requestDeliveryReceipt": false
        }),
    };

    providers::send_queued(&imap_account, &operation).expect("Seven Mail SMTP send failed");

    let paths = AppPaths::resolve().expect("Seven Mail app paths must resolve in CI");
    storage::clear_cache(&paths).expect("CI cache must be clean");

    let mut imap_ok = false;
    let mut imap_error = None;
    for _ in 0..20 {
        match imap_sync::sync_latest(&paths, &imap_account, 25) {
            Ok(_) => {
                let messages = storage::list_cached_messages(&paths, Some(&imap_account.id))
                    .expect("IMAP cache must be readable");
                if messages.iter().any(|message| {
                    message.subject == subject
                        && message.body_text.as_deref().is_some_and(|body| body.contains(&marker))
                }) {
                    imap_ok = true;
                    break;
                }
            }
            Err(error) => imap_error = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    assert!(
        imap_ok,
        "SMTP accepted the message, but Seven Mail could not observe it through IMAP. Last error: {}",
        imap_error.unwrap_or_else(|| "none".to_string())
    );

    let mut pop3_ok = false;
    let mut pop3_error = None;
    for _ in 0..20 {
        match pop3_sync::sync_latest(&paths, &pop3_account, 25) {
            Ok(_) => {
                let messages = storage::list_cached_messages(&paths, Some(&pop3_account.id))
                    .expect("POP3 cache must be readable");
                if messages.iter().any(|message| {
                    message.subject == subject
                        && message.body_text.as_deref().is_some_and(|body| body.contains(&marker))
                }) {
                    pop3_ok = true;
                    break;
                }
            }
            Err(error) => pop3_error = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    assert!(
        pop3_ok,
        "SMTP accepted the message, but Seven Mail could not observe it through POP3. Last error: {}",
        pop3_error.unwrap_or_else(|| "none".to_string())
    );
}


#[test]
fn external_smtp_smoke() {
    if std::env::var("SEVEN_MAIL_EXTERNAL_SMOKE").ok().as_deref() != Some("1") {
        eprintln!("Seven Mail external SMTP smoke skipped.");
        return;
    }

    let required = |name: &str| {
        std::env::var(name).unwrap_or_else(|_| panic!("missing required environment variable {name}"))
    };

    let email = required("SEVEN_MAIL_EXTERNAL_EMAIL");
    let username = std::env::var("SEVEN_MAIL_EXTERNAL_USERNAME").unwrap_or_else(|_| email.clone());
    let smtp_host = required("SEVEN_MAIL_EXTERNAL_SMTP_HOST");
    let smtp_port = required("SEVEN_MAIL_EXTERNAL_SMTP_PORT")
        .parse::<u16>()
        .expect("SEVEN_MAIL_EXTERNAL_SMTP_PORT must be a valid port");
    let smtp_security = std::env::var("SEVEN_MAIL_EXTERNAL_SMTP_SECURITY")
        .unwrap_or_else(|_| "starttls".to_string());
    let recipient = std::env::var("SEVEN_MAIL_EXTERNAL_RECIPIENT")
        .unwrap_or_else(|_| "roval90075@hiredify.com".to_string());

    let account: AccountProfile = serde_json::from_value(serde_json::json!({
        "id": "ci-external-smtp",
        "displayName": "Seven Mail External CI",
        "email": email,
        "provider": "imap",
        "color": "#6d5dfc",
        "isDefault": true,
        "username": username,
        "incomingProtocol": "imap",
        "smtpHost": smtp_host,
        "smtpPort": smtp_port,
        "smtpSecurityMode": smtp_security,
        "securityMode": smtp_security,
        "connectionTimeoutSeconds": 20
    }))
    .expect("external SMTP account must deserialize");

    assert!(
        providers::test_smtp(&account).expect("external SMTP connection/authentication failed"),
        "external SMTP connection did not pass"
    );

    let marker = uuid::Uuid::new_v4().to_string();
    let operation = QueueOperation {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "send".to_string(),
        account_id: account.id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        attempts: 0,
        payload: serde_json::json!({
            "fromAddress": account.email,
            "to": recipient,
            "cc": "",
            "bcc": "",
            "subject": format!("Seven Mail external smoke {marker}"),
            "bodyText": format!("Mensagem enviada pelo backend real do Seven Mail no CI. Marker: {marker}"),
            "bodyHtml": "",
            "attachments": [],
            "priority": "normal",
            "requestReadReceipt": false,
            "requestDeliveryReceipt": false
        }),
    };

    providers::send_queued(&account, &operation)
        .expect("external SMTP server did not accept the Seven Mail message");

    println!("Seven Mail external SMTP accepted recipient={recipient} marker={marker}");
}


#[test]
fn external_receive_smoke() {
    if std::env::var("SEVEN_MAIL_EXTERNAL_SMOKE").ok().as_deref() != Some("1") {
        eprintln!("Seven Mail external receive smoke skipped.");
        return;
    }

    let required = |name: &str| {
        std::env::var(name).unwrap_or_else(|_| panic!("missing required environment variable {name}"))
    };

    let email = required("SEVEN_MAIL_EXTERNAL_EMAIL");
    let username = std::env::var("SEVEN_MAIL_EXTERNAL_USERNAME").unwrap_or_else(|_| email.clone());
    let expected_subject = std::env::var("SEVEN_MAIL_EXTERNAL_EXPECTED_SUBJECT")
        .unwrap_or_else(|_| "Seven Mail inbound receive smoke".to_string());

    let imap_account: AccountProfile = serde_json::from_value(serde_json::json!({
        "id": "ci-external-imap",
        "displayName": "Seven Mail External IMAP",
        "email": email,
        "provider": "gmail",
        "color": "#6d5dfc",
        "isDefault": true,
        "username": username,
        "incomingProtocol": "imap",
        "imapHost": "imap.gmail.com",
        "imapPort": 993,
        "imapSecurityMode": "tls",
        "smtpHost": "smtp.gmail.com",
        "smtpPort": 465,
        "smtpSecurityMode": "tls",
        "securityMode": "tls",
        "connectionTimeoutSeconds": 20
    }))
    .expect("external IMAP account must deserialize");

    let pop3_account: AccountProfile = serde_json::from_value(serde_json::json!({
        "id": "ci-external-pop3",
        "displayName": "Seven Mail External POP3",
        "email": imap_account.email,
        "provider": "gmail",
        "color": "#6d5dfc",
        "isDefault": false,
        "username": imap_account.username,
        "incomingProtocol": "pop3",
        "pop3Host": "pop.gmail.com",
        "pop3Port": 995,
        "pop3SecurityMode": "tls",
        "smtpHost": "smtp.gmail.com",
        "smtpPort": 465,
        "smtpSecurityMode": "tls",
        "securityMode": "tls",
        "connectionTimeoutSeconds": 20
    }))
    .expect("external POP3 account must deserialize");

    assert!(
        imap_sync::test(&imap_account).expect("external Gmail IMAP connection/authentication failed"),
        "external Gmail IMAP connection did not pass"
    );

    let paths = AppPaths::resolve().expect("Seven Mail app paths must resolve in external CI");
    storage::clear_cache(&paths).expect("external receive cache must be clean");

    let mut imap_found = false;
    let mut imap_error = None;
    for _ in 0..12 {
        match imap_sync::sync_latest(&paths, &imap_account, 50) {
            Ok(_) => {
                let messages = storage::list_cached_messages(&paths, Some(&imap_account.id))
                    .expect("external IMAP cache must be readable");
                if messages.iter().any(|message| message.subject.contains(&expected_subject)) {
                    imap_found = true;
                    break;
                }
            }
            Err(error) => imap_error = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    assert!(
        imap_found,
        "Seven Mail authenticated with Gmail IMAP but did not observe the inbound message. Last error: {}",
        imap_error.unwrap_or_else(|| "none".to_string())
    );

    assert!(
        pop3_sync::test(&pop3_account).expect("external Gmail POP3 connection/authentication failed"),
        "external Gmail POP3 connection did not pass"
    );

    let mut pop3_found = false;
    let mut pop3_error = None;
    for _ in 0..12 {
        match pop3_sync::sync_latest(&paths, &pop3_account, 50) {
            Ok(_) => {
                let messages = storage::list_cached_messages(&paths, Some(&pop3_account.id))
                    .expect("external POP3 cache must be readable");
                if messages.iter().any(|message| message.subject.contains(&expected_subject)) {
                    pop3_found = true;
                    break;
                }
            }
            Err(error) => pop3_error = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    assert!(
        pop3_found,
        "Seven Mail authenticated with Gmail POP3 but did not observe the inbound message. Last error: {}",
        pop3_error.unwrap_or_else(|| "none".to_string())
    );

    println!("Seven Mail external receive confirmed via IMAP and POP3 subject={expected_subject}");
}

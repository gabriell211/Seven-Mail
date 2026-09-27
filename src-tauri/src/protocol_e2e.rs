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

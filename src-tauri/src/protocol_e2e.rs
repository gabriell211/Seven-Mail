use crate::{
    imap_sync,
    models::{AccountProfile, QueueOperation},
    providers,
    storage::{self, AppPaths},
};

fn enabled() -> bool {
    std::env::var("SEVEN_MAIL_PROTOCOL_E2E").ok().as_deref() == Some("1")
}

#[test]
fn smtp_to_imap_roundtrip() {
    if !enabled() {
        eprintln!("Seven Mail protocol E2E skipped (set SEVEN_MAIL_PROTOCOL_E2E=1 to enable).");
        return;
    }

    let account: AccountProfile = serde_json::from_value(serde_json::json!({
        "id": "ci-protocol-e2e",
        "displayName": "Seven Mail CI",
        "email": "test1@localhost",
        "provider": "imap",
        "color": "#6d5dfc",
        "isDefault": true,
        "username": "test1",
        "incomingProtocol": "imap",
        "imapHost": "127.0.0.1",
        "imapPort": 3993,
        "smtpHost": "127.0.0.1",
        "smtpPort": 3025,
        "imapSecurityMode": "tls",
        "smtpSecurityMode": "plain",
        "securityMode": "tls",
        "connectionTimeoutSeconds": 10
    }))
    .expect("CI account must deserialize");

    assert!(
        providers::test_smtp(&account).expect("SMTP connection test failed"),
        "SMTP NOOP did not confirm the connection"
    );
    assert!(
        imap_sync::test(&account).expect("IMAP connection test failed"),
        "IMAP SELECT did not confirm the connection"
    );

    let marker = uuid::Uuid::new_v4().to_string();
    let subject = format!("Seven Mail protocol E2E {marker}");
    let operation = QueueOperation {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "send".to_string(),
        account_id: account.id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        attempts: 0,
        payload: serde_json::json!({
            "fromAddress": account.email,
            "to": "test1@localhost",
            "cc": "",
            "bcc": "",
            "subject": subject,
            "bodyText": format!("Seven Mail SMTP -> IMAP round-trip marker: {marker}"),
            "bodyHtml": "",
            "attachments": [],
            "priority": "normal",
            "requestReadReceipt": false,
            "requestDeliveryReceipt": false
        }),
    };

    providers::send_queued(&account, &operation).expect("Seven Mail SMTP send failed");

    let paths = AppPaths::resolve().expect("Seven Mail app paths must resolve in CI");
    let mut last_error = None;

    for _ in 0..20 {
        match imap_sync::sync_latest(&paths, &account, 25) {
            Ok(_) => {
                let messages = storage::list_cached_messages(&paths, Some(&account.id))
                    .expect("cached messages must be readable");
                if messages.iter().any(|message| {
                    message.subject == subject
                        && message
                            .body_text
                            .as_deref()
                            .is_some_and(|body| body.contains(&marker))
                }) {
                    return;
                }
            }
            Err(error) => last_error = Some(error),
        }

        std::thread::sleep(std::time::Duration::from_millis(250));
    }

    panic!(
        "SMTP accepted the message, but Seven Mail could not observe it through IMAP. Last IMAP error: {}",
        last_error.unwrap_or_else(|| "none".to_string())
    );
}

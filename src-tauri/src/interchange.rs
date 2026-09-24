use crate::{models::{AccountProfile, MailAddress, MailMessage}, storage::{self, AppPaths}};
use mail_parser::{MessageParser, MimeHeaders};
use std::{fs, path::Path};

const MAX_TEXT_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EML_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn ensure_readable_file(path: &str, max_bytes: u64) -> Result<std::path::PathBuf, String> {
    let path = Path::new(path);
    let metadata = fs::metadata(path).map_err(|error| format!("Não foi possível acessar o arquivo: {error}"))?;
    if !metadata.is_file() {
        return Err("O caminho selecionado não é um arquivo.".to_string());
    }
    if metadata.len() > max_bytes {
        return Err(format!("O arquivo excede o limite de {} MB.", max_bytes / 1024 / 1024));
    }
    Ok(path.to_path_buf())
}

pub fn read_text_file(path: &str) -> Result<String, String> {
    let path = ensure_readable_file(path, MAX_TEXT_FILE_BYTES)?;
    fs::read_to_string(path).map_err(|error| format!("Não foi possível ler o arquivo: {error}"))
}

pub fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Não foi possível preparar a pasta: {error}"))?;
    }
    fs::write(path, content.as_bytes()).map_err(|error| format!("Não foi possível salvar o arquivo: {error}"))
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

pub fn import_eml(paths: &AppPaths, account: &AccountProfile, path: &str) -> Result<MailMessage, String> {
    let source = ensure_readable_file(path, MAX_EML_FILE_BYTES)?;
    let raw = fs::read(&source).map_err(|error| format!("Não foi possível ler o EML: {error}"))?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "O arquivo EML não pôde ser interpretado.".to_string())?;

    let received_at = parsed
        .date()
        .map(|date| date.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let body_text = parsed.body_text(0).map(|value| value.into_owned());
    let body_html = parsed.body_html(0).map(|value| value.into_owned());
    let preview = parsed
        .body_preview(180)
        .map(|value| value.into_owned())
        .unwrap_or_default();
    let attachment_names = (0..parsed.attachment_count())
        .filter_map(|index| parsed.attachment(index))
        .map(|part| part.attachment_name().unwrap_or("anexo").to_string())
        .collect::<Vec<_>>();

    let message = MailMessage {
        id: format!("{}-import-{}", account.id, uuid::Uuid::new_v4()),
        account_id: account.id.clone(),
        remote_id: None,
        remote_folder: None,
        folder: "Caixa de entrada".to_string(),
        subject: parsed.subject().unwrap_or("(sem assunto)").to_owned(),
        preview,
        from: mail_address(parsed.from().and_then(|value| value.first())),
        to: recipients(parsed.to()),
        received_at,
        is_read: false,
        is_flagged: false,
        is_pinned: false,
        has_attachments: parsed.attachment_count() > 0,
        body_html,
        body_text,
        categories: vec!["Importado".to_string()],
        applied_rule_ids: Vec::new(),
        size_bytes: Some(raw.len() as u64),
        attachment_names,
        importance: Some("normal".to_string()),
        snoozed_until: None,
        is_muted: false,
        is_phishing: false,
        is_important: false,
    };

    storage::cache_message(paths, &message)?;
    storage::cache_raw_message(paths, &message.account_id, &message.id, &raw)?;
    Ok(message)
}

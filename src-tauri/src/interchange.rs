use crate::{local_crypto, models::{AccountProfile, MailAddress, MailAttachmentInfo, MailAttachmentPreview, MailMessage}, storage::{self, AppPaths}};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use mail_parser::{MessageParser, MimeHeaders};
use msg_parser::Outlook;
use std::{fs, io::{Cursor, Read}, path::Path};

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

pub fn read_file_data_url(path: &str) -> Result<String, String> {
    let path = ensure_readable_file(path, 8 * 1024 * 1024)?;
    let bytes = fs::read(&path).map_err(|error| format!("Não foi possível ler o arquivo: {error}"))?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Use uma imagem PNG, JPG, GIF ou WebP.".to_string()),
    };
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
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

fn outlook_person(person: &msg_parser::Person) -> MailAddress {
    MailAddress {
        name: if person.name.trim().is_empty() { None } else { Some(person.name.clone()) },
        email: if person.email.trim().is_empty() { "desconhecido@localhost".to_string() } else { person.email.clone() },
    }
}

pub fn import_msg(paths: &AppPaths, account: &AccountProfile, path: &str) -> Result<MailMessage, String> {
    let source = ensure_readable_file(path, MAX_EML_FILE_BYTES)?;
    let raw = fs::read(&source).map_err(|error| format!("Não foi possível ler o MSG: {error}"))?;
    let outlook = Outlook::from_slice(&raw).map_err(|error| format!("Não foi possível interpretar o MSG: {error}"))?;

    let body_html = if !outlook.html.trim().is_empty() {
        Some(outlook.html.clone())
    } else {
        outlook.html_from_rtf().filter(|value| !value.trim().is_empty())
    };
    let body_text = if outlook.body.trim().is_empty() { None } else { Some(outlook.body.clone()) };
    let preview = body_text.as_deref()
        .unwrap_or_else(|| body_html.as_deref().unwrap_or(""))
        .chars()
        .take(180)
        .collect::<String>();

    let attachment_names = outlook.attachments.iter().map(|attachment| {
        if !attachment.long_file_name.trim().is_empty() {
            attachment.long_file_name.clone()
        } else if !attachment.file_name.trim().is_empty() {
            attachment.file_name.clone()
        } else if !attachment.display_name.trim().is_empty() {
            attachment.display_name.clone()
        } else {
            "anexo".to_string()
        }
    }).collect::<Vec<_>>();

    let received_at = [
        outlook.message_delivery_time.as_str(),
        outlook.client_submit_time.as_str(),
        outlook.creation_time.as_str(),
    ].into_iter().find(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let message = MailMessage {
        id: format!("{}-msg-{}", account.id, uuid::Uuid::new_v4()),
        account_id: account.id.clone(),
        remote_id: None,
        remote_folder: None,
        folder: "Caixa de entrada".to_string(),
        subject: if outlook.subject.trim().is_empty() { "(sem assunto)".to_string() } else { outlook.subject.clone() },
        preview,
        from: outlook_person(&outlook.sender),
        to: outlook.to.iter().map(outlook_person).collect(),
        received_at,
        is_read: false,
        is_flagged: false,
        is_pinned: false,
        has_attachments: !outlook.attachments.is_empty(),
        body_html,
        body_text,
        categories: vec!["Importado".to_string(), "MSG".to_string()],
        applied_rule_ids: Vec::new(),
        size_bytes: Some(raw.len() as u64),
        attachment_names,
        importance: Some(match outlook.importance { 2 => "high", 0 => "low", _ => "normal" }.to_string()),
        snoozed_until: None,
        is_muted: false,
        is_phishing: false,
        is_important: outlook.importance == 2,
        source_format: Some("msg".to_string()),
    };

    storage::cache_message(paths, &message)?;
    storage::cache_raw_message(paths, &message.account_id, &message.id, &raw)?;
    Ok(message)
}

pub fn read_oft_template(path: &str) -> Result<serde_json::Value, String> {
    let source = ensure_readable_file(path, MAX_EML_FILE_BYTES)?;
    let outlook = Outlook::from_path(&source).map_err(|error| format!("Não foi possível interpretar o OFT: {error}"))?;
    let body_html = if !outlook.html.trim().is_empty() {
        outlook.html.clone()
    } else {
        outlook.html_from_rtf().unwrap_or_default()
    };
    let body_text = outlook.body.clone();
    let name = source.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Modelo OFT")
        .to_string();
    Ok(serde_json::json!({
        "name": name,
        "subject": outlook.subject,
        "bodyText": body_text,
        "bodyHtml": body_html,
        "sourceFormat": "oft"
    }))
}

pub fn save_original_message(paths: &AppPaths, account_id: &str, message_id: &str, destination: &str) -> Result<(), String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let destination = Path::new(destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Não foi possível preparar a pasta: {error}"))?;
    }
    fs::write(destination, raw).map_err(|error| format!("Não foi possível salvar a mensagem original: {error}"))
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
        .filter_map(|index| parsed.attachment(index as u32))
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
        source_format: Some("eml".to_string()),
    };

    storage::cache_message(paths, &message)?;
    storage::cache_raw_message(paths, &message.account_id, &message.id, &raw)?;
    Ok(message)
}


fn attachment_mime(name: &str) -> String {
    let ext = name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase());
    match ext.as_deref() {
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
    .to_string()
}

fn safe_attachment_name(value: &str, index: usize) -> String {
    let cleaned = value
        .chars()
        .map(|ch| if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { ch })
        .collect::<String>();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { format!("anexo-{}", index + 1) } else { cleaned }
}

pub fn read_message_source(paths: &AppPaths, account_id: &str, message_id: &str) -> Result<String, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    Ok(String::from_utf8_lossy(&raw).into_owned())
}

pub fn list_message_attachments(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
) -> Result<Vec<MailAttachmentInfo>, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "Não foi possível interpretar a fonte da mensagem.".to_string())?;

    let mut attachments = Vec::new();
    for index in 0..parsed.attachment_count() {
        let Some(part) = parsed.attachment(index as u32) else { continue; };
        let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);
        attachments.push(MailAttachmentInfo {
            index,
            name: name.clone(),
            size: part.len() as u64,
            mime: attachment_mime(&name),
            inline: part.content_id().is_some(),
        });
    }
    Ok(attachments)
}

fn strip_xml_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len().min(120_000));
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => {
                in_tag = true;
                if !output.ends_with(' ') { output.push(' '); }
            }
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
        if output.len() >= 120_000 { break; }
    }
    output
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn zip_summary(bytes: &[u8], extension: &str) -> Result<String, String> {
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| format!("Arquivo compactado inválido: {error}"))?;

    let mut entries = Vec::new();
    for index in 0..archive.len().min(250) {
        let entry = archive.by_index(index)
            .map_err(|error| format!("Falha ao ler item compactado: {error}"))?;
        if !entry.is_dir() {
            entries.push(format!("{} · {} bytes", entry.name(), entry.size()));
        }
    }

    let mut details = String::new();
    match extension {
        "docx" => {
            if let Ok(mut document) = archive.by_name("word/document.xml") {
                let mut xml = String::new();
                let _ = document.read_to_string(&mut xml);
                let text = strip_xml_text(&xml);
                if !text.is_empty() {
                    details.push_str("Texto extraído do documento:\n\n");
                    details.push_str(&text);
                    details.push_str("\n\n");
                }
            }
        }
        "xlsx" => {
            if let Ok(mut workbook) = archive.by_name("xl/workbook.xml") {
                let mut xml = String::new();
                let _ = workbook.read_to_string(&mut xml);
                let text = strip_xml_text(&xml);
                if !text.is_empty() {
                    details.push_str("Estrutura da planilha:\n\n");
                    details.push_str(&text);
                    details.push_str("\n\n");
                }
            }
        }
        "pptx" => {
            let slides = entries.iter().filter(|value| value.contains("ppt/slides/slide")).count();
            details.push_str(&format!("Apresentação com aproximadamente {slides} slide(s).\n\n"));
        }
        _ => {}
    }

    details.push_str("Conteúdo do pacote:\n");
    details.push_str(&entries.join("\n"));
    Ok(details)
}

pub fn preview_message_attachment(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    index: usize,
) -> Result<MailAttachmentPreview, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "Não foi possível interpretar a fonte da mensagem.".to_string())?;
    let part = parsed
        .attachment(index as u32)
        .ok_or_else(|| "Anexo não encontrado.".to_string())?;

    let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);
    let mime = attachment_mime(&name);
    let bytes = part.contents();
    let size = bytes.len() as u64;
    if size > 20 * 1024 * 1024 {
        return Ok(MailAttachmentPreview {
            name,
            mime,
            size,
            data_url: None,
            text: Some("Pré-visualização limitada a anexos de até 20 MB. Use Salvar para abrir este arquivo no aplicativo adequado.".to_string()),
            kind: "large".to_string(),
        });
    }

    let extension = name.rsplit_once('.').map(|(_, value)| value.to_ascii_lowercase()).unwrap_or_default();
    if mime.starts_with("image/") {
        return Ok(MailAttachmentPreview {
            name,
            mime: mime.clone(),
            size,
            data_url: Some(format!("data:{mime};base64,{}", BASE64.encode(bytes))),
            text: None,
            kind: "image".to_string(),
        });
    }
    if mime == "application/pdf" {
        return Ok(MailAttachmentPreview {
            name,
            mime: mime.clone(),
            size,
            data_url: Some(format!("data:{mime};base64,{}", BASE64.encode(bytes))),
            text: None,
            kind: "pdf".to_string(),
        });
    }
    if mime.starts_with("text/") || matches!(extension.as_str(), "json" | "xml") {
        return Ok(MailAttachmentPreview {
            name,
            mime,
            size,
            data_url: None,
            text: Some(String::from_utf8_lossy(bytes).chars().take(120_000).collect()),
            kind: "text".to_string(),
        });
    }
    if matches!(extension.as_str(), "zip" | "docx" | "xlsx" | "pptx") {
        return Ok(MailAttachmentPreview {
            name,
            mime,
            size,
            data_url: None,
            text: Some(zip_summary(bytes, &extension)?),
            kind: if extension == "zip" { "archive".to_string() } else { "office".to_string() },
        });
    }

    Ok(MailAttachmentPreview {
        name,
        mime,
        size,
        data_url: None,
        text: Some("Este tipo de arquivo não possui pré-visualização segura interna. Salve-o para abrir no aplicativo associado.".to_string()),
        kind: "binary".to_string(),
    })
}

pub fn cache_message_attachment(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    index: usize,
) -> Result<String, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "Não foi possível interpretar a fonte da mensagem.".to_string())?;
    let part = parsed
        .attachment(index as u32)
        .ok_or_else(|| "Anexo não encontrado.".to_string())?;
    let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);

    let account = account_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') { ch } else { '_' })
        .collect::<String>();
    let message = message_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') { ch } else { '_' })
        .collect::<String>();
    let directory = paths.attachment_cache.join(account).join(message);
    fs::create_dir_all(&directory).map_err(|error| format!("Não foi possível preparar o cache de anexos: {error}"))?;
    let destination = directory.join(format!("{index:03}-{name}"));
    fs::write(&destination, part.contents())
        .map_err(|error| format!("Não foi possível materializar o anexo: {error}"))?;
    Ok(destination.display().to_string())
}

pub fn save_message_attachment(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    index: usize,
    destination: &str,
) -> Result<(), String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "Não foi possível interpretar a fonte da mensagem.".to_string())?;
    let part = parsed
        .attachment(index as u32)
        .ok_or_else(|| "Anexo não encontrado.".to_string())?;
    let destination = Path::new(destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Não foi possível preparar a pasta: {error}"))?;
    }
    fs::write(destination, part.contents())
        .map_err(|error| format!("Não foi possível salvar o anexo: {error}"))
}

pub fn stage_message_attachments(
    paths: &AppPaths,
    operation_id: &str,
    account_id: &str,
    message_id: &str,
) -> Result<Vec<crate::models::QueuedAttachment>, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "Não foi possível interpretar a fonte da mensagem.".to_string())?;

    let directory = paths.queue_attachments.join(operation_id);
    fs::create_dir_all(&directory).map_err(|error| format!("Não foi possível preparar anexos: {error}"))?;

    let mut output = Vec::new();
    for index in 0..parsed.attachment_count() {
        let Some(part) = parsed.attachment(index as u32) else { continue; };
        let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);
        let staged_name = format!("{index:03}-{name}");
        let path = directory.join(staged_name);
        local_crypto::write(&path, part.contents())
            .map_err(|error| format!("Não foi possível preparar o anexo {name}: {error}"))?;
        output.push(crate::models::QueuedAttachment {
            name,
            path: path.display().to_string(),
            size: part.len() as u64,
            inline: false,
            content_id: None,
        });
    }
    Ok(output)
}

pub fn save_all_message_attachments(
    paths: &AppPaths,
    account_id: &str,
    message_id: &str,
    directory: &str,
) -> Result<usize, String> {
    let raw = storage::read_raw_message(paths, account_id, message_id)?;
    let parsed = MessageParser::default()
        .parse(&raw)
        .ok_or_else(|| "Não foi possível interpretar a fonte da mensagem.".to_string())?;
    let directory = Path::new(directory);
    fs::create_dir_all(directory).map_err(|error| format!("Não foi possível preparar a pasta: {error}"))?;

    let mut saved = 0usize;
    for index in 0..parsed.attachment_count() {
        let Some(part) = parsed.attachment(index as u32) else { continue; };
        let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);
        let mut path = directory.join(&name);
        if path.exists() {
            let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("anexo");
            let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("");
            let next = if ext.is_empty() {
                format!("{stem}-{}", index + 1)
            } else {
                format!("{stem}-{}.{}", index + 1, ext)
            };
            path = directory.join(next);
        }
        fs::write(path, part.contents())
            .map_err(|error| format!("Não foi possível salvar o anexo {name}: {error}"))?;
        saved += 1;
    }
    Ok(saved)
}

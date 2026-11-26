use crate::{local_crypto, models::{AccountProfile, MailAddress, MailAttachmentInfo, MailAttachmentPreview, MailMessage}, storage::{self, AppPaths}};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use mail_parser::{MessageParser, MimeHeaders};
use msg_parser::Outlook;
use std::{fs, io::{Cursor, Read}, path::Path, rc::Rc};

use outlook_pst::{
    ltp::prop_context::PropertyValue,
    messaging::folder::Folder as PstFolder,
    ndb::node_id::NodeId,
    UnicodePstFile,
    UnicodePstMessage,
    UnicodePstRecipient,
    UnicodePstRecipientType,
};

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
    let cleaned = cleaned.trim_matches(|c: char| c.is_whitespace() || c == '.');
    let device = cleaned.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || ["COM", "LPT"].iter().any(|prefix| device.strip_prefix(*prefix)
            .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")));
    // Leave room for UUID prefixes and export collision suffixes. Preserve
    // normal extensions so a truncated filename retains its file type.
    let cleaned = if cleaned.len() > 160 {
        let extension = Path::new(cleaned).extension().and_then(|v| v.to_str())
            .filter(|v| v.len() <= 20).map(|v| format!(".{v}")).unwrap_or_default();
        let stem = if extension.is_empty() { cleaned } else { &cleaned[..cleaned.len()-extension.len()] };
        let mut end = (160 - extension.len()).min(stem.len());
        while !stem.is_char_boundary(end) { end -= 1; }
        format!("{}{extension}", &stem[..end])
    } else { cleaned.to_owned() };
    let cleaned = cleaned.trim_end_matches(|c: char| c.is_whitespace() || c == '.');
    if cleaned.is_empty() { format!("anexo-{}", index.saturating_add(1)) }
    else if reserved { format!("_{cleaned}") }
    else { cleaned.to_owned() }
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
            if let Ok(document) = archive.by_name("word/document.xml") {
                let mut xml = String::new();
                let _ = document.take(2 * 1024 * 1024).read_to_string(&mut xml);
                let text = strip_xml_text(&xml);
                if !text.is_empty() {
                    details.push_str("Texto extraído do documento:\n\n");
                    details.push_str(&text);
                    details.push_str("\n\n");
                }
            }
        }
        "xlsx" => {
            if let Ok(workbook) = archive.by_name("xl/workbook.xml") {
                let mut xml = String::new();
                let _ = workbook.take(2 * 1024 * 1024).read_to_string(&mut xml);
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
    let attachment_index = u32::try_from(index).map_err(|_| "Índice de anexo inválido.".to_string())?;
    let part = parsed
        .attachment(attachment_index)
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
    if mime.starts_with("image/") && mime != "image/svg+xml" {
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

fn cleanup_expired_attachment_exports(root: &Path) -> Result<(), String> {
    cleanup_attachment_exports_at(root, std::time::SystemTime::now())
}

fn cleanup_attachment_exports_at(root: &Path, now: std::time::SystemTime) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Pasta de anexos temporários inválida.".into());
    }
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if uuid::Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            // Another cleanup may already have removed this directory.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if metadata.is_dir() && !metadata.file_type().is_symlink() &&
            metadata.modified().ok().and_then(|time| now.duration_since(time).ok())
                .map(|age| age >= std::time::Duration::from_secs(3600)).unwrap_or(false)
        {
            // A file may still be in use by an external application on Windows.
            let _ = fs::remove_dir_all(entry.path());
        }
    }
    Ok(())
}

pub fn cleanup_attachment_exports(paths: &AppPaths) -> Result<(), String> {
    let root = paths.root.join("attachment-exports");
    cleanup_expired_attachment_exports(&root)
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
    let attachment_index = u32::try_from(index).map_err(|_| "Índice de anexo inválido.".to_string())?;
    let part = parsed
        .attachment(attachment_index)
        .ok_or_else(|| "Anexo não encontrado.".to_string())?;
    let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);

    if part.contents().len() > 64 * 1024 * 1024 {
        return Err("O anexo excede o limite de materialização de 64 MB.".to_string());
    }
    // Raw message storage is encrypted. Materialize only for an explicit
    // external-open or drag operation, in an isolated transient directory.
    let root = paths.root.join("attachment-exports");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    cleanup_expired_attachment_exports(&root)?;
    let directory = root.join(uuid::Uuid::new_v4().to_string());
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(&directory).map_err(|error| error.to_string())?;
    let destination = directory.join(format!("{index:03}-{name}"));
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = options.open(&destination).and_then(|mut file| file.write_all(part.contents()));
    if let Err(error) = written {
        let _ = fs::remove_dir_all(&directory);
        return Err(format!("Não foi possível materializar o anexo: {error}"));
    }
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
    let attachment_index = u32::try_from(index).map_err(|_| "Índice de anexo inválido.".to_string())?;
    let part = parsed
        .attachment(attachment_index)
        .ok_or_else(|| "Anexo não encontrado.".to_string())?;
    let destination = Path::new(destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Não foi possível preparar a pasta: {error}"))?;
    }
    write_new_attachment(destination, part.contents())
        .map_err(|error| format!("Não foi possível salvar o anexo sem sobrescrever arquivos: {error}"))
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

    if uuid::Uuid::parse_str(operation_id).is_err() {
        return Err("Identificador de operação de anexo inválido.".to_string());
    }
    if parsed.attachment_count() > 256 {
        return Err("Quantidade de anexos acima do limite.".into());
    }
    // Validate the complete batch before creating any staged files.
    let mut total = 0usize;
    for index in 0..parsed.attachment_count() {
        let Some(part) = parsed.attachment(index as u32) else { continue; };
        total = total.saturating_add(part.contents().len());
        if part.contents().len() > 64 * 1024 * 1024 || total > 100 * 1024 * 1024 {
            return Err("Anexos excedem o limite de 64 MB por arquivo ou 100 MB no total.".into());
        }
    }
    let directory = storage::prepare_attachment_directory(&paths.queue_attachments, operation_id)?;
    let mut output: Vec<crate::models::QueuedAttachment> = Vec::new();
    for index in 0..parsed.attachment_count() {
        let Some(part) = parsed.attachment(index as u32) else { continue; };
        let name = safe_attachment_name(part.attachment_name().unwrap_or("anexo"), index);
        let staged_name = format!("{}-{index:03}-{name}", uuid::Uuid::new_v4());
        let path = directory.join(staged_name);
        if let Err(error) = local_crypto::write(&path, part.contents()) {
            for attachment in &output { let _ = fs::remove_file(&attachment.path); }
            return Err(format!("Não foi possível preparar o anexo {name}: {error}"));
        }
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

// create_new performs the existence check and creation together, including dangling symlinks.
fn write_new_attachment(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

fn export_unique_attachment(directory: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let original = Path::new(name);
    let stem = original.file_stem().and_then(|value| value.to_str()).unwrap_or("anexo");
    let ext = original.extension().and_then(|value| value.to_str()).unwrap_or("");
    for suffix in 0..1000 {
        let candidate = if suffix == 0 {
            name.to_owned()
        } else if ext.is_empty() {
            format!("{stem}-{suffix}")
        } else {
            format!("{stem}-{suffix}.{ext}")
        };
        match write_new_attachment(&directory.join(candidate), bytes) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "Limite de nomes de anexo atingido"))
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
        export_unique_attachment(directory, &name, part.contents())
            .map_err(|error| format!("Não foi possível salvar o anexo {name}: {error}"))?;
        saved += 1;
    }
    Ok(saved)
}


fn pst_property_text(value: Option<&PropertyValue>) -> Option<String> {
    match value {
        Some(PropertyValue::String8(value)) => Some(value.to_string()),
        Some(PropertyValue::Unicode(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn pst_received_iso(value: Option<&PropertyValue>) -> String {
    let filetime = match value {
        Some(PropertyValue::Time(value)) => *value,
        _ => 0,
    };
    if filetime <= 0 {
        return chrono::Utc::now().to_rfc3339();
    }
    let unix = filetime / 10_000_000 - 11_644_473_600;
    chrono::DateTime::<chrono::Utc>::from_timestamp(unix, 0)
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

fn import_pst_folder(
    paths: &AppPaths,
    account: &AccountProfile,
    folder: Rc<dyn PstFolder>,
    parent_label: Option<&str>,
) -> Result<usize, String> {
    let label = folder
        .properties()
        .display_name()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "PST".to_string());
    let full_label = parent_label
        .filter(|value| !value.trim().is_empty())
        .map(|parent| format!("{parent}/{label}"))
        .unwrap_or_else(|| label.clone());

    let mut imported = 0usize;
    if let Some(contents) = folder.contents_table() {
        for row in contents.rows_matrix() {
            let node = NodeId::from(u32::from(row.id()));
            let entry_id = folder
                .store()
                .properties()
                .make_entry_id(node)
                .map_err(|error| format!("Falha ao resolver mensagem PST: {error}"))?;
            let message = folder
                .store()
                .open_message(&entry_id, None)
                .map_err(|error| format!("Falha ao abrir mensagem PST: {error}"))?;
            let properties = message.properties();

            let subject = pst_property_text(properties.get(0x0037))
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "(sem assunto)".to_string());
            let body_text = pst_property_text(properties.get(0x1000));
            let body_html = pst_property_text(properties.get(0x1013));
            let preview = body_text
                .as_deref()
                .or(body_html.as_deref())
                .unwrap_or("")
                .chars()
                .take(180)
                .collect::<String>();
            let sender_name = pst_property_text(properties.get(0x0C1A));
            let sender_email = pst_property_text(properties.get(0x5D01))
                .or_else(|| pst_property_text(properties.get(0x0C1F)))
                .unwrap_or_else(|| "desconhecido@localhost".to_string());
            let received_at = pst_received_iso(properties.get(0x0E06));

            let local = MailMessage {
                id: format!("{}-pst-{}", account.id, uuid::Uuid::new_v4()),
                account_id: account.id.clone(),
                remote_id: None,
                remote_folder: None,
                folder: full_label.clone(),
                subject,
                preview,
                from: MailAddress { name: sender_name, email: sender_email },
                to: Vec::new(),
                received_at,
                is_read: false,
                is_flagged: false,
                is_pinned: false,
                has_attachments: message.attachment_table().is_some(),
                body_html,
                body_text,
                categories: vec!["Importado".to_string(), "PST".to_string()],
                applied_rule_ids: Vec::new(),
                size_bytes: None,
                attachment_names: Vec::new(),
                importance: None,
                snoozed_until: None,
                is_muted: false,
                is_phishing: false,
                is_important: false,
                source_format: Some("pst".to_string()),
            };
            storage::cache_message(paths, &local)?;
            imported += 1;
        }
    }

    if let Some(hierarchy) = folder.hierarchy_table() {
        for row in hierarchy.rows_matrix() {
            let node = NodeId::from(u32::from(row.id()));
            let entry_id = folder
                .store()
                .properties()
                .make_entry_id(node)
                .map_err(|error| format!("Falha ao resolver pasta PST: {error}"))?;
            let child = folder
                .store()
                .open_folder(&entry_id)
                .map_err(|error| format!("Falha ao abrir pasta PST: {error}"))?;
            imported += import_pst_folder(paths, account, child, Some(&full_label))?;
        }
    }
    Ok(imported)
}

pub fn import_pst(paths: &AppPaths, account: &AccountProfile, source: &str) -> Result<usize, String> {
    let source = ensure_readable_file(source, 16 * 1024 * 1024 * 1024)?;
    let store = outlook_pst::open_store(&source)
        .map_err(|error| format!("Não foi possível abrir o PST: {error}"))?;
    let subtree_id = store
        .properties()
        .ipm_sub_tree_entry_id()
        .map_err(|error| format!("PST sem árvore de mensagens: {error}"))?;
    let subtree = store
        .open_folder(&subtree_id)
        .map_err(|error| format!("Não foi possível abrir a árvore do PST: {error}"))?;
    let hierarchy = subtree
        .hierarchy_table()
        .ok_or_else(|| "PST sem pastas de mensagens.".to_string())?;

    let mut imported = 0usize;
    for row in hierarchy.rows_matrix() {
        let node = NodeId::from(u32::from(row.id()));
        let entry_id = store
            .properties()
            .make_entry_id(node)
            .map_err(|error| format!("Falha ao resolver pasta PST: {error}"))?;
        let folder = store
            .open_folder(&entry_id)
            .map_err(|error| format!("Falha ao abrir pasta PST: {error}"))?;
        imported += import_pst_folder(paths, account, folder, None)?;
    }
    Ok(imported)
}

fn pst_filetime(value: &str) -> i64 {
    let unix = chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp());
    (unix.saturating_add(11_644_473_600)).saturating_mul(10_000_000)
}

pub fn export_pst(paths: &AppPaths, account_id: Option<&str>, destination: &str) -> Result<usize, String> {
    let messages = storage::list_cached_messages(paths, account_id)?;
    if messages.is_empty() {
        return Err("Não há mensagens em cache para exportar.".to_string());
    }

    let destination = Path::new(destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Não foi possível preparar a pasta: {error}"))?;
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| format!("Não foi possível substituir o PST existente: {error}"))?;
    }

    for (index, message) in messages.iter().enumerate() {
        let recipients = message.to.iter().map(|recipient| UnicodePstRecipient {
            name: recipient.name.as_deref().unwrap_or(recipient.email.as_str()),
            email: recipient.email.as_str(),
            recipient_type: UnicodePstRecipientType::To,
        }).collect::<Vec<_>>();

        let sender_name = message.from.name.as_deref().unwrap_or(message.from.email.as_str());
        let body = message.body_text.as_deref().unwrap_or(message.preview.as_str());
        let pst_message = UnicodePstMessage {
            subject: message.subject.as_str(),
            sender_name,
            sender_email: message.from.email.as_str(),
            recipients: &recipients,
            body,
            html_body: message.body_html.as_deref(),
            message_id: message.id.as_str(),
            delivery_time: pst_filetime(&message.received_at),
        };

        if index == 0 {
            UnicodePstFile::create(destination, &pst_message)
                .map_err(|error| format!("Falha ao criar PST: {error}"))?;
        } else {
            UnicodePstFile::append(destination, &pst_message)
                .map_err(|error| format!("Falha ao adicionar mensagem ao PST: {error}"))?;
        }
    }

    Ok(messages.len())
}

#[cfg(test)]
mod attachment_export_safety_tests {
    use super::*;

    #[test]
    fn attachment_names_are_portable_and_bounded() {
        for name in ["CON.txt", "NUL", "COM1.pdf", "LPT².txt", "CONIN$", "AUX .doc"] {
            assert!(safe_attachment_name(name, 0).starts_with('_'), "{name}");
        }
        assert_eq!(safe_attachment_name(" . ", 0), "anexo-1");
        assert_eq!(safe_attachment_name("report.pdf. ", 0), "report.pdf");
        assert_eq!(safe_attachment_name("../a\\b:stream", 0), "_a_b_stream");
        let long = safe_attachment_name(&format!("{}.pdf", "á".repeat(200)), 0);
        assert!(long.len() <= 160);
        assert!(long.ends_with(".pdf"));
    }

    #[test]
    fn cleanup_only_removes_expired_uuid_directories() {
        use std::time::{Duration, SystemTime};
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let expired = root.join(uuid::Uuid::new_v4().to_string());
        let unrelated = root.join("keep");
        let file = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&expired).unwrap();
        fs::create_dir(&unrelated).unwrap();
        fs::write(&file, b"keep").unwrap();
        fs::write(expired.join("attachment.txt"), b"temporary").unwrap();
        let modified = fs::metadata(&expired).unwrap().modified().unwrap();
        cleanup_attachment_exports_at(&root, SystemTime::now()).unwrap();
        assert!(expired.is_dir());
        cleanup_attachment_exports_at(&root, modified + Duration::from_secs(3600)).unwrap();
        assert!(!expired.exists());
        assert!(unrelated.is_dir());
        assert!(file.is_file());
        fs::remove_dir_all(&root).unwrap();
        assert!(cleanup_attachment_exports_at(&root, SystemTime::now()).is_ok());
    }

    #[test]
    fn exporting_does_not_overwrite_original_or_previous_collision() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        fs::write(root.join("report.pdf"), b"original").unwrap();
        fs::write(root.join("report-1.pdf"), b"previous").unwrap();
        assert!(write_new_attachment(&root.join("report.pdf"), b"replacement").is_err());
        export_unique_attachment(&root, "report.pdf", b"new").unwrap();
        assert_eq!(fs::read(root.join("report.pdf")).unwrap(), b"original");
        assert_eq!(fs::read(root.join("report-1.pdf")).unwrap(), b"previous");
        assert_eq!(fs::read(root.join("report-2.pdf")).unwrap(), b"new");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlink_is_not_followed_when_exporting() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let target = root.join("target");
        std::os::unix::fs::symlink(&target, root.join("link")).unwrap();
        assert!(write_new_attachment(&root.join("link"), b"data").is_err());
        assert!(!target.exists());
        fs::remove_dir_all(root).unwrap();
    }
}

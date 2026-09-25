use crate::{
    credentials,
    local_crypto,
    models::AccountProfile,
    storage::AppPaths,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use openssl::{
    cms::{CmsContentInfo, CMSOptions},
    pkcs12::Pkcs12,
    stack::Stack,
    symm::Cipher,
    x509::X509,
};
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

const IDENTITY_SCOPE: &str = "smime-p12";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmimeIdentityStatus {
    pub configured: bool,
    pub subject: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmimeInspection {
    pub signed: bool,
    pub signature_valid: Option<bool>,
    pub encrypted: bool,
    pub decrypted: bool,
    pub decrypted_preview: Option<String>,
    pub error: Option<String>,
}

fn smime_dir(paths: &AppPaths) -> PathBuf {
    paths.config.join("smime")
}

fn identity_path(paths: &AppPaths, account_id: &str) -> PathBuf {
    smime_dir(paths).join(format!("{account_id}.p12"))
}

fn email_key(email: &str) -> String {
    let mut hasher = DefaultHasher::new();
    email.trim().to_ascii_lowercase().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn recipient_path(paths: &AppPaths, email: &str) -> PathBuf {
    smime_dir(paths)
        .join("recipients")
        .join(format!("{}.pem", email_key(email)))
}

fn parse_identity(paths: &AppPaths, account_id: &str) -> Result<(X509, openssl::pkey::PKey<openssl::pkey::Private>), String> {
    let bytes = local_crypto::read(&identity_path(paths, account_id))
        .map_err(|_| "Identidade S/MIME não configurada para esta conta.".to_string())?;
    let password = credentials::load_scoped(IDENTITY_SCOPE, account_id)?
        .ok_or_else(|| "Senha da identidade S/MIME não encontrada no Keyring.".to_string())?;
    let parsed = Pkcs12::from_der(&bytes)
        .and_then(|archive| archive.parse2(&password))
        .map_err(|error| format!("Não foi possível abrir a identidade S/MIME: {error}"))?;
    let cert = parsed.cert.ok_or_else(|| "PKCS#12 não contém certificado.".to_string())?;
    let pkey = parsed.pkey.ok_or_else(|| "PKCS#12 não contém chave privada.".to_string())?;
    Ok((cert, pkey))
}

fn load_certificate(path: &Path) -> Result<X509, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    X509::from_pem(&bytes)
        .or_else(|_| X509::from_der(&bytes))
        .map_err(|error| format!("Certificado X.509 inválido: {error}"))
}

fn load_stored_certificate(paths: &AppPaths, email: &str) -> Result<X509, String> {
    let bytes = local_crypto::read(&recipient_path(paths, email))
        .map_err(|_| format!("Certificado S/MIME não encontrado para {email}."))?;
    X509::from_pem(&bytes).map_err(|error| format!("Certificado salvo inválido para {email}: {error}"))
}

pub fn import_identity(paths: &AppPaths, account_id: &str, source: &str, password: &str) -> Result<SmimeIdentityStatus, String> {
    let raw = fs::read(source).map_err(|error| format!("Não foi possível ler o PKCS#12: {error}"))?;
    let parsed = Pkcs12::from_der(&raw)
        .and_then(|archive| archive.parse2(password))
        .map_err(|error| format!("PKCS#12 ou senha inválidos: {error}"))?;
    let cert = parsed.cert.ok_or_else(|| "PKCS#12 não contém certificado.".to_string())?;
    if parsed.pkey.is_none() {
        return Err("PKCS#12 não contém chave privada.".to_string());
    }

    fs::create_dir_all(smime_dir(paths)).map_err(|error| error.to_string())?;
    local_crypto::write(&identity_path(paths, account_id), &raw)?;
    credentials::store_scoped(IDENTITY_SCOPE, account_id, password)?;

    Ok(SmimeIdentityStatus {
        configured: true,
        subject: cert.subject_name().entries().next().map(|entry| entry.data().to_string()),
    })
}

pub fn identity_status(paths: &AppPaths, account_id: &str) -> Result<SmimeIdentityStatus, String> {
    if !identity_path(paths, account_id).exists() {
        return Ok(SmimeIdentityStatus { configured: false, subject: None });
    }
    let (cert, _) = parse_identity(paths, account_id)?;
    Ok(SmimeIdentityStatus {
        configured: true,
        subject: cert.subject_name().entries().next().map(|entry| entry.data().to_string()),
    })
}

pub fn remove_identity(paths: &AppPaths, account_id: &str) -> Result<(), String> {
    let path = identity_path(paths, account_id);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    credentials::delete_scoped(IDENTITY_SCOPE, account_id)
}

pub fn import_recipient_certificate(paths: &AppPaths, email: &str, source: &str) -> Result<(), String> {
    let email = email.trim();
    if email.is_empty() || !email.contains('@') {
        return Err("Informe um e-mail válido para o certificado.".to_string());
    }
    let cert = load_certificate(Path::new(source))?;
    let pem = cert.to_pem().map_err(|error| error.to_string())?;
    let path = recipient_path(paths, email);
    local_crypto::write(&path, &pem)
}

pub fn has_recipient_certificate(paths: &AppPaths, email: &str) -> bool {
    recipient_path(paths, email).exists()
}

fn wrap_base64(bytes: &[u8]) -> String {
    let encoded = BASE64.encode(bytes);
    encoded
        .as_bytes()
        .chunks(76)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn split_message(raw: &[u8]) -> (String, Vec<u8>, Vec<u8>) {
    let text = String::from_utf8_lossy(raw);
    let separator = text.find("\r\n\r\n").map(|index| (index, 4))
        .or_else(|| text.find("\n\n").map(|index| (index, 2)))
        .unwrap_or((text.len(), 0));
    let headers = &text[..separator.0];
    let body_start = separator.0 + separator.1;
    let body = raw.get(body_start..).unwrap_or_default().to_vec();

    let mut outer = Vec::<String>::new();
    let mut content = Vec::<String>::new();
    let mut target_content = false;
    for line in headers.lines() {
        let lower = line.to_ascii_lowercase();
        if line.starts_with(' ') || line.starts_with('\t') {
            if target_content {
                content.push(line.to_string());
            } else {
                outer.push(line.to_string());
            }
            continue;
        }
        target_content = lower.starts_with("content-") || lower.starts_with("mime-version:");
        if target_content {
            content.push(line.to_string());
        } else {
            outer.push(line.to_string());
        }
    }

    let mut entity = content.join("\r\n").into_bytes();
    entity.extend_from_slice(b"\r\n\r\n");
    entity.extend_from_slice(&body);
    (outer.join("\r\n"), entity, body)
}

fn smime_entity(der: &[u8], kind: &str) -> Vec<u8> {
    format!(
        "MIME-Version: 1.0\r\nContent-Type: application/pkcs7-mime; smime-type={kind}; name=\"smime.p7m\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"smime.p7m\"\r\n\r\n{}\r\n",
        wrap_base64(der)
    ).into_bytes()
}

fn assemble(outer_headers: &str, entity: &[u8]) -> Vec<u8> {
    let mut out = outer_headers.as_bytes().to_vec();
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(entity);
    out
}

pub fn protect_message(
    paths: &AppPaths,
    account: &AccountProfile,
    recipients: &[String],
    raw: &[u8],
    sign: bool,
    encrypt: bool,
) -> Result<Vec<u8>, String> {
    if !sign && !encrypt {
        return Ok(raw.to_vec());
    }

    let (outer_headers, mut entity, _) = split_message(raw);

    if sign {
        let (cert, pkey) = parse_identity(paths, &account.id)?;
        let cms = CmsContentInfo::sign(
            Some(&cert),
            Some(&pkey),
            None,
            Some(&entity),
            CMSOptions::BINARY,
        ).map_err(|error| format!("Falha ao assinar S/MIME: {error}"))?;
        entity = smime_entity(&cms.to_der().map_err(|error| error.to_string())?, "signed-data");
    }

    if encrypt {
        let mut certs = Stack::new().map_err(|error| error.to_string())?;
        let mut missing = Vec::new();
        for email in recipients {
            match load_stored_certificate(paths, email) {
                Ok(cert) => certs.push(cert).map_err(|error| error.to_string())?,
                Err(_) => missing.push(email.clone()),
            }
        }
        if missing.is_empty() {
            if let Ok((own_cert, _)) = parse_identity(paths, &account.id) {
                certs.push(own_cert).map_err(|error| error.to_string())?;
            }
        } else {
            return Err(format!("Faltam certificados S/MIME para: {}", missing.join(", ")));
        }

        let cms = CmsContentInfo::encrypt(
            &certs,
            &entity,
            Cipher::aes_256_cbc(),
            CMSOptions::BINARY,
        ).map_err(|error| format!("Falha ao criptografar S/MIME: {error}"))?;
        entity = smime_entity(&cms.to_der().map_err(|error| error.to_string())?, "enveloped-data");
    }

    Ok(assemble(&outer_headers, &entity))
}

fn extract_pkcs7(raw: &[u8]) -> Result<(String, Vec<u8>), String> {
    let text = String::from_utf8_lossy(raw);
    let lower = text.to_ascii_lowercase();
    let kind = if lower.contains("smime-type=enveloped-data") {
        "enveloped-data"
    } else if lower.contains("smime-type=signed-data") {
        "signed-data"
    } else {
        return Err("A mensagem não contém um envelope S/MIME compatível.".to_string());
    };
    let body = text.split_once("\r\n\r\n")
        .map(|(_, value)| value)
        .or_else(|| text.split_once("\n\n").map(|(_, value)| value))
        .unwrap_or("");
    let compact = body.lines()
        .take_while(|line| !line.starts_with("--"))
        .map(str::trim)
        .collect::<String>();
    let der = BASE64.decode(compact.as_bytes()).map_err(|error| format!("Conteúdo S/MIME inválido: {error}"))?;
    Ok((kind.to_string(), der))
}

fn inspect_entity(paths: &AppPaths, account_id: &str, raw: &[u8]) -> SmimeInspection {
    let mut result = SmimeInspection {
        signed: false,
        signature_valid: None,
        encrypted: false,
        decrypted: false,
        decrypted_preview: None,
        error: None,
    };

    let Ok((kind, der)) = extract_pkcs7(raw) else {
        return result;
    };

    if kind == "enveloped-data" {
        result.encrypted = true;
        match CmsContentInfo::from_der(&der) {
            Ok(cms) => match parse_identity(paths, account_id)
                .and_then(|(cert, pkey)| cms.decrypt(&pkey, &cert).map_err(|error| error.to_string()))
            {
                Ok(decrypted) => {
                    result.decrypted = true;
                    result.decrypted_preview = Some(String::from_utf8_lossy(&decrypted).chars().take(4000).collect());
                    let nested = inspect_entity(paths, account_id, &decrypted);
                    if nested.signed {
                        result.signed = true;
                        result.signature_valid = nested.signature_valid;
                        if nested.error.is_some() {
                            result.error = nested.error;
                        }
                    }
                }
                Err(error) => result.error = Some(error),
            },
            Err(error) => result.error = Some(error.to_string()),
        }
        return result;
    }

    result.signed = true;
    match CmsContentInfo::from_der(&der) {
        Ok(mut cms) => {
            let mut output = Vec::new();
            match cms.verify(
                None,
                None,
                None,
                Some(&mut output),
                CMSOptions::NOVERIFY | CMSOptions::BINARY,
            ) {
                Ok(()) => {
                    result.signature_valid = Some(true);
                    result.decrypted_preview = Some(String::from_utf8_lossy(&output).chars().take(4000).collect());
                }
                Err(error) => {
                    result.signature_valid = Some(false);
                    result.error = Some(format!("Assinatura S/MIME inválida: {error}"));
                }
            }
        }
        Err(error) => result.error = Some(error.to_string()),
    }
    result
}

pub fn inspect_message(paths: &AppPaths, account_id: &str, message_id: &str) -> Result<SmimeInspection, String> {
    let raw = crate::storage::read_raw_message(paths, account_id, message_id)?;
    Ok(inspect_entity(paths, account_id, &raw))
}

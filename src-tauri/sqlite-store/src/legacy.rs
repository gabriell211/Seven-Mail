//! Read-only adapter for a quiescent Seven Mail cache snapshot.
//! The caller supplies authenticated AES-GCM decryption; no plaintext is written.
use crate::{MessageRecord, Result, Store};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::{Read, Write}, path::{Path, PathBuf}};

const LEGACY_MAGIC: &[u8] = b"SEVENMAIL-ENC-1\0";
const MAX_FILE: u64 = 32 * 1024 * 1024;
const MAX_FILES: usize = 1_000_000;
type Identity = (String, String);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Address {
    name: Option<String>,
    email: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMessage {
    id: String,
    account_id: String,
    folder: String,
    subject: String,
    preview: String,
    from: Address,
    to: Vec<Address>,
    received_at: String,
    #[serde(rename = "isRead")]
    _is_read: bool,
    #[serde(rename = "isFlagged")]
    _is_flagged: bool,
    #[serde(rename = "isPinned")]
    _is_pinned: bool,
    #[serde(rename = "hasAttachments")]
    _has_attachments: bool,
    body_text: Option<String>,
    body_html: Option<String>,
    categories: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    pub messages: usize,
    pub accounts: usize,
    pub source_fingerprint: String,
}

fn io_error(_: std::io::Error) -> String {
    "Não foi possível ler o snapshot legado.".into()
}

fn valid_component(value: &str) -> bool {
    !value.is_empty() && value.len() <= 180 && value != "." && !value.contains("..")
        && !value.chars().any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':'))
}

fn name(path: &Path) -> Result<String> {
    path.file_name().and_then(|value| value.to_str()).filter(|value| valid_component(value))
        .map(str::to_owned).ok_or_else(|| "Nome inválido no snapshot legado.".into())
}

fn require_directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Diretório legado inválido ou link simbólico.".into());
    }
    Ok(())
}

fn inventory(root: &Path) -> Result<BTreeMap<Identity, PathBuf>> {
    require_directory(root)?;
    let mut files = BTreeMap::new();
    for entry in fs::read_dir(root).map_err(io_error)? {
        let account_path = entry.map_err(io_error)?.path();
        require_directory(&account_path)?;
        let account = name(&account_path)?;
        for entry in fs::read_dir(&account_path).map_err(io_error)? {
            let path = entry.map_err(io_error)?.path();
            let meta = fs::symlink_metadata(&path).map_err(io_error)?;
            if meta.file_type().is_symlink() { return Err("Link simbólico no cache legado.".into()); }
            // EML source files are deliberately not migrated in this phase.
            if path.file_name().and_then(|v| v.to_str()) == Some("_raw") && meta.is_dir() { continue; }
            if !meta.is_file() || path.extension().and_then(|v| v.to_str()) != Some("json") {
                return Err("Arquivo inesperado no cache legado; migração suspensa.".into());
            }
            let id = path.file_stem().and_then(|value| value.to_str()).filter(|v| valid_component(v))
                .ok_or_else(|| "Identificador legado inválido.".to_string())?.to_owned();
            if files.len() >= MAX_FILES || files.insert((account.clone(), id), path).is_some() {
                return Err("Inventário legado excede o limite ou possui identidade duplicada.".into());
            }
        }
    }
    Ok(files)
}

fn encrypted_file(path: &Path) -> Result<Vec<u8>> {
    let parent = path.parent().ok_or_else(|| "Caminho legado inválido.".to_string())?;
    require_directory(parent)?;
    let meta = fs::symlink_metadata(path).map_err(io_error)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_FILE {
        return Err("Arquivo legado inválido ou acima do limite.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(io_error)?.take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() as u64 > MAX_FILE || !bytes.starts_with(LEGACY_MAGIC) || bytes.len() <= LEGACY_MAGIC.len()+12+16 {
        return Err("Arquivo legado sem criptografia válida.".into());
    }
    Ok(bytes)
}

fn address(value: &Address) -> String {
    format!("{} {}", value.name.as_deref().unwrap_or(""), value.email)
}

fn decode(identity: &Identity, plain: &[u8]) -> Result<MessageRecord> {
    let message: LegacyMessage = serde_json::from_slice(plain)
        .map_err(|_| "Metadados de mensagem legada inválidos.".to_string())?;
    if message.account_id != identity.0 || message.id != identity.1 {
        return Err("Identidade do conteúdo diverge do caminho legado.".into());
    }
    let received = chrono::DateTime::parse_from_rfc3339(&message.received_at)
        .map_err(|_| "Data da mensagem legada inválida.".to_string())?;
    let payload = std::str::from_utf8(plain).map_err(|_| "JSON legado não está em UTF-8.".to_string())?.to_owned();
    // Preserve the original JSON byte-for-byte, including unknown fields, UID,
    // remote folder, flags, attachments and future metadata.
    let body = format!("{} {}", message.preview, message.body_text.as_deref().unwrap_or(""));
    let _ = message.body_html;
    Ok(MessageRecord {
        account_id: message.account_id, message_id: message.id, received_ms: received.timestamp_millis(),
        folder: message.folder, subject: message.subject, sender: address(&message.from),
        recipients: message.to.iter().map(address).collect::<Vec<_>>().join(" "),
        body, categories: message.categories.join(" "), payload,
    })
}

fn fingerprint(digests: &BTreeMap<Identity, [u8; 32]>) -> String {
    let mut hash = Sha256::new();
    for ((account, id), digest) in digests {
        for value in [account, id] {
            hash.update((value.len() as u64).to_be_bytes());
            hash.update(value.as_bytes());
        }
        hash.update(digest);
    }
    format!("{:x}", hash.finalize())
}

/// Create a new encrypted-only snapshot from a quiescent legacy cache.
/// The caller must stop all writers before this operation. A failed or
/// interrupted copy has no completion marker and cannot be used for cutover.
/// No source file is modified, and an existing destination is never reused.
pub fn create_snapshot(source: &Path, destination: &Path) -> Result<MigrationReport> {
    require_directory(source)?;
    let source = fs::canonicalize(source).map_err(io_error)?;
    let parent = destination.parent().ok_or_else(|| "Destino inválido.".to_string())?;
    require_directory(parent)?;
    let parent = fs::canonicalize(parent).map_err(io_error)?;
    let destination = parent.join(name(destination)?);
    if destination.starts_with(&source) || source.starts_with(&destination) {
        return Err("Snapshot deve estar fora do cache legado.".into());
    }
    // create_dir is exclusive: never delete or modify a pre-existing backup.
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(&destination).map_err(io_error)?;
    let result = (|| -> Result<MigrationReport> {
        let root = destination.join("messages");
        builder.create(&root).map_err(io_error)?;
        let files = inventory(&source)?;
        let mut digests = BTreeMap::new();
        let mut accounts = std::collections::BTreeSet::new();
        for ((account, id), path) in &files {
            let dir = root.join(account);
            if accounts.insert(account.clone()) { builder.create(&dir).map_err(io_error)?; }
            let bytes = encrypted_file(path)?;
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut output = options.open(dir.join(format!("{id}.json"))).map_err(io_error)?;
            output.write_all(&bytes).and_then(|_| output.sync_all()).map_err(io_error)?;
            digests.insert((account.clone(), id.clone()), Sha256::digest(&bytes).into());
        }
        if inventory(&source)? != files { return Err("Inventário mudou durante a cópia.".into()); }
        let copied = inventory(&root)?;
        if copied.len() != files.len() { return Err("Contagem de snapshot inválida.".into()); }
        for (identity, path) in &files {
            let actual: [u8;32] = Sha256::digest(encrypted_file(path)?).into();
            let target = copied.get(identity).ok_or_else(|| "Arquivo ausente no snapshot.".to_string())?;
            let backup: [u8;32] = Sha256::digest(encrypted_file(target)?).into();
            if digests.get(identity) != Some(&actual) || actual != backup {
                return Err("Conteúdo mudou durante a cópia.".into());
            }
        }
        #[cfg(unix)]
        {
            for account in &accounts { fs::File::open(root.join(account)).and_then(|dir| dir.sync_all()).map_err(io_error)?; }
            fs::File::open(&root).and_then(|dir| dir.sync_all()).map_err(io_error)?;
        }
        let report = MigrationReport { messages: files.len(), accounts: accounts.len(), source_fingerprint: fingerprint(&digests) };
        let manifest = serde_json::json!({"version":1,"messages":report.messages,"accounts":report.accounts,"fingerprint":report.source_fingerprint});
        let manifest_bytes = serde_json::to_vec(&manifest).map_err(|_| "Manifesto inválido.".to_string())?;
        let mut marker = fs::OpenOptions::new().write(true).create_new(true).open(destination.join("snapshot.complete.json")).map_err(io_error)?;
        marker.write_all(&manifest_bytes).and_then(|_| marker.sync_all()).map_err(io_error)?;
        #[cfg(unix)]
        {
            fs::File::open(&destination).and_then(|dir| dir.sync_all()).map_err(io_error)?;
            fs::File::open(&parent).and_then(|dir| dir.sync_all()).map_err(io_error)?;
        }
        Ok(report)
    })();
    // Retain incomplete copies for inspection; never infer successful completion
    // from a directory's existence. A new attempt uses a new destination.
    result
}

/// Imports only from an offline, stable snapshot; the active application must
/// not write into this tree. Detects accidental source drift before committing.
/// The decryptor must authenticate ciphertext and reject missing/wrong keys.
pub fn migrate_snapshot<F>(store: &mut Store, root: &Path, decrypt: F) -> Result<MigrationReport>
where F: FnMut(&[u8]) -> Result<Vec<u8>> {
    migrate_snapshot_inner(store, root, decrypt, None)
}

#[derive(Deserialize)]
struct SnapshotManifest {
    version: u32,
    messages: usize,
    accounts: usize,
    fingerprint: String,
}

/// Import a completed snapshot, requiring the manifest to match the source
/// before the database transaction commits.
pub fn migrate_completed_snapshot<F>(store: &mut Store, snapshot: &Path, decrypt: F) -> Result<MigrationReport>
where F: FnMut(&[u8]) -> Result<Vec<u8>> {
    require_directory(snapshot)?;
    let path = snapshot.join("snapshot.complete.json");
    let meta = fs::symlink_metadata(&path).map_err(io_error)?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 4096 {
        return Err("Manifesto de snapshot inválido.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(&path).map_err(io_error)?.take(4097).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len()>4096 { return Err("Manifesto excede limite.".into()); }
    let manifest: SnapshotManifest = serde_json::from_slice(&bytes).map_err(|_| "Snapshot incompleto ou manifesto inválido.".to_string())?;
    if manifest.version != 1 || manifest.fingerprint.len()!=64 || !manifest.fingerprint.bytes().all(|ch|ch.is_ascii_hexdigit()) {
        return Err("Versão ou fingerprint de snapshot inválido.".into());
    }
    migrate_snapshot_inner(store, &snapshot.join("messages"), decrypt, Some(&manifest))
}

fn migrate_snapshot_inner<F>(store: &mut Store, root: &Path, mut decrypt: F, manifest: Option<&SnapshotManifest>) -> Result<MigrationReport>
where F: FnMut(&[u8]) -> Result<Vec<u8>> {
    let files = inventory(root)?;
    let accounts = files.keys().map(|(account, _)| account).collect::<std::collections::BTreeSet<_>>().len();
    if let Some(manifest) = manifest {
        if manifest.messages != files.len() || manifest.accounts != accounts {
            return Err("Contagem diverge do manifesto do snapshot.".into());
        }
    }
    let mut digests = BTreeMap::new();
    let mut iter = files.iter();
    let mut checked = false;
    let records = std::iter::from_fn(|| {
        if let Some((identity, path)) = iter.next() {
            return Some((|| {
                let bytes = encrypted_file(path)?;
                digests.insert(identity.clone(), Sha256::digest(&bytes).into());
                let plain = decrypt(&bytes)?;
                if plain.len() as u64 > MAX_FILE { return Err("Mensagem acima do limite.".into()); }
                decode(identity, &plain)
            })());
        }
        if checked { return None; }
        checked = true;
        let check = (|| -> Result<()> {
            if inventory(root)? != files { return Err("Inventário mudou durante a migração.".into()); }
            for (identity, path) in &files {
                let digest: [u8;32] = Sha256::digest(encrypted_file(path)?).into();
                if digests.get(identity) != Some(&digest) {
                    return Err("Conteúdo legado mudou durante a migração.".into());
                }
            }
            if let Some(manifest) = manifest {
                if manifest.fingerprint != fingerprint(&digests) {
                    return Err("Fingerprint diverge do manifesto do snapshot.".into());
                }
            }
            Ok(())
        })();
        check.err().map(Err)
    });
    let count = store.import_exact_snapshot(records, files.len())?;
    Ok(MigrationReport { messages: count, accounts, source_fingerprint: fingerprint(&digests) })
}

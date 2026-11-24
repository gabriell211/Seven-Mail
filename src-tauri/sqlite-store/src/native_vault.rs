//! Native-only staging adapter. No IPC, activation, or writes to legacy data.
use crate::{legacy::{create_snapshot, migrate_completed_snapshot, verify_completed_snapshot, MigrationReport}, Result, Store};
use aes_gcm::{aead::{Aead, KeyInit, OsRng, rand_core::RngCore}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex};
use zeroize::Zeroizing;

const SQL_SERVICE: &str = "Seven Mail SQLCipher";
const LEGACY_SERVICE: &str = "Seven Mail";
const LEGACY_ID: &str = "__local_storage_key__";
const MAGIC: &[u8] = b"SEVENMAIL-ENC-1\0";
static VAULT_LOCK: Mutex<()> = Mutex::new(());

trait Vault {
    fn read(&self, service: &str, id: &str) -> Result<Option<Zeroizing<String>>>;
    fn write(&self, service: &str, id: &str, value: &str) -> Result<()>;
}
struct NativeVault;
impl Vault for NativeVault {
    fn read(&self, service: &str, id: &str) -> Result<Option<Zeroizing<String>>> {
        let entry=keyring::Entry::new(service,id).map_err(|_| "Cofre nativo indisponível.".to_string())?;
        match entry.get_password() {
            Ok(value)=>Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry)=>Ok(None),
            Err(_)=>Err("Não foi possível acessar o cofre nativo.".into()),
        }
    }
    fn write(&self, service: &str, id: &str, value: &str) -> Result<()> {
        keyring::Entry::new(service,id).and_then(|entry|entry.set_password(value))
            .map_err(|_| "Não foi possível gravar no cofre nativo.".into())
    }
}
fn decode_key(encoded: &str) -> Result<Zeroizing<[u8;32]>> {
    let bytes=Zeroizing::new(STANDARD.decode(encoded).map_err(|_| "Chave inválida no cofre.".to_string())?);
    let key: [u8;32]=bytes.as_slice().try_into().map_err(|_| "Tamanho de chave inválido.".to_string())?;
    Ok(Zeroizing::new(key))
}
fn existing_key(vault: &impl Vault, service: &str, id: &str) -> Result<Zeroizing<[u8;32]>> {
    let encoded=vault.read(service,id)?.ok_or_else(||"Chave original ausente; nenhum dado foi substituído.".to_string())?;
    decode_key(&encoded)
}
fn new_key(vault: &impl Vault, id: &str) -> Result<Zeroizing<[u8;32]>> {
    if vault.read(SQL_SERVICE,id)?.is_some() {
        return Err("Identidade de armazenamento já existe; não será sobrescrita.".into());
    }
    let mut key=Zeroizing::new([0u8;32]);
    OsRng.fill_bytes(&mut key[..]);
    let encoded=Zeroizing::new(STANDARD.encode(&key[..]));
    vault.write(SQL_SERVICE,id,&encoded)?;
    let confirmed=existing_key(vault,SQL_SERVICE,id)?;
    if confirmed[..]!=key[..] { return Err("Cofre não confirmou a chave gerada.".into()); }
    Ok(key)
}
fn decrypt_legacy(key: &[u8;32], bytes: &[u8]) -> Result<Vec<u8>> {
    if !bytes.starts_with(MAGIC) || bytes.len()<MAGIC.len()+12+16 {
        return Err("Envelope legado inválido.".into());
    }
    let start=MAGIC.len();
    let cipher=Aes256Gcm::new_from_slice(key).map_err(|_|"Chave inválida.".to_string())?;
    cipher.decrypt(Nonce::from_slice(&bytes[start..start+12]),&bytes[start+12..])
        .map_err(|_| "Falha de autenticação dos dados legados.".into())
}
fn staging_identity(path: &Path) -> Result<String> {
    let id=path.file_name().and_then(|v|v.to_str()).ok_or_else(||"Identidade de staging inválida.".to_string())?;
    if id.len()!=32 || !id.bytes().all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v)) {
        return Err("Use um identificador aleatório hexadecimal de 32 caracteres.".into());
    }
    Ok(id.to_owned())
}
fn create_private_directory(path:&Path)->Result<()> {
    let parent=path.parent().ok_or_else(||"Destino inválido.".to_string())?;
    let meta=fs::symlink_metadata(parent).map_err(|_|"Diretório de staging indisponível.".to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink(){return Err("Diretório de staging inválido.".into());}
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(path).map_err(|_|"Destino já existe ou não pôde ser criado.".into())
}

#[derive(Debug, Clone)]
pub struct OfflinePreparation {
    pub staging: PathBuf,
    pub report: MigrationReport,
}

/// Create and validate an isolated database while excluding the compatible
/// desktop process. Older versions must be fully stopped separately.
/// Nothing here changes the application's active storage.
pub fn prepare_offline(data_root: &Path) -> Result<OfflinePreparation> {
    let _guard = crate::storage_guard::StorageGuard::maintenance(data_root)?;
    let root = fs::canonicalize(data_root).map_err(|_| "Diretório de dados indisponível.".to_string())?;
    let source = root.join("cache").join("messages");
    for path in [&root.join("cache"), &source] {
        let meta = fs::symlink_metadata(path).map_err(|_| "Cache legado indisponível.".to_string())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Diretório legado inválido.".into());
        }
    }
    // Verify availability of the original key before creating a backup.
    let _legacy = existing_key(&NativeVault, LEGACY_SERVICE, LEGACY_ID)?;
    let mut random = [0u8; 16];
    OsRng.fill_bytes(&mut random);
    let id = random.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join("");
    let parent = root.join("sqlite-preparation");
    if let Err(error) = fs::symlink_metadata(&parent) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err("Diretório de preparação indisponível.".into());
        }
        create_private_directory(&parent)?;
    }
    let meta = fs::symlink_metadata(&parent).map_err(|_| "Diretório de preparação inválido.".to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Diretório de preparação inválido.".into());
    }
    let attempt = parent.join(&id);
    create_private_directory(&attempt)?;
    let snapshot = attempt.join("snapshot");
    let staging = attempt.join(&id);
    let expected = create_snapshot(&source, &snapshot)?;
    let report = prepare_native_staging(&snapshot, &staging)?;
    if report != expected { return Err("Relatório de preparação diverge do backup.".into()); }
    let reopened = open_native_staging(&staging)?;
    let legacy = existing_key(&NativeVault, LEGACY_SERVICE, LEGACY_ID)?;
    let verified = verify_completed_snapshot(&reopened, &snapshot, |bytes| decrypt_legacy(&legacy, bytes))?;
    if verified != report {
        return Err("Reabertura diverge do snapshot autenticado.".into());
    }
    Ok(OfflinePreparation { staging, report })
}

/// Prepare a new database from a completed offline snapshot. The caller must
/// provide a private staging parent, a globally unique random directory ID,
/// and ensure the active application is not using the snapshot. Never activates
/// the database or deletes the source. A failed attempt remains isolated.
pub fn prepare_native_staging(snapshot:&Path, staging:&Path)->Result<MigrationReport>{
    prepare_with_vault(&NativeVault,snapshot,staging)
}
fn prepare_with_vault(vault:&impl Vault,snapshot:&Path,staging:&Path)->Result<MigrationReport>{
    let _guard=VAULT_LOCK.lock().map_err(|_|"Cofre indisponível.".to_string())?;
    let id=staging_identity(staging)?;
    let legacy=existing_key(vault,LEGACY_SERVICE,LEGACY_ID)?;
    // Reserve the destination before creating its unique vault entry.
    create_private_directory(staging)?;
    let key=new_key(vault,&id)?;
    let mut store=Store::open(&staging.join("messages.db"),&key)?;
    let report=migrate_completed_snapshot(&mut store,snapshot,|bytes|decrypt_legacy(&legacy,bytes))?;
    store.verify()?;
    drop(store);
    let manifest=serde_json::to_vec(&serde_json::json!({
        "version":1,"messages":report.messages,"fingerprint":report.source_fingerprint
    })).map_err(|_|"Manifesto de staging inválido.".to_string())?;
    let mut options=fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut marker=options.open(staging.join("staging.complete.json")).map_err(|_|"Não foi possível confirmar staging.".to_string())?;
    marker.write_all(&manifest).and_then(|_|marker.sync_all()).map_err(|_|"Não foi possível persistir confirmação.".to_string())?;
    #[cfg(unix)]
    fs::File::open(staging).and_then(|dir|dir.sync_all()).map_err(|_|"Não foi possível persistir diretório.".to_string())?;
    Ok(report)
}

#[derive(serde::Deserialize)]
struct Completion {
    version:u32,
    messages:usize,
    fingerprint:String,
}
fn read_completion(staging:&Path)->Result<Completion>{
    let path=staging.join("staging.complete.json");
    let meta=fs::symlink_metadata(&path).map_err(|_|"Staging incompleto.".to_string())?;
    if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>4096{return Err("Confirmação de staging inválida.".into());}
    let mut bytes=Vec::new();
    fs::File::open(path).and_then(|file|file.take(4097).read_to_end(&mut bytes)).map_err(|_|"Confirmação de staging indisponível.".to_string())?;
    if bytes.len()>4096{return Err("Confirmação excede limite.".into());}
    let completion:Completion=serde_json::from_slice(&bytes).map_err(|_|"Confirmação de staging inválida.".to_string())?;
    if completion.version!=1||completion.fingerprint.len()!=64||!completion.fingerprint.bytes().all(|v|v.is_ascii_hexdigit()){
        return Err("Versão ou fingerprint de staging inválido.".into());
    }
    Ok(completion)
}

/// Reopen a completed staging database for validation, without generating a\n/// replacement key. Do not use this as the active mutable mail store.
pub fn open_native_staging(staging:&Path)->Result<Store>{
    let _guard=VAULT_LOCK.lock().map_err(|_|"Cofre indisponível.".to_string())?;
    let id=staging_identity(staging)?;
    let meta=fs::symlink_metadata(staging).map_err(|_|"Staging inexistente.".to_string())?;
    if !meta.is_dir()||meta.file_type().is_symlink(){return Err("Staging inválido.".into());}
    let path=staging.join("messages.db");
    let meta=fs::symlink_metadata(&path).map_err(|_|"Banco de staging inexistente.".to_string())?;
    if !meta.is_file()||meta.file_type().is_symlink(){return Err("Banco de staging inválido.".into());}
    let completion=read_completion(staging)?;
    let key=existing_key(&NativeVault,SQL_SERVICE,&id)?;
    let store=Store::open_read_only(&path,&key)?;
    store.verify()?;
    let count:i64=store.conn.query_row("SELECT count(*) FROM messages",[],|row|row.get(0)).map_err(crate::db_error)?;
    if count<0||count as u64!=completion.messages as u64{
        return Err("Contagem do banco preparado diverge da confirmação.".into());
    }
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell,collections::BTreeMap};
    #[derive(Default)]
    struct MemoryVault(RefCell<BTreeMap<(String,String),String>>);
    impl Vault for MemoryVault {
        fn read(&self,service:&str,id:&str)->Result<Option<Zeroizing<String>>>{
            Ok(self.0.borrow().get(&(service.into(),id.into())).cloned().map(Zeroizing::new))
        }
        fn write(&self,service:&str,id:&str,value:&str)->Result<()>{
            self.0.borrow_mut().insert((service.into(),id.into()),value.into());Ok(())
        }
    }
    #[test]
    fn missing_or_invalid_original_key_never_creates_a_replacement(){
        let vault=MemoryVault::default();
        assert!(existing_key(&vault,LEGACY_SERVICE,LEGACY_ID).is_err());
        assert!(vault.0.borrow().is_empty());
        vault.write(LEGACY_SERVICE,LEGACY_ID,"invalid").unwrap();
        assert!(existing_key(&vault,LEGACY_SERVICE,LEGACY_ID).is_err());
    }
    #[test]
    fn generated_key_is_separate_confirmed_and_not_replaced(){
        let vault=MemoryVault::default();
        vault.write(LEGACY_SERVICE,LEGACY_ID,&STANDARD.encode([1u8;32])).unwrap();
        let key=new_key(&vault,"stage").unwrap();
        assert_eq!(&key[..],&existing_key(&vault,SQL_SERVICE,"stage").unwrap()[..]);
        assert_ne!(&key[..],&existing_key(&vault,LEGACY_SERVICE,LEGACY_ID).unwrap()[..]);
        assert!(new_key(&vault,"stage").is_err());
        assert_eq!(&key[..],&existing_key(&vault,SQL_SERVICE,"stage").unwrap()[..]);
    }
}

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, rand_core::RngCore},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::{fs, io::Write, path::Path};

use crate::credentials;

const MAGIC: &[u8] = b"SEVENMAIL-ENC-1\0";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

fn key_bytes(create: bool) -> Result<[u8; KEY_LEN], String> {
    static KEY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = KEY_LOCK.lock().map_err(|_| "Falha ao acessar chave local.".to_string())?;
    if let Some(encoded) = credentials::load_local_storage_key()? {
        let decoded = BASE64.decode(encoded).map_err(|error| error.to_string())?;
        let bytes: [u8; KEY_LEN] = decoded
            .as_slice()
            .try_into()
            .map_err(|_| "Chave local armazenada possui tamanho inválido.".to_string())?;
        return Ok(bytes);
    }

    if !create {
        return Err("Chave local ausente no cofre do sistema. Os dados existentes foram preservados; restaure a chave original.".into());
    }
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    credentials::store_local_storage_key(&BASE64.encode(key))?;
    // Verify the actual persistent backend before using a newly created key.
    let stored = credentials::load_local_storage_key()?.ok_or_else(|| "Cofre do sistema não persistiu a chave.".to_string())?;
    if BASE64.decode(stored).map_err(|_| "Chave armazenada inválida.".to_string())?.as_slice() != key.as_slice() {
        return Err("Chave persistida diverge da chave gerada.".into());
    }
    Ok(key)
}

pub fn is_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

pub fn encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = key_bytes(true)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain)
        .map_err(|_| "Falha ao criptografar dados locais.".to_string())?;

    let mut output = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

pub fn decrypt_or_plain(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if !is_encrypted(bytes) {
        return Ok(bytes.to_vec());
    }

    if bytes.len() < MAGIC.len() + NONCE_LEN + 16 {
        return Err("Arquivo local criptografado inválido.".to_string());
    }

    let key = key_bytes(false)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce_start = MAGIC.len();
    let nonce_end = nonce_start + NONCE_LEN;
    cipher
        .decrypt(
            Nonce::from_slice(&bytes[nonce_start..nonce_end]),
            &bytes[nonce_end..],
        )
        .map_err(|_| "Não foi possível descriptografar dados locais. Verifique o Keyring do sistema.".to_string())
}

pub fn read(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    decrypt_or_plain(&bytes)
}

pub fn write(path: &Path, plain: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Caminho local inválido.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    // Never replace an encrypted file if the original key is unavailable.
    if path.is_file() {
        let previous = fs::read(path).map_err(|error| error.to_string())?;
        if is_encrypted(&previous) { decrypt_or_plain(&previous)?; }
    }
    let encrypted = encrypt(plain)?;
    atomic_write(path, &encrypted)
}

// The temporary file lives on the same filesystem as the destination.
// Never truncate the existing file before the replacement is durable.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Caminho local inválido.".to_string())?;
    let temporary = parent.join(format!(".sevenmail-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    let result = written.and_then(|_| fs::rename(&temporary, path));
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn encrypt_file_if_needed(path: &Path) -> Result<usize, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if is_encrypted(&bytes) {
        return Ok(0);
    }
    write(path, &bytes)?;
    Ok(1)
}

fn contains_encrypted(path: &Path) -> Result<bool, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    if meta.file_type().is_symlink() {
        return Err("Link simbólico inesperado nos dados locais.".into());
    }
    if meta.is_file() {
        use std::io::Read;
        let mut prefix = vec![0; MAGIC.len()];
        let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
        return match file.read_exact(&mut prefix) {
            Ok(()) => Ok(is_encrypted(&prefix)),
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
            Err(error) => Err(error.to_string()),
        };
    }
    if !meta.is_dir() { return Err("Entrada local inválida.".into()); }
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        if contains_encrypted(&entry.map_err(|error| error.to_string())?.path())? { return Ok(true); }
    }
    Ok(false)
}

fn encrypt_tree_inner(path: &Path) -> Result<usize, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };
    if meta.file_type().is_symlink() { return Err("Link simbólico inesperado nos dados locais.".into()); }
    if meta.is_file() { return encrypt_file_if_needed(path); }
    if !meta.is_dir() { return Err("Entrada local inválida.".into()); }
    let mut count = 0usize;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let child = entry.map_err(|error| error.to_string())?.path();
        count += encrypt_tree_inner(&child)?;
    }
    Ok(count)
}

pub fn migrate_local_data(root: &Path) -> Result<usize, String> {
    static MIGRATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = MIGRATION_LOCK.lock().map_err(|_| "Migração local indisponível.".to_string())?;
    let marker = root.join(".encrypted-v1");
    let directories = ["config", "cache", "queue", "state"];
    if credentials::load_local_storage_key()?.is_none() {
        for relative in directories {
            if contains_encrypted(&root.join(relative))? {
                return Err("Chave local ausente com arquivos criptografados existentes. Nenhum dado foi alterado.".into());
            }
        }
        key_bytes(true)?;
    }
    if marker.exists() { return Ok(0); }
    let mut count = 0usize;
    for relative in directories {
        count += encrypt_tree_inner(&root.join(relative))?;
    }
    atomic_write(&marker, b"v1")?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_bytes() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let path = root.join("cache.json");
        atomic_write(&path, b"original").unwrap();
        atomic_write(&path, b"replacement").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_replacement_preserves_destination_and_cleans_temp() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let path = root.join("occupied");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("keep"), b"original").unwrap();
        assert!(atomic_write(&path, b"replacement").is_err());
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

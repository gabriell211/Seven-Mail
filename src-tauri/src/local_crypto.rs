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

fn key_bytes() -> Result<[u8; KEY_LEN], String> {
    if let Some(encoded) = credentials::load_local_storage_key()? {
        let decoded = BASE64.decode(encoded).map_err(|error| error.to_string())?;
        let bytes: [u8; KEY_LEN] = decoded
            .as_slice()
            .try_into()
            .map_err(|_| "Chave local armazenada possui tamanho inválido.".to_string())?;
        return Ok(bytes);
    }

    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    credentials::store_local_storage_key(&BASE64.encode(key))?;
    Ok(key)
}

pub fn is_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

pub fn encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = key_bytes()?;
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

    if bytes.len() <= MAGIC.len() + NONCE_LEN {
        return Err("Arquivo local criptografado inválido.".to_string());
    }

    let key = key_bytes()?;
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
    let encrypted = encrypt(plain)?;
    let mut file = fs::File::create(path).map_err(|error| error.to_string())?;
    file.write_all(&encrypted).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn encrypt_file_if_needed(path: &Path) -> Result<usize, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if is_encrypted(&bytes) {
        return Ok(0);
    }
    write(path, &bytes)?;
    Ok(1)
}

fn encrypt_tree_inner(path: &Path) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }

    if path.is_file() {
        return encrypt_file_if_needed(path);
    }

    let mut count = 0usize;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let child = entry.map_err(|error| error.to_string())?.path();
        count += encrypt_tree_inner(&child)?;
    }
    Ok(count)
}

pub fn migrate_local_data(root: &Path) -> Result<usize, String> {
    let marker = root.join(".encrypted-v1");
    if marker.exists() {
        return Ok(0);
    }

    let mut count = 0usize;
    for relative in ["config", "cache", "queue", "state"] {
        count += encrypt_tree_inner(&root.join(relative))?;
    }

    fs::write(marker, b"v1").map_err(|error| error.to_string())?;
    Ok(count)
}

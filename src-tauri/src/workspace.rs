use crate::{local_crypto, models::WorkspaceDocument, storage::AppPaths};
use std::{fs, io, path::{Path, PathBuf}};

fn io_error(error: io::Error) -> String { error.to_string() }

fn safe_component(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 180
        || value.contains('/')
        || value.contains(char::from(92))
        || value.contains("..")
    {
        return Err("Identificador inválido para armazenamento local.".to_string());
    }
    Ok(value)
}

fn state_root(paths: &AppPaths) -> PathBuf {
    paths.root.join("state")
}

fn kind_dir(paths: &AppPaths, kind: &str) -> Result<PathBuf, String> {
    safe_component(kind)?;
    let dir = state_root(paths).join(kind);
    fs::create_dir_all(&dir).map_err(io_error)?;
    Ok(dir)
}

fn read_document(path: &Path) -> Result<WorkspaceDocument, String> {
    let bytes = local_crypto::read(path)?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn write_document(path: &Path, document: &WorkspaceDocument) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(document).map_err(|error| error.to_string())?;
    local_crypto::write(path, &bytes)
}

pub fn list_for_sync(paths: &AppPaths, kind: &str) -> Result<Vec<WorkspaceDocument>, String> {
    let dir = kind_dir(paths, kind)?;
    let mut documents = Vec::new();

    for entry in fs::read_dir(dir).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(document) = read_document(&path) {
            documents.push(document);
        }
    }

    documents.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(documents)
}

pub fn list(paths: &AppPaths, kind: &str) -> Result<Vec<WorkspaceDocument>, String> {
    Ok(list_for_sync(paths, kind)?
        .into_iter()
        .filter(|document| document.deleted_at.is_none())
        .collect())
}

static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn document_version(document: &WorkspaceDocument) -> Result<chrono::DateTime<chrono::FixedOffset>, String> {
    let parse = |value: &str| chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| "Versão de documento inválida.".to_string());
    let updated = parse(&document.updated_at)?;
    match document.deleted_at.as_deref() {
        Some(deleted) => Ok(updated.max(parse(deleted)?)),
        None => Ok(updated),
    }
}

fn check_replacement(previous: &WorkspaceDocument, next: &WorkspaceDocument) -> Result<bool, String> {
    if previous.id != next.id || previous.kind != next.kind {
        return Err("Identidade de documento divergente.".into());
    }
    let old_version = document_version(previous)?;
    let new_version = document_version(next)?;
    match (previous.deleted_at.is_some(), next.deleted_at.is_some()) {
        (true, false) => return Err("Documento excluído não pode ser restaurado implicitamente.".into()),
        (false, true) => return Ok(true),
        _ => {}
    }
    if new_version < old_version {
        return Err("Versão local mais recente preservada.".into());
    }
    if new_version == old_version {
        if previous.deleted_at.is_some() || previous.payload == next.payload {
            return Ok(false);
        }
        return Err("Conflito entre documentos com a mesma versão.".into());
    }
    Ok(true)
}

pub fn upsert(paths: &AppPaths, document: WorkspaceDocument) -> Result<WorkspaceDocument, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Armazenamento de documentos indisponível.".to_string())?;
    document_version(&document)?;
    safe_component(&document.id)?;
    safe_component(&document.kind)?;
    let dir = kind_dir(paths, &document.kind)?;
    let path = dir.join(format!("{}.json", document.id));
    if path.try_exists().map_err(io_error)? {
        let previous = read_document(&path)?;
        if !check_replacement(&previous, &document)? {
            return Ok(previous);
        }
    }
    write_document(&path, &document)?;
    Ok(document)
}

pub fn delete(paths: &AppPaths, kind: &str, id: &str) -> Result<WorkspaceDocument, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Armazenamento de documentos indisponível.".to_string())?;
    safe_component(kind)?;
    safe_component(id)?;
    let path = kind_dir(paths, kind)?.join(format!("{id}.json"));
    let deleted_at = chrono::Utc::now().to_rfc3339();
    let mut document = if path.exists() {
        read_document(&path)?
    } else {
        WorkspaceDocument {
            id: id.to_owned(),
            kind: kind.to_owned(),
            updated_at: deleted_at.clone(),
            payload: serde_json::json!({}),
            deleted_at: None,
        }
    };
    if document.deleted_at.is_some() {
        return Ok(document);
    }
    document.updated_at = deleted_at.clone();
    document.deleted_at = Some(deleted_at);
    write_document(&path, &document)?;
    Ok(document)
}

pub fn search(paths: &AppPaths, query: &str) -> Result<Vec<WorkspaceDocument>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let root = state_root(paths);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut output = Vec::new();
    for kind in fs::read_dir(root).map_err(io_error)? {
        let kind_path = kind.map_err(io_error)?.path();
        if !kind_path.is_dir() {
            continue;
        }
        for entry in fs::read_dir(kind_path).map_err(io_error)? {
            let path = entry.map_err(io_error)?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(document) = read_document(&path) {
                if document.deleted_at.is_some() {
                    continue;
                }
                let haystack = serde_json::to_string(&document.payload)
                    .unwrap_or_default()
                    .to_lowercase();
                if haystack.contains(&needle) {
                    output.push(document);
                }
            }
        }
    }

    output.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(output)
}

pub fn export_all(paths: &AppPaths) -> Result<Vec<WorkspaceDocument>, String> {
    let root = state_root(paths);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut documents = Vec::new();
    for kind in fs::read_dir(root).map_err(io_error)? {
        let kind_path = kind.map_err(io_error)?.path();
        if !kind_path.is_dir() {
            continue;
        }
        for entry in fs::read_dir(kind_path).map_err(io_error)? {
            let path = entry.map_err(io_error)?.path();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                if let Ok(document) = read_document(&path) {
                    documents.push(document);
                }
            }
        }
    }
    documents.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.id.cmp(&b.id)));
    Ok(documents)
}

pub fn import_all(paths: &AppPaths, documents: Vec<WorkspaceDocument>) -> Result<usize, String> {
    let mut imported = 0usize;
    for document in documents {
        upsert(paths, document)?;
        imported += 1;
    }
    Ok(imported)
}

#[cfg(test)]
mod reconciliation_tests {
    use super::*;

    fn document(version: &str, deleted: bool, payload: i32) -> WorkspaceDocument {
        WorkspaceDocument {
            id: "doc".into(), kind: "note".into(), updated_at: version.into(),
            payload: serde_json::json!({"value": payload}),
            deleted_at: if deleted { Some(version.into()) } else { None },
        }
    }

    #[test]
    fn stale_or_conflicting_writes_cannot_replace_local_data() {
        let old = document("2026-11-24T10:00:00Z", false, 1);
        let new = document("2026-11-24T10:01:00Z", false, 2);
        assert!(check_replacement(&new, &old).is_err());
        assert!(check_replacement(&old, &new).unwrap());
        assert!(!check_replacement(&new, &new).unwrap());
        let conflict = document("2026-11-24T10:01:00Z", false, 3);
        assert!(check_replacement(&new, &conflict).is_err());
    }

    #[test]
    fn tombstone_wins_over_newer_live_copy() {
        let deleted = document("2026-11-24T10:00:00Z", true, 1);
        let live = document("2026-11-24T10:01:00Z", false, 2);
        assert!(check_replacement(&deleted, &live).is_err());
        assert!(check_replacement(&live, &deleted).unwrap());
    }
}

use crate::{models::WorkspaceDocument, storage::AppPaths};
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
    let bytes = fs::read(path).map_err(io_error)?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn write_document(path: &Path, document: &WorkspaceDocument) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(document).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(io_error)
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

pub fn upsert(paths: &AppPaths, document: WorkspaceDocument) -> Result<WorkspaceDocument, String> {
    safe_component(&document.id)?;
    safe_component(&document.kind)?;
    let dir = kind_dir(paths, &document.kind)?;
    let path = dir.join(format!("{}.json", document.id));
    write_document(&path, &document)?;
    Ok(document)
}

pub fn delete(paths: &AppPaths, kind: &str, id: &str) -> Result<WorkspaceDocument, String> {
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

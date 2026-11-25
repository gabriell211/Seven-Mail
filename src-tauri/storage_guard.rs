//! Shared lock for the desktop process and offline storage maintenance.
use std::{fs::{self, File, OpenOptions, TryLockError}, path::Path};

const LOCK_NAME: &str = ".seven-mail-storage-v1.lock";

pub struct StorageGuard {
    _file: File,
}

impl StorageGuard {
    /// The desktop owns this guard for its entire lifetime.
    pub fn desktop(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|_| "Diretório de dados indisponível.".to_string())?;
        Self::acquire(root, true)
    }

    /// Maintenance must target a root initialized by a compatible desktop.
    /// Older executables do not respect this lock and must remain closed.
    pub fn maintenance(root: &Path) -> Result<Self, String> {
        Self::acquire(root, false)
    }

    fn acquire(root: &Path, create: bool) -> Result<Self, String> {
        let meta = fs::symlink_metadata(root).map_err(|_| "Diretório de dados indisponível.".to_string())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Diretório de dados inválido.".into());
        }
        let path = root.join(LOCK_NAME);
        match fs::symlink_metadata(&path) {
            Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => return Err("Arquivo de bloqueio inválido.".into()),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {}
            Err(_) => return Err("Bloqueio de armazenamento ausente; inicialize a versão compatível do Seven Mail.".into()),
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(create).truncate(false);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path).map_err(|_| "Não foi possível abrir o bloqueio de armazenamento.".to_string())?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(TryLockError::WouldBlock) => Err("O armazenamento está em uso. Encerre o Seven Mail ou a manutenção.".into()),
            Err(TryLockError::Error(_)) => Err("Bloqueio exclusivo de armazenamento indisponível.".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn temp() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("seven-mail-guard-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)))
    }
    #[test]
    fn maintenance_requires_compatible_desktop_and_excludes_other_handles() {
        let root = temp();
        fs::create_dir(&root).unwrap();
        assert!(StorageGuard::maintenance(&root).is_err());
        let desktop = StorageGuard::desktop(&root).unwrap();
        assert!(StorageGuard::maintenance(&root).is_err());
        drop(desktop);
        let maintenance = StorageGuard::maintenance(&root).unwrap();
        assert!(StorageGuard::desktop(&root).is_err());
        drop(maintenance);
        let desktop = StorageGuard::desktop(&root).unwrap();
        drop(desktop);
        fs::remove_dir_all(root).unwrap();
    }
}

use crate::storage::AppPaths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, process::Command, time::Duration};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/gabriell211/Seven-Mail/releases/latest";
const MAX_UPDATE_BYTES: u64 = 600 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: String,
    pub release_url: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub asset_size: Option<u64>,
    pub digest: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    assets: Vec<ReleaseAsset>,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .https_only(true)
        .user_agent("Seven-Mail-Updater")
        .build()
        .map_err(|error| format!("Falha ao preparar o atualizador: {error}"))
}

fn version_tuple(value: &str) -> Vec<u64> {
    value
        .trim()
        .trim_start_matches('v')
        .split(|character: char| character == '.' || character == '-')
        .take(3)
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .chain(std::iter::repeat(0))
        .take(3)
        .collect()
}

fn is_newer(candidate: &str, current: &str) -> bool {
    version_tuple(candidate) > version_tuple(current)
}

fn select_asset(assets: &[ReleaseAsset]) -> Option<&ReleaseAsset> {
    #[cfg(target_os = "windows")]
    {
        let arch = std::env::consts::ARCH;
        if arch == "aarch64" {
            return assets.iter().find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.contains("aarch64") && name.ends_with("-setup.exe")
            }).or_else(|| assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with("-setup.exe")));
        }
        return assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with("_x64-setup.exe"))
            .or_else(|| assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with("-setup.exe")));
    }

    #[cfg(target_os = "linux")]
    {
        let arch = std::env::consts::ARCH;
        let marker = if arch == "aarch64" { "aarch64" } else { "amd64" };
        if std::env::var_os("APPIMAGE").is_some() {
            return assets.iter().find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.contains(marker) && name.ends_with(".appimage")
            });
        }
        return assets.iter().find(|asset| {
            let name = asset.name.to_ascii_lowercase();
            name.contains(marker) && name.ends_with(".deb")
        }).or_else(|| assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with(".appimage")));
    }

    #[cfg(target_os = "macos")]
    {
        let arch = std::env::consts::ARCH;
        return assets.iter().find(|asset| {
            let name = asset.name.to_ascii_lowercase();
            name.contains(arch) && name.ends_with(".dmg")
        }).or_else(|| assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with(".dmg")));
    }

    #[allow(unreachable_code)]
    None
}

pub fn check() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let release = client()?
        .get(LATEST_RELEASE_URL)
        .send()
        .map_err(|error| format!("Não foi possível consultar atualizações: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Servidor de atualização recusou a consulta: {error}"))?
        .json::<GithubRelease>()
        .map_err(|error| format!("Resposta de atualização inválida: {error}"))?;

    let available = is_newer(&release.tag_name, &current);
    let asset = if available { select_asset(&release.assets) } else { None };

    Ok(UpdateInfo {
        available,
        current_version: current,
        version: release.tag_name.trim_start_matches('v').to_string(),
        release_url: release.html_url,
        asset_name: asset.map(|value| value.name.clone()),
        asset_url: asset.map(|value| value.browser_download_url.clone()),
        asset_size: asset.map(|value| value.size),
        digest: asset.and_then(|value| value.digest.clone()),
        notes: release.body,
    })
}

fn update_directory() -> Result<PathBuf, String> {
    let directory = AppPaths::resolve()?.root.join("updates");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Não foi possível preparar a pasta de atualizações: {error}"))?;
    Ok(directory)
}

fn expected_sha256(digest: Option<&str>) -> Result<String, String> {
    let digest = digest
        .ok_or_else(|| "A release não publicou digest SHA-256 para este instalador.".to_string())?
        .trim();
    let value = digest.strip_prefix("sha256:").unwrap_or(digest);
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("Digest SHA-256 da release é inválido.".to_string());
    }
    Ok(value.to_ascii_lowercase())
}

fn trusted_destination(info: &UpdateInfo) -> Result<PathBuf, String> {
    let name = info.asset_name.as_deref()
        .ok_or_else(|| "Nome do instalador ausente.".to_string())?;
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(std::path::Component::Normal(_)))
        || components.next().is_some()
        || name.contains('/') || name.contains('\\') || name.contains(':')
    {
        return Err("Nome do instalador inválido.".to_string());
    }
    Ok(update_directory()?.join(name))
}

fn verify_installer(path: &Path, info: &UpdateInfo) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("O instalador não é um arquivo regular.".to_string());
    }
    let size = info.asset_size.ok_or_else(|| "Tamanho do instalador ausente.".to_string())?;
    if size > MAX_UPDATE_BYTES || metadata.len() != size {
        return Err("Tamanho do instalador inválido.".to_string());
    }
    let expected = expected_sha256(info.digest.as_deref())?;
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        total += count as u64;
        if total > MAX_UPDATE_BYTES {
            return Err("O instalador excede o limite de segurança.".to_string());
        }
        hasher.update(&buffer[..count]);
    }
    if total != size || format!("{:x}", hasher.finalize()) != expected {
        return Err("A verificação SHA-256 do instalador falhou.".to_string());
    }
    Ok(())
}

pub fn download(requested: &UpdateInfo) -> Result<String, String> {
    // Never trust a URL, asset name, size or digest from the webview.
    let info = check()?;
    if !info.available || requested.version != info.version {
        return Err("A atualização mudou ou não está disponível. Consulte novamente.".to_string());
    }
    let url = info.asset_url.as_deref()
        .ok_or_else(|| "Não há instalador compatível com esta plataforma na release.".to_string())?;
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("github.com")
        || !parsed.path().to_ascii_lowercase().starts_with("/gabriell211/seven-mail/releases/download/")
    {
        return Err("Origem do instalador inválida.".to_string());
    }
    let size = info.asset_size.ok_or_else(|| "Tamanho do instalador ausente.".to_string())?;
    if size > MAX_UPDATE_BYTES {
        return Err("O instalador excede o limite de segurança do atualizador.".to_string());
    }

    let expected = expected_sha256(info.digest.as_deref())?;
    let destination = trusted_destination(&info)?;
    let partial = destination.with_extension(format!("{}.download", uuid::Uuid::new_v4()));

    let mut response = client()?
        .get(url)
        .send()
        .map_err(|error| format!("Falha ao baixar atualização: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Falha no download da atualização: {error}"))?;

    if response.content_length().unwrap_or(0) > MAX_UPDATE_BYTES {
        return Err("O download excede o limite de segurança.".to_string());
    }

    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&partial)
        .map_err(|error| format!("Não foi possível criar o arquivo temporário: {error}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let count = response.read(&mut buffer)
            .map_err(|error| format!("Falha ao receber atualização: {error}"))?;
        if count == 0 { break; }
        total = total.saturating_add(count as u64);
        if total > MAX_UPDATE_BYTES {
            let _ = fs::remove_file(&partial);
            return Err("O download excedeu o limite de segurança.".to_string());
        }
        file.write_all(&buffer[..count])
            .map_err(|error| format!("Falha ao gravar atualização: {error}"))?;
        hasher.update(&buffer[..count]);
    }
    file.sync_all().map_err(|error| format!("Falha ao finalizar atualização: {error}"))?;
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if actual != expected || total != size {
        let _ = fs::remove_file(&partial);
        return Err("A verificação SHA-256 falhou. O instalador foi descartado.".to_string());
    }

    fs::rename(&partial, &destination)
        .map_err(|error| format!("Não foi possível finalizar o download: {error}"))?;

    #[cfg(unix)]
    if destination.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("AppImage")).unwrap_or(false) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&destination).map_err(|error| error.to_string())?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&destination, permissions).map_err(|error| error.to_string())?;
    }

    Ok(destination.to_string_lossy().to_string())
}

pub fn install(path: &str) -> Result<String, String> {
    let info = check()?;
    if !info.available {
        return Err("Nenhuma atualização está disponível.".to_string());
    }
    let trusted = trusted_destination(&info)?;
    if Path::new(path) != trusted.as_path() {
        return Err("O caminho não corresponde ao instalador oficial.".to_string());
    }
    verify_installer(&trusted, &info)?;
    let path = trusted.as_path();

    #[cfg(target_os = "windows")]
    {
        Command::new(path)
            .spawn()
            .map_err(|error| format!("Não foi possível iniciar o instalador: {error}"))?;
        return Ok("Instalador iniciado. O Seven Mail pode ser fechado quando solicitado.".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
        if extension.eq_ignore_ascii_case("AppImage") {
            Command::new(path)
                .spawn()
                .map_err(|error| format!("Não foi possível iniciar a nova AppImage: {error}"))?;
            return Ok("Nova AppImage iniciada. Feche esta versão após confirmar a abertura.".to_string());
        }
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Não foi possível abrir o instalador Linux: {error}"))?;
        return Ok("Pacote de atualização aberto no instalador do sistema.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Não foi possível abrir a atualização: {error}"))?;
        return Ok("Imagem de atualização aberta. Conclua a substituição do aplicativo.".to_string());
    }

    #[allow(unreachable_code)]
    Err("Instalação automática não disponível nesta plataforma.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_hash_and_size_are_verified_again() {
        let path = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let original = b"verified installer";
        fs::write(&path, original).unwrap();
        let info = UpdateInfo {
            available: true,
            current_version: "1.0.1".into(),
            version: "1.1.0".into(),
            release_url: String::new(),
            asset_name: None,
            asset_url: None,
            asset_size: Some(original.len() as u64),
            digest: Some(format!("sha256:{:x}", Sha256::digest(original))),
            notes: None,
        };
        assert!(verify_installer(&path, &info).is_ok());
        fs::write(&path, b"tampered installer").unwrap();
        assert!(verify_installer(&path, &info).is_err());
        fs::remove_file(path).unwrap();
    }
}

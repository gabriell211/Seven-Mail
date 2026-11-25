//! Explicit offline maintenance command; never packaged or invoked by Tauri.
#[cfg(feature = "native-vault")]
fn main() -> std::process::ExitCode {
    use seven_mail_sqlite_store::native_vault::prepare_offline;
    use std::{env, path::PathBuf, process::ExitCode};
    let mut args = env::args_os().skip(1);
    let confirmation = args.next();
    let root = args.next();
    if confirmation.as_deref() != Some(std::ffi::OsStr::new("--desktop-closed")) || root.is_none() || args.next().is_some() {
        eprintln!("Uso: prepare --desktop-closed <diretório-de-dados>");
        eprintln!("Encerre todas as versões do Seven Mail, inclusive na bandeja.");
        return ExitCode::FAILURE;
    }
    let root = PathBuf::from(root.unwrap());
    match prepare_offline(&root) {
        Ok(result) => {
            println!("Staging validado. Mensagens: {}. Contas: {}.", result.report.messages, result.report.accounts);
            println!("Destino: {}", result.staging.display());
            println!("O armazenamento ativo permanece inalterado.");
            ExitCode::SUCCESS
        }
        Err(error) => { eprintln!("Preparação interrompida: {error}"); ExitCode::FAILURE }
    }
}

#[cfg(not(feature = "native-vault"))]
fn main() -> std::process::ExitCode {
    eprintln!("Compile com --features native-vault.");
    std::process::ExitCode::FAILURE
}

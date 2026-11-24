use crate::{
    credentials,
    models::{AccountProfile, DirectoryContact},
};
use ldap3::{LdapConn, LdapConnSettings, Scope, SearchEntry};
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    time::Duration,
};

fn stable_id(dn: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    dn.hash(&mut hasher);
    format!("ldap-{:016x}", hasher.finish())
}

fn first(attrs: &HashMap<String, Vec<String>>, names: &[&str]) -> String {
    for name in names {
        if let Some(value) = attrs.get(*name).and_then(|values| values.first()) {
            if !value.trim().is_empty() {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}

fn ldap_starttls(url: &str) -> Result<bool, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "URL LDAP inválida.".to_string())?;
    if parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URL LDAP inválida.".to_string());
    }
    match parsed.scheme() {
        "ldaps" => Ok(false),
        "ldap" => Ok(true),
        _ => Err("Use LDAPS ou LDAP com StartTLS obrigatório.".to_string()),
    }
}

pub fn sync(account: &AccountProfile) -> Result<Vec<DirectoryContact>, String> {
    let url = account
        .ldap_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Configure a URL LDAP da conta.".to_string())?;
    let base = account
        .ldap_base_dn
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Configure o Base DN LDAP.".to_string())?;
    let filter = account
        .ldap_filter
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("(&(objectClass=person)(mail=*))");

    let starttls = ldap_starttls(url)?;
    let settings = LdapConnSettings::new()
        .set_conn_timeout(Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300)))
        .set_starttls(starttls);
    let mut ldap = LdapConn::with_settings(settings, url)
        .map_err(|error| format!("Falha ao estabelecer conexão LDAP criptografada: {error}"))?;
    ldap.with_timeout(Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300)));

    let username = account.username.as_deref().unwrap_or(&account.email);
    let password = credentials::load(account.credential_account_id())?;
    ldap.simple_bind(username, &password)
        .map_err(|error| format!("Falha no bind LDAP: {error}"))?
        .success()
        .map_err(|error| format!("Autenticação LDAP recusada: {error}"))?;

    let attrs = vec![
        "cn",
        "displayName",
        "mail",
        "telephoneNumber",
        "mobile",
        "company",
        "o",
        "title",
    ];
    let (entries, _) = ldap
        .search(base, Scope::Subtree, filter, attrs)
        .map_err(|error| format!("Pesquisa LDAP falhou: {error}"))?
        .success()
        .map_err(|error| format!("Servidor LDAP recusou a pesquisa: {error}"))?;

    let mut contacts = Vec::new();
    for entry in entries {
        let entry = SearchEntry::construct(entry);
        let display_name = first(&entry.attrs, &["displayName", "cn"]);
        let email = first(&entry.attrs, &["mail"]);
        if display_name.is_empty() && email.is_empty() {
            continue;
        }

        contacts.push(DirectoryContact {
            id: stable_id(&entry.dn),
            display_name: if display_name.is_empty() { email.clone() } else { display_name },
            email,
            phone: first(&entry.attrs, &["mobile", "telephoneNumber"]),
            company: first(&entry.attrs, &["company", "o"]),
            job_title: first(&entry.attrs, &["title"]),
            dn: entry.dn,
        });
    }

    ldap.unbind().map_err(|error| format!("Falha ao encerrar LDAP: {error}"))?;
    Ok(contacts)
}

pub fn test(account: &AccountProfile) -> Result<bool, String> {
    let _ = sync(account)?;
    Ok(true)
}

#[cfg(test)]
mod tls_tests {
    use super::ldap_starttls;

    #[test]
    fn requires_encrypted_ldap_connection() {
        assert_eq!(ldap_starttls("ldap://directory.example.com:389"), Ok(true));
        assert_eq!(ldap_starttls("ldaps://directory.example.com:636"), Ok(false));
        assert!(ldap_starttls("http://directory.example.com").is_err());
    }
}

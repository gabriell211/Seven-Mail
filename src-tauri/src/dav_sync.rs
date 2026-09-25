use crate::{
    credentials,
    models::{AccountProfile, DavSyncResult},
};
use regex::Regex;
use reqwest::{blocking::Client, Method};
use std::time::Duration;

fn validate_url(value: &str) -> Result<(), String> {
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("https://")
        || lower.starts_with("http://127.0.0.1")
        || lower.starts_with("http://localhost")
    {
        Ok(())
    } else {
        Err("CalDAV/CardDAV exige HTTPS (HTTP é permitido apenas em localhost).".to_string())
    }
}

fn xml_unescape(value: &str) -> String {
    value
        .trim()
        .strip_prefix("<![CDATA[")
        .and_then(|value| value.strip_suffix("]]>"))
        .unwrap_or(value.trim())
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn extract_objects(xml: &str, local_name: &str) -> Result<Vec<String>, String> {
    let pattern = format!(
        r"(?is)<(?:[A-Za-z0-9_-]+:)?{0}(?:\s[^>]*)?>(.*?)</(?:[A-Za-z0-9_-]+:)?{0}>",
        regex::escape(local_name)
    );
    let regex = Regex::new(&pattern).map_err(|error| error.to_string())?;
    Ok(regex
        .captures_iter(xml)
        .filter_map(|capture| capture.get(1))
        .map(|capture| xml_unescape(capture.as_str()))
        .filter(|value| !value.trim().is_empty())
        .collect())
}

fn report(account: &AccountProfile, url: &str, body: &str, tag: &str) -> Result<Vec<String>, String> {
    validate_url(url)?;
    let password = credentials::load(account.credential_account_id())?;
    let username = account.username.as_deref().unwrap_or(&account.email);
    let timeout = Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let client = Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("Falha ao preparar cliente DAV: {error}"))?;
    let method = Method::from_bytes(b"REPORT").map_err(|error| error.to_string())?;

    let response = client
        .request(method, url)
        .basic_auth(username, Some(password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(body.to_string())
        .send()
        .map_err(|error| format!("Falha DAV: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Servidor DAV recusou a sincronização: {error}"))?;

    let xml = response.text().map_err(|error| format!("Resposta DAV inválida: {error}"))?;
    extract_objects(&xml, tag)
}

pub fn sync(account: &AccountProfile) -> Result<DavSyncResult, String> {
    let calendar_objects = if account.can("calendar") {
        if let Some(url) = account.caldav_url.as_deref().filter(|value| !value.trim().is_empty()) {
        report(
            account,
            url,
            r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"/></c:filter>
</c:calendar-query>"#,
            "calendar-data",
        )?
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let contact_objects = if let Some(url) = account.carddav_url.as_deref().filter(|value| !value.trim().is_empty()) {
        report(
            account,
            url,
            r#"<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data/></d:prop>
</card:addressbook-query>"#,
            "address-data",
        )?
    } else {
        Vec::new()
    };

    Ok(DavSyncResult {
        calendar_objects,
        contact_objects,
    })
}

pub fn test(account: &AccountProfile) -> Result<bool, String> {
    let result = sync(account)?;
    if account.caldav_url.as_deref().unwrap_or("").is_empty()
        && account.carddav_url.as_deref().unwrap_or("").is_empty()
    {
        return Err("Configure uma URL CalDAV ou CardDAV.".to_string());
    }
    let _ = result;
    Ok(true)
}


fn object_url(base: &str, id: &str, extension: &str) -> Result<String, String> {
    validate_url(base)?;
    let mut url = base.trim_end_matches('/').to_string();
    let safe = id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') { ch } else { '_' })
        .collect::<String>();
    if safe.trim_matches('_').is_empty() {
        return Err("Identificador DAV inválido.".to_string());
    }
    url.push('/');
    url.push_str(&safe);
    url.push('.');
    url.push_str(extension);
    Ok(url)
}

fn dav_client(account: &AccountProfile) -> Result<(Client, String, String), String> {
    let password = credentials::load(account.credential_account_id())?;
    let username = account.username.as_deref().unwrap_or(&account.email).to_string();
    let timeout = Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let client = Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("Falha ao preparar cliente DAV: {error}"))?;
    Ok((client, username, password))
}

fn put_object(
    account: &AccountProfile,
    base_url: &str,
    id: &str,
    extension: &str,
    content_type: &str,
    content: &str,
) -> Result<(), String> {
    let url = object_url(base_url, id, extension)?;
    let (client, username, password) = dav_client(account)?;
    client
        .put(url)
        .basic_auth(username, Some(password))
        .header("Content-Type", content_type)
        .body(content.to_string())
        .send()
        .map_err(|error| format!("Falha ao gravar objeto DAV: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Servidor DAV recusou a gravação: {error}"))?;
    Ok(())
}

fn delete_object(account: &AccountProfile, base_url: &str, id: &str, extension: &str) -> Result<(), String> {
    let url = object_url(base_url, id, extension)?;
    let (client, username, password) = dav_client(account)?;
    let response = client
        .delete(url)
        .basic_auth(username, Some(password))
        .send()
        .map_err(|error| format!("Falha ao excluir objeto DAV: {error}"))?;
    if response.status().as_u16() == 404 {
        return Ok(());
    }
    response
        .error_for_status()
        .map_err(|error| format!("Servidor DAV recusou a exclusão: {error}"))?;
    Ok(())
}

pub fn put_calendar(account: &AccountProfile, event_id: &str, ics: &str) -> Result<(), String> {
    if account.is_shared_mailbox && !account.can("manage-calendar") {
        return Err("A conta compartilhada não permite editar o calendário.".to_string());
    }
    let base = account
        .caldav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CalDAV não configurado.".to_string())?;
    put_object(account, base, event_id, "ics", "text/calendar; charset=utf-8", ics)
}

pub fn delete_calendar(account: &AccountProfile, event_id: &str) -> Result<(), String> {
    if account.is_shared_mailbox && !account.can("manage-calendar") {
        return Err("A conta compartilhada não permite editar o calendário.".to_string());
    }
    let base = account
        .caldav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CalDAV não configurado.".to_string())?;
    delete_object(account, base, event_id, "ics")
}

pub fn put_contact(account: &AccountProfile, contact_id: &str, vcard: &str) -> Result<(), String> {
    if account.is_shared_mailbox && !account.can("edit") {
        return Err("A conta compartilhada não permite editar contatos.".to_string());
    }
    let base = account
        .carddav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CardDAV não configurado.".to_string())?;
    put_object(account, base, contact_id, "vcf", "text/vcard; charset=utf-8", vcard)
}

pub fn delete_contact(account: &AccountProfile, contact_id: &str) -> Result<(), String> {
    if account.is_shared_mailbox && !account.can("edit") {
        return Err("A conta compartilhada não permite editar contatos.".to_string());
    }
    let base = account
        .carddav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CardDAV não configurado.".to_string())?;
    delete_object(account, base, contact_id, "vcf")
}

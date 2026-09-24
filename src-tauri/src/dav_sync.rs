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
        .replace("&quot;", """)
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
    let password = credentials::load(&account.id)?;
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
    let calendar_objects = if let Some(url) = account.caldav_url.as_deref().filter(|value| !value.trim().is_empty()) {
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

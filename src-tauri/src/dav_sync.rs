use crate::{
    credentials,
    models::{AccountProfile, DavSyncResult},
};
use crate::dav_xml::{self, DavObject, DavResource};
use reqwest::{blocking::Client, Method, Url, header::{ETAG, IF_MATCH, IF_NONE_MATCH}};
use std::io::Read;
use std::time::Duration;

fn validate_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL DAV inválida.".to_string())?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() {
        return Err("DAV exige HTTPS, sem credenciais, query ou fragmento; HTTP somente em loopback.".into());
    }
    Ok(url)
}

fn collection_url(base: &str) -> Result<Url, String> {
    let mut url = validate_url(base)?;
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok(url)
}

fn resource_url(base: &str, href: &str) -> Result<Url, String> {
    let collection = collection_url(base)?;
    let target = collection.join(href).map_err(|_| "Endereço de recurso DAV inválido.".to_string())?;
    let target = validate_url(target.as_str())?;
    let suffix = target.path().strip_prefix(collection.path()).unwrap_or("");
    let lower = suffix.to_ascii_lowercase();
    if target.origin() != collection.origin() || suffix.is_empty() || suffix.contains('/')
        || lower.contains("%2f") || lower.contains("%5c") || lower.contains("%00")
        || lower.contains("%25") {
        return Err("Recurso DAV fora da coleção autorizada.".into());
    }
    Ok(target)
}

fn strong_etag(value: &str) -> Result<&str, String> {
    if value.len() < 2 || value.len() > 1024 || !value.starts_with('"') || !value.ends_with('"')
        || value[1..value.len()-1].chars().any(|c| c == '"' || c.is_control() || c.is_whitespace()) {
        return Err("ETag forte indisponível. Sincronize o recurso antes de alterá-lo.".into());
    }
    Ok(value)
}

fn report(account: &AccountProfile, url: &str, body: &str, tag: &str) -> Result<Vec<DavObject>, String> {
    let url = validate_url(url)?;
    let password = credentials::load(account.credential_account_id())?;
    let username = account.username.as_deref().unwrap_or(&account.email);
    let timeout = Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let client = Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Falha ao preparar cliente DAV: {error}"))?;
    let method = Method::from_bytes(b"REPORT").map_err(|error| error.to_string())?;

    let response = client
        .request(method, url.clone())
        .basic_auth(username, Some(password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(body.to_string())
        .send()
        .map_err(|error| format!("Falha DAV: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Servidor DAV recusou a sincronização: {error}"))?;

    if response.status().as_u16() != 207 {
        return Err(format!("REPORT DAV esperado: HTTP 207, recebido {}.", response.status()));
    }
    let mut bytes = Vec::new();
    response.take(dav_xml::MAX_REPORT_BYTES as u64 + 1).read_to_end(&mut bytes)
        .map_err(|error| format!("Resposta DAV inválida: {error}"))?;
    if bytes.len() > dav_xml::MAX_REPORT_BYTES { return Err("Resposta DAV excede 16 MB.".into()); }
    let xml = String::from_utf8(bytes).map_err(|_| "Resposta DAV não está em UTF-8.".to_string())?;
    let mut objects = dav_xml::parse_report(&xml, tag)?;
    for object in &mut objects {
        object.resource.href = resource_url(url.as_str(), &object.resource.href)?.to_string();
    }
    Ok(objects)
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


fn object_url(base: &str, id: &str, extension: &str) -> Result<Url, String> {
    if id.is_empty() || id.len() > 180 || id == "." || id == ".."
        || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')) {
        return Err("Identificador DAV inválido.".into());
    }
    let mut url = collection_url(base)?;
    url.path_segments_mut().map_err(|_| "Coleção DAV inválida.".to_string())?
        .pop_if_empty().push(&format!("{id}.{extension}"));
    resource_url(base, url.as_str())
}

fn dav_client(account: &AccountProfile) -> Result<(Client, String, String), String> {
    let password = credentials::load(account.credential_account_id())?;
    let username = account.username.as_deref().unwrap_or(&account.email).to_string();
    let timeout = Duration::from_secs(account.connection_timeout_seconds.clamp(5, 300));
    let client = Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Falha ao preparar cliente DAV: {error}"))?;
    Ok((client, username, password))
}

fn check_mutation_status(response: &reqwest::blocking::Response) -> Result<(), String> {
    if response.status().as_u16() == 412 {
        return Err("Conflito DAV: o recurso foi alterado em outro dispositivo. Sincronize antes de tentar novamente.".into());
    }
    if !response.status().is_success() {
        return Err(format!("Servidor DAV recusou a alteração: HTTP {}.", response.status()));
    }
    Ok(())
}

fn put_object(
    account: &AccountProfile,
    base_url: &str,
    id: &str,
    extension: &str,
    content_type: &str,
    content: &str,
    resource: Option<&DavResource>,
    create: bool,
) -> Result<DavResource, String> {
    let (url, condition) = match resource {
        Some(resource) if !create => (resource_url(base_url, &resource.href)?, Some(strong_etag(&resource.etag)?)),
        None if create => (object_url(base_url, id, extension)?, None),
        _ => return Err("Identidade ou versão DAV não confirmada. Sincronize antes de editar.".into()),
    };
    if content.len() > 2 * 1024 * 1024 { return Err("Objeto DAV excede 2 MB.".into()); }
    let (client, username, password) = dav_client(account)?;
    let request = client.put(url.clone()).basic_auth(username, Some(password))
        .header("Content-Type", content_type).body(content.to_owned());
    let request = if let Some(etag) = condition { request.header(IF_MATCH, etag) }
        else { request.header(IF_NONE_MATCH, "*") };
    let response = request.send().map_err(|error| format!("Falha ao gravar objeto DAV: {error}"))?;
    check_mutation_status(&response)?;
    let etag = response.headers().get(ETAG).and_then(|value| value.to_str().ok())
        .and_then(|value| strong_etag(value).ok()).unwrap_or("").to_owned();
    // If the server omits a strong ETag, the successful write is retained but
    // further updates must wait for the next REPORT.
    Ok(DavResource { href: url.to_string(), etag })
}

fn delete_object(account: &AccountProfile, base_url: &str, resource: Option<&DavResource>) -> Result<(), String> {
    let resource = resource.ok_or_else(|| "Sincronize o recurso DAV antes de excluí-lo.".to_string())?;
    let url = resource_url(base_url, &resource.href)?;
    let etag = strong_etag(&resource.etag)?;
    let (client, username, password) = dav_client(account)?;
    let response = client.delete(url).basic_auth(username, Some(password)).header(IF_MATCH, etag)
        .send().map_err(|error| format!("Falha ao excluir objeto DAV: {error}"))?;
    if response.status().as_u16() == 404 { return Ok(()); }
    check_mutation_status(&response)
}

pub fn put_calendar(account: &AccountProfile, event_id: &str, ics: &str, resource: Option<&DavResource>, create: bool) -> Result<DavResource, String> {
    if account.is_shared_mailbox && !account.can("manage-calendar") {
        return Err("A conta compartilhada não permite editar o calendário.".to_string());
    }
    let base = account
        .caldav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CalDAV não configurado.".to_string())?;
    put_object(account, base, event_id, "ics", "text/calendar; charset=utf-8", ics, resource, create)
}

pub fn delete_calendar(account: &AccountProfile, resource: Option<&DavResource>) -> Result<(), String> {
    if account.is_shared_mailbox && !account.can("manage-calendar") {
        return Err("A conta compartilhada não permite editar o calendário.".to_string());
    }
    let base = account
        .caldav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CalDAV não configurado.".to_string())?;
    delete_object(account, base, resource)
}

pub fn put_contact(account: &AccountProfile, contact_id: &str, vcard: &str, resource: Option<&DavResource>, create: bool) -> Result<DavResource, String> {
    if account.is_shared_mailbox && !account.can("edit") {
        return Err("A conta compartilhada não permite editar contatos.".to_string());
    }
    let base = account
        .carddav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CardDAV não configurado.".to_string())?;
    put_object(account, base, contact_id, "vcf", "text/vcard; charset=utf-8", vcard, resource, create)
}

pub fn delete_contact(account: &AccountProfile, resource: Option<&DavResource>) -> Result<(), String> {
    if account.is_shared_mailbox && !account.can("edit") {
        return Err("A conta compartilhada não permite editar contatos.".to_string());
    }
    let base = account
        .carddav_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "CardDAV não configurado.".to_string())?;
    delete_object(account, base, resource)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_resource_origin_and_collection() {
        assert!(resource_url("https://mail.example/book/", "/book/a.vcf").is_ok());
        for href in ["https://evil.example/book/a.vcf", "/other/a.vcf", "/book/%2Fother", "/book/", "../outside.vcf"] {
            assert!(resource_url("https://mail.example/book/", href).is_err(), "{href}");
        }
        assert!(validate_url("http://localhost.evil.example/book").is_err());
        assert!(validate_url("http://127.0.0.1:8080/book").is_ok());
    }
    #[test]
    fn only_strong_specific_etags_can_authorize_updates() {
        assert_eq!(strong_etag("\"abc\"").unwrap(), "\"abc\"");
        for tag in ["*", "", "W/\"a\"", "\"a\r\nb\"", "\"a\",\"b\""] {
            assert!(strong_etag(tag).is_err(), "{tag}");
        }
    }
}

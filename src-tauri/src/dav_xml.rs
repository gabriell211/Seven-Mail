use quick_xml::{events::Event, name::ResolveResult, NsReader};
use serde::{Deserialize, Serialize};

const DAV: &str = "DAV:";
const CALDAV: &str = "urn:ietf:params:xml:ns:caldav";
const CARDDAV: &str = "urn:ietf:params:xml:ns:carddav";
pub const MAX_REPORT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DavResource {
    pub href: String,
    pub etag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DavObject {
    pub resource: DavResource,
    pub data: String,
}

#[derive(Default)]
struct Element {
    ns: String,
    name: String,
    text: String,
    children: Vec<Element>,
}

impl Element {
    fn is(&self, ns: &str, name: &str) -> bool {
        self.ns == ns && self.name == name
    }
    fn child(&self, ns: &str, name: &str) -> Option<&Self> {
        self.children.iter().find(|node| node.is(ns, name))
    }
    fn leaf(&self, ns: &str, name: &str) -> Option<&str> {
        let node = self.child(ns, name)?;
        if node.children.is_empty() { Some(node.text.as_str()) } else { None }
    }
}

fn namespace(ns: ResolveResult<'_>) -> Result<String, String> {
    match ns {
        ResolveResult::Bound(value) => Ok(value.0.to_owned()),
        ResolveResult::Unbound => Ok(String::new()),
        ResolveResult::Unknown(_) => Err("Prefixo XML DAV sem namespace.".into()),
    }
}

fn add_node(stack: &mut [Element], root: &mut Option<Element>, node: Element) -> Result<(), String> {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else if root.replace(node).is_some() {
        return Err("Resposta DAV com múltiplas raízes.".into());
    }
    Ok(())
}

fn parse_tree(xml: &str) -> Result<Element, String> {
    if xml.len() > MAX_REPORT_BYTES { return Err("Resposta DAV muito grande.".into()); }
    let mut reader = NsReader::from_str(xml);
    reader.config_mut().expand_empty_elements = true;
    let mut stack: Vec<Element> = Vec::new();
    let mut root = None;
    let mut nodes = 0usize;
    loop {
        let (ns, event) = reader.read_resolved_event().map_err(|e| format!("XML DAV inválido: {e}"))?;
        match event {
            Event::Start(tag) | Event::Empty(tag) => {
                // Empty elements are expanded below via reader configuration in parse_tree.
                nodes += 1;
                if nodes > 150_000 || stack.len() >= 48 { return Err("Estrutura XML DAV excede os limites.".into()); }
                stack.push(Element { ns: namespace(ns)?, name: tag.local_name().into_inner().to_owned(), ..Default::default() });
            }
            Event::End(_) => {
                let node = stack.pop().ok_or_else(|| "XML DAV desequilibrado.".to_string())?;
                add_node(&mut stack, &mut root, node)?;
            }
            Event::Text(value) => {
                if let Some(node) = stack.last_mut() { node.text.push_str(&value); }
                else if !value.trim().is_empty() { return Err("Texto fora da raiz XML.".into()); }
            }
            Event::CData(value) => {
                let node = stack.last_mut().ok_or_else(|| "CDATA fora da raiz XML.".to_string())?;
                node.text.push_str(&value);
            }
            Event::GeneralRef(value) => {
                let node = stack.last_mut().ok_or_else(|| "Referência XML fora da raiz.".to_string())?;
                let reference = format!("&{};", &*value);
                let decoded = quick_xml::escape::unescape(&reference).map_err(|e| format!("Entidade XML DAV não permitida: {e}"))?;
                node.text.push_str(&decoded);
            }
            Event::DocType(_) => return Err("DTD não permitido em respostas DAV.".into()),
            Event::Eof => break,
            _ => {}
        }
    }
    if !stack.is_empty() { return Err("Resposta XML DAV incompleta.".into()); }
    root.ok_or_else(|| "Resposta XML DAV vazia.".into())
}

fn success(status: &str) -> bool {
    status.split_ascii_whitespace().nth(1).and_then(|v| v.parse::<u16>().ok()).map(|v| (200..300).contains(&v)).unwrap_or(false)
}

pub fn parse_report(xml: &str, tag: &str) -> Result<Vec<DavObject>, String> {
    let ns = match tag { "calendar-data" => CALDAV, "address-data" => CARDDAV, _ => return Err("Tipo DAV inválido.".into()) };
    let root = parse_tree(xml)?;
    if !root.is(DAV, "multistatus") { return Err("Resposta DAV não é multistatus.".into()); }
    let mut objects = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for response in root.children.iter().filter(|node| node.is(DAV, "response")) {
        if let Some(status) = response.leaf(DAV, "status") {
            if !success(status) { return Err(format!("Falha em recurso DAV: {}", status.trim())); }
        }
        let href = response.leaf(DAV, "href").unwrap_or("").trim();
        let mut etag = None;
        let mut data = None;
        for propstat in response.children.iter().filter(|node| node.is(DAV, "propstat")) {
            if !success(propstat.leaf(DAV, "status").unwrap_or("")) { continue; }
            let Some(prop) = propstat.child(DAV, "prop") else { continue; };
            if let Some(value) = prop.leaf(DAV, "getetag") { etag = Some(value.trim()); }
            if let Some(value) = prop.leaf(ns, tag) { data = Some(value); }
        }
        if let Some(data) = data.filter(|value| !value.trim().is_empty()) {
            if href.is_empty() || !seen.insert(href.to_string()) { return Err("Identidade DAV ausente ou duplicada.".into()); }
            objects.push(DavObject { resource: DavResource { href: href.to_owned(), etag: etag.unwrap_or("").to_owned() }, data: data.to_owned() });
        }
    }
    Ok(objects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_namespaces_cdata_entities_and_successful_properties_only() {
        let xml = r#"<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:response><d:href>/book/a.vcf</d:href><d:propstat><d:prop><d:getetag>&quot;v1&quot;</d:getetag><c:address-data><![CDATA[BEGIN:VCARD
FN:A & B]]>&#10;END:VCARD</c:address-data><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><c:address-data>wrong</c:address-data></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>"#;
        let objects = parse_report(xml, "address-data").unwrap();
        assert_eq!(objects.len(), 1);
        assert_eq!(objects[0].resource.etag, "\"v1\"");
        assert_eq!(objects[0].data, "BEGIN:VCARD\nFN:A & B\nEND:VCARD");
    }

    #[test]
    fn rejects_dtd_and_malformed_documents() {
        assert!(parse_report("<!DOCTYPE a [<!ENTITY x SYSTEM 'file:///secret'>]><a/>", "calendar-data").is_err());
        assert!(parse_report("<d:multistatus xmlns:d='DAV:'><d:response>", "calendar-data").is_err());
    }
}

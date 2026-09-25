use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub platform: String,
    pub data_dir: String,
    pub cache_dir: String,
    pub queue_dir: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub provider: String,
    pub color: String,
    pub is_default: bool,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default = "default_incoming_protocol")]
    pub incoming_protocol: String,
    #[serde(default)]
    pub imap_host: Option<String>,
    #[serde(default)]
    pub imap_port: Option<u16>,
    #[serde(default)]
    pub pop3_host: Option<String>,
    #[serde(default)]
    pub pop3_port: Option<u16>,
    #[serde(default)]
    pub caldav_url: Option<String>,
    #[serde(default)]
    pub carddav_url: Option<String>,
    #[serde(default)]
    pub ldap_url: Option<String>,
    #[serde(default)]
    pub ldap_base_dn: Option<String>,
    #[serde(default)]
    pub ldap_filter: Option<String>,
    #[serde(default)]
    pub oauth_enabled: bool,
    #[serde(default)]
    pub oauth_client_id: Option<String>,
    #[serde(default)]
    pub oauth_authorization_url: Option<String>,
    #[serde(default)]
    pub oauth_token_url: Option<String>,
    #[serde(default)]
    pub oauth_scopes: Vec<String>,
    #[serde(default)]
    pub oauth_redirect_uri: Option<String>,
    #[serde(default)]
    pub smtp_host: Option<String>,
    #[serde(default)]
    pub smtp_port: Option<u16>,
    #[serde(default)]
    pub security_mode: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub is_shared_mailbox: bool,
    #[serde(default)]
    pub shared_owner_account_id: Option<String>,
    #[serde(default)]
    pub shared_owner_email: Option<String>,
    #[serde(default)]
    pub shared_mode: Option<String>,
    #[serde(default)]
    pub shared_permissions: Vec<String>,
    #[serde(default)]
    pub send_mode: Option<String>,
    #[serde(default)]
    pub muted: bool,
    #[serde(default = "default_timeout_seconds")]
    pub connection_timeout_seconds: u64,
    #[serde(default)]
    pub auto_reply_enabled: bool,
    #[serde(default)]
    pub auto_reply_subject: Option<String>,
    #[serde(default)]
    pub auto_reply_body: Option<String>,
    #[serde(default)]
    pub auto_reply_start: Option<String>,
    #[serde(default)]
    pub auto_reply_end: Option<String>,
}

impl AccountProfile {
    pub fn credential_account_id(&self) -> &str {
        self.shared_owner_account_id.as_deref().unwrap_or(&self.id)
    }

    pub fn can(&self, permission: &str) -> bool {
        !self.is_shared_mailbox
            || self.shared_permissions.is_empty()
            || self.shared_permissions.iter().any(|value| value == permission)
    }
}

fn default_timeout_seconds() -> u64 {
    30
}

fn default_incoming_protocol() -> String {
    "imap".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DavSyncResult {
    pub calendar_objects: Vec<String>,
    pub contact_objects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryContact {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub phone: String,
    pub company: String,
    pub job_title: String,
    pub dn: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub security_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAddress {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessage {
    pub id: String,
    pub account_id: String,
    #[serde(default)]
    pub remote_id: Option<String>,
    #[serde(default)]
    pub remote_folder: Option<String>,
    pub folder: String,
    pub subject: String,
    pub preview: String,
    pub from: MailAddress,
    pub to: Vec<MailAddress>,
    pub received_at: String,
    pub is_read: bool,
    pub is_flagged: bool,
    pub is_pinned: bool,
    pub has_attachments: bool,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub categories: Vec<String>,
    #[serde(default)]
    pub applied_rule_ids: Vec<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub attachment_names: Vec<String>,
    #[serde(default)]
    pub importance: Option<String>,
    #[serde(default)]
    pub snoozed_until: Option<String>,
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub is_phishing: bool,
    #[serde(default)]
    pub is_important: bool,
    #[serde(default)]
    pub source_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueOperation {
    pub id: String,
    pub kind: String,
    pub account_id: String,
    pub created_at: String,
    pub attempts: u32,
    pub payload: Value,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    pub id: String,
    pub kind: String,
    pub updated_at: String,
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailFolder {
    pub name: String,
    pub path: String,
    pub role: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedAttachment {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(default)]
    pub inline: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentInfo {
    pub index: usize,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub inline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentPreview {
    pub name: String,
    pub mime: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub kind: String,
}

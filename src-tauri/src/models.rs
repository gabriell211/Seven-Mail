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

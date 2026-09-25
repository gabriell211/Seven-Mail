import { invoke } from "@tauri-apps/api/core";
import type { AccountProfile, MailAttachmentInfo, MailAttachmentPreview, MailFolder, MailMessage, ProviderSettings, QueueOperation, QueuedAttachment, RuntimeInfo, WorkspaceDocument, WorkspaceKind } from "../types";

const hasTauri = () => "__TAURI_INTERNALS__" in window;

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauri()) throw new Error("Comando disponível apenas no aplicativo desktop.");
  return invoke<T>(name, args);
}

export const bridge = {
  initialOpenRequests: (): Promise<string[]> => command("initial_open_requests"),
  runtimeInfo: async (): Promise<RuntimeInfo> => hasTauri()
    ? command<RuntimeInfo>("runtime_info")
    : { platform:"browser", dataDir:"%APPDATA%\\Seven Mail", cacheDir:"%APPDATA%\\Seven Mail\\cache", queueDir:"%APPDATA%\\Seven Mail\\queue", version:"web-preview" },
  checkForUpdate: (): Promise<{available:boolean;currentVersion:string;version:string;releaseUrl:string;assetName?:string;assetUrl?:string;assetSize?:number;digest?:string;notes?:string}> => command("check_for_update"),
  downloadUpdate: (info: {available:boolean;currentVersion:string;version:string;releaseUrl:string;assetName?:string;assetUrl?:string;assetSize?:number;digest?:string;notes?:string}): Promise<string> => command("download_update", { info }),
  installUpdate: (path: string): Promise<string> => command("install_update", { path }),
  openDefaultMailSettings: (): Promise<string> => command("open_default_mail_settings"),
  setCloseToTray: (enabled: boolean): Promise<void> => command("set_close_to_tray", { enabled }),
  listAccounts: (): Promise<AccountProfile[]> => command("list_accounts"),
  saveAccount: (account: AccountProfile): Promise<void> => command("save_account", { account }),
  setDefaultAccount: (accountId: string): Promise<AccountProfile[]> => command("set_default_account", { accountId }),
  deleteAccount: (accountId: string): Promise<AccountProfile[]> => command("delete_account", { accountId }),
  storeSecret: (accountId: string, secret: string): Promise<void> => command("store_secret", { accountId, secret }),
  tmailorTestTokenStatus: (): Promise<boolean> => command("tmailor_test_token_status"),
  tmailorTestTokenStore: (token: string): Promise<void> => command("tmailor_test_token_store", { token }),
  tmailorTestTokenLoad: (): Promise<string | null> => command("tmailor_test_token_load"),
  tmailorTestTokenClear: (): Promise<void> => command("tmailor_test_token_clear"),
  hasAppLock: (): Promise<boolean> => command("has_app_lock"),
  setAppLock: (pin: string): Promise<void> => command("set_app_lock", { pin }),
  verifyAppLock: (pin: string): Promise<boolean> => command("verify_app_lock", { pin }),
  clearAppLock: (): Promise<void> => command("clear_app_lock"),
  oauthExchangeCode: (accountId: string, code: string, verifier: string, redirectUri?: string): Promise<{accessToken:string;refreshToken?:string;expiresAt?:number}> => command("oauth_exchange_code", { accountId, code, verifier, redirectUri: redirectUri ?? null }),
  providerOAuthExchangeCode: (accountId: string, code: string, verifier: string, redirectUri?: string): Promise<{accessToken:string;refreshToken?:string;expiresAt?:number;scope?:string}> => command("provider_oauth_exchange_code", { accountId, code, verifier, redirectUri: redirectUri ?? null }),
  providerOAuthStatus: (accountId: string): Promise<boolean> => command("provider_oauth_status", { accountId }),
  providerOAuthClear: (accountId: string): Promise<void> => command("provider_oauth_clear", { accountId }),
  oauthRefresh: (accountId: string): Promise<{accessToken:string;refreshToken?:string;expiresAt?:number}> => command("oauth_refresh", { accountId }),
  oauthStatus: (accountId: string): Promise<boolean> => command("oauth_status", { accountId }),
  oauthClear: (accountId: string): Promise<void> => command("oauth_clear", { accountId }),
  discoverProvider: (email: string): Promise<ProviderSettings> => command("discover_provider", { email }),
  providerCapabilities: (accountId: string): Promise<{nativeApi:boolean;recall:boolean;reactions:boolean;reactionPolicy:boolean;sensitivityLabels:boolean;retentionLabels:boolean;usageRights:boolean;push:boolean}> => command("provider_capabilities", { accountId }),
  providerCorporateCatalog: (accountId: string): Promise<{capabilities:Record<string,boolean>;sensitivityLabels:Array<Record<string,unknown>>;retentionLabels:Array<Record<string,unknown>>;sensitivityError?:string;retentionError?:string}> => command("provider_corporate_catalog", { accountId }),
  providerSensitivityRights: (accountId: string, labelId: string, ownerEmail?: string): Promise<Record<string,unknown>> => command("provider_sensitivity_rights", { accountId, labelId, ownerEmail: ownerEmail ?? null }),
  providerMessagePolicy: (accountId: string, messageId: string): Promise<{sensitivityLabelId?:string;canForward:boolean;canCopy:boolean;reactionsAllowed:boolean;rights:string[]}> => command("provider_message_policy", { accountId, messageId }),
  sendMessageReaction: (accountId: string, messageId: string, emoji: string): Promise<void> => command("send_message_reaction", { accountId, messageId, emoji }),
  providerRecallMessage: (accountId: string, messageId: string): Promise<string> => command("provider_recall_message", { accountId, messageId }),
  importSmimeIdentity: (accountId: string, path: string, password: string): Promise<{configured:boolean;subject?:string}> =>
    command("import_smime_identity", { accountId, path, password }),
  smimeIdentityStatus: (accountId: string): Promise<{configured:boolean;subject?:string}> =>
    command("smime_identity_status", { accountId }),
  removeSmimeIdentity: (accountId: string): Promise<void> => command("remove_smime_identity", { accountId }),
  importSmimeRecipientCertificate: (email: string, path: string): Promise<void> =>
    command("import_smime_recipient_certificate", { email, path }),
  hasSmimeRecipientCertificate: (email: string): Promise<boolean> =>
    command("has_smime_recipient_certificate", { email }),
  inspectSmimeMessage: (accountId: string, messageId: string): Promise<{signed:boolean;signatureValid?:boolean;encrypted:boolean;decrypted:boolean;decryptedPreview?:string;error?:string}> =>
    command("inspect_smime_message", { accountId, messageId }),
  syncLdap: (accountId: string): Promise<Array<{id:string;displayName:string;email:string;phone:string;company:string;jobTitle:string;dn:string}>> => command("sync_ldap", { accountId }),
  testLdapConnection: (accountId: string): Promise<boolean> => command("test_ldap_connection", { accountId }),
  syncDav: (accountId: string): Promise<{calendarObjects:string[];contactObjects:string[]}> => command("sync_dav", { accountId }),
  testDavConnection: (accountId: string): Promise<boolean> => command("test_dav_connection", { accountId }),
  putDavCalendar: (accountId: string, eventId: string, ics: string): Promise<void> => command("put_dav_calendar", { accountId, eventId, ics }),
  deleteDavCalendar: (accountId: string, eventId: string): Promise<void> => command("delete_dav_calendar", { accountId, eventId }),
  putDavContact: (accountId: string, contactId: string, vcard: string): Promise<void> => command("put_dav_contact", { accountId, contactId, vcard }),
  deleteDavContact: (accountId: string, contactId: string): Promise<void> => command("delete_dav_contact", { accountId, contactId }),
  testSmtpConnection: (accountId: string): Promise<boolean> => command("test_smtp_connection", { accountId }),
  testImapConnection: (accountId: string): Promise<boolean> => command("test_imap_connection", { accountId }),
  syncInbox: (accountId: string, limit = 50): Promise<number> => command("sync_inbox", { accountId, limit }),
  waitForMailPush: (accountId: string, timeoutSeconds = 25): Promise<boolean> => command("wait_for_mail_push", { accountId, timeoutSeconds }),
  listFolders: (accountId: string): Promise<MailFolder[]> => command("list_mail_folders", { accountId }),
  syncFolder: (accountId: string, path: string, label: string, limit = 50): Promise<number> => command("sync_mail_folder", { accountId, path, label, limit }),
  createFolder: (accountId: string, name: string): Promise<void> => command("create_mail_folder", { accountId, name }),
  renameFolder: (accountId: string, path: string, label: string, name: string): Promise<void> => command("rename_mail_folder", { accountId, path, label, name }),
  deleteFolder: (accountId: string, path: string, label: string): Promise<void> => command("delete_mail_folder", { accountId, path, label }),
  flushMailActions: (accountId: string): Promise<number> => command("flush_mail_actions", { accountId }),
  listCachedMessages: (accountId?: string): Promise<MailMessage[]> => command("list_cached_messages", { accountId: accountId ?? null }),
  searchCachedMessageIds: (query: string, accountId?: string): Promise<string[]> => command("search_cached_message_ids", { accountId: accountId ?? null, query }),
  cacheMessage: (message: MailMessage): Promise<void> => command("cache_message", { message }),
  queueOperation: (operation: QueueOperation): Promise<void> => command("queue_operation", { operation }),
  stageAttachments: (operationId: string, sources: string[], maxFileMb = 25, maxTotalMb = 100): Promise<QueuedAttachment[]> => command("stage_attachments", { operationId, sources, maxFileMb, maxTotalMb }),
  stageMessageAsEml: (operationId: string, accountId: string, messageId: string, suggestedName: string): Promise<QueuedAttachment> =>
    command("stage_message_as_eml", { operationId, accountId, messageId, suggestedName }),
  cancelOperation: (operationId: string): Promise<boolean> => command("cancel_operation", { operationId }),
  listQueue: (): Promise<QueueOperation[]> => command("list_queue"),
  flushOutbox: (): Promise<number> => command("flush_outbox"),
  messageAction: (accountId: string, messageId: string, action: "read" | "unread" | "flag" | "unflag" | "pin" | "unpin" | "archive" | "delete" | "spam" | "inbox"): Promise<MailMessage> =>
    command("message_action", { accountId, messageId, action }),
  moveMessageToFolder: (accountId: string, messageId: string, targetPath: string, targetLabel: string): Promise<MailMessage> =>
    command("move_message_to_folder", { accountId, messageId, targetPath, targetLabel }),
  moveMessageToAccount: (sourceAccountId: string, messageId: string, targetAccountId: string, targetMailbox = "INBOX"): Promise<void> =>
    command("move_message_to_account", { sourceAccountId, messageId, targetAccountId, targetMailbox }),
  clearCache: (): Promise<void> => command("clear_cache"),
  pruneMessageCache: (retentionDays: number): Promise<number> => command("prune_message_cache", { retentionDays }),
  secureClearLocalData: (): Promise<void> => command("secure_clear_local_data"),
  readTextFile: (path: string): Promise<string> => command("read_text_file", { path }),
  readFileDataUrl: (path: string): Promise<string> => command("read_file_data_url", { path }),
  writeTextFile: (path: string, content: string): Promise<void> => command("write_text_file", { path, content }),
  exportPst: (accountId: string | undefined, path: string): Promise<number> => command("export_pst", { accountId: accountId ?? null, path }),
  importPst: (accountId: string, path: string): Promise<number> => command("import_pst", { accountId, path }),
  importEml: (accountId: string, path: string): Promise<MailMessage> => command("import_eml", { accountId, path }),
  importMsg: (accountId: string, path: string): Promise<MailMessage> => command("import_msg", { accountId, path }),
  readOftTemplate: (path: string): Promise<{name:string;subject:string;bodyText:string;bodyHtml:string;sourceFormat:string}> => command("read_oft_template", { path }),
  saveOriginalMessage: (accountId: string, messageId: string, destination: string): Promise<void> => command("save_original_message", { accountId, messageId, destination }),
  readMessageSource: (accountId: string, messageId: string): Promise<string> => command("read_message_source", { accountId, messageId }),
  listMessageAttachments: (accountId: string, messageId: string): Promise<MailAttachmentInfo[]> => command("list_message_attachments", { accountId, messageId }),
  previewMessageAttachment: (accountId: string, messageId: string, index: number): Promise<MailAttachmentPreview> =>
    command("preview_message_attachment", { accountId, messageId, index }),
  stageMessageAttachments: (operationId: string, accountId: string, messageId: string): Promise<QueuedAttachment[]> =>
    command("stage_message_attachments", { operationId, accountId, messageId }),
  cacheMessageAttachment: (accountId: string, messageId: string, index: number): Promise<string> => command("cache_message_attachment", { accountId, messageId, index }),
  saveMessageAttachment: (accountId: string, messageId: string, index: number, destination: string): Promise<void> => command("save_message_attachment", { accountId, messageId, index, destination }),
  saveAllMessageAttachments: (accountId: string, messageId: string, directory: string): Promise<number> => command("save_all_message_attachments", { accountId, messageId, directory }),
  updateMessageMetadata: (accountId: string, messageId: string, metadata: { importance?: "low"|"normal"|"high"; snoozedUntil?: string; isMuted?: boolean; isPhishing?: boolean; isImportant?: boolean }): Promise<MailMessage> => command("update_message_metadata", { accountId, messageId, importance: metadata.importance, snoozedUntil: metadata.snoozedUntil, isMuted: metadata.isMuted, isPhishing: metadata.isPhishing, isImportant: metadata.isImportant }),
  copyMessageToFolder: (accountId: string, messageId: string, targetPath: string): Promise<void> => command("copy_message_to_folder", { accountId, messageId, targetPath }),
  listWorkspace: <T = Record<string, unknown>>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> => command("list_workspace", { kind }),
  listWorkspaceForSync: <T = Record<string, unknown>>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> => command("list_workspace_for_sync", { kind }),
  upsertWorkspace: <T = Record<string, unknown>>(document: WorkspaceDocument<T>): Promise<WorkspaceDocument<T>> => command("upsert_workspace", { document }),
  deleteWorkspace: (kind: WorkspaceKind, id: string): Promise<WorkspaceDocument> => command("delete_workspace", { kind, id }),
  searchWorkspace: (query: string): Promise<WorkspaceDocument[]> => command("search_workspace", { query }),
  exportWorkspace: (): Promise<WorkspaceDocument[]> => command("export_workspace"),
  importWorkspace: (documents: WorkspaceDocument[]): Promise<number> => command("import_workspace", { documents })
};

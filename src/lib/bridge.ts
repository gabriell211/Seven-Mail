import { invoke } from "@tauri-apps/api/core";
import type { AccountProfile, MailFolder, MailMessage, ProviderSettings, QueueOperation, QueuedAttachment, RuntimeInfo, WorkspaceDocument, WorkspaceKind } from "../types";

const hasTauri = () => "__TAURI_INTERNALS__" in window;

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauri()) throw new Error("Comando disponível apenas no aplicativo desktop.");
  return invoke<T>(name, args);
}

export const bridge = {
  runtimeInfo: async (): Promise<RuntimeInfo> => hasTauri()
    ? command<RuntimeInfo>("runtime_info")
    : { platform:"browser", dataDir:"%APPDATA%\\Seven Mail", cacheDir:"%APPDATA%\\Seven Mail\\cache", queueDir:"%APPDATA%\\Seven Mail\\queue", version:"web-preview" },
  setCloseToTray: (enabled: boolean): Promise<void> => command("set_close_to_tray", { enabled }),
  listAccounts: (): Promise<AccountProfile[]> => command("list_accounts"),
  saveAccount: (account: AccountProfile): Promise<void> => command("save_account", { account }),
  setDefaultAccount: (accountId: string): Promise<AccountProfile[]> => command("set_default_account", { accountId }),
  deleteAccount: (accountId: string): Promise<AccountProfile[]> => command("delete_account", { accountId }),
  storeSecret: (accountId: string, secret: string): Promise<void> => command("store_secret", { accountId, secret }),
  discoverProvider: (email: string): Promise<ProviderSettings> => command("discover_provider", { email }),
  testSmtpConnection: (accountId: string): Promise<boolean> => command("test_smtp_connection", { accountId }),
  testImapConnection: (accountId: string): Promise<boolean> => command("test_imap_connection", { accountId }),
  syncInbox: (accountId: string, limit = 50): Promise<number> => command("sync_inbox", { accountId, limit }),
  listFolders: (accountId: string): Promise<MailFolder[]> => command("list_mail_folders", { accountId }),
  syncFolder: (accountId: string, path: string, label: string, limit = 50): Promise<number> => command("sync_mail_folder", { accountId, path, label, limit }),
  flushMailActions: (accountId: string): Promise<number> => command("flush_mail_actions", { accountId }),
  listCachedMessages: (accountId?: string): Promise<MailMessage[]> => command("list_cached_messages", { accountId: accountId ?? null }),
  cacheMessage: (message: MailMessage): Promise<void> => command("cache_message", { message }),
  queueOperation: (operation: QueueOperation): Promise<void> => command("queue_operation", { operation }),
  stageAttachments: (operationId: string, sources: string[]): Promise<QueuedAttachment[]> => command("stage_attachments", { operationId, sources }),
  cancelOperation: (operationId: string): Promise<boolean> => command("cancel_operation", { operationId }),
  listQueue: (): Promise<QueueOperation[]> => command("list_queue"),
  flushOutbox: (): Promise<number> => command("flush_outbox"),
  messageAction: (accountId: string, messageId: string, action: "read" | "unread" | "flag" | "unflag" | "archive" | "delete" | "spam" | "inbox"): Promise<MailMessage> =>
    command("message_action", { accountId, messageId, action }),
  clearCache: (): Promise<void> => command("clear_cache"),
  listWorkspace: <T = Record<string, unknown>>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> => command("list_workspace", { kind }),
  upsertWorkspace: <T = Record<string, unknown>>(document: WorkspaceDocument<T>): Promise<WorkspaceDocument<T>> => command("upsert_workspace", { document }),
  deleteWorkspace: (kind: WorkspaceKind, id: string): Promise<void> => command("delete_workspace", { kind, id }),
  searchWorkspace: (query: string): Promise<WorkspaceDocument[]> => command("search_workspace", { query }),
  exportWorkspace: (): Promise<WorkspaceDocument[]> => command("export_workspace"),
  importWorkspace: (documents: WorkspaceDocument[]): Promise<number> => command("import_workspace", { documents })
};

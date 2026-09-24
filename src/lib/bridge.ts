import { invoke } from "@tauri-apps/api/core";
import type { AccountProfile, MailMessage, ProviderSettings, QueueOperation, RuntimeInfo } from "../types";

const hasTauri = () => "__TAURI_INTERNALS__" in window;

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauri()) throw new Error("Comando disponível apenas no aplicativo desktop.");
  return invoke<T>(name, args);
}

export const bridge = {
  runtimeInfo: async (): Promise<RuntimeInfo> => hasTauri()
    ? command<RuntimeInfo>("runtime_info")
    : { platform:"browser", dataDir:"%APPDATA%\\Seven Mail", cacheDir:"%APPDATA%\\Seven Mail\\cache", queueDir:"%APPDATA%\\Seven Mail\\queue", version:"web-preview" },
  listAccounts: (): Promise<AccountProfile[]> => command("list_accounts"),
  saveAccount: (account: AccountProfile): Promise<void> => command("save_account", { account }),
  storeSecret: (accountId: string, secret: string): Promise<void> => command("store_secret", { accountId, secret }),
  discoverProvider: (email: string): Promise<ProviderSettings> => command("discover_provider", { email }),
  testSmtpConnection: (accountId: string): Promise<boolean> => command("test_smtp_connection", { accountId }),
  testImapConnection: (accountId: string): Promise<boolean> => command("test_imap_connection", { accountId }),
  syncInbox: (accountId: string, limit = 50): Promise<number> => command("sync_inbox", { accountId, limit }),
  listCachedMessages: (accountId?: string): Promise<MailMessage[]> => command("list_cached_messages", { accountId: accountId ?? null }),
  queueOperation: (operation: QueueOperation): Promise<void> => command("queue_operation", { operation }),
  listQueue: (): Promise<QueueOperation[]> => command("list_queue"),
  flushOutbox: (): Promise<number> => command("flush_outbox"),
  clearCache: (): Promise<void> => command("clear_cache")
};

import { invoke } from "@tauri-apps/api/core";
import type { AccountProfile, MailMessage, QueueOperation, RuntimeInfo } from "../types";

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
  removeAccount: (accountId: string): Promise<void> => command("remove_account", { accountId }),
  storeSecret: (accountId: string, secret: string): Promise<void> => command("store_secret", { accountId, secret }),
  listCachedMessages: (accountId?: string): Promise<MailMessage[]> => command("list_cached_messages", { accountId: accountId ?? null }),
  queueOperation: (operation: QueueOperation): Promise<void> => command("queue_operation", { operation }),
  listQueue: (): Promise<QueueOperation[]> => command("list_queue"),
  clearCache: (): Promise<void> => command("clear_cache")
};

import { BetterAuthVanillaAdapter, createClient } from "@neondatabase/neon-js";
import type { AccountProfile, MailMessage, WorkspaceDocument, WorkspaceKind } from "../types";
import { bridge } from "./bridge";
import { sameProjection } from "./cloud-reconciliation";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim();
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL?.trim();

export const neonConfigured = Boolean(authUrl && dataApiUrl);

export const neonClient = authUrl && dataApiUrl
  ? createClient({
      auth: {
        adapter: BetterAuthVanillaAdapter(),
        url: authUrl,
      },
      dataApi: {
        url: dataApiUrl,
      },
    })
  : null;

function requireClient() {
  if (!neonClient) {
    throw new Error("Neon não configurado. Defina VITE_NEON_AUTH_URL e VITE_NEON_DATA_API_URL.");
  }
  return neonClient;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return String(error);
}

export async function getCloudSession() {
  if (!neonClient) return null;
  const result = await neonClient.auth.getSession();
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data ?? null;
}

// The local workspace is not a multi-user container. Do not attach it to a
// second cloud account, even if Neon authentication itself succeeds.
let protocolProof: { owner: string; expires: number } | null = null;
async function requireCloudProtocol(owner: string): Promise<void> {
  if (protocolProof?.owner === owner && protocolProof.expires > Date.now()) return;
  const result = await requireClient().from("seven_mail_sync_capabilities").select("protocol_version").limit(1);
  const rows = (result.data ?? []) as unknown as Array<{protocol_version:number}>;
  if (result.error || rows[0]?.protocol_version !== 2) {
    const error = new Error("O banco Neon precisa da migration de sincronização v2.");
    reportCloudSyncError(error, "migration");
    throw error;
  }
  protocolProof = { owner, expires: Date.now() + 60_000 };
}

export async function getAuthorizedCloudOwner(): Promise<string | null> {
  if (!neonClient) return null;
  const session = await getCloudSession();
  const owner = session?.session && session.user?.id;
  if (!owner) return null;
  const binding = await bridge.getCloudBinding();
  if (!binding?.enabled || binding.ownerId !== owner) return null;
  await requireCloudProtocol(owner);
  return owner;
}

let lastCloudSyncError: { scope: string; message: string } | null = null;

export function getLastCloudSyncError() { return lastCloudSyncError; }

export function clearCloudSyncError(): void {
  lastCloudSyncError = null;
  window.dispatchEvent(new Event("seven-mail:cloud-sync-error"));
}

export function reportCloudSyncError(error: unknown, scope: string): void {
  // Report scope only; remote errors may contain message payloads or identifiers.
  void error;
  lastCloudSyncError = { scope, message: scope === "migration" ? "O banco Neon precisa da migration de sincronização v2. A sincronização está suspensa." : "A sincronização não foi concluída. Os dados locais foram preservados." };
  window.dispatchEvent(new Event("seven-mail:cloud-sync-error"));
}

export async function setCloudSyncConsent(enabled: boolean): Promise<void> {
  const session = await getCloudSession();
  const owner = session?.session && session.user?.id;
  if (!owner) throw new Error("Entre na conta Neon antes de configurar a sincronização.");
  await bridge.setCloudBinding(owner, enabled);
  protocolProof = null;
  versions.clear();
  window.dispatchEvent(new Event("seven-mail:cloud-session"));
}

export async function signInCloud(email: string, password: string) {
  const result = await requireClient().auth.signIn.email({ email, password });
  if (result.error) throw new Error(errorMessage(result.error));
  window.dispatchEvent(new Event("seven-mail:cloud-session"));
  return result.data;
}

export async function signUpCloud(name: string, email: string, password: string) {
  const result = await requireClient().auth.signUp.email({ name, email, password });
  if (result.error) throw new Error(errorMessage(result.error));
  window.dispatchEvent(new Event("seven-mail:cloud-session"));
  return result.data;
}

export async function signOutCloud() {
  if (!neonClient) return;
  const result = await neonClient.auth.signOut();
  if (result.error) throw new Error(errorMessage(result.error));
  protocolProof = null;
  versions.clear();
  clearCloudSyncError();
  window.dispatchEvent(new Event("seven-mail:cloud-session"));
}

interface CloudWorkspaceRow<T> {
  id: string;
  kind: WorkspaceKind;
  payload: T;
  updated_at: string;
  deleted_at: string | null;
}

export async function pullCloudDocuments<T>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> {
  if (!neonClient) return [];
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return [];

  const rows: Array<CloudWorkspaceRow<T>> = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
    const result = await neonClient
      .from("workspace_documents")
      .select("id, kind, payload, updated_at, deleted_at")
      .eq("owner_id", owner)
      .eq("kind", kind)
      .order("id")
      .range(offset, offset + pageSize - 1);

    if (result.error) throw new Error(errorMessage(result.error));
    const page = (result.data ?? []) as unknown as Array<CloudWorkspaceRow<T>>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    updatedAt: row.deleted_at && Date.parse(row.deleted_at) > Date.parse(row.updated_at)
      ? row.deleted_at
      : row.updated_at,
    deletedAt: row.deleted_at,
  }));
}

export async function pushCloudDocument<T>(document: WorkspaceDocument<T>, expectedOwner?: string): Promise<void> {
  if (!neonClient) return;
  const owner = await getAuthorizedCloudOwner();
  if (expectedOwner && owner !== expectedOwner) throw new Error("Sessão Neon alterada.");
  if (!owner) return;
  try {
    const result = await neonClient.from("workspace_documents").upsert({
      owner_id: owner,
      id: document.id,
      kind: document.kind,
      payload: document.payload,
      updated_at: document.updatedAt,
      deleted_at: document.deletedAt ?? null,
    }, { onConflict: "id" });
    if (result.error) throw new Error(errorMessage(result.error));
  } catch (error) {
    reportCloudSyncError(error, document.kind);
    throw error;
  }
}

export async function pushCloudDocuments(documents: WorkspaceDocument[]): Promise<void> {
  if (!neonClient || documents.length === 0) return;
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return;
  // Each record has its own conflict outcome. Do not roll back unrelated edits.
  const failures: unknown[] = [];
  for (const document of documents) {
    if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
    try { await pushCloudDocument(document, owner); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new Error("Um ou mais documentos não foram sincronizados.");
}

type MailTable = "desktop_mail_accounts" | "desktop_mail_messages";
type VersionedRow = { id: string; updated_at: string };
const versions = new Map<string, string>();
const versionKey = (owner: string, table: MailTable, id: string) => JSON.stringify([owner, table, id]);

function rememberVersions(owner: string, table: MailTable, rows: VersionedRow[]): void {
  for (const row of rows) {
    if (typeof row.updated_at === "string" && row.updated_at) {
      versions.set(versionKey(owner, table, row.id), row.updated_at);
    }
  }
}

async function insertMailRows(table: MailTable, owner: string, rows: Array<Record<string, unknown> & {id:string}>): Promise<void> {
  if (!neonClient || rows.length === 0) return;
  if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
  const result = await neonClient.from(table).upsert(rows, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false }).select("id,updated_at");
  if (result.error) throw new Error(errorMessage(result.error));
  rememberVersions(owner, table, (result.data ?? []) as unknown as VersionedRow[]);
}

async function updateMailRow(table: MailTable, owner: string, row: Record<string, unknown> & {id:string}): Promise<void> {
  if (!neonClient) return;
  const key = versionKey(owner, table, row.id);
  const version = versions.get(key);
  if (!version) {
    await insertMailRows(table, owner, [row]);
    if (!versions.has(key)) throw new Error("Registro existente sem versão local confirmada.");
    return;
  }
  if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
  const result = await neonClient.from(table).update(row)
    .eq("owner_id", owner).eq("id", row.id).eq("updated_at", version)
    .is("deleted_at", null).select("id,updated_at");
  if (result.error) throw new Error(errorMessage(result.error));
  const rows = (result.data ?? []) as unknown as VersionedRow[];
  if (rows.length !== 1 || rows[0].id !== row.id) {
    versions.delete(key);
    throw new Error("Conflito de versão: sincronize o registro antes de editar.");
  }
  rememberVersions(owner, table, rows);
}



interface CloudAccountRow {
  id: string;
  display_name: string;
  email: string;
  provider: AccountProfile["provider"];
  color: string;
  is_default: boolean;
  username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  security_mode: AccountProfile["securityMode"] | null;
  updated_at: string;
}

export async function pullCloudAccounts(local: AccountProfile[] = []): Promise<AccountProfile[]> {
  if (!neonClient) return [];
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return [];

  const result = await neonClient
    .from("desktop_mail_accounts")
    .select("id, display_name, email, provider, color, is_default, username, imap_host, imap_port, smtp_host, smtp_port, security_mode, updated_at")
    .eq("owner_id", owner)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (result.error) throw new Error(errorMessage(result.error));
  if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
  const rows = (result.data ?? []) as unknown as CloudAccountRow[];
  const localById = new Map(local.map(account => [account.id, account]));
  for (const row of rows) {
    const account = localById.get(row.id);
    if (account && sameProjection(accountToCloudRow(account, owner), row)) {
      rememberVersions(owner, "desktop_mail_accounts", [row]);
    } else if (account) {
      versions.delete(versionKey(owner, "desktop_mail_accounts", row.id));
      reportCloudSyncError(new Error("Conta com versões divergentes."), "accounts");
    }
  }
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    provider: row.provider,
    color: row.color,
    isDefault: row.is_default,
    username: row.username ?? undefined,
    imapHost: row.imap_host ?? undefined,
    imapPort: row.imap_port ?? undefined,
    smtpHost: row.smtp_host ?? undefined,
    smtpPort: row.smtp_port ?? undefined,
    securityMode: row.security_mode ?? undefined,
  }));
}

function accountToCloudRow(account: AccountProfile, owner: string) {
  return {
    owner_id: owner,
    id: account.id,
    display_name: account.displayName,
    email: account.email,
    provider: account.provider,
    color: account.color,
    is_default: account.isDefault,
    username: account.username ?? null,
    imap_host: account.imapHost ?? null,
    imap_port: account.imapPort ?? null,
    smtp_host: account.smtpHost ?? null,
    smtp_port: account.smtpPort ?? null,
    security_mode: account.securityMode ?? null,
  };
}

export async function pushCloudAccount(account: AccountProfile): Promise<void> {
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return;
  try { await updateMailRow("desktop_mail_accounts", owner, accountToCloudRow(account, owner)); }
  catch (error) { reportCloudSyncError(error, "accounts"); throw error; }
}

export async function pushCloudAccounts(accounts: AccountProfile[]): Promise<void> {
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return;
  try {
    for (let offset = 0; offset < accounts.length; offset += 50) {
      await insertMailRows("desktop_mail_accounts", owner, accounts.slice(offset, offset+50).map(account => accountToCloudRow(account, owner)));
    }
  } catch (error) { reportCloudSyncError(error, "accounts"); throw error; }
}

interface CloudMessageRow extends VersionedRow {
  id: string;
  account_id: string;
  remote_id: string | null;
  remote_folder: string | null;
  folder: string;
  subject: string;
  preview: string;
  sender: MailMessage["from"];
  recipients: MailMessage["to"];
  received_at: string;
  is_read: boolean;
  is_flagged: boolean;
  is_pinned: boolean;
  has_attachments: boolean;
  body_html: string | null;
  body_text: string | null;
  categories: string[];
}

function cloudRowToMessage(row: CloudMessageRow): MailMessage {
  return {
    id: row.id,
    accountId: row.account_id,
    remoteId: row.remote_id ?? undefined,
    remoteFolder: row.remote_folder ?? undefined,
    folder: row.folder,
    subject: row.subject,
    preview: row.preview,
    from: row.sender,
    to: row.recipients,
    receivedAt: row.received_at,
    isRead: row.is_read,
    isFlagged: row.is_flagged,
    isPinned: row.is_pinned,
    hasAttachments: row.has_attachments,
    bodyHtml: row.body_html ?? undefined,
    bodyText: row.body_text ?? undefined,
    categories: row.categories ?? [],
  };
}

export async function pullCloudMessages(accountId: string, limit = 500, local: MailMessage[] = []): Promise<MailMessage[]> {
  if (!neonClient) return [];
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return [];

  const result = await neonClient
    .from("desktop_mail_messages")
    .select("id, account_id, remote_id, remote_folder, folder, subject, preview, sender, recipients, received_at, is_read, is_flagged, is_pinned, has_attachments, body_html, body_text, categories, updated_at")
    .eq("owner_id", owner)
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 2000)));

  if (result.error) throw new Error(errorMessage(result.error));
  if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
  const rows = (result.data ?? []) as unknown as CloudMessageRow[];
  const localById = new Map(local.map(message => [message.id, message]));
  for (const row of rows) {
    const message = localById.get(row.id);
    if (message && sameProjection(messageToCloudRow(message, owner), row)) {
      rememberVersions(owner, "desktop_mail_messages", [row]);
    } else if (message) {
      versions.delete(versionKey(owner, "desktop_mail_messages", row.id));
      reportCloudSyncError(new Error("Mensagem com versões divergentes."), "messages");
    }
  }
  return rows.map(cloudRowToMessage);
}

function messageToCloudRow(message: MailMessage, owner: string) {
  return {
    owner_id: owner,
    id: message.id,
    account_id: message.accountId,
    remote_id: message.remoteId ?? null,
    remote_folder: message.remoteFolder ?? null,
    folder: message.folder,
    subject: message.subject,
    preview: message.preview,
    sender: message.from,
    recipients: message.to,
    received_at: message.receivedAt,
    is_read: message.isRead,
    is_flagged: message.isFlagged,
    is_pinned: message.isPinned,
    has_attachments: message.hasAttachments,
    body_html: message.bodyHtml ?? null,
    body_text: message.bodyText ?? null,
    categories: message.categories,
  };
}

export async function pushCloudMessage(message: MailMessage): Promise<void> {
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return;
  try { await updateMailRow("desktop_mail_messages", owner, messageToCloudRow(message, owner)); }
  catch (error) { reportCloudSyncError(error, "messages"); throw error; }
}

export async function pushCloudMessages(messages: MailMessage[]): Promise<void> {
  if (!neonClient || messages.length === 0) return;
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return;
  // Deduplicate IDs and bound requests by batch size.
  const unique = [...new Map(messages.map((message) => [message.id, message])).values()];
  const batchSize = 50;
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    if (await getAuthorizedCloudOwner() !== owner) return;
    const rows = unique.slice(offset, offset + batchSize).map((message) => messageToCloudRow(message, owner));
    try { await insertMailRows("desktop_mail_messages", owner, rows); }
    catch (error) { reportCloudSyncError(error, "messages"); throw error; }
  }
}


export async function deleteCloudAccount(accountId: string): Promise<void> {
  if (!neonClient) return;
  const owner = await getAuthorizedCloudOwner();
  if (!owner) return;
  try {
    const key = versionKey(owner, "desktop_mail_accounts", accountId);
    const version = versions.get(key);
    if (!version) throw new Error("Conta sem versão local confirmada para exclusão remota.");
    if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada.");
    // The database trigger tombstones dependent messages in the same transaction.
    const result = await neonClient.from("desktop_mail_accounts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("owner_id", owner).eq("id", accountId).eq("updated_at", version)
      .is("deleted_at", null).select("id");
    if (result.error) throw new Error(errorMessage(result.error));
    const rows = (result.data ?? []) as unknown as Array<{id:string}>;
    if (rows.length !== 1 || rows[0].id !== accountId) {
      throw new Error("Conflito de versão na exclusão da conta.");
    }
    versions.delete(key);
  } catch (error) {
    reportCloudSyncError(error, "accounts");
    throw error;
  }
}

import { createAuthClient } from "@neondatabase/auth";
import { fetchWithToken, NeonPostgrestClient } from "@neondatabase/postgrest-js";
import type { AccountProfile, MailMessage, WorkspaceDocument, WorkspaceKind } from "../types";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim();
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL?.trim();

export const neonConfigured = Boolean(authUrl && dataApiUrl);
export const neonAuth = authUrl ? createAuthClient(authUrl) : null;

async function accessToken(): Promise<string | null> {
  if (!neonAuth) return null;
  return (await neonAuth.getJWTToken?.()) ?? null;
}

export const neonClient = dataApiUrl
  ? new NeonPostgrestClient({
      dataApiUrl,
      options: {
        global: {
          fetch: fetchWithToken(accessToken),
        },
      },
    })
  : null;

function requireAuth() {
  if (!neonAuth) {
    throw new Error("Neon Auth não configurado. Defina VITE_NEON_AUTH_URL.");
  }
  return neonAuth;
}

function requireClient() {
  if (!neonClient) {
    throw new Error("Neon Data API não configurada. Defina VITE_NEON_DATA_API_URL.");
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
  if (!neonAuth) return null;
  const result = await neonAuth.getSession();
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data ?? null;
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
  if (!neonAuth) return;
  const result = await neonAuth.signOut();
  if (result.error) throw new Error(errorMessage(result.error));
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
  const session = await getCloudSession();
  if (!session?.session) return [];

  const result = await neonClient
    .from("workspace_documents")
    .select("id, kind, payload, updated_at, deleted_at")
    .eq("kind", kind)
    .is("deleted_at", null);

  if (result.error) throw new Error(errorMessage(result.error));

  const rows = (result.data ?? []) as unknown as Array<CloudWorkspaceRow<T>>;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    updatedAt: row.updated_at,
  }));
}

export async function pushCloudDocument<T>(document: WorkspaceDocument<T>): Promise<void> {
  if (!neonClient) return;
  const session = await getCloudSession();
  if (!session?.session) return;

  const result = await neonClient
    .from("workspace_documents")
    .upsert(
      {
        id: document.id,
        kind: document.kind,
        payload: document.payload,
        updated_at: document.updatedAt,
        deleted_at: null,
      },
      { onConflict: "id" },
    );

  if (result.error) throw new Error(errorMessage(result.error));
}

export async function pushCloudDocuments(documents: WorkspaceDocument[]): Promise<void> {
  if (!neonClient || documents.length === 0) return;
  const session = await getCloudSession();
  if (!session?.session) return;

  const rows = documents.map((document) => ({
    id: document.id,
    kind: document.kind,
    payload: document.payload,
    updated_at: document.updatedAt,
    deleted_at: null,
  }));

  const result = await neonClient
    .from("workspace_documents")
    .upsert(rows, { onConflict: "id" });

  if (result.error) throw new Error(errorMessage(result.error));
}

export async function deleteCloudDocument(kind: WorkspaceKind, id: string): Promise<void> {
  if (!neonClient) return;
  const session = await getCloudSession();
  if (!session?.session) return;

  const result = await neonClient
    .from("workspace_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("kind", kind);

  if (result.error) throw new Error(errorMessage(result.error));
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

export async function pullCloudAccounts(): Promise<AccountProfile[]> {
  if (!neonClient) return [];
  const session = await getCloudSession();
  if (!session?.session) return [];

  const result = await neonClient
    .from("desktop_mail_accounts")
    .select("id, display_name, email, provider, color, is_default, username, imap_host, imap_port, smtp_host, smtp_port, security_mode, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (result.error) throw new Error(errorMessage(result.error));
  const rows = (result.data ?? []) as unknown as CloudAccountRow[];
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

export async function pushCloudAccount(account: AccountProfile): Promise<void> {
  if (!neonClient) return;
  const session = await getCloudSession();
  if (!session?.session) return;

  const result = await neonClient.from("desktop_mail_accounts").upsert({
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
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }, { onConflict: "id" });

  if (result.error) throw new Error(errorMessage(result.error));
}

export async function pushCloudAccounts(accounts: AccountProfile[]): Promise<void> {
  for (const account of accounts) {
    await pushCloudAccount(account);
  }
}

interface CloudMessageRow {
  id: string;
  account_id: string;
  remote_id: string | null;
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

export async function pullCloudMessages(accountId: string, limit = 500): Promise<MailMessage[]> {
  if (!neonClient) return [];
  const session = await getCloudSession();
  if (!session?.session) return [];

  const result = await neonClient
    .from("desktop_mail_messages")
    .select("id, account_id, remote_id, folder, subject, preview, sender, recipients, received_at, is_read, is_flagged, is_pinned, has_attachments, body_html, body_text, categories")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 2000)));

  if (result.error) throw new Error(errorMessage(result.error));
  return ((result.data ?? []) as unknown as CloudMessageRow[]).map(cloudRowToMessage);
}

export async function pushCloudMessage(message: MailMessage): Promise<void> {
  if (!neonClient) return;
  const session = await getCloudSession();
  if (!session?.session) return;

  const result = await neonClient.from("desktop_mail_messages").upsert({
    id: message.id,
    account_id: message.accountId,
    remote_id: message.remoteId ?? null,
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
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }, { onConflict: "id" });

  if (result.error) throw new Error(errorMessage(result.error));
}

export async function pushCloudMessages(messages: MailMessage[]): Promise<void> {
  if (messages.length === 0) return;
  for (const message of messages) {
    await pushCloudMessage(message);
  }
}

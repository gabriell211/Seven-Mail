import { createClient } from "@neondatabase/neon-js";
import type { WorkspaceDocument, WorkspaceKind } from "../types";

const databaseUrl = import.meta.env.VITE_NEON_DATABASE_URL?.trim();
export const neonConfigured = Boolean(databaseUrl);

export const neonClient = databaseUrl ? createClient(databaseUrl) : null;

function requireClient() {
  if (!neonClient) {
    throw new Error("Neon não configurado. Defina os endpoints públicos no build do Seven Mail.");
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

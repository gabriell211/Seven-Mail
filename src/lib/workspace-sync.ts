import { bridge } from "./bridge";
import { getAuthorizedCloudOwner, pullCloudDocuments, pushCloudDocument, reportCloudSyncError } from "./neon";
import { reconcileDocuments } from "./cloud-reconciliation";
import type { WorkspaceDocument, WorkspaceKind } from "../types";

const pending = new Map<WorkspaceKind, Promise<unknown>>();

export async function syncWorkspaceCollection<T>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> {
  const previous = pending.get(kind);
  const task = (previous?.catch(() => undefined) ?? Promise.resolve()).then(() => syncCollection<T>(kind));
  pending.set(kind, task);
  try {
    return await task;
  } finally {
    if (pending.get(kind) === task) pending.delete(kind);
  }
}

async function syncCollection<T>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> {
  try {
    const owner = await getAuthorizedCloudOwner();
    if (owner) {
      const cloud = await pullCloudDocuments<T>(kind);
      if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada durante sincronização.");
      const local = await bridge.listWorkspaceForSync<T>(kind);
      const localById = new Map(local.map((document) => [document.id, document]));
      const remoteById = new Map(cloud.map((document) => [document.id, document]));
      for (const remote of cloud) {
        if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada durante sincronização.");
        const current = localById.get(remote.id);
        const decision = current ? reconcileDocuments(current, remote) : "remote";
        if (decision === "remote") {
          await bridge.upsertWorkspace(remote);
        } else if (decision === "local" && current) {
          await pushCloudDocument(current, owner);
        } else if (decision === "conflict") {
          reportCloudSyncError(new Error("Versões divergentes com a mesma data; documento local preservado."), kind);
        }
      }
      for (const document of local) {
        if (await getAuthorizedCloudOwner() !== owner) throw new Error("Sessão Neon alterada durante sincronização.");
        if (!remoteById.has(document.id)) await pushCloudDocument(document, owner);
      }
    }
  } catch (error) {
    reportCloudSyncError(error, kind);
  }
  // Re-read the native store; never return a stale snapshot after concurrent edits.
  return (await bridge.listWorkspaceForSync<T>(kind))
    .filter((document) => !document.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

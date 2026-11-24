import type { WorkspaceDocument } from "../types";

export type Reconciliation = "local" | "remote" | "equal" | "conflict";

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("Data de versão da sincronização inválida.");
  return result;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry)).join(",") + "}";
}

export function reconcileDocuments<T>(local: WorkspaceDocument<T>, remote: WorkspaceDocument<T>): Reconciliation {
  if (local.id !== remote.id || local.kind !== remote.kind) throw new Error("Identidade de documento divergente.");
  const localTime = Math.max(timestamp(local.updatedAt), local.deletedAt ? timestamp(local.deletedAt) : -Infinity);
  const remoteTime = Math.max(timestamp(remote.updatedAt), remote.deletedAt ? timestamp(remote.deletedAt) : -Infinity);
  // A deleted identity is never silently restored, even by a newer cached copy.
  if (Boolean(local.deletedAt) !== Boolean(remote.deletedAt)) return local.deletedAt ? "local" : "remote";
  if (localTime !== remoteTime) return localTime > remoteTime ? "local" : "remote";
  if (local.deletedAt && remote.deletedAt) return "equal";
  return canonical(local.payload) === canonical(remote.payload) ? "equal" : "conflict";
}

/** Compare only mirrored fields, never unrelated server metadata. */
export function sameProjection(local: Record<string, unknown>, remote: object): boolean {
  const row = remote as Record<string, unknown>;
  return Object.entries(local).every(([key, value]) =>
    key === "owner_id" || (Object.hasOwn(row, key) && canonical(value) === canonical(row[key])));
}

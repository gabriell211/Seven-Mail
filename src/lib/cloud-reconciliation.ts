import type { WorkspaceDocument } from "../types";

export type Reconciliation = "local" | "remote" | "equal" | "conflict";

function timestamp(value: string): bigint {
  // PostgreSQL uses microseconds and chrono can emit nanoseconds; Date.parse
  // alone truncates both to milliseconds and can equate distinct versions.
  const match = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("Data de versão da sincronização inválida.");
  const [, date, time, fraction = "", zone] = match;
  const wallTime = Date.parse(`${date}T${time}Z`);
  const wholeSeconds = Date.parse(`${date}T${time}${zone.toUpperCase()}`);
  if (!Number.isFinite(wallTime) || !Number.isFinite(wholeSeconds)
      || new Date(wallTime).toISOString().slice(0, 19) !== `${date}T${time}`) {
    throw new Error("Data de versão da sincronização inválida.");
  }
  return BigInt(wholeSeconds) * 1_000_000n + BigInt(fraction.padEnd(9, "0"));
}

export function compareVersionTimestamps(a: string, b: string): -1 | 0 | 1 {
  const left = timestamp(a);
  const right = timestamp(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function documentVersion<T>(document: WorkspaceDocument<T>): bigint {
  const updated = timestamp(document.updatedAt);
  if (!document.deletedAt) return updated;
  const deleted = timestamp(document.deletedAt);
  return deleted > updated ? deleted : updated;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry)).join(",") + "}";
}

export function reconcileDocuments<T>(local: WorkspaceDocument<T>, remote: WorkspaceDocument<T>): Reconciliation {
  if (local.id !== remote.id || local.kind !== remote.kind) throw new Error("Identidade de documento divergente.");
  const localTime = documentVersion(local);
  const remoteTime = documentVersion(remote);
  // A deleted identity is never silently restored, even by a newer cached copy.
  if (Boolean(local.deletedAt) !== Boolean(remote.deletedAt)) return local.deletedAt ? "local" : "remote";
  if (localTime !== remoteTime) return localTime > remoteTime ? "local" : "remote";
  if (local.deletedAt && remote.deletedAt) return "equal";
  return canonical(local.payload) === canonical(remote.payload) ? "equal" : "conflict";
}

/** Compare only mirrored fields, never unrelated server metadata. */
export function sameProjection(local: Record<string, unknown>, remote: object): boolean {
  const row = remote as Record<string, unknown>;
  return Object.entries(local).every(([key, value]) => {
    if (key === "owner_id") return true;
    if (!Object.hasOwn(row, key)) return false;
    if (key === "received_at" && typeof value === "string" && typeof row[key] === "string") {
      const localTime = Date.parse(value);
      const remoteTime = Date.parse(row[key]);
      return Number.isFinite(localTime) && localTime === remoteTime;
    }
    return canonical(value) === canonical(row[key]);
  });
}

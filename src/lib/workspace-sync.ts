import { bridge } from "./bridge";
import { pullCloudDocuments, pushCloudDocument } from "./neon";
import type { WorkspaceDocument, WorkspaceKind } from "../types";

export async function syncWorkspaceCollection<T>(kind: WorkspaceKind): Promise<Array<WorkspaceDocument<T>>> {
  const local = await bridge.listWorkspaceForSync<T>(kind);
  const merged = new Map(local.map((document) => [document.id, document]));

  try {
    const cloud = await pullCloudDocuments<T>(kind);
    const cloudIds = new Set(cloud.map((document) => document.id));

    for (const remote of cloud) {
      const current = merged.get(remote.id);
      const timeDifference = current
        ? Date.parse(remote.updatedAt) - Date.parse(current.updatedAt)
        : 1;
      const remoteWins = !current
        || timeDifference > 0
        || (timeDifference === 0 && Boolean(remote.deletedAt) && !current.deletedAt);
      const localWins = current && (
        timeDifference < 0
        || (timeDifference === 0 && Boolean(current.deletedAt) && !remote.deletedAt)
      );

      if (remoteWins) {
        await bridge.upsertWorkspace(remote);
        merged.set(remote.id, remote);
      } else if (localWins) {
        void pushCloudDocument(current).catch(() => undefined);
      }
    }

    for (const document of local) {
      if (!cloudIds.has(document.id)) {
        void pushCloudDocument(document).catch(() => undefined);
      }
    }
  } catch {
    // Local documents and tombstones remain available for the next sync.
  }

  return [...merged.values()]
    .filter((document) => !document.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

import type { MailMessage } from "../types";

export type MailQuickFilter = "all" | "unread" | "flagged" | "attachments";

type SearchToken =
  | { kind: "text"; value: string }
  | { kind: "field"; field: "from" | "to" | "subject" | "body" | "folder"; value: string }
  | { kind: "state"; value: "read" | "unread" | "flagged" | "unflagged" }
  | { kind: "has"; value: "attachment" | "attachments" }
  | { kind: "after" | "before"; value: string };

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitQuery(query: string): string[] {
  return query.match(/(?:[^\s"]+:"[^"]*"|"[^"]*"|\S+)/g) ?? [];
}

function parseToken(raw: string): SearchToken {
  const token = unquote(raw);
  const separator = token.indexOf(":");
  if (separator <= 0) return { kind: "text", value: token };

  const key = normalize(token.slice(0, separator));
  const value = unquote(token.slice(separator + 1));

  if (["from", "to", "subject", "body", "folder"].includes(key) && value) {
    return {
      kind: "field",
      field: key as "from" | "to" | "subject" | "body" | "folder",
      value,
    };
  }

  if (key === "is" && ["read", "unread", "flagged", "unflagged"].includes(normalize(value))) {
    return { kind: "state", value: normalize(value) as SearchToken & never };
  }

  if (key === "has" && ["attachment", "attachments"].includes(normalize(value))) {
    return { kind: "has", value: normalize(value) as "attachment" | "attachments" };
  }

  if ((key === "after" || key === "before") && value) {
    return { kind: key, value };
  }

  return { kind: "text", value: token };
}

function includes(value: string | undefined, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

function recipients(message: MailMessage): string {
  return message.to.map((recipient) => `${recipient.name ?? ""} ${recipient.email}`).join(" ");
}

function dateBoundary(value: string, endOfDay: boolean): number | null {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(isoDate ? `${value}T00:00:00` : value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (endOfDay && isoDate) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed.getTime();
}

function matchesToken(message: MailMessage, token: SearchToken): boolean {
  switch (token.kind) {
    case "text": {
      const haystack = [
        message.subject,
        message.preview,
        message.bodyText,
        message.from.name,
        message.from.email,
        recipients(message),
        message.folder,
        message.remoteFolder,
        ...message.categories,
      ].filter(Boolean).join(" ");
      return includes(haystack, token.value);
    }
    case "field": {
      const value = token.value;
      if (token.field === "from") {
        return includes(`${message.from.name ?? ""} ${message.from.email}`, value);
      }
      if (token.field === "to") return includes(recipients(message), value);
      if (token.field === "subject") return includes(message.subject, value);
      if (token.field === "body") return includes(`${message.bodyText ?? ""} ${message.preview}`, value);
      return includes(`${message.folder} ${message.remoteFolder ?? ""}`, value);
    }
    case "state":
      if (token.value === "read") return message.isRead;
      if (token.value === "unread") return !message.isRead;
      if (token.value === "flagged") return message.isFlagged;
      return !message.isFlagged;
    case "has":
      return message.hasAttachments;
    case "after": {
      const boundary = dateBoundary(token.value, false);
      if (boundary === null) return false;
      return new Date(message.receivedAt).getTime() >= boundary;
    }
    case "before": {
      const boundary = dateBoundary(token.value, true);
      if (boundary === null) return false;
      return new Date(message.receivedAt).getTime() <= boundary;
    }
  }
}

export function matchesMailQuery(message: MailMessage, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  return splitQuery(trimmed).map(parseToken).every((token) => matchesToken(message, token));
}

export function matchesQuickFilter(message: MailMessage, filter: MailQuickFilter): boolean {
  if (filter === "unread") return !message.isRead;
  if (filter === "flagged") return message.isFlagged;
  if (filter === "attachments") return message.hasAttachments;
  return true;
}

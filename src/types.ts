export type AppSection = "mail" | "calendar" | "people" | "tasks" | "notes" | "rules" | "settings";
export type ThemeMode = "system" | "light" | "dark";
export type ReadingPane = "right" | "bottom" | "off";

export interface RuntimeInfo {
  platform: string;
  dataDir: string;
  cacheDir: string;
  queueDir: string;
  version: string;
}

export interface AccountProfile {
  id: string;
  displayName: string;
  email: string;
  provider: "gmail" | "microsoft" | "yahoo" | "icloud" | "imap";
  color: string;
  isDefault: boolean;
  username?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  securityMode?: "tls" | "starttls";
}

export interface ProviderSettings {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  securityMode: "tls" | "starttls";
}

export interface MailAddress { name?: string; email: string; }

export interface MailMessage {
  id: string;
  accountId: string;
  folder: string;
  subject: string;
  preview: string;
  from: MailAddress;
  to: MailAddress[];
  receivedAt: string;
  isRead: boolean;
  isFlagged: boolean;
  isPinned: boolean;
  hasAttachments: boolean;
  bodyHtml?: string;
  bodyText?: string;
  categories: string[];
}

export interface QueueOperation {
  id: string;
  kind: "send" | "move" | "delete" | "flag" | "read" | "draft";
  accountId: string;
  createdAt: string;
  attempts: number;
  payload: Record<string, unknown>;
}

export interface AppSettings {
  theme: ThemeMode;
  readingPane: ReadingPane;
  compact: boolean;
  previewLines: 1 | 2;
  markReadDelayMs: number;
  confirmBeforeDelete: boolean;
  confirmBeforeSend: boolean;
  startWithSystem: boolean;
  minimizeToTray: boolean;
}

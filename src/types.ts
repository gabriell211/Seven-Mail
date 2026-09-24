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
  remoteId?: string;
  remoteFolder?: string;
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
  sendDelaySeconds: 0 | 5 | 10 | 20 | 30;
}


export type WorkspaceKind = "calendar" | "contact" | "task" | "note" | "rule" | "category" | "saved-search" | "settings" | "draft";

export interface WorkspaceDocument<T = Record<string, unknown>> {
  id: string;
  kind: WorkspaceKind;
  updatedAt: string;
  payload: T;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string;
  participants: string[];
}

export interface ContactItem {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  notes: string;
  favorite: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  notes: string;
  priority: "low" | "normal" | "high";
  listName: string;
  startsAt?: string;
  dueAt?: string;
  reminderAt?: string;
  completedAt?: string;
  relatedMessageId?: string;
}

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  color: string;
}

export interface RuleItem {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  field: "from" | "to" | "subject" | "body" | "domain";
  operator: "contains" | "equals";
  value: string;
  action: "archive" | "delete" | "spam" | "flag" | "read";
}


export interface MailFolder {
  name: string;
  path: string;
  role: "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash" | "flagged" | "custom";
}


export interface QueuedAttachment {
  name: string;
  path: string;
  size: number;
}

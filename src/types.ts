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
  aliases?: string[];
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
  appliedRuleIds?: string[];
  sizeBytes?: number;
  attachmentNames?: string[];
  importance?: "low" | "normal" | "high";
  snoozedUntil?: string;
  isMuted?: boolean;
  isPhishing?: boolean;
  isImportant?: boolean;
}

export interface QueueOperation {
  id: string;
  kind: "send" | "move" | "copy" | "delete" | "flag" | "read" | "draft";
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
  notificationsEnabled: boolean;
  syncIntervalMinutes: 1 | 5 | 10 | 15 | 30;
  focusInboxEnabled?: boolean;
  mailPageSize?: 25 | 50 | 100;
  maxAttachmentMb?: 10 | 25 | 50 | 100;
  openNextAfterDelete?: boolean;
  showSenderPhotos?: boolean;
  blockedSenders?: string[];
  trustedSenders?: string[];
  blockedDomains?: string[];
  favoriteFolders?: Record<string, string[]>;
  folderOrder?: Record<string, string[]>;
}


export type WorkspaceKind = "calendar" | "contact" | "task" | "note" | "rule" | "category" | "saved-search" | "signature" | "settings" | "draft" | "template" | "content-block" | "folder-pref" | "profile";

export interface WorkspaceDocument<T = Record<string, unknown>> {
  id: string;
  kind: WorkspaceKind;
  updatedAt: string;
  payload: T;
  deletedAt?: string | null;
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
  reminderAt?: string;
  reminderNotifiedAt?: string;
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
  reminderNotifiedAt?: string;
  completedAt?: string;
  relatedMessageId?: string;
}

export interface CategoryItem {
  id: string;
  name: string;
  color: string;
  favorite?: boolean;
}

export interface SavedSearchItem {
  id: string;
  name: string;
  query: string;
}

export interface SignatureItem {
  id: string;
  accountId: string;
  name: string;
  bodyText: string;
  bodyHtml: string;
  isDefault: boolean;
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
  field: "from" | "to" | "subject" | "body" | "domain" | "size" | "attachment" | "priority";
  operator: "contains" | "equals" | "greater" | "less";
  value: string;
  action: "archive" | "delete" | "spam" | "flag" | "read" | "move" | "copy" | "category" | "forward";
  target?: string;
  stopProcessing?: boolean;
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


export interface MailAttachmentInfo {
  index: number;
  name: string;
  size: number;
  mime: string;
  inline: boolean;
}

export interface MailTemplateItem {
  id: string;
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export interface ContentBlockItem {
  id: string;
  name: string;
  bodyText: string;
  bodyHtml: string;
}

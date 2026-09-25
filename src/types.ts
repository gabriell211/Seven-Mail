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
  incomingProtocol?: "imap" | "pop3";
  imapHost?: string;
  imapPort?: number;
  pop3Host?: string;
  pop3Port?: number;
  caldavUrl?: string;
  carddavUrl?: string;
  ldapUrl?: string;
  ldapBaseDn?: string;
  ldapFilter?: string;
  oauthEnabled?: boolean;
  oauthClientId?: string;
  oauthAuthorizationUrl?: string;
  oauthTokenUrl?: string;
  oauthScopes?: string[];
  oauthRedirectUri?: string;
  smtpHost?: string;
  smtpPort?: number;
  securityMode?: "tls" | "starttls";
  aliases?: string[];
  isSharedMailbox?: boolean;
  sharedOwnerAccountId?: string;
  sharedOwnerEmail?: string;
  sharedMode?: "resource" | "account";
  sharedPermissions?: Array<"read" | "edit" | "calendar" | "manage-calendar" | "send">;
  sendMode?: "as" | "on-behalf";
  muted?: boolean;
  connectionTimeoutSeconds?: 10 | 20 | 30 | 60 | 120;
  autoReplyEnabled?: boolean;
  autoReplySubject?: string;
  autoReplyBody?: string;
  autoReplyStart?: string;
  autoReplyEnd?: string;
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

export interface ConditionalMailRule {
  id: string;
  field: "from" | "subject" | "category" | "priority";
  value: string;
  accent: string;
}

export interface QuickStepItem {
  id: string;
  name: string;
  shortcut?: string;
  actions: Array<{
    kind: "archive" | "delete" | "read" | "flag" | "pin" | "category" | "move";
    target?: string;
  }>;
}

export interface ShortcutBindings {
  newMessage: string;
  search: string;
  reply: string;
  replyAll: string;
  forward: string;
  archive: string;
  delete: string;
  toggleRead: string;
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
  fontSize?: "small" | "medium" | "large";
  uiScale?: 0.9 | 1 | 1.1 | 1.2;
  highContrast?: boolean;
  reduceMotion?: boolean;
  closeBehavior?: "tray" | "exit";
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  ignoredConversationKeys?: string[];
  cleanupSenders?: Record<string, number>;
  autoReplyEnabled?: boolean;
  autoReplySubject?: string;
  autoReplyBody?: string;
  autoReplyStart?: string;
  autoReplyEnd?: string;
  autoForwardEnabled?: boolean;
  autoForwardAddress?: string;
  blockRemoteContent?: boolean;
  remoteContentAllowedSenders?: string[];
  warnSuspiciousLinks?: boolean;
  externalSenderWarning?: boolean;
  appLockEnabled?: boolean;
  appLockMinutes?: 0 | 1 | 5 | 15 | 30;
  quickSteps?: QuickStepItem[];
  shortcuts?: ShortcutBindings;
  locale?: "pt-BR" | "en-US" | "es-ES";
  dateFormat?: "short" | "medium" | "long";
  timeFormat?: "12" | "24";
  firstDayOfWeek?: 0 | 1 | 6;
  timezone?: string;
  secondaryTimezones?: string[];
  workDays?: number[];
  workHours?: Record<string,{start:string;end:string}>;
  workplace?: string;
  navOrder?: AppSection[];
  hiddenNavItems?: AppSection[];
  quickActions?: Array<"archive" | "delete" | "flag" | "read" | "pin">;
  conditionalMailRules?: ConditionalMailRule[];
  autoCorrectEnabled?: boolean;
  autoCapitalizeEnabled?: boolean;
  composeLanguage?: string;
  customDictionary?: string[];
  connectionTimeoutSeconds?: 10 | 20 | 30 | 60 | 120;
  localRetentionDays?: 7 | 14 | 30 | 90 | 180 | 365 | 0;
  maxConcurrentSyncs?: 1 | 2 | 3 | 4;
  batterySaverEnabled?: boolean;
  memorySaverEnabled?: boolean;
}


export type WorkspaceKind = "calendar" | "calendar-list" | "contact" | "contact-group" | "task" | "note" | "rule" | "category" | "saved-search" | "signature" | "settings" | "draft" | "template" | "content-block" | "folder-pref" | "profile" | "extension";

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
  calendarId?: string;
  accountId?: string;
  requiredParticipants?: string[];
  optionalParticipants?: string[];
  resources?: string[];
  isPrivate?: boolean;
  recurrence?: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrenceUntil?: string;
  categories?: string[];
  status?: "confirmed" | "draft" | "cancelled";
  timezone?: string;
  onlineMeetingUrl?: string;
  organizer?: string;
  recurrenceExceptions?: string[];
  recurrenceParentId?: string;
  occurrenceOriginalStart?: string;
  attendeeResponse?: "needs-action" | "accepted" | "tentative" | "declined";
  keepInvitationInInbox?: boolean;
  freeBusyStatus?: "busy" | "free" | "tentative";
}

export interface CalendarListItem {
  id: string;
  name: string;
  color: string;
  accountId?: string;
  visible: boolean;
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
  firstName?: string;
  lastName?: string;
  nickname?: string;
  emails?: string[];
  phones?: string[];
  addresses?: string[];
  importantDates?: Array<{ label: string; date: string }>;
  categories?: string[];
  groupIds?: string[];
  photoDataUrl?: string;
}

export interface ContactGroupItem {
  id: string;
  name: string;
  description?: string;
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
  recurrence?: "none" | "daily" | "weekly" | "monthly" | "yearly";
  categories?: string[];
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
  inline?: boolean;
  contentId?: string;
}


export interface MailAttachmentInfo {
  index: number;
  name: string;
  size: number;
  mime: string;
  inline: boolean;
}

export interface MailAttachmentPreview {
  name: string;
  mime: string;
  size: number;
  dataUrl?: string;
  text?: string;
  kind: "image" | "pdf" | "text" | "archive" | "office" | "binary" | "large";
}

export interface ExtensionPermissionItem {
  id: "external.open" | "meeting.create" | "storage.open";
  granted: boolean;
}

export interface ExtensionActionItem {
  id: string;
  label: string;
  urlTemplate: string;
  permission: ExtensionPermissionItem["id"];
}

export interface ExtensionManifestItem {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  permissions: ExtensionPermissionItem[];
  actions?: ExtensionActionItem[];
  meeting?: {
    label?: string;
    urlTemplate: string;
  };
  storage?: {
    label?: string;
    url: string;
  };
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

export interface ProfileItem {
  id: string;
  name: string;
  accountIds: string[];
  settings: Partial<AppSettings>;
  isDefault?: boolean;
}

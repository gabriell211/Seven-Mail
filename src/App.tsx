import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon, type IconName } from "./icons";
import { bridge } from "./lib/bridge";
import { PersistentCalendarView, PersistentNotesView, PersistentPeopleView, PersistentRulesView, PersistentTasksView } from "./components/WorkspaceViews";
import { CloudPanel } from "./components/CloudPanel";
import { AccountsPanel } from "./components/AccountsPanel";
import { SignaturesPanel } from "./components/SignaturesPanel";
import { MessageDetailsModal, SenderPoliciesPanel } from "./components/AdvancedMailPanels";
import { ComposerAssetsPanel } from "./components/ComposerAssetsPanel";
import { ProfilesPanel } from "./components/ProfilesPanel";
import { ExtensionsPanel } from "./components/ExtensionsPanel";
import { SafeMessageBody } from "./components/SafeMessageBody";
import { ReadingAssist } from "./components/ReadingAssist";
import { BrandLogo } from "./components/BrandLogo";
import { LaunchScreen } from "./components/LaunchScreen";
import { AppLockScreen } from "./components/AppLockScreen";
import { Composer, type ComposeDraft, type QueuedSendInfo } from "./components/Composer";
import { ensureNotificationPermission, notifyCalendarReminder, notifyNewMessages, notifyTaskReminder } from "./lib/notifications";
import { pullCloudAccounts, pullCloudMessages, pushCloudAccount, pushCloudAccounts, pushCloudDocument, pushCloudMessage, pushCloudMessages } from "./lib/neon";
import { syncWorkspaceCollection } from "./lib/workspace-sync";
import { matchesMailQuery, matchesQuickFilter, type MailQuickFilter } from "./lib/mail-search";
import { pendingRulesForMessage } from "./lib/rules";
import { takePendingOAuth } from "./lib/oauth-client";
import { contactsFromVcard, eventsFromIcs, messageToEml, safeExportName } from "./lib/interchange";
import type { AccountProfile, AppSection, AppSettings, CalendarEvent, CalendarListItem, CategoryItem, ContactItem, MailFolder, MailMessage, ProfileItem, ProviderSettings, RuleItem, RuntimeInfo, SavedSearchItem, SignatureItem, TaskItem, WorkspaceDocument, WorkspaceKind } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  readingPane: "right",
  compact: false,
  previewLines: 2,
  markReadDelayMs: 1200,
  confirmBeforeDelete: true,
  confirmBeforeSend: false,
  startWithSystem: false,
  minimizeToTray: true,
  sendDelaySeconds: 10,
  notificationsEnabled: false,
  syncIntervalMinutes: 5,
  focusInboxEnabled: true,
  mailPageSize: 50,
  maxAttachmentMb: 25,
  openNextAfterDelete: true,
  showSenderPhotos: true,
  blockedSenders: [],
  trustedSenders: [],
  blockedDomains: [],
  favoriteFolders: {},
  folderOrder: {},
  fontSize: "medium",
  uiScale: 1,
  highContrast: false,
  reduceMotion: false,
  closeBehavior: "tray",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  ignoredConversationKeys: [],
  cleanupSenders: {},
  autoReplyEnabled: false,
  autoReplySubject: "Resposta automática",
  autoReplyBody: "",
  autoForwardEnabled: false,
  autoForwardAddress: "",
  quickActions: ["archive","flag","read"],
  conditionalMailRules: [],
  autoCorrectEnabled: true,
  autoCapitalizeEnabled: true,
  composeLanguage: "pt-BR",
  customDictionary: [],
  connectionTimeoutSeconds: 30,
  localRetentionDays: 90,
  maxConcurrentSyncs: 2,
  batterySaverEnabled: false,
  memorySaverEnabled: false,
  blockRemoteContent: true,
  remoteContentAllowedSenders: [],
  warnSuspiciousLinks: true,
  externalSenderWarning: true,
  appLockEnabled: false,
  appLockMinutes: 5,
  locale: "pt-BR",
  dateFormat: "short",
  timeFormat: "24",
  firstDayOfWeek: 0,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  secondaryTimezones: [],
  workDays: [1,2,3,4,5],
  workHours: {
    "1":{start:"08:00",end:"18:00"},
    "2":{start:"08:00",end:"18:00"},
    "3":{start:"08:00",end:"18:00"},
    "4":{start:"08:00",end:"18:00"},
    "5":{start:"08:00",end:"18:00"}
  },
  workplace: "",
  navOrder: ["mail","calendar","people","tasks","notes","rules","settings"],
  hiddenNavItems: [],
  quickSteps: [],
  shortcuts: {
    newMessage:"ctrl+n",
    search:"ctrl+k",
    reply:"r",
    replyAll:"shift+r",
    forward:"f",
    archive:"e",
    delete:"delete",
    toggleRead:"u"
  }
};

const NAV: Array<{id:AppSection;label:string;icon:IconName}> = [
  {id:"mail",label:"E-mail",icon:"mail"},
  {id:"calendar",label:"Calendário",icon:"calendar"},
  {id:"people",label:"Pessoas",icon:"people"},
  {id:"tasks",label:"Tarefas",icon:"check"},
  {id:"notes",label:"Notas",icon:"note"},
  {id:"rules",label:"Regras",icon:"rule"},
  {id:"settings",label:"Configurações",icon:"settings"}
];

const FALLBACK_FOLDERS: MailFolder[] = [
  {name:"Caixa de entrada",path:"INBOX",role:"inbox"},
  {name:"Rascunhos",path:"Drafts",role:"drafts"},
  {name:"Enviados",path:"Sent",role:"sent"},
  {name:"Arquivados",path:"Archive",role:"archive"},
  {name:"Spam",path:"Junk",role:"spam"},
  {name:"Lixeira",path:"Trash",role:"trash"}
];

function folderIcon(role: MailFolder["role"]): IconName {
  switch (role) {
    case "inbox": return "inbox";
    case "drafts": return "draft";
    case "sent": return "send";
    case "archive": return "archive";
    case "spam": return "spam";
    case "trash": return "trash";
    case "flagged": return "flag";
    default: return "mail";
  }
}

const COLORS = ["#7868ff","#21a6a1","#ef7350","#cb59d8","#3d83f6"];

function conversationKey(subject: string): string {
  return subject.toLocaleLowerCase("pt-BR").replace(/^(re|enc|fw|fwd):\s*/g,"").replace(/\s+/g," ").trim();
}

function shortcutMatches(event:KeyboardEvent,binding:string|undefined):boolean {
  if(!binding) return false;
  const parts=binding.toLocaleLowerCase("en-US").split("+").map((part)=>part.trim()).filter(Boolean);
  const key=parts.at(-1);
  if(!key) return false;
  const normalizedKey=event.key.toLocaleLowerCase("en-US");
  const keyMatch=key==="delete"?event.key==="Delete":normalizedKey===key;
  return keyMatch
    && event.ctrlKey===parts.includes("ctrl")
    && event.metaKey===parts.includes("meta")
    && event.altKey===parts.includes("alt")
    && event.shiftKey===parts.includes("shift");
}

async function forEachConcurrent<T>(
  items:T[],
  limit:number,
  worker:(item:T)=>Promise<void>,
):Promise<void>{
  const queue=[...items];
  const count=Math.max(1,Math.min(limit||1,queue.length||1));
  await Promise.all(Array.from({length:count},async()=>{
    while(queue.length){
      const item=queue.shift();
      if(item===undefined) return;
      await worker(item);
    }
  }));
}

function notificationsMutedNow(settings: AppSettings): boolean {
  if(!settings.quietHoursEnabled) return false;
  const start=settings.quietHoursStart??"22:00";
  const end=settings.quietHoursEnd??"07:00";
  const [sh,sm]=start.split(":").map(Number);
  const [eh,em]=end.split(":").map(Number);
  if(!Number.isFinite(sh)||!Number.isFinite(sm)||!Number.isFinite(eh)||!Number.isFinite(em)) return false;
  const now=new Date();
  const minutes=now.getHours()*60+now.getMinutes();
  const startMinutes=sh*60+sm;
  const endMinutes=eh*60+em;
  return startMinutes<=endMinutes
    ? minutes>=startMinutes&&minutes<endMinutes
    : minutes>=startMinutes||minutes<endMinutes;
}

function bytesToBase64(bytes:Uint8Array):string {
  let binary="";
  const chunk=0x8000;
  for(let index=0;index<bytes.length;index+=chunk){
    binary+=String.fromCharCode(...bytes.subarray(index,Math.min(index+chunk,bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value:string):Uint8Array<ArrayBuffer> {
  const binary=atob(value);
  const buffer=new ArrayBuffer(binary.length);
  const bytes=new Uint8Array(buffer);
  for(let index=0;index<binary.length;index+=1) bytes[index]=binary.charCodeAt(index);
  return bytes;
}

function ownedBytes(bytes:Uint8Array):Uint8Array<ArrayBuffer>{
  const buffer=new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Uint8Array(buffer);
}

async function deriveBackupKey(password:string,salt:Uint8Array):Promise<CryptoKey> {
  const material=await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {name:"PBKDF2",salt:ownedBytes(salt),iterations:250_000,hash:"SHA-256"},
    material,
    {name:"AES-GCM",length:256},
    false,
    ["encrypt","decrypt"],
  );
}

async function encryptBackupJson(plain:string,password:string):Promise<string> {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveBackupKey(password,salt);
  const encrypted=await crypto.subtle.encrypt(
    {name:"AES-GCM",iv:ownedBytes(iv)},
    key,
    new TextEncoder().encode(plain),
  );
  return JSON.stringify({
    format:"seven-mail-backup-encrypted",
    version:1,
    algorithm:"AES-256-GCM",
    kdf:"PBKDF2-SHA256",
    iterations:250000,
    salt:bytesToBase64(salt),
    iv:bytesToBase64(iv),
    data:bytesToBase64(new Uint8Array(encrypted)),
  },null,2);
}

async function decryptBackupJson(raw:string,password:string):Promise<string> {
  const envelope=JSON.parse(raw) as {format?:string;salt?:string;iv?:string;data?:string};
  if(envelope.format!=="seven-mail-backup-encrypted"||!envelope.salt||!envelope.iv||!envelope.data){
    throw new Error("Backup criptografado inválido.");
  }
  const key=await deriveBackupKey(password,base64ToBytes(envelope.salt));
  try{
    const decrypted=await crypto.subtle.decrypt(
      {name:"AES-GCM",iv:ownedBytes(base64ToBytes(envelope.iv))},
      key,
      ownedBytes(base64ToBytes(envelope.data)),
    );
    return new TextDecoder().decode(decrypted);
  }catch{
    throw new Error("Senha incorreta ou backup corrompido.");
  }
}

function AddAccountModal({onClose,onAdded}:{onClose:()=>void;onAdded:(account:AccountProfile)=>void}) {
  const [provider,setProvider] = useState<AccountProfile["provider"]>("gmail");
  const [displayName,setDisplayName] = useState("");
  const [email,setEmail] = useState("");
  const [secret,setSecret] = useState("");
  const [incomingProtocol,setIncomingProtocol] = useState<"imap"|"pop3">("imap");
  const [pop3Host,setPop3Host] = useState("");
  const [pop3Port,setPop3Port] = useState(995);
  const [server,setServer] = useState<ProviderSettings>({
    imapHost:"",
    imapPort:993,
    smtpHost:"",
    smtpPort:465,
    securityMode:"tls"
  });
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");

  async function resolveServer(): Promise<ProviderSettings> {
    const discovered = await bridge.discoverProvider(email.trim());
    if (provider !== "imap") return discovered;
    return {
      imapHost: server.imapHost.trim() || discovered.imapHost,
      imapPort: server.imapPort || discovered.imapPort,
      smtpHost: server.smtpHost.trim() || discovered.smtpHost,
      smtpPort: server.smtpPort || discovered.smtpPort,
      securityMode: server.securityMode
    };
  }

  async function connect() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const settings = await resolveServer();
      const account: AccountProfile = {
        id: crypto.randomUUID(),
        displayName: displayName.trim() || email.split("@")[0],
        email: email.trim(),
        username: email.trim(),
        provider,
        incomingProtocol,
        pop3Host: incomingProtocol==="pop3" ? (pop3Host.trim() || `pop.${email.trim().split("@")[1]??""}`) : undefined,
        pop3Port: incomingProtocol==="pop3" ? (pop3Port || 995) : undefined,
        connectionTimeoutSeconds:30,
        color: COLORS[Math.floor(Math.random()*COLORS.length)],
        isDefault: false,
        ...settings
      };
      await bridge.saveAccount(account);
      if (secret.trim()) await bridge.storeSecret(account.id, secret);
      onAdded(account);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal account-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <header className="modal-header">
        <div><span className="eyebrow">NOVA CONTA</span><h2>Conectar e-mail</h2><p>Configuração automática para provedores conhecidos e modo manual para servidores corporativos.</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="x"/></button>
      </header>
      <div className="provider-grid">
        {(["gmail","microsoft","yahoo","icloud","imap"] as const).map(item =>
          <button className={provider===item?"provider active":"provider"} key={item} onClick={()=>setProvider(item)}>
            <span className="provider-glyph">{item==="imap"?"@":item[0].toUpperCase()}</span>
            <b>{item==="imap"?"Outro":item[0].toUpperCase()+item.slice(1)}</b>
          </button>
        )}
      </div>
      <div className="form-grid">
        <label><span>Nome</span><input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Seu nome"/></label>
        <label><span>E-mail</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@dominio.com"/></label>
        <label className="full"><span>Senha / senha de aplicativo</span><input type="password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Armazenada no Windows Credential Manager / Keyring"/></label>
      </div>
      {provider==="imap"&&<div className="server-grid">
        <label className="full"><span>Protocolo de entrada</span><select value={incomingProtocol} onChange={e=>setIncomingProtocol(e.target.value as "imap"|"pop3")}><option value="imap">IMAP</option><option value="pop3">POP3 (TLS)</option></select></label>
        {incomingProtocol==="imap"?<>
          <label><span>IMAP</span><input value={server.imapHost} onChange={e=>setServer(v=>({...v,imapHost:e.target.value}))} placeholder="imap.dominio.com"/></label>
          <label><span>Porta IMAP</span><input type="number" value={server.imapPort} onChange={e=>setServer(v=>({...v,imapPort:Number(e.target.value)}))}/></label>
        </>:<>
          <label><span>POP3</span><input value={pop3Host} onChange={e=>setPop3Host(e.target.value)} placeholder="pop.dominio.com"/></label>
          <label><span>Porta POP</span><input type="number" value={pop3Port} onChange={e=>setPop3Port(Number(e.target.value))}/></label>
        </>}
        <label><span>SMTP</span><input value={server.smtpHost} onChange={e=>setServer(v=>({...v,smtpHost:e.target.value}))} placeholder="smtp.dominio.com"/></label>
        <label><span>Porta SMTP</span><input type="number" value={server.smtpPort} onChange={e=>setServer(v=>({...v,smtpPort:Number(e.target.value)}))}/></label>
        <label className="full"><span>Segurança SMTP</span><select value={server.securityMode} onChange={e=>setServer(v=>({...v,securityMode:e.target.value as "tls"|"starttls"}))}><option value="tls">TLS direto</option><option value="starttls">STARTTLS</option></select></label>
      </div>}
      <div className="secure-note"><Icon name="lock" size={16}/><span>A credencial nunca é gravada no cache. A fila offline contém somente a operação e o conteúdo necessário para reenvio.</span></div>
      {error&&<div className="form-error">{error}</div>}
      <footer className="modal-footer"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!email.trim()||busy} onClick={connect}>{busy?"Conectando...":"Conectar"}</button></footer>
    </section>
  </div>;
}

function ComposeModal({account,onClose}:{account?:AccountProfile;onClose:()=>void}) {
  const [to,setTo] = useState("");
  const [subject,setSubject] = useState("");
  const [body,setBody] = useState("");

  async function send() {
    if (!account || !to.trim()) return;
    await bridge.queueOperation({
      id: crypto.randomUUID(),
      kind: "send",
      accountId: account.id,
      createdAt: new Date().toISOString(),
      attempts: 0,
      payload: {to,subject,body}
    });
    onClose();
    void bridge.flushOutbox().catch(() => undefined);
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal compose-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <header className="modal-header compact-header">
        <div><span className="eyebrow">NOVA MENSAGEM</span><h2>Escrever e-mail</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="x"/></button>
      </header>
      <div className="compose-fields">
        <label><span>De</span><div>{account ? account.email : "Adicione uma conta"}</div></label>
        <label><span>Para</span><input value={to} onChange={e=>setTo(e.target.value)} placeholder="destinatario@dominio.com"/></label>
        <label><span>Assunto</span><input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Assunto"/></label>
      </div>
      <div className="format-bar">{["B","I","U","S","• Lista","1. Lista","Link","Tabela"].map(item=><button key={item}>{item}</button>)}</div>
      <textarea className="editor" value={body} onChange={e=>setBody(e.target.value)} placeholder="Escreva sua mensagem..." />
      <footer className="compose-footer">
        <div><button className="icon-button"><Icon name="paperclip"/></button><button className="ghost">Assinatura</button><button className="ghost"><Icon name="clock" size={15}/> Programar</button></div>
        <div><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!account||!to.trim()} onClick={send}><Icon name="send" size={15}/> Enviar</button></div>
      </footer>
    </section>
  </div>;
}

function EmptyInbox({onAdd}:{onAdd:()=>void}) {
  return <div className="empty-state">
    <div className="empty-symbol"><Icon name="mail" size={34}/></div>
    <span className="eyebrow">COMECE POR AQUI</span>
    <h2>Sua caixa, do seu jeito.</h2>
    <p>Adicione uma conta para sincronizar mensagens e pastas. A fila offline fica segura no diretório nativo do Seven Mail.</p>
    <button className="primary" onClick={onAdd}><Icon name="plus" size={16}/> Adicionar primeira conta</button>
    <div className="trust"><span><Icon name="shield" size={14}/> Keyring</span><span><Icon name="cloud" size={14}/> Neon</span></div>
  </div>;
}

function MailView({accounts,messages,activeAccount,folders,folder,localDrafts,categories,savedSearches,onOpenDraft,onComposeFromMessage,onForwardAsAttachment,onResendMessage,onCreateTaskFromMessage,onCreateEventFromMessage,onImportEml,onExportEml,onCreateCategory,onEditCategory,onDeleteCategory,onToggleCategory,onToggleCategoryFavorite,onUseSavedSearch,onDeleteSavedSearch,onCreateFolder,onCreateSubfolder,onRenameFolder,onDeleteFolder,onMoveToFolder,onCopyToFolder,onToggleFolderFavorite,onReorderFolder,onUpdateMetadata,onIgnoreConversation,onSetSenderCleanup,onAllowRemoteContent,onBlockSender,onTrustSender,onReleaseSender,focusMessageId,onFolderChange,onCompose,onAdd,onRefresh,onMessageAction,syncing,settings}:{accounts:AccountProfile[];messages:MailMessage[];activeAccount?:AccountProfile;folders:MailFolder[];folder:MailFolder;localDrafts:ComposeDraft[];categories:CategoryItem[];savedSearches:SavedSearchItem[];onOpenDraft:(draft:ComposeDraft)=>void;onComposeFromMessage:(message:MailMessage,mode:"reply"|"replyAll"|"forward")=>void;onForwardAsAttachment:(message:MailMessage)=>void;onResendMessage:(message:MailMessage)=>void;onCreateTaskFromMessage:(message:MailMessage)=>void;onCreateEventFromMessage:(message:MailMessage)=>void;onImportEml?:()=>void;onExportEml:(message:MailMessage)=>void;onCreateCategory:()=>void;onEditCategory:(category:CategoryItem)=>void;onDeleteCategory:(category:CategoryItem)=>void;onToggleCategory:(message:MailMessage,category:CategoryItem)=>void;onToggleCategoryFavorite:(category:CategoryItem)=>void;onUseSavedSearch:(item:SavedSearchItem)=>void;onDeleteSavedSearch:(item:SavedSearchItem)=>void;onCreateFolder?:()=>void;onCreateSubfolder?:(folder:MailFolder)=>void;onRenameFolder?:(folder:MailFolder)=>void;onDeleteFolder?:(folder:MailFolder)=>void;onMoveToFolder?:(message:MailMessage,folder:MailFolder)=>void;onCopyToFolder?:(message:MailMessage,folder:MailFolder)=>void;onToggleFolderFavorite?:(folder:MailFolder)=>void;onReorderFolder?:(folder:MailFolder,direction:-1|1)=>void;onUpdateMetadata:(message:MailMessage,metadata:{importance?:"low"|"normal"|"high";snoozedUntil?:string;isMuted?:boolean;isPhishing?:boolean;isImportant?:boolean})=>void;onIgnoreConversation:(message:MailMessage)=>void;onSetSenderCleanup:(message:MailMessage)=>void;onAllowRemoteContent:(sender:string)=>void;onBlockSender:(email:string)=>void;onTrustSender:(email:string)=>void;onReleaseSender:(email:string)=>void;focusMessageId?:string;onFolderChange:(folder:MailFolder)=>void;onCompose:()=>void;onAdd:()=>void;onRefresh:()=>void;onMessageAction:(messageId:string,action:"read"|"unread"|"flag"|"unflag"|"pin"|"unpin"|"archive"|"delete"|"spam"|"inbox")=>Promise<void>;syncing:boolean;settings:AppSettings}) {
  const [selectedId,setSelectedId] = useState<string>();
  const [quickFilter,setQuickFilter] = useState<MailQuickFilter>("all");
  const [sort,setSort] = useState<"newest"|"oldest"|"sender"|"subject"|"unread"|"size"|"status">("newest");
  const [focusTab,setFocusTab] = useState<"focused"|"other">("focused");
  const [conversationView,setConversationView] = useState(true);
  const [periodFilter,setPeriodFilter] = useState<"all"|"today"|"7d"|"30d">("all");
  const [senderFilter,setSenderFilter] = useState("");
  const [priorityFilter,setPriorityFilter] = useState<"all"|"low"|"normal"|"high">("all");
  const [visibleCount,setVisibleCount] = useState<number>(settings.mailPageSize ?? 50);
  const [details,setDetails] = useState<{message:MailMessage;tab:"attachments"|"headers"|"source"}|null>(null);
  const [collapsedGroups,setCollapsedGroups] = useState<string[]>([]);
  const swipeStartRef=useRef<{id:string;x:number;y:number}|null>(null);
  const selected = messages.find(m=>m.id===selectedId);
  const now = Date.now();
  const baseFolderMessages = messages.filter(message=>{
    if (message.folder!==folder.name || !matchesQuickFilter(message,quickFilter)) return false;
    if(senderFilter&&message.from.email.toLocaleLowerCase("pt-BR")!==senderFilter) return false;
    if(priorityFilter!=="all"&&(message.importance??"normal")!==priorityFilter) return false;
    if(periodFilter!=="all"){
      const age=now-new Date(message.receivedAt).getTime();
      const max=periodFilter==="today"?24*60*60*1000:periodFilter==="7d"?7*24*60*60*1000:30*24*60*60*1000;
      if(!Number.isFinite(age)||age<0||age>max) return false;
    }
    if (message.snoozedUntil) {
      const until = new Date(message.snoozedUntil).getTime();
      if (Number.isFinite(until) && until > now) return false;
    }
    if (folder.role==="inbox" && settings.focusInboxEnabled) {
      const trusted=(settings.trustedSenders??[]).includes(message.from.email.toLocaleLowerCase("pt-BR"));
      const focused=Boolean(message.isImportant||message.isFlagged||message.isPinned||trusted);
      if (focusTab==="focused"&&!focused) return false;
      if (focusTab==="other"&&focused) return false;
    }
    return true;
  });
  const sortedFolderMessages = [...baseFolderMessages]
    .sort((a,b)=>{
      const pinned = Number(b.isPinned)-Number(a.isPinned);
      if (pinned!==0) return pinned;
      if (sort==="oldest") return a.receivedAt.localeCompare(b.receivedAt);
      if (sort==="sender") return (a.from.name||a.from.email).localeCompare(b.from.name||b.from.email);
      if (sort==="subject") return a.subject.localeCompare(b.subject);
      if (sort==="unread") return Number(a.isRead)-Number(b.isRead)||b.receivedAt.localeCompare(a.receivedAt);
      if (sort==="size") return (b.sizeBytes??0)-(a.sizeBytes??0);
      if (sort==="status") return Number(a.isRead)-Number(b.isRead)||Number(b.isFlagged)-Number(a.isFlagged)||b.receivedAt.localeCompare(a.receivedAt);
      return b.receivedAt.localeCompare(a.receivedAt);
    });

  const conversationKey=(message:MailMessage)=>message.subject.toLocaleLowerCase("pt-BR").replace(/^(re|enc|fw|fwd):\s*/g,"").trim()||message.id;
  const conversationCounts=new Map<string,number>();
  for(const message of sortedFolderMessages){
    const key=conversationKey(message);
    conversationCounts.set(key,(conversationCounts.get(key)??0)+1);
  }
  const displayMessages=conversationView
    ? sortedFolderMessages.filter((message,index,array)=>array.findIndex((item)=>conversationKey(item)===conversationKey(message))===index)
    : sortedFolderMessages;
  const folderMessages=displayMessages.slice(0,visibleCount);
  const selectedThread=selected&&conversationView
    ? messages.filter((message)=>conversationKey(message)===conversationKey(selected)).sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt))
    : selected?[selected]:[];

  useEffect(()=>{
    if (focusMessageId && messages.some((message)=>message.id===focusMessageId)) {
      setSelectedId(focusMessageId);
    }
  },[focusMessageId,messages]);

  useEffect(()=>{
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;

      const current = selectedId ? messages.find((message)=>message.id===selectedId) : undefined;
      const index = folderMessages.findIndex((message)=>message.id===selectedId);

      if (event.key==="ArrowDown" && folderMessages.length) {
        event.preventDefault();
        setSelectedId(folderMessages[Math.min(folderMessages.length-1,Math.max(0,index+1))].id);
        return;
      }
      if (event.key==="ArrowUp" && folderMessages.length) {
        event.preventDefault();
        setSelectedId(folderMessages[Math.max(0,index<=0?0:index-1)].id);
        return;
      }
      if (!current) return;

      const quickStep=(settings.quickSteps??[]).find((step)=>shortcutMatches(event,step.shortcut));
      if(quickStep){
        event.preventDefault();
        void runQuickStep(current,quickStep);
        return;
      }

      const bindings=settings.shortcuts??DEFAULT_SETTINGS.shortcuts!;
      if(shortcutMatches(event,bindings.replyAll)){
        event.preventDefault();
        onComposeFromMessage(current,"replyAll");
      }else if(shortcutMatches(event,bindings.reply)){
        event.preventDefault();
        onComposeFromMessage(current,"reply");
      }else if(shortcutMatches(event,bindings.forward)){
        event.preventDefault();
        onComposeFromMessage(current,"forward");
      }else if(shortcutMatches(event,bindings.archive)){
        event.preventDefault();
        void act(current.id,"archive");
      }else if(shortcutMatches(event,bindings.toggleRead)){
        event.preventDefault();
        void act(current.id,current.isRead?"unread":"read");
      }else if(shortcutMatches(event,bindings.delete)){
        event.preventDefault();
        void act(current.id,"delete");
      }
    };
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[selectedId,folderMessages,messages,settings.shortcuts,settings.quickSteps]);

  useEffect(()=>{
    setVisibleCount(settings.mailPageSize ?? 50);
  },[folder.path,quickFilter,sort,focusTab,conversationView,settings.mailPageSize]);

  const folderPrefKey=activeAccount?.id??"__all__";
  const preferredOrder=settings.folderOrder?.[folderPrefKey]??[];
  const baseVisibleFolders=folders.length?folders:FALLBACK_FOLDERS;
  const visibleFolders=[...baseVisibleFolders].sort((a,b)=>{
    const ai=preferredOrder.indexOf(a.path);
    const bi=preferredOrder.indexOf(b.path);
    if(ai===-1&&bi===-1) return 0;
    if(ai===-1) return 1;
    if(bi===-1) return -1;
    return ai-bi;
  });
  const favoriteFolderPaths=settings.favoriteFolders?.[folderPrefKey]??[];
  const favoriteFolders=visibleFolders.filter((item)=>favoriteFolderPaths.includes(item.path));
  const favoriteCategories=categories.filter((item)=>item.favorite);
  const senderOptions=[...new Map(messages.map((message)=>[message.from.email.toLocaleLowerCase("pt-BR"),message.from])).values()]
    .sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email));
  const messageGroups=useMemo(()=>{
    const today=new Date();
    const todayStart=new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
    const yesterdayStart=todayStart-86_400_000;
    const weekStart=todayStart-6*86_400_000;
    const groups=new Map<string,MailMessage[]>();
    for(const message of folderMessages){
      const time=new Date(message.receivedAt).getTime();
      const label=time>=todayStart?"Hoje":time>=yesterdayStart?"Ontem":time>=weekStart?"Esta semana":"Mais antigas";
      groups.set(label,[...(groups.get(label)??[]),message]);
    }
    return ["Hoje","Ontem","Esta semana","Mais antigas"]
      .map((label)=>({label,messages:groups.get(label)??[]}))
      .filter((group)=>group.messages.length>0);
  },[folderMessages]);

  function conditionalAccent(message:MailMessage):string|undefined {
    for(const rule of settings.conditionalMailRules??[]){
      const value=rule.value.toLocaleLowerCase("pt-BR");
      const match=rule.field==="from"
        ? `${message.from.name??""} ${message.from.email}`.toLocaleLowerCase("pt-BR").includes(value)
        : rule.field==="subject"
          ? message.subject.toLocaleLowerCase("pt-BR").includes(value)
          : rule.field==="category"
            ? message.categories.some((item)=>item.toLocaleLowerCase("pt-BR").includes(value))
            : (message.importance??"normal")===rule.value;
      if(match) return rule.accent;
    }
    return undefined;
  }

  function runQuickAction(event:MouseEvent,message:MailMessage,action:NonNullable<AppSettings["quickActions"]>[number]){
    event.preventDefault();
    event.stopPropagation();
    if(action==="flag") void act(message.id,message.isFlagged?"unflag":"flag");
    else if(action==="read") void act(message.id,message.isRead?"unread":"read");
    else if(action==="pin") void act(message.id,message.isPinned?"unpin":"pin");
    else void act(message.id,action);
  }

  function quickActionIcon(action:NonNullable<AppSettings["quickActions"]>[number]):IconName {
    if(action==="delete") return "trash";
    if(action==="flag") return "flag";
    if(action==="read") return "mail";
    if(action==="pin") return "pin";
    return "archive";
  }

  async function runQuickStep(message:MailMessage,step:NonNullable<AppSettings["quickSteps"]>[number]){
    let current=messages.find((item)=>item.id===message.id)??message;
    for(const action of step.actions){
      if(action.kind==="archive"||action.kind==="delete"||action.kind==="read"||action.kind==="flag"||action.kind==="pin"){
        const mapped=action.kind==="read"
          ? (current.isRead?"unread":"read")
          : action.kind==="flag"
            ? (current.isFlagged?"unflag":"flag")
            : action.kind==="pin"
              ? (current.isPinned?"unpin":"pin")
              : action.kind;
        await onMessageAction(current.id,mapped);
        current={...current,
          isRead:mapped==="read"?true:mapped==="unread"?false:current.isRead,
          isFlagged:mapped==="flag"?true:mapped==="unflag"?false:current.isFlagged,
          isPinned:mapped==="pin"?true:mapped==="unpin"?false:current.isPinned,
        };
      }else if(action.kind==="category"&&action.target){
        const category=categories.find((item)=>item.name===action.target||item.id===action.target);
        if(category&&!current.categories.includes(category.name)){
          onToggleCategory(current,category);
          current={...current,categories:[...current.categories,category.name]};
        }
      }else if(action.kind==="move"&&action.target&&onMoveToFolder){
        const target=folders.find((item)=>item.path===action.target||item.name===action.target);
        if(target) onMoveToFolder(current,target);
      }
    }
  }

  async function act(messageId:string, action:"read"|"unread"|"flag"|"unflag"|"pin"|"unpin"|"archive"|"delete"|"spam"|"inbox") {
    const currentIndex=folderMessages.findIndex((message)=>message.id===messageId);
    await onMessageAction(messageId, action);
    if (["archive","delete","spam","inbox"].includes(action)) {
      if(settings.openNextAfterDelete && currentIndex>=0){
        const next=folderMessages[currentIndex+1]??folderMessages[currentIndex-1];
        setSelectedId(next?.id);
      }else{
        setSelectedId(undefined);
      }
    }
  }

  function snooze(message:MailMessage){
    const defaultValue=new Date(Date.now()+24*60*60*1000).toISOString().slice(0,16);
    const value=window.prompt("Adiar até (AAAA-MM-DDTHH:MM)",defaultValue)?.trim();
    if(!value) return;
    const date=new Date(value);
    if(!Number.isFinite(date.getTime())) return;
    onUpdateMetadata(message,{snoozedUntil:date.toISOString()});
    setSelectedId(undefined);
  }

  function openMessageWindow(message:MailMessage){
    const label=`message-${message.id.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,70)}-${Date.now()}`;
    const view=new WebviewWindow(label,{
      url:`/?message=${encodeURIComponent(message.id)}&account=${encodeURIComponent(message.accountId)}`,
      title:message.subject||"Seven Mail",
      width:1000,
      height:760,
      center:true,
      resizable:true,
    });
    view.once("tauri://error",(error)=>console.error(error));
  }

  function isBlocked(message:MailMessage){
    const email=message.from.email.toLocaleLowerCase("pt-BR");
    const domain=email.split("@")[1]??"";
    return (settings.blockedSenders??[]).includes(email)||(settings.blockedDomains??[]).includes(domain);
  }

  function isTrusted(message:MailMessage){
    return (settings.trustedSenders??[]).includes(message.from.email.toLocaleLowerCase("pt-BR"));
  }

  return <><div className={`mail-layout reading-${settings.readingPane} preview-${settings.previewLines}`}>
    <aside className="folder-pane">
      <button className="compose-button" onClick={onCompose}><Icon name="plus" size={17}/> Novo e-mail</button>
      <div className="account-line"><i style={{background:activeAccount?.color||"#7868ff"}}/><span>{activeAccount?.email||(accounts.length?"Todas as contas":"Nenhuma conta")}</span></div>
      <div className="group-title folder-group-title"><span>PASTAS</span>{activeAccount&&onCreateFolder&&<button className="group-add" aria-label="Nova pasta" onClick={onCreateFolder}><Icon name="plus" size={13}/></button>}</div>
      <nav className="folders">
        {visibleFolders.map(item=>{
          const unread = messages.filter(message=>message.folder===item.name&&!message.isRead).length;
          const button=<button
            className={folder.path===item.path?"folder active":"folder"}
            onClick={()=>onFolderChange(item)}
            onDragOver={(event)=>{if(onMoveToFolder)event.preventDefault();}}
            onDrop={(event)=>{
              if(!onMoveToFolder)return;
              event.preventDefault();
              const messageId=event.dataTransfer.getData("application/x-seven-mail-message");
              const dragged=messages.find((message)=>message.id===messageId);
              if(dragged&&dragged.remoteFolder!==item.path) onMoveToFolder(dragged,item);
            }}
          >
            <Icon name={folderIcon(item.role)} size={17}/><span>{item.name}</span>{unread>0&&<b>{unread}</b>}
          </button>;
          if(item.role!=="custom"||!activeAccount) return <div className="organizer-row folder-organizer" key={item.path}>{button}<div className="folder-actions"><button className={favoriteFolderPaths.includes(item.path)?"organizer-delete active":"organizer-delete"} aria-label={`Favoritar ${item.name}`} onClick={()=>onToggleFolderFavorite?.(item)}><Icon name="star" size={12}/></button></div></div>;
          return <div className="organizer-row folder-organizer" key={item.path}>{button}<div className="folder-actions"><button className={favoriteFolderPaths.includes(item.path)?"organizer-delete active":"organizer-delete"} aria-label={`Favoritar ${item.name}`} onClick={()=>onToggleFolderFavorite?.(item)}><Icon name="star" size={12}/></button><button className="organizer-delete" title="Nova subpasta" aria-label={`Nova subpasta em ${item.name}`} onClick={()=>onCreateSubfolder?.(item)}><Icon name="plus" size={12}/></button><button className="organizer-delete" title="Mover acima" onClick={()=>onReorderFolder?.(item,-1)}>↑</button><button className="organizer-delete" title="Mover abaixo" onClick={()=>onReorderFolder?.(item,1)}>↓</button><button className="organizer-delete folder-edit" aria-label={`Renomear ${item.name}`} onClick={()=>onRenameFolder?.(item)}><Icon name="settings" size={12}/></button><button className="organizer-delete" aria-label={`Excluir ${item.name}`} onClick={()=>onDeleteFolder?.(item)}><Icon name="x" size={12}/></button></div></div>;
        })}
      </nav>
      <div className="group-title"><span>FAVORITOS</span></div>
      <button className="folder" onClick={()=>setQuickFilter("flagged")}><Icon name="star" size={17}/><span>Importantes</span></button>
      {favoriteFolders.map((item)=><button className={folder.path===item.path?"folder active":"folder"} key={`fav-${item.path}`} onClick={()=>onFolderChange(item)}><Icon name={folderIcon(item.role)} size={16}/><span>{item.name}</span></button>)}
      {favoriteCategories.map((category)=><button className="folder" key={`catfav-${category.id}`} onClick={()=>onUseSavedSearch({id:category.id,name:category.name,query:`category:"${category.name}"`})}><i className="category-dot" style={{background:category.color}}/><span>{category.name}</span></button>)}
      {savedSearches.length>0&&<>
        <div className="group-title"><span>PASTAS DE PESQUISA</span></div>
        <div className="organizer-list">{savedSearches.map(item=><div className="organizer-row" key={item.id}><button className="folder" onClick={()=>onUseSavedSearch(item)}><Icon name="search" size={15}/><span>{item.name}</span></button><button className="organizer-delete" aria-label={`Excluir pesquisa ${item.name}`} onClick={()=>onDeleteSavedSearch(item)}><Icon name="x" size={12}/></button></div>)}</div>
      </>}
      <div className="group-title"><span>CATEGORIAS</span><button className="group-add" aria-label="Nova categoria" onClick={onCreateCategory}><Icon name="plus" size={13}/></button></div>
      <div className="organizer-list">{categories.map(category=><div className="organizer-row category-organizer-row" key={category.id}><button className="folder" onClick={()=>onUseSavedSearch({id:category.id,name:category.name,query:`category:"${category.name}"`})}><i className="category-dot" style={{background:category.color}}/><span>{category.name}</span></button><div className="folder-actions"><button className={category.favorite?"organizer-delete active":"organizer-delete"} aria-label={`Favoritar categoria ${category.name}`} onClick={()=>onToggleCategoryFavorite(category)}><Icon name="star" size={12}/></button><button className="organizer-delete folder-edit" aria-label={`Editar categoria ${category.name}`} onClick={()=>onEditCategory(category)}><Icon name="settings" size={12}/></button><button className="organizer-delete" aria-label={`Excluir categoria ${category.name}`} onClick={()=>onDeleteCategory(category)}><Icon name="x" size={12}/></button></div></div>)}</div>
      <div className="local-card"><div><Icon name="cloud" size={18}/></div><span><b>Local-first</b><small>Fila offline protegida</small></span></div>
    </aside>

    <section className="message-pane">
      <header className="pane-header">
        <div><span className="eyebrow">{folder.name.toUpperCase()}</span><h2>{folder.name}</h2></div>
        <div className="pane-tools">{onImportEml&&activeAccount&&<button className="icon-button" title="Importar EML" aria-label="Importar EML" onClick={onImportEml}><Icon name="upload" size={16}/></button>}<button className={conversationView?"icon-button active":"icon-button"} title="Visualização por conversa" aria-label="Alternar visualização por conversa" onClick={()=>setConversationView(value=>!value)}><Icon name="people" size={16}/></button><select className="mail-sort" value={sort} onChange={e=>setSort(e.target.value as typeof sort)} aria-label="Ordenar mensagens"><option value="newest">Mais recentes</option><option value="oldest">Mais antigas</option><option value="sender">Remetente</option><option value="subject">Assunto</option><option value="size">Tamanho</option><option value="status">Status</option><option value="unread">Não lidas primeiro</option></select><div className="icon-group"><button className={syncing?"icon-button spinning":"icon-button"} onClick={onRefresh} disabled={accounts.length===0||syncing} aria-label="Sincronizar caixa"><Icon name="refresh"/></button><button className="icon-button"><Icon name="more"/></button></div></div>
      </header>
      {folder.role==="inbox"&&settings.focusInboxEnabled&&<div className="segmented focus-tabs"><button className={focusTab==="focused"?"active":""} onClick={()=>setFocusTab("focused")}>Prioritária</button><button className={focusTab==="other"?"active":""} onClick={()=>setFocusTab("other")}>Outros</button></div>}
      <div className="segmented mail-filters">
        <button className={quickFilter==="all"?"active":""} onClick={()=>setQuickFilter("all")}>Todas</button>
        <button className={quickFilter==="unread"?"active":""} onClick={()=>setQuickFilter("unread")}>Não lidas</button>
        <button className={quickFilter==="flagged"?"active":""} onClick={()=>setQuickFilter("flagged")}>Sinalizadas</button>
        <button className={quickFilter==="pinned"?"active":""} onClick={()=>setQuickFilter("pinned")}>Fixadas</button>
        <button className={quickFilter==="attachments"?"active":""} onClick={()=>setQuickFilter("attachments")}>Anexos</button>
      </div>
      <div className="mail-advanced-filters">
        <select value={periodFilter} onChange={(event)=>setPeriodFilter(event.target.value as typeof periodFilter)} aria-label="Filtrar por período"><option value="all">Qualquer período</option><option value="today">Últimas 24h</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option></select>
        <select value={senderFilter} onChange={(event)=>setSenderFilter(event.target.value)} aria-label="Filtrar por remetente"><option value="">Qualquer remetente</option>{senderOptions.map((sender)=><option key={sender.email} value={sender.email.toLocaleLowerCase("pt-BR")}>{sender.name||sender.email}</option>)}</select>
        <select value={priorityFilter} onChange={(event)=>setPriorityFilter(event.target.value as typeof priorityFilter)} aria-label="Filtrar por prioridade"><option value="all">Qualquer prioridade</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baixa</option></select>
        {(periodFilter!=="all"||senderFilter||priorityFilter!=="all")&&<button className="ghost" onClick={()=>{setPeriodFilter("all");setSenderFilter("");setPriorityFilter("all");}}>Limpar</button>}
      </div>
      {accounts.length===0 ? <EmptyInbox onAdd={onAdd}/> : folderMessages.length===0 && (folder.role!=="drafts" || localDrafts.length===0) ? <div className="empty-state small"><div className="empty-symbol"><Icon name={folder.role==="drafts"?"draft":"inbox"} size={30}/></div><h3>{folder.role==="drafts"?"Nenhum rascunho":"Tudo limpo"}</h3><p>{folder.role==="drafts"?"Mensagens em edição aparecerão aqui automaticamente.":"As mensagens sincronizadas aparecerão aqui."}</p></div> :
        <div className="message-list">
          {folder.role==="drafts"&&localDrafts.map(draft=><button key={draft.id} className="message local-draft-message" onClick={()=>onOpenDraft(draft)}>
            <span className="avatar draft-avatar"><Icon name="draft" size={15}/></span>
            <span className="message-copy"><span className="message-meta"><b>Rascunho local</b><time>autosave</time></span><strong>{draft.subject||"(sem assunto)"}</strong><small>{draft.to?`Para: ${draft.to}`:(draft.bodyText||"Comece a escrever...")}</small></span>
            {draft.attachments.length>0&&<span className="draft-attachment-count"><Icon name="paperclip" size={13}/>{draft.attachments.length}</span>}
          </button>)}
          {messageGroups.map((group)=><section className="message-date-group" key={group.label}>
            <button className="message-group-header" onClick={()=>setCollapsedGroups((current)=>current.includes(group.label)?current.filter((item)=>item!==group.label):[...current,group.label])}><Icon name="chevron" size={12}/><b>{group.label}</b><span>{group.messages.length}</span></button>
            {!collapsedGroups.includes(group.label)&&group.messages.map(message=>{const accent=conditionalAccent(message);return <button key={message.id} draggable={Boolean(onMoveToFolder)} onDragStart={(event)=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/x-seven-mail-message",message.id);}} onPointerDown={(event)=>{if(event.pointerType!=="mouse"||event.button===0)swipeStartRef.current={id:message.id,x:event.clientX,y:event.clientY};}} onPointerCancel={()=>{swipeStartRef.current=null;}} onPointerUp={(event)=>{const start=swipeStartRef.current;swipeStartRef.current=null;if(!start||start.id!==message.id)return;const dx=event.clientX-start.x;const dy=event.clientY-start.y;if(Math.abs(dx)<72||Math.abs(dx)<Math.abs(dy)*1.35)return;event.preventDefault();event.stopPropagation();void act(message.id,dx>0?"archive":"delete");}} style={accent?{borderLeftColor:accent}:undefined} className={"message swipeable "+(accent?"conditional ":"")+(selectedId===message.id?"selected ":"")+(!message.isRead?"unread ":"")+(message.isPhishing?"phishing ":"")+(message.isImportant?"important ":"")+(isBlocked(message)?"blocked ":"")} onClick={()=>{setSelectedId(message.id);if(!message.isRead){window.setTimeout(()=>void act(message.id,"read"),settings.markReadDelayMs);}}}>
              {settings.showSenderPhotos!==false&&<span className="avatar">{(message.from.name||message.from.email)[0].toUpperCase()}</span>}
              <span className="message-copy"><span className="message-meta"><b>{message.from.name||message.from.email}</b><time>{new Date(message.receivedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></span><strong>{message.subject||"(sem assunto)"}{conversationView&&(conversationCounts.get(conversationKey(message))??0)>1&&<em className="conversation-count"> {conversationCounts.get(conversationKey(message))}</em>}</strong><small>{message.preview}</small>{message.categories.length>0&&<span className="message-category-dots">{message.categories.slice(0,4).map(name=>{const category=categories.find(item=>item.name===name);return <i key={name} title={name} style={{background:category?.color||"#888"}}/>;})}</span>}</span>
              <span className="message-indicators">{message.isImportant&&<Icon name="star" size={13}/>} {message.isMuted&&<Icon name="moon" size={13}/>} {message.isPinned&&<Icon name="pin" size={13}/>} {message.hasAttachments&&<Icon name="paperclip" size={14}/>}</span>
              <span className="message-quick-actions">{(settings.quickActions??["archive","flag","read"]).map((action)=><span role="button" tabIndex={0} title={action} key={action} onClick={(event)=>runQuickAction(event,message,action)} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();runQuickAction(event as unknown as MouseEvent,message,action);}}}><Icon name={quickActionIcon(action)} size={12}/></span>)}</span>
            </button>})}
          </section>)}
          {displayMessages.length>folderMessages.length&&<button className="load-more-mail" onClick={()=>setVisibleCount(value=>value+(settings.mailPageSize??50))}>Carregar mais · {displayMessages.length-folderMessages.length} restantes</button>}
        </div>
      }
    </section>

    <section className="reading-pane">
      {selected ? <>
        <header className="reading-header"><div><span className="eyebrow">MENSAGEM</span><h1>{selected.subject}</h1></div><div className="icon-group">
  <button className={selected.isPinned?"icon-button active":"icon-button"} title={selected.isPinned?"Desafixar":"Fixar"} onClick={()=>void act(selected.id,selected.isPinned?"unpin":"pin")}><Icon name="pin"/></button>
  <button className="icon-button" title={selected.isFlagged?"Remover sinalização":"Sinalizar"} onClick={()=>void act(selected.id,selected.isFlagged?"unflag":"flag")}><Icon name="flag"/></button>
  <button className="icon-button" title="Arquivar" onClick={()=>void act(selected.id,"archive")}><Icon name="archive"/></button>
  <button className="icon-button" title="Excluir" onClick={()=>void act(selected.id,"delete")}><Icon name="trash"/></button>
  <button className="icon-button" title={selected.isRead?"Marcar como não lida":"Marcar como lida"} onClick={()=>void act(selected.id,selected.isRead?"unread":"read")}><Icon name="mail"/></button>
  <button className="icon-button" title="Responder" onClick={()=>onComposeFromMessage(selected,"reply")}><Icon name="reply"/></button>
  <button className="icon-button" title="Responder a todos" onClick={()=>onComposeFromMessage(selected,"replyAll")}><Icon name="people"/></button>
  <button className="icon-button" title="Encaminhar" onClick={()=>onComposeFromMessage(selected,"forward")}><Icon name="forward"/></button>
  <button className="icon-button" title="Mais opções"><Icon name="more"/></button>
</div></header>
        <div className="sender">{settings.showSenderPhotos!==false&&<span className="avatar big">{(selected.from.name||selected.from.email)[0].toUpperCase()}</span>}<div><b>{selected.from.name||selected.from.email}</b><small>{selected.from.email}{isTrusted(selected)?" · confiável":isBlocked(selected)?" · bloqueado":""}</small></div><time>{new Date(selected.receivedAt).toLocaleString()}</time></div>
        {categories.length>0&&<div className="message-categories">{categories.map(category=>{const active=selected.categories.includes(category.name);return <button key={category.id} className={active?"category-chip active":"category-chip"} onClick={()=>onToggleCategory(selected,category)}><i style={{background:category.color}}/>{category.name}</button>;})}</div>}
        {activeAccount&&folders.length>1&&<div className="move-folder-row"><span>Organizar</span>{onMoveToFolder&&<select defaultValue="" onChange={e=>{const target=folders.find(item=>item.path===e.target.value);if(target){onMoveToFolder(selected,target);e.currentTarget.value="";}}}><option value="" disabled>Mover para...</option>{folders.filter(item=>item.path!==selected.remoteFolder).map(item=><option key={item.path} value={item.path}>{item.name}</option>)}</select>}{onCopyToFolder&&<select defaultValue="" onChange={e=>{const target=folders.find(item=>item.path===e.target.value);if(target){onCopyToFolder(selected,target);e.currentTarget.value="";}}}><option value="" disabled>Copiar para...</option>{folders.filter(item=>item.path!==selected.remoteFolder).map(item=><option key={item.path} value={item.path}>{item.name}</option>)}</select>}</div>}
        {conversationView&&selectedThread.length>1&&<div className="thread-summary"><b>{selectedThread.length} mensagens nesta conversa</b>{selectedThread.map(item=><button key={item.id} className={item.id===selected.id?"active":""} onClick={()=>setSelectedId(item.id)}><span>{item.from.name||item.from.email}</span><time>{new Date(item.receivedAt).toLocaleString("pt-BR")}</time></button>)}</div>}
        <SafeMessageBody message={selected} accountEmail={accounts.find((item)=>item.id===selected.accountId)?.email} settings={settings} onAllowRemote={onAllowRemoteContent}/>
        <ReadingAssist message={selected}/>
        {(settings.quickSteps??[]).length>0&&<div className="message-quick-steps">{(settings.quickSteps??[]).map((step)=><button className="secondary" key={step.id} onClick={()=>void runQuickStep(selected,step)}><Icon name="rule" size={13}/>{step.name}{step.shortcut&&<kbd>{step.shortcut}</kbd>}</button>)}</div>}
        <div className="reply-actions advanced-actions">
          <button className="secondary" onClick={()=>onComposeFromMessage(selected,"reply")}><Icon name="reply" size={15}/> Responder</button>
          <button className="secondary" onClick={()=>onComposeFromMessage(selected,"replyAll")}><Icon name="people" size={15}/> Responder a todos</button>
          <button className="secondary" onClick={()=>onComposeFromMessage(selected,"forward")}><Icon name="forward" size={15}/> Encaminhar</button>
          <button className="secondary" onClick={()=>onForwardAsAttachment(selected)}><Icon name="paperclip" size={15}/> Como anexo</button>
          <button className="secondary" onClick={()=>onResendMessage(selected)}><Icon name="send" size={15}/> Reenviar</button>
          {folder.role==="trash"&&<button className="secondary" onClick={()=>void act(selected.id,"inbox")}><Icon name="inbox" size={15}/> Restaurar</button>}
          <button className="secondary" onClick={()=>snooze(selected)}><Icon name="clock" size={15}/> Adiar</button>
          <button className={selected.isImportant?"secondary active":"secondary"} onClick={()=>onUpdateMetadata(selected,{isImportant:!selected.isImportant})}><Icon name="star" size={15}/> Importante</button>
          <button className={selected.isMuted?"secondary active":"secondary"} onClick={()=>onUpdateMetadata(selected,{isMuted:!selected.isMuted})}><Icon name="moon" size={15}/> {selected.isMuted?"Liberar conversa":"Silenciar"}</button>
          <button className="secondary danger-lite" onClick={()=>onIgnoreConversation(selected)}><Icon name="trash" size={15}/> Ignorar conversa</button>
          <button className="secondary" onClick={()=>onSetSenderCleanup(selected)}><Icon name="archive" size={15}/> Limpeza automática</button>
          <select className="priority-select" value={selected.importance??"normal"} onChange={e=>onUpdateMetadata(selected,{importance:e.target.value as "low"|"normal"|"high"})}><option value="low">Prioridade baixa</option><option value="normal">Prioridade normal</option><option value="high">Prioridade alta</option></select>
          <button className="secondary" onClick={()=>setDetails({message:selected,tab:"attachments"})}><Icon name="paperclip" size={15}/> Anexos</button>
          <button className="secondary" onClick={()=>setDetails({message:selected,tab:"headers"})}><Icon name="mail" size={15}/> Cabeçalhos</button>
          <button className="secondary" onClick={()=>setDetails({message:selected,tab:"source"})}><Icon name="note" size={15}/> Fonte</button>
          <button className="secondary" onClick={()=>window.print()}><Icon name="note" size={15}/> Imprimir</button>
          <button className="secondary" onClick={()=>openMessageWindow(selected)}><Icon name="plus" size={15}/> Nova janela</button>
          <button className="secondary" onClick={()=>onCreateTaskFromMessage(selected)}><Icon name="check" size={15}/> Criar tarefa</button>
          <button className="secondary" onClick={()=>onCreateEventFromMessage(selected)}><Icon name="calendar" size={15}/> Criar evento</button>
          <button className="secondary" onClick={()=>onExportEml(selected)}><Icon name="download" size={15}/> Salvar EML</button>
          <button className="secondary danger-lite" onClick={()=>{onUpdateMetadata(selected,{isPhishing:true});void act(selected.id,"spam");}}><Icon name="shield" size={15}/> Phishing</button>
          {isBlocked(selected)?<button className="secondary" onClick={()=>onReleaseSender(selected.from.email)}>Liberar remetente</button>:<button className="secondary" onClick={()=>onBlockSender(selected.from.email)}>Bloquear remetente</button>}
          {!isTrusted(selected)&&<button className="secondary" onClick={()=>onTrustSender(selected.from.email)}>Confiar remetente</button>}
        </div>
      </> : <div className="reading-empty"><BrandLogo variant="hero"/><span className="eyebrow">SEVEN MAIL</span><h2>Selecione uma mensagem</h2><p>Leia, responda e organize sem sair da mesma tela.</p></div>}
    </section>
  </div>{details&&<MessageDetailsModal message={details.message} initialTab={details.tab} onClose={()=>setDetails(null)}/>}</>;
}

function CalendarView() {
  const today = new Date();
  const days = Array.from({length:35},(_,i)=>i-2);
  return <Workspace title={today.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})} eyebrow="CALENDÁRIO" action="Novo evento">
    <div className="calendar">
      <div className="week">{["DOM","SEG","TER","QUA","QUI","SEX","SÁB"].map(d=><span key={d}>{d}</span>)}</div>
      <div className="days">{days.map((d,i)=><div className={d===today.getDate()?"day today":"day"} key={i}><span>{d>0&&d<=30?d:""}</span>{d===today.getDate()&&<b>Hoje · Agenda</b>}</div>)}</div>
    </div>
  </Workspace>;
}

function PeopleView() {
  return <Workspace title="Contatos" eyebrow="PESSOAS" action="Novo contato"><div className="feature-grid">
    <Feature icon="people" title="Seus contatos em um só lugar">CardDAV, diretórios corporativos, grupos, favoritos e contatos compartilhados.</Feature>
    <Feature icon="search" title="Busca instantânea">Pesquise nome, empresa, e-mail, telefone, categoria ou diretório.</Feature>
    <Feature icon="cloud" title="Sincronização por conta">Origens locais e remotas continuam identificadas e independentes.</Feature>
  </div></Workspace>;
}

function TasksView() {
  const [tasks,setTasks] = useState(["Revisar mensagens sinalizadas"]);
  const [draft,setDraft] = useState("");
  return <Workspace title="Tarefas" eyebrow="MINHA AGENDA"><div className="task-board">
    <section className="task-column"><header><span>HOJE</span><b>{tasks.length}</b></header>
      {tasks.map((task,i)=><button className="task-card" key={i}><i><Icon name="check" size={13}/></i><span>{task}</span><Icon name="more" size={15}/></button>)}
      <div className="quick-add"><Icon name="plus" size={15}/><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Adicionar tarefa" onKeyDown={e=>{if(e.key==="Enter"&&draft.trim()){setTasks(v=>[...v,draft.trim()]);setDraft("");}}}/></div>
    </section>
    <section className="task-column muted"><header><span>PRÓXIMAS</span><b>0</b></header><p className="mini-empty">Sem tarefas futuras.</p></section>
  </div></Workspace>;
}

function NotesView() {
  const [notes,setNotes] = useState([{title:"Bem-vindo ao Seven Mail",body:"Notas rápidas ficam junto do seu fluxo de comunicação."}]);
  return <Workspace title="Notas rápidas" eyebrow="NOTAS" action="Nova nota" onAction={()=>setNotes(v=>[{title:"Nova nota",body:"Clique para editar."},...v])}><div className="notes">
    {notes.map((note,i)=><article className="note" key={i}><i>●</i><h3>{note.title}</h3><p>{note.body}</p><small>agora</small></article>)}
  </div></Workspace>;
}

function RulesView() {
  return <Workspace title="Regras" eyebrow="AUTOMAÇÕES" action="Nova regra"><div className="rule-card">
    <div className="empty-symbol"><Icon name="rule" size={28}/></div><h2>Automatize a caixa de entrada</h2><p>Combine remetente, domínio, assunto, palavras, tamanho, anexos e prioridade com ações encadeadas.</p>
    <div className="rule-flow"><span>SE <b>remetente contém</b></span><Icon name="chevron" size={14}/><span>ENTÃO <b>mover para pasta</b></span><Icon name="chevron" size={14}/><span><b>marcar categoria</b></span></div>
  </div></Workspace>;
}

function SettingsView({settings,onChange,runtime,accounts,onAccountsChange,signatures,onSaveSignature,onDeleteSignature,profiles,activeProfileId,onActivateProfile,onSaveProfile,onDeleteProfile}:{settings:AppSettings;onChange:(s:AppSettings)=>void;runtime?:RuntimeInfo;accounts:AccountProfile[];onAccountsChange:(accounts:AccountProfile[])=>void;signatures:SignatureItem[];onSaveSignature:(signature:SignatureItem)=>Promise<void>;onDeleteSignature:(signature:SignatureItem)=>Promise<void>;profiles:ProfileItem[];activeProfileId?:string;onActivateProfile:(profile:ProfileItem|null)=>void;onSaveProfile:(profile:ProfileItem)=>Promise<void>;onDeleteProfile:(profile:ProfileItem)=>Promise<void>}) {
  const set = <K extends keyof AppSettings>(key:K,value:AppSettings[K])=>onChange({...settings,[key]:value});

  function toggleWorkDay(day:number){
    const current=settings.workDays??[1,2,3,4,5];
    const next=current.includes(day)?current.filter((item)=>item!==day):[...current,day].sort();
    set("workDays",next);
  }

  function setWorkHour(day:number,field:"start"|"end",value:string){
    const current=settings.workHours??{};
    const existing=current[String(day)]??{start:"08:00",end:"18:00"};
    set("workHours",{...current,[String(day)]:{...existing,[field]:value}});
  }

  function moveNavItem(id:AppSection,direction:-1|1){
    const order=[...(settings.navOrder??NAV.map((item)=>item.id))];
    const index=order.indexOf(id);
    if(index<0) return;
    const target=index+direction;
    if(target<0||target>=order.length) return;
    [order[index],order[target]]=[order[target],order[index]];
    set("navOrder",order);
  }

  function toggleNavItem(id:AppSection){
    if(id==="settings") return;
    const hidden=settings.hiddenNavItems??[];
    set("hiddenNavItems",hidden.includes(id)?hidden.filter((item)=>item!==id):[...hidden,id]);
  }

  async function exportBackup(encrypted=false) {
    const password=encrypted?window.prompt("Senha para criptografar o backup")?.trim():"";
    if(encrypted&&(!password||password.length<6)){
      if(password!==undefined) window.alert("Use uma senha com pelo menos 6 caracteres.");
      return;
    }
    if(encrypted){
      const confirmation=window.prompt("Confirme a senha do backup")?.trim();
      if(confirmation!==password){
        window.alert("As senhas não coincidem.");
        return;
      }
    }

    const destination = await saveDialog({
      defaultPath:encrypted?"seven-mail-backup.encrypted.json":"seven-mail-backup.json",
      filters:[{name:encrypted?"Backup criptografado Seven Mail":"Backup Seven Mail",extensions:["json"]}],
    });
    if (!destination) return;
    const workspace = await bridge.exportWorkspace();
    const backup = {
      format:"seven-mail-backup",
      version:1,
      exportedAt:new Date().toISOString(),
      settings,
      accounts,
      workspace,
    };
    const plain=JSON.stringify(backup,null,2);
    await bridge.writeTextFile(destination,encrypted?await encryptBackupJson(plain,password!):plain);
  }

  async function importBackup() {
    const selected = await open({
      multiple:false,
      directory:false,
      filters:[{name:"Backup Seven Mail",extensions:["json"]}],
    });
    if (!selected || Array.isArray(selected)) return;
    let raw = await bridge.readTextFile(selected);
    const envelope=JSON.parse(raw) as {format?:string};
    if(envelope.format==="seven-mail-backup-encrypted"){
      const password=window.prompt("Senha do backup criptografado")??"";
      if(!password) return;
      raw=await decryptBackupJson(raw,password);
    }
    const backup = JSON.parse(raw) as {
      format?:string;
      settings?:Partial<AppSettings>;
      accounts?:AccountProfile[];
      workspace?:WorkspaceDocument[];
    };
    if (backup.format!=="seven-mail-backup") {
      throw new Error("Este arquivo não é um backup válido do Seven Mail.");
    }
    if (Array.isArray(backup.workspace)) {
      await bridge.importWorkspace(backup.workspace);
    }
    if (Array.isArray(backup.accounts)) {
      for (const account of backup.accounts) await bridge.saveAccount(account);
      onAccountsChange(backup.accounts);
    }
    if (backup.settings) {
      onChange({...DEFAULT_SETTINGS,...backup.settings});
    }
    window.alert("Backup restaurado. Credenciais de e-mail não fazem parte do backup e continuam protegidas pelo Keyring do sistema.");
    window.location.reload();
  }

  async function configureAppLock() {
    const pin=window.prompt("Crie um PIN para bloquear o Seven Mail")?.trim();
    if(!pin) return;
    const confirmation=window.prompt("Confirme o PIN")?.trim();
    if(confirmation!==pin){
      window.alert("Os PINs não coincidem.");
      return;
    }
    await bridge.setAppLock(pin);
    set("appLockEnabled",true);
    window.dispatchEvent(new CustomEvent("seven-mail:app-lock-changed",{detail:true}));
    window.alert("Bloqueio do aplicativo ativado.");
  }

  async function disableAppLock() {
    const pin=window.prompt("Digite o PIN atual para desativar o bloqueio")??"";
    if(!await bridge.verifyAppLock(pin)){
      window.alert("PIN incorreto.");
      return;
    }
    await bridge.clearAppLock();
    set("appLockEnabled",false);
    window.dispatchEvent(new CustomEvent("seven-mail:app-lock-changed",{detail:false}));
  }

  async function secureWipeLocalData() {
    if(!window.confirm("Isso apagará de forma segura cache, fila offline e workspace local. Contas e credenciais do Keyring serão preservadas. Continuar?")) return;
    if(!window.confirm("Confirma a limpeza segura dos dados locais?")) return;
    await bridge.secureClearLocalData();
    localStorage.removeItem("seven-mail:search-history");
    window.alert("Dados locais removidos com sobrescrita. O Seven Mail será reiniciado.");
    window.location.reload();
  }

  function toggleQuickAction(action:NonNullable<AppSettings["quickActions"]>[number]){
    const current=settings.quickActions??[];
    set("quickActions",current.includes(action)?current.filter((item)=>item!==action):[...current,action].slice(-4));
  }

  function addConditionalMailRule(){
    const field=window.prompt("Campo: from, subject, category ou priority","from")?.trim() as "from"|"subject"|"category"|"priority"|undefined;
    if(!field||!["from","subject","category","priority"].includes(field)) return;
    const value=window.prompt("Valor a destacar")?.trim();
    if(!value) return;
    const accent=window.prompt("Cor (hex ou CSS)","#6f60f4")?.trim()||"#6f60f4";
    set("conditionalMailRules",[...(settings.conditionalMailRules??[]),{id:crypto.randomUUID(),field,value,accent}]);
  }

  function createQuickStep(){
    const name=window.prompt("Nome da ação rápida composta")?.trim();
    if(!name) return;
    const raw=window.prompt(
      "Ações separadas por vírgula: archive, delete, read, flag, pin, category, move",
      "read,archive",
    )?.trim();
    if(!raw) return;
    const allowed=new Set(["archive","delete","read","flag","pin","category","move"]);
    const kinds=raw.split(",").map((value)=>value.trim().toLowerCase()).filter((value)=>allowed.has(value));
    if(kinds.length===0){
      window.alert("Nenhuma ação válida informada.");
      return;
    }
    const actions=kinds.map((kind)=>{
      let target:string|undefined;
      if(kind==="category") target=window.prompt("Nome da categoria para o Quick Step")?.trim()||undefined;
      if(kind==="move") target=window.prompt("Pasta IMAP de destino para o Quick Step")?.trim()||undefined;
      return {kind:kind as NonNullable<AppSettings["quickSteps"]>[number]["actions"][number]["kind"],target};
    });
    const shortcut=window.prompt("Atalho opcional (ex.: ctrl+shift+1)")?.trim().toLowerCase()||undefined;
    set("quickSteps",[...(settings.quickSteps??[]),{id:crypto.randomUUID(),name,shortcut,actions}]);
  }

  function removeQuickStep(id:string){
    set("quickSteps",(settings.quickSteps??[]).filter((step)=>step.id!==id));
  }

    return <Workspace title="Configurações" eyebrow="PREFERÊNCIAS">
    <div className="settings-row brand-settings-row"><div><h3>Sobre o Seven Mail</h3><p>Identidade e informações do aplicativo.</p></div><div className="brand-about-card"><BrandLogo variant="about"/><div><strong>Seven Mail</strong><span>Cliente desktop local-first</span><small>Windows · Linux · macOS</small></div></div></div>
    <div className="settings-row"><div><h3>Idioma, data e hora</h3><p>Preferências regionais usadas no calendário e nas áreas principais.</p></div><div className="shortcut-grid regional-settings">
      <label><span>Idioma</span><select value={settings.locale??"pt-BR"} onChange={e=>set("locale",e.target.value as AppSettings["locale"])}><option value="pt-BR">Português (Brasil)</option><option value="en-US">English (US)</option><option value="es-ES">Español</option></select></label>
      <label><span>Formato de data</span><select value={settings.dateFormat??"short"} onChange={e=>set("dateFormat",e.target.value as AppSettings["dateFormat"])}><option value="short">Curta</option><option value="medium">Média</option><option value="long">Longa</option></select></label>
      <label><span>Formato de hora</span><select value={settings.timeFormat??"24"} onChange={e=>set("timeFormat",e.target.value as AppSettings["timeFormat"])}><option value="24">24 horas</option><option value="12">12 horas</option></select></label>
      <label><span>Primeiro dia</span><select value={settings.firstDayOfWeek??0} onChange={e=>set("firstDayOfWeek",Number(e.target.value) as AppSettings["firstDayOfWeek"])}><option value={0}>Domingo</option><option value={1}>Segunda-feira</option><option value={6}>Sábado</option></select></label>
      <label><span>Fuso principal</span><input value={settings.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={e=>set("timezone",e.target.value)}/></label>
      <label><span>Fusos secundários</span><input value={(settings.secondaryTimezones??[]).join(", ")} onChange={e=>set("secondaryTimezones",e.target.value.split(",").map((item)=>item.trim()).filter(Boolean))} placeholder="America/New_York, Europe/London"/></label>
    </div></div>
    <div className="settings-row"><div><h3>Horário de trabalho</h3><p>Define semana útil, expediente por dia e local de trabalho.</p></div><div className="work-settings"><label><span>Local de trabalho</span><input value={settings.workplace??""} onChange={e=>set("workplace",e.target.value)} placeholder="Escritório, Casa, Híbrido"/></label><div className="work-day-grid">{[0,1,2,3,4,5,6].map((day)=>{const labels=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];const enabled=(settings.workDays??[1,2,3,4,5]).includes(day);const hours=settings.workHours?.[String(day)]??{start:"08:00",end:"18:00"};return <article className={enabled?"active":""} key={day}><label><input type="checkbox" checked={enabled} onChange={()=>toggleWorkDay(day)}/>{labels[day]}</label><input type="time" disabled={!enabled} value={hours.start} onChange={e=>setWorkHour(day,"start",e.target.value)}/><input type="time" disabled={!enabled} value={hours.end} onChange={e=>setWorkHour(day,"end",e.target.value)}/></article>;})}</div></div></div>
    <div className="settings-row"><div><h3>Menu lateral</h3><p>Escolha a ordem e quais áreas ficam visíveis no menu principal.</p></div><div className="nav-customizer">{(settings.navOrder??NAV.map((item)=>item.id)).map((id)=>{const item=NAV.find((nav)=>nav.id===id);if(!item)return null;const hidden=(settings.hiddenNavItems??[]).includes(id);return <article key={id}><Icon name={item.icon} size={14}/><span>{item.label}</span><label><input type="checkbox" checked={!hidden} disabled={id==="settings"} onChange={()=>toggleNavItem(id)}/> Visível</label><button className="icon-button" onClick={()=>moveNavItem(id,-1)}>↑</button><button className="icon-button" onClick={()=>moveNavItem(id,1)}>↓</button></article>;})}</div></div>
    <div className="settings-row"><div><h3>Aparência</h3><p>Tema, densidade e pré-visualização da lista.</p></div><div className="appearance-settings"><div className="choices">{(["system","light","dark"] as const).map(t=><button className={settings.theme===t?"choice active":"choice"} key={t} onClick={()=>set("theme",t)}><Icon name={t==="dark"?"moon":"sun"} size={16}/>{t==="system"?"Sistema":t==="light"?"Claro":"Escuro"}</button>)}</div><label><input type="checkbox" checked={settings.compact} onChange={e=>set("compact",e.target.checked)}/> Lista compacta</label><label><span>Linhas de prévia</span><select value={settings.previewLines} onChange={e=>set("previewLines",Number(e.target.value) as AppSettings["previewLines"])}><option value={1}>1 linha</option><option value={2}>2 linhas</option></select></label></div></div>
    <div className="settings-row"><div><h3>Quick Steps</h3><p>Combine múltiplas ações em um único botão e, opcionalmente, associe um atalho.</p></div><div className="quick-step-settings"><button className="secondary" onClick={createQuickStep}><Icon name="plus" size={13}/> Novo Quick Step</button>{(settings.quickSteps??[]).length===0?<small>Nenhuma ação composta configurada.</small>:(settings.quickSteps??[]).map((step)=><article key={step.id}><span><b>{step.name}</b><small>{step.actions.map((action)=>action.target?`${action.kind} → ${action.target}`:action.kind).join(" · ")}</small></span>{step.shortcut&&<kbd>{step.shortcut}</kbd>}<button className="icon-button" aria-label={`Excluir ${step.name}`} onClick={()=>removeQuickStep(step.id)}><Icon name="trash" size={13}/></button></article>)}</div></div>
    <div className="settings-row"><div><h3>Atalhos de teclado</h3><p>Personalize os atalhos principais. Use formatos como <code>ctrl+n</code>, <code>shift+r</code> ou <code>delete</code>.</p></div><div className="shortcut-grid">{([
      ["newMessage","Novo e-mail"],
      ["search","Pesquisa"],
      ["reply","Responder"],
      ["replyAll","Responder a todos"],
      ["forward","Encaminhar"],
      ["archive","Arquivar"],
      ["delete","Excluir"],
      ["toggleRead","Lida / não lida"],
    ] as const).map(([key,label])=><label key={key}><span>{label}</span><input value={(settings.shortcuts??DEFAULT_SETTINGS.shortcuts!)[key]} onChange={(event)=>set("shortcuts",{...(settings.shortcuts??DEFAULT_SETTINGS.shortcuts!),[key]:event.target.value.toLowerCase()})}/></label>)}</div></div>
    <div className="settings-row"><div><h3>Lista de mensagens</h3><p>Escolha ações rápidas e destaques condicionais.</p></div><div className="inbox-preferences"><div><b>Ações rápidas</b>{(["archive","delete","flag","read","pin"] as const).map((action)=><label key={action}><input type="checkbox" checked={(settings.quickActions??[]).includes(action)} onChange={()=>toggleQuickAction(action)}/>{action==="archive"?"Arquivar":action==="delete"?"Excluir":action==="flag"?"Sinalizar":action==="read"?"Lida/não lida":"Fixar"}</label>)}</div><div className="conditional-rules"><header><b>Formatação condicional</b><button className="secondary" onClick={addConditionalMailRule}><Icon name="plus" size={12}/> Regra</button></header>{(settings.conditionalMailRules??[]).map((rule)=><span key={rule.id}><i style={{background:rule.accent}}/>{rule.field}: {rule.value}<button aria-label="Excluir regra" onClick={()=>set("conditionalMailRules",(settings.conditionalMailRules??[]).filter((item)=>item.id!==rule.id))}><Icon name="x" size={10}/></button></span>)}</div></div></div>
    <div className="settings-row"><div><h3>Acessibilidade e escala</h3><p>Controles visuais globais, foco de teclado e redução de movimento.</p></div><div className="appearance-settings"><label><span>Tamanho da fonte</span><select value={settings.fontSize??"medium"} onChange={e=>set("fontSize",e.target.value as AppSettings["fontSize"])}><option value="small">Pequena</option><option value="medium">Média</option><option value="large">Grande</option></select></label><label><span>Escala da interface</span><select value={settings.uiScale??1} onChange={e=>set("uiScale",Number(e.target.value) as AppSettings["uiScale"])}><option value={0.9}>90%</option><option value={1}>100%</option><option value={1.1}>110%</option><option value={1.2}>120%</option></select></label><label><input type="checkbox" checked={Boolean(settings.highContrast)} onChange={e=>set("highContrast",e.target.checked)}/> Alto contraste</label><label><input type="checkbox" checked={Boolean(settings.reduceMotion)} onChange={e=>set("reduceMotion",e.target.checked)}/> Reduzir animações</label><small>Atalhos: Alt+1 E-mail · Alt+2 Calendário · Alt+3 Contatos · Alt+4 Tarefas · Ctrl/Cmd+K Pesquisa · Ctrl/Cmd+N Novo e-mail</small></div></div>
    <div className="settings-row"><div><h3>Painel de leitura</h3><p>Posição padrão e tempo para marcar mensagens como lidas.</p></div><div className="appearance-settings"><select value={settings.readingPane} onChange={e=>set("readingPane",e.target.value as AppSettings["readingPane"])}><option value="right">À direita</option><option value="bottom">Abaixo</option><option value="off">Desativado</option></select><label><span>Marcar como lida</span><select value={settings.markReadDelayMs} onChange={e=>set("markReadDelayMs",Number(e.target.value))}><option value={0}>Imediatamente</option><option value={500}>Após 0,5 s</option><option value={1200}>Após 1,2 s</option><option value={3000}>Após 3 s</option></select></label></div></div>
    <div className="settings-row"><div><h3>Lista de mensagens</h3><p>Caixa prioritária, paginação e comportamento após ações.</p></div><div className="toggles"><label><input type="checkbox" checked={settings.focusInboxEnabled!==false} onChange={e=>set("focusInboxEnabled",e.target.checked)}/> Usar Prioritária e Outros</label><label><input type="checkbox" checked={settings.showSenderPhotos!==false} onChange={e=>set("showSenderPhotos",e.target.checked)}/> Mostrar fotos/iniciais dos remetentes</label><label><input type="checkbox" checked={settings.openNextAfterDelete!==false} onChange={e=>set("openNextAfterDelete",e.target.checked)}/> Abrir próxima mensagem após mover/excluir</label><label><span>Mensagens por página</span><select value={settings.mailPageSize??50} onChange={e=>set("mailPageSize",Number(e.target.value) as AppSettings["mailPageSize"])}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><label><span>Limite por anexo</span><select value={settings.maxAttachmentMb??25} onChange={e=>set("maxAttachmentMb",Number(e.target.value) as AppSettings["maxAttachmentMb"])}><option value={10}>10 MB</option><option value={25}>25 MB</option><option value={50}>50 MB</option><option value={100}>100 MB</option></select></label></div></div>
    <div className="settings-row"><div><h3>Envio</h3><p>Defina o atraso usado para desfazer um envio e a confirmação antes de colocar a mensagem na fila.</p></div><div className="send-settings"><select value={settings.sendDelaySeconds} onChange={e=>set("sendDelaySeconds",Number(e.target.value) as AppSettings["sendDelaySeconds"])}><option value={0}>Imediato</option><option value={5}>Desfazer por 5 s</option><option value={10}>Desfazer por 10 s</option><option value={20}>Desfazer por 20 s</option><option value={30}>Desfazer por 30 s</option></select><label><input type="checkbox" checked={settings.confirmBeforeSend} onChange={e=>set("confirmBeforeSend",e.target.checked)}/> Confirmar antes de enviar</label></div></div>
    <div className="settings-row"><div><h3>Escrita e idioma</h3><p>Assistência local de composição e dicionário personalizado.</p></div><div className="send-settings"><label><span>Idioma de composição</span><select value={settings.composeLanguage??"pt-BR"} onChange={e=>set("composeLanguage",e.target.value)}><option value="pt-BR">Português (Brasil)</option><option value="pt-PT">Português (Portugal)</option><option value="en-US">English (US)</option><option value="es-ES">Español</option></select></label><label><input type="checkbox" checked={settings.autoCorrectEnabled!==false} onChange={e=>set("autoCorrectEnabled",e.target.checked)}/> Autocorreção conservadora</label><label><input type="checkbox" checked={settings.autoCapitalizeEnabled!==false} onChange={e=>set("autoCapitalizeEnabled",e.target.checked)}/> Capitalização automática</label><div className="dictionary-editor"><b>Dicionário personalizado</b><div>{(settings.customDictionary??[]).map((word)=><span key={word}>{word}<button onClick={()=>set("customDictionary",(settings.customDictionary??[]).filter((item)=>item!==word))}><Icon name="x" size={10}/></button></span>)}</div><button className="secondary" onClick={()=>{const word=window.prompt("Palavra para adicionar ao dicionário")?.trim();if(word)set("customDictionary",[...new Set([...(settings.customDictionary??[]),word])]);}}><Icon name="plus" size={12}/> Palavra</button></div></div></div>
    <div className="settings-row"><div><h3>Sincronização e notificações</h3><p>Atualização automática, retenção local e uso de recursos.</p></div><div className="send-settings"><label><span>Intervalo</span><select value={settings.syncIntervalMinutes} onChange={e=>set("syncIntervalMinutes",Number(e.target.value) as AppSettings["syncIntervalMinutes"])}><option value={1}>A cada 1 minuto</option><option value={5}>A cada 5 minutos</option><option value={10}>A cada 10 minutos</option><option value={15}>A cada 15 minutos</option><option value={30}>A cada 30 minutos</option></select></label><label><span>Retenção local</span><select value={settings.localRetentionDays??90} onChange={e=>set("localRetentionDays",Number(e.target.value) as AppSettings["localRetentionDays"])}><option value={0}>Sem limite</option><option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={180}>180 dias</option><option value={365}>1 ano</option></select></label><label><span>Sincronizações simultâneas</span><select value={settings.maxConcurrentSyncs??2} onChange={e=>set("maxConcurrentSyncs",Number(e.target.value) as AppSettings["maxConcurrentSyncs"])}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label><label><input type="checkbox" checked={Boolean(settings.batterySaverEnabled)} onChange={e=>set("batterySaverEnabled",e.target.checked)}/> Economia de bateria (reduz a frequência em segundo plano)</label><label><input type="checkbox" checked={Boolean(settings.memorySaverEnabled)} onChange={e=>set("memorySaverEnabled",e.target.checked)}/> Economia de memória (menos mensagens por lote)</label><label><input type="checkbox" checked={settings.notificationsEnabled} onChange={e=>set("notificationsEnabled",e.target.checked)}/> Notificações nativas de novas mensagens</label><label><input type="checkbox" checked={Boolean(settings.quietHoursEnabled)} onChange={e=>set("quietHoursEnabled",e.target.checked)}/> Horário silencioso</label>{settings.quietHoursEnabled&&<div className="quiet-hours"><label><span>De</span><input type="time" value={settings.quietHoursStart??"22:00"} onChange={e=>set("quietHoursStart",e.target.value)}/></label><label><span>Até</span><input type="time" value={settings.quietHoursEnd??"07:00"} onChange={e=>set("quietHoursEnd",e.target.value)}/></label></div>}</div></div>
    <div className="settings-row"><div><h3>Ausência e encaminhamento</h3><p>Automação local executada durante sincronizações enquanto o Seven Mail estiver em execução.</p></div><div className="send-settings"><label><input type="checkbox" checked={Boolean(settings.autoReplyEnabled)} onChange={e=>set("autoReplyEnabled",e.target.checked)}/> Resposta automática</label>{settings.autoReplyEnabled&&<><input value={settings.autoReplySubject??""} onChange={e=>set("autoReplySubject",e.target.value)} placeholder="Assunto"/><textarea value={settings.autoReplyBody??""} onChange={e=>set("autoReplyBody",e.target.value)} placeholder="Mensagem de ausência"/><div className="quiet-hours"><label><span>Início</span><input type="datetime-local" value={settings.autoReplyStart?.slice(0,16)??""} onChange={e=>set("autoReplyStart",e.target.value||undefined)}/></label><label><span>Fim</span><input type="datetime-local" value={settings.autoReplyEnd?.slice(0,16)??""} onChange={e=>set("autoReplyEnd",e.target.value||undefined)}/></label></div></>}<label><input type="checkbox" checked={Boolean(settings.autoForwardEnabled)} onChange={e=>set("autoForwardEnabled",e.target.checked)}/> Encaminhamento automático</label>{settings.autoForwardEnabled&&<input type="email" value={settings.autoForwardAddress??""} onChange={e=>set("autoForwardAddress",e.target.value)} placeholder="destino@dominio.com"/>}</div></div>
    <div className="settings-row"><div><h3>Dados locais</h3><p>Cache pode ser limpo sem tocar na fila de saída. Backup inclui workspace, preferências e metadados das contas; senhas ficam somente no Keyring.</p></div><div className="paths"><span><b>Dados</b>{runtime?.dataDir||"Carregando..."}</span><span><b>Cache</b>{runtime?.cacheDir||"Carregando..."}</span><span><b>Fila</b>{runtime?.queueDir||"Carregando..."}</span><div className="data-actions"><button className="secondary" onClick={()=>void exportBackup(false)}><Icon name="download" size={14}/> Exportar backup</button><button className="secondary" onClick={()=>void exportBackup(true)}><Icon name="lock" size={14}/> Backup criptografado</button><button className="secondary" onClick={()=>void importBackup()}><Icon name="upload" size={14}/> Restaurar backup</button><button className="secondary" onClick={()=>bridge.clearCache()}>Limpar apenas cache</button><button className="danger-link" onClick={()=>void secureWipeLocalData()}>Limpeza segura</button></div></div></div>
    <div className="settings-row"><div><h3>Privacidade de mensagens</h3><p>Reduz rastreamento e alerta sobre conteúdo potencialmente perigoso.</p></div><div className="toggles"><label><input type="checkbox" checked={settings.blockRemoteContent!==false} onChange={e=>set("blockRemoteContent",e.target.checked)}/> Bloquear imagens e conteúdo remoto</label><label><input type="checkbox" checked={settings.warnSuspiciousLinks!==false} onChange={e=>set("warnSuspiciousLinks",e.target.checked)}/> Avisar antes de abrir links suspeitos</label><label><input type="checkbox" checked={settings.externalSenderWarning!==false} onChange={e=>set("externalSenderWarning",e.target.checked)}/> Avisar remetente externo</label></div></div>
    <div className="settings-row"><div><h3>Bloqueio do aplicativo</h3><p>PIN protegido pelo Keyring. Pode bloquear automaticamente após inatividade.</p></div><div className="send-settings">{settings.appLockEnabled?<><button className="secondary" onClick={()=>void configureAppLock()}><Icon name="lock" size={14}/> Alterar PIN</button><button className="danger-link" onClick={()=>void disableAppLock()}>Desativar bloqueio</button></>:<button className="secondary" onClick={()=>void configureAppLock()}><Icon name="lock" size={14}/> Ativar bloqueio</button>}<label><span>Bloquear após</span><select disabled={!settings.appLockEnabled} value={settings.appLockMinutes??5} onChange={e=>set("appLockMinutes",Number(e.target.value) as AppSettings["appLockMinutes"])}><option value={0}>Somente manual</option><option value={1}>1 minuto</option><option value={5}>5 minutos</option><option value={15}>15 minutos</option><option value={30}>30 minutos</option></select></label></div></div>
        <SenderPoliciesPanel settings={settings} onChange={onChange}/>
    <ProfilesPanel accounts={accounts} profiles={profiles} activeProfileId={activeProfileId} onActivate={onActivateProfile} onSave={onSaveProfile} onDelete={onDeleteProfile}/>
    <AccountsPanel accounts={accounts} onChange={onAccountsChange}/>
    <SignaturesPanel accounts={accounts} signatures={signatures} onSave={onSaveSignature} onDelete={onDeleteSignature}/>
    <ComposerAssetsPanel/>
    <ExtensionsPanel/>
    <CloudPanel/>
    <div className="settings-row"><div><h3>Desktop</h3><p>Integração real com Windows, Linux e macOS.</p></div><div className="toggles"><button className="secondary" onClick={()=>void bridge.openDefaultMailSettings().then((message)=>window.alert(message)).catch((reason)=>window.alert(String(reason)))}><Icon name="mail" size={14}/> Definir como cliente padrão</button><label><span>Ao fechar a janela</span><select value={settings.closeBehavior??(settings.minimizeToTray?"tray":"exit")} onChange={e=>{const value=e.target.value as AppSettings["closeBehavior"];set("closeBehavior",value);set("minimizeToTray",value==="tray");}}><option value="tray">Minimizar para bandeja</option><option value="exit">Encerrar o aplicativo</option></select></label><label><input type="checkbox" checked={settings.startWithSystem} onChange={e=>set("startWithSystem",e.target.checked)}/> Iniciar com o sistema</label><label><input type="checkbox" checked={settings.confirmBeforeDelete} onChange={e=>set("confirmBeforeDelete",e.target.checked)}/> Confirmar exclusão</label></div></div>
  </Workspace>;
}

function Workspace({title,eyebrow,action,onAction,children}:{title:string;eyebrow:string;action?:string;onAction?:()=>void;children:ReactNode}) {
  return <div className="workspace"><header className="workspace-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{action&&<button className="primary" onClick={onAction}><Icon name="plus" size={15}/>{action}</button>}</header>{children}</div>;
}
function Feature({icon,title,children}:{icon:IconName;title:string;children:ReactNode}) { return <article className="feature"><div className="empty-symbol small-symbol"><Icon name={icon}/></div><h3>{title}</h3><p>{children}</p></article>; }

export default function App() {
  const launchParams = new URLSearchParams(window.location.search);
  const launchMessageId = launchParams.get("message") ?? undefined;
  const launchAccountId = launchParams.get("account") ?? undefined;
  const [section,setSection] = useState<AppSection>("mail");
  const [accounts,setAccounts] = useState<AccountProfile[]>([]);
  const [activeId,setActiveId] = useState<string|undefined>(launchAccountId);
  const [messages,setMessages] = useState<MailMessage[]>([]);
  const [mailFolders,setMailFolders] = useState<MailFolder[]>(FALLBACK_FOLDERS);
  const [selectedFolder,setSelectedFolder] = useState<MailFolder>(FALLBACK_FOLDERS[0]);
  const [runtime,setRuntime] = useState<RuntimeInfo>();
  const [composeOpen,setComposeOpen] = useState(false);
  const [draftToOpen,setDraftToOpen] = useState<ComposeDraft>();
  const [localDrafts,setLocalDrafts] = useState<ComposeDraft[]>([]);
  const [accountOpen,setAccountOpen] = useState(false);
  const [undoSend,setUndoSend] = useState<{id:string;expiresAt:number}|null>(null);
  const [search,setSearch] = useState("");
  const [indexedMessageIds,setIndexedMessageIds] = useState<string[]|null>(null);
  const [searchHistory,setSearchHistory] = useState<string[]>(()=>{
    try{return JSON.parse(localStorage.getItem("seven-mail:search-history")||"[]");}catch{return [];}
  });
  const [workspaceSearchResults,setWorkspaceSearchResults] = useState<WorkspaceDocument[]>([]);
  const [globalSearchOpen,setGlobalSearchOpen] = useState(false);
  const [focusMessageId,setFocusMessageId] = useState<string|undefined>(launchMessageId);
  const [categories,setCategories] = useState<CategoryItem[]>([]);
  const [savedSearches,setSavedSearches] = useState<SavedSearchItem[]>([]);
  const [signatures,setSignatures] = useState<SignatureItem[]>([]);
  const [profiles,setProfiles] = useState<ProfileItem[]>([]);
  const [activeProfileId,setActiveProfileId] = useState<string|undefined>(()=>localStorage.getItem("seven-mail:active-profile")||undefined);
  const [syncState,setSyncState] = useState<"idle"|"syncing"|"error">("idle");
  const externalOpenInitialized = useRef(false);
  const [bootState,setBootState] = useState({
    runtime: false,
    accounts: false,
    workspace: false,
    messages: false,
  });
  const [lockConfigured,setLockConfigured]=useState(false);
  const [appLocked,setAppLocked]=useState(false);
  const [settings,setSettings] = useState<AppSettings>(()=>{
    try { return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem("seven-mail:settings")||"{}")}; } catch { return DEFAULT_SETTINGS; }
  });

  const navItems=useMemo(()=>{
    const order=settings.navOrder??NAV.map((item)=>item.id);
    const hidden=new Set(settings.hiddenNavItems??[]);
    return order
      .map((id)=>NAV.find((item)=>item.id===id))
      .filter((item):item is (typeof NAV)[number]=>Boolean(item)&&(!hidden.has(item!.id)||item!.id==="settings"));
  },[settings.navOrder,settings.hiddenNavItems]);

  const activeProfile = profiles.find((profile)=>profile.id===activeProfileId);
  const profileAccounts = activeProfile
    ? accounts.filter((account)=>activeProfile.accountIds.includes(account.id))
    : accounts;
  const unified = activeId==="__all__";
  const activeAccount = unified ? undefined : (profileAccounts.find(a=>a.id===activeId)||profileAccounts[0]);
  const composeAccount = activeAccount ?? profileAccounts.find((account)=>account.isDefault) ?? profileAccounts[0];
  const bootReady = bootState.runtime && bootState.accounts && bootState.workspace && bootState.messages;
  const unreadBadgeCount=useMemo(
    ()=>messages.filter((message)=>!message.isRead&&message.folder==="Caixa de entrada").length,
    [messages],
  );

  useEffect(()=>{
    if(!bootReady) return;
    document.title=unreadBadgeCount>0?`(${unreadBadgeCount}) Seven Mail`:"Seven Mail";
    void getCurrentWindow().setBadgeCount(unreadBadgeCount>0?unreadBadgeCount:undefined).catch(()=>undefined);
  },[bootReady,unreadBadgeCount]);

  async function loadWorkspaceCollection<T>(kind: WorkspaceKind): Promise<T[]> {
    const documents = await syncWorkspaceCollection<T>(kind).catch(() => []);
    return documents.map((document) => document.payload);
  }

  async function refreshMailOrganization() {
    const [nextCategories,nextSavedSearches,nextSignatures,nextProfiles] = await Promise.all([
      loadWorkspaceCollection<CategoryItem>("category"),
      loadWorkspaceCollection<SavedSearchItem>("saved-search"),
      loadWorkspaceCollection<SignatureItem>("signature"),
      loadWorkspaceCollection<ProfileItem>("profile"),
    ]);
    setCategories(nextCategories);
    setSavedSearches(nextSavedSearches);
    setSignatures(nextSignatures);
    setProfiles(nextProfiles);
    setActiveProfileId((current)=>current||nextProfiles.find((profile)=>profile.isDefault)?.id);
  }

  async function refreshActiveFolders(account = activeAccount) {
    if (!account) return;
    const folders = await bridge.listFolders(account.id);
    setMailFolders(folders.length ? folders : FALLBACK_FOLDERS);
    return folders;
  }

  async function createCustomFolder(parent?:MailFolder) {
    if (!activeAccount) return;
    const name = window.prompt(parent?`Nome da subpasta de "${parent.name}"`:"Nome da nova pasta")?.trim();
    if (!name) return;

    let path=name;
    if(parent){
      const nested=mailFolders.find((item)=>item.path.startsWith(parent.path)&&item.path.length>parent.path.length);
      const delimiter=nested?.path.slice(parent.path.length,parent.path.length+1) || "/";
      path=`${parent.path}${delimiter}${name}`;
    }

    await bridge.createFolder(activeAccount.id,path);
    const folders = await refreshActiveFolders(activeAccount);
    if (folders) {
      const created = folders.find((item)=>item.path===path||item.name===name);
      if (created) setSelectedFolder(created);
    }
  }

  async function renameCustomFolder(folder: MailFolder) {
    if (!activeAccount || folder.role!=="custom") return;
    const name = window.prompt("Novo nome da pasta",folder.path)?.trim();
    if (!name || name===folder.path) return;
    await bridge.renameFolder(activeAccount.id,folder.path,folder.name,name);
    const folders = await refreshActiveFolders(activeAccount);
    if (selectedFolder.path===folder.path) {
      const renamed = folders?.find((item)=>item.path===name||item.name===name);
      if (renamed) setSelectedFolder(renamed);
    }
    setMessages(await bridge.listCachedMessages(activeAccount.id));
  }

  async function deleteCustomFolder(folder: MailFolder) {
    if (!activeAccount || folder.role!=="custom") return;
    if (!window.confirm(`Excluir a pasta "${folder.name}" e as mensagens nela?`)) return;
    await bridge.deleteFolder(activeAccount.id,folder.path,folder.name);
    const folders = await refreshActiveFolders(activeAccount);
    if (selectedFolder.path===folder.path) {
      setSelectedFolder(folders?.find((item)=>item.role==="inbox")??FALLBACK_FOLDERS[0]);
    }
    setMessages(await bridge.listCachedMessages(activeAccount.id));
  }

  async function moveToFolder(message: MailMessage, target: MailFolder) {
    const updated = await bridge.moveMessageToFolder(message.accountId,message.id,target.path,target.name);
    setMessages(await bridge.listCachedMessages(unified ? undefined : message.accountId));
    void pushCloudMessage(updated).catch(() => undefined);
    void bridge.flushMailActions(message.accountId).catch(() => undefined);
  }

  async function copyToFolder(message: MailMessage, target: MailFolder) {
    await bridge.copyMessageToFolder(message.accountId,message.id,target.path);
    void bridge.flushMailActions(message.accountId).catch(() => undefined);
  }

  async function updateMessageMetadata(message: MailMessage, metadata: {importance?:"low"|"normal"|"high";snoozedUntil?:string;isMuted?:boolean;isPhishing?:boolean;isImportant?:boolean}) {
    const updated=await bridge.updateMessageMetadata(message.accountId,message.id,metadata);
    setMessages((current)=>current.map((item)=>item.id===updated.id?updated:item));
    void pushCloudMessage(updated).catch(() => undefined);
  }

  function addPolicy(key:"blockedSenders"|"trustedSenders", email:string) {
    const normalized=email.trim().toLocaleLowerCase("pt-BR");
    if(!normalized) return;
    setSettings((current)=>{
      const blocked=(current.blockedSenders??[]).filter((value)=>value!==normalized);
      const trusted=(current.trustedSenders??[]).filter((value)=>value!==normalized);
      return {
        ...current,
        blockedSenders:key==="blockedSenders"?[...new Set([...blocked,normalized])]:blocked,
        trustedSenders:key==="trustedSenders"?[...new Set([...trusted,normalized])]:trusted,
      };
    });
  }

  function releaseSender(email:string) {
    const normalized=email.trim().toLocaleLowerCase("pt-BR");
    setSettings((current)=>({...current,blockedSenders:(current.blockedSenders??[]).filter((value)=>value!==normalized)}));
  }

  async function applySenderPolicies(candidates: MailMessage[]): Promise<void> {
    const blockedSenders=new Set((settings.blockedSenders??[]).map((value)=>value.toLocaleLowerCase("pt-BR")));
    const blockedDomains=new Set((settings.blockedDomains??[]).map((value)=>value.toLocaleLowerCase("pt-BR")));
    const ignored=new Set(settings.ignoredConversationKeys??[]);
    const cleanup=settings.cleanupSenders??{};
    const touched=new Set<string>();

    for(const message of candidates){
      if(message.folder!=="Caixa de entrada") continue;
      const email=message.from.email.toLocaleLowerCase("pt-BR");
      const domain=email.split("@")[1]??"";

      if(blockedSenders.has(email)||blockedDomains.has(domain)){
        await bridge.messageAction(message.accountId,message.id,"spam").catch(()=>undefined);
        touched.add(message.accountId);
        continue;
      }

      if(ignored.has(conversationKey(message.subject))){
        await bridge.updateMessageMetadata(message.accountId,message.id,{isMuted:true}).catch(()=>undefined);
        await bridge.messageAction(message.accountId,message.id,"delete").catch(()=>undefined);
        touched.add(message.accountId);
        continue;
      }

      const days=cleanup[email];
      if(days&&days>0){
        const received=new Date(message.receivedAt).getTime();
        if(Number.isFinite(received)&&Date.now()-received>=days*86_400_000){
          await bridge.messageAction(message.accountId,message.id,"delete").catch(()=>undefined);
          touched.add(message.accountId);
        }
      }
    }

    for(const accountId of touched) void bridge.flushMailActions(accountId).catch(()=>undefined);
  }

  function setSenderCleanup(message: MailMessage) {
    const email=message.from.email.toLocaleLowerCase("pt-BR");
    const current=settings.cleanupSenders?.[email];
    const raw=window.prompt(
      `Excluir automaticamente mensagens de ${email} após quantos dias? Digite 0 para desativar.`,
      String(current??30),
    );
    if(raw===null) return;
    const days=Math.max(0,Math.min(3650,Math.round(Number(raw))));
    if(!Number.isFinite(days)) return;
    setSettings((value)=>{
      const next={...(value.cleanupSenders??{})};
      if(days===0) delete next[email];
      else next[email]=days;
      return {...value,cleanupSenders:next};
    });
  }

  function automaticWindowActive(account?:AccountProfile): boolean {
    const now=Date.now();
    const startValue=account?.autoReplyStart??settings.autoReplyStart;
    const endValue=account?.autoReplyEnd??settings.autoReplyEnd;
    const start=startValue?new Date(startValue).getTime():NaN;
    const end=endValue?new Date(endValue).getTime():NaN;
    if(Number.isFinite(start)&&now<start) return false;
    if(Number.isFinite(end)&&now>end) return false;
    return true;
  }

  async function applyFreshAutomations(fresh: MailMessage[], account: AccountProfile) {
    if(fresh.length===0) return;
    const own=new Set([account.email,...(account.aliases??[])].map((value)=>value.toLocaleLowerCase("pt-BR")));
    const forwardAddress=(settings.autoForwardAddress??"").trim();

    for(const message of fresh){
      const sender=message.from.email.toLocaleLowerCase("pt-BR");
      if(own.has(sender)) continue;

      const markers=new Set(message.appliedRuleIds??[]);
      let updated=message;

      const accountAutoReply=account.isSharedMailbox&&account.autoReplyEnabled&&account.autoReplyBody?.trim();
      const globalAutoReply=settings.autoReplyEnabled&&settings.autoReplyBody?.trim();
      const autoReplyBody=(accountAutoReply?account.autoReplyBody:settings.autoReplyBody)?.trim();
      const autoReplySubject=(accountAutoReply?account.autoReplySubject:settings.autoReplySubject)?.trim();

      if((accountAutoReply||globalAutoReply)&&autoReplyBody&&automaticWindowActive(accountAutoReply?account:undefined)&&!markers.has("__auto-reply__")&&!/^(no-?reply|mailer-daemon)@/i.test(sender)){
        const id=crypto.randomUUID();
        await bridge.queueOperation({
          id,
          kind:"send",
          accountId:account.id,
          createdAt:new Date().toISOString(),
          attempts:0,
          payload:{
            fromAddress:account.email,
            to:message.from.email,
            cc:"",
            bcc:"",
            subject:/^re:/i.test(message.subject)?message.subject:`Re: ${autoReplySubject||message.subject||"Resposta automática"}`,
            bodyText:autoReplyBody,
            bodyHtml:"",
            attachments:[],
            priority:"normal",
            requestReadReceipt:false,
            requestDeliveryReceipt:false,
            sendAt:new Date().toISOString(),
          },
        });
        markers.add("__auto-reply__");
      }

      if(settings.autoForwardEnabled&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardAddress)&&!markers.has("__auto-forward__")){
        const id=crypto.randomUUID();
        const attachment=await bridge.stageMessageAsEml(id,message.accountId,message.id,safeExportName(message.subject,"mensagem")).catch(()=>null);
        await bridge.queueOperation({
          id,
          kind:"send",
          accountId:account.id,
          createdAt:new Date().toISOString(),
          attempts:0,
          payload:{
            fromAddress:account.email,
            to:forwardAddress,
            cc:"",
            bcc:"",
            subject:/^(enc|fw|fwd):/i.test(message.subject)?message.subject:`Enc: ${message.subject||"(sem assunto)"}`,
            bodyText:`Encaminhado automaticamente pelo Seven Mail.\n\nDe: ${message.from.email}\nAssunto: ${message.subject}`,
            bodyHtml:"",
            attachments:attachment?[attachment]:[],
            priority:message.importance??"normal",
            requestReadReceipt:false,
            requestDeliveryReceipt:false,
            sendAt:new Date().toISOString(),
          },
        });
        markers.add("__auto-forward__");
      }

      if(markers.size!==(message.appliedRuleIds??[]).length){
        updated={...message,appliedRuleIds:[...markers]};
        await bridge.cacheMessage(updated);
        void pushCloudMessage(updated).catch(()=>undefined);
      }
    }

    void bridge.flushOutbox().catch(()=>undefined);
  }

  async function createCategory() {
    const name = window.prompt("Nome da categoria")?.trim();
    if (!name || categories.some((category)=>category.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))) return;

    const category: CategoryItem = {
      id: crypto.randomUUID(),
      name,
      color: COLORS[categories.length % COLORS.length],
    };
    const document: WorkspaceDocument<CategoryItem> = {
      id: category.id,
      kind: "category",
      updatedAt: new Date().toISOString(),
      payload: category,
    };
    await bridge.upsertWorkspace(document);
    setCategories((current)=>[...current,category]);
    void pushCloudDocument(document).catch(() => undefined);
  }

  async function editCategory(category: CategoryItem) {
    const name = window.prompt("Nome da categoria",category.name)?.trim();
    if (!name) return;
    const color = window.prompt("Cor da categoria (hex)",category.color)?.trim() || category.color;
    const updated: CategoryItem = {...category,name,color};
    const document: WorkspaceDocument<CategoryItem> = {
      id:updated.id,
      kind:"category",
      updatedAt:new Date().toISOString(),
      payload:updated,
    };
    await bridge.upsertWorkspace(document);
    setCategories((current)=>current.map((item)=>item.id===updated.id?updated:item));
    void pushCloudDocument(document).catch(() => undefined);

    if (name !== category.name) {
      const cached = await bridge.listCachedMessages();
      for (const message of cached) {
        if (!message.categories.includes(category.name)) continue;
        const next = {
          ...message,
          categories:message.categories.map((value)=>value===category.name?name:value),
        };
        await bridge.cacheMessage(next);
        void pushCloudMessage(next).catch(() => undefined);
      }
      setMessages(await bridge.listCachedMessages(unified ? undefined : activeAccount?.id));
    }
  }

  async function toggleCategoryFavorite(category: CategoryItem) {
    const updated={...category,favorite:!category.favorite};
    const document:WorkspaceDocument<CategoryItem>={
      id:updated.id,
      kind:"category",
      updatedAt:new Date().toISOString(),
      payload:updated,
    };
    await bridge.upsertWorkspace(document);
    setCategories((current)=>current.map((item)=>item.id===updated.id?updated:item));
    void pushCloudDocument(document).catch(()=>undefined);
  }

  async function toggleFolderFavorite(folder:MailFolder){
    if(!activeAccount) return;
    const key=activeAccount.id;
    setSettings((current)=>{
      const existing=current.favoriteFolders?.[key]??[];
      const next=existing.includes(folder.path)?existing.filter((value)=>value!==folder.path):[...existing,folder.path];
      return {...current,favoriteFolders:{...(current.favoriteFolders??{}),[key]:next}};
    });
  }

  function reorderFolder(folder:MailFolder,direction:-1|1){
    if(!activeAccount) return;
    const key=activeAccount.id;
    setSettings((current)=>{
      const all=current.folderOrder?.[key]?.length?current.folderOrder[key]:mailFolders.map((item)=>item.path);
      const list=[...all];
      const index=list.indexOf(folder.path);
      if(index<0) return current;
      const nextIndex=index+direction;
      if(nextIndex<0||nextIndex>=list.length) return current;
      [list[index],list[nextIndex]]=[list[nextIndex],list[index]];
      return {...current,folderOrder:{...(current.folderOrder??{}),[key]:list}};
    });
  }

  async function deleteCategory(category: CategoryItem) {
    if (!window.confirm(`Excluir a categoria "${category.name}"?`)) return;
    const tombstone = await bridge.deleteWorkspace("category",category.id);
    setCategories((current)=>current.filter((item)=>item.id!==category.id));
    void pushCloudDocument(tombstone).catch(() => undefined);

    const cached = await bridge.listCachedMessages();
    for (const message of cached) {
      if (!message.categories.includes(category.name)) continue;
      const updated = {...message,categories:message.categories.filter((name)=>name!==category.name)};
      await bridge.cacheMessage(updated);
      void pushCloudMessage(updated).catch(() => undefined);
    }
    setMessages(await bridge.listCachedMessages(unified ? undefined : activeAccount?.id));
  }

  async function toggleMessageCategory(message: MailMessage, category: CategoryItem) {
    const hasCategory = message.categories.includes(category.name);
    const updated: MailMessage = {
      ...message,
      categories: hasCategory
        ? message.categories.filter((name)=>name!==category.name)
        : [...message.categories,category.name],
    };
    await bridge.cacheMessage(updated);
    setMessages((current)=>current.map((item)=>item.id===updated.id?updated:item));
    void pushCloudMessage(updated).catch(() => undefined);
  }

  async function saveProfile(profile: ProfileItem) {
    const now=new Date().toISOString();
    const documents:WorkspaceDocument<ProfileItem>[]=[];
    if(profile.isDefault){
      for(const item of profiles){
        if(item.id===profile.id||!item.isDefault) continue;
        const demoted={...item,isDefault:false};
        const document:WorkspaceDocument<ProfileItem>={id:demoted.id,kind:"profile",updatedAt:now,payload:demoted};
        await bridge.upsertWorkspace(document);
        documents.push(document);
      }
    }
    const document:WorkspaceDocument<ProfileItem>={id:profile.id,kind:"profile",updatedAt:now,payload:profile};
    await bridge.upsertWorkspace(document);
    documents.push(document);
    setProfiles((current)=>[profile,...current.map((item)=>profile.isDefault&&item.id!==profile.id?{...item,isDefault:false}:item).filter((item)=>item.id!==profile.id)]);
    for(const item of documents) void pushCloudDocument(item).catch(()=>undefined);
  }

  async function deleteProfile(profile: ProfileItem) {
    if(!window.confirm(`Excluir o perfil "${profile.name}"? As contas não serão removidas.`)) return;
    const tombstone=await bridge.deleteWorkspace("profile",profile.id);
    void pushCloudDocument(tombstone).catch(()=>undefined);
    setProfiles((current)=>current.filter((item)=>item.id!==profile.id));
    if(activeProfileId===profile.id){
      setActiveProfileId(undefined);
      localStorage.removeItem("seven-mail:active-profile");
    }
  }

  function activateProfile(profile: ProfileItem | null) {
    const id=profile?.id;
    setActiveProfileId(id);
    if(id) localStorage.setItem("seven-mail:active-profile",id);
    else localStorage.removeItem("seven-mail:active-profile");
    if(profile?.settings){
      setSettings((current)=>({...current,...profile.settings}));
    }
    const allowed=profile?accounts.filter((account)=>profile.accountIds.includes(account.id)):accounts;
    setActiveId((current)=>current==="__all__"||allowed.some((account)=>account.id===current)?current:(allowed.find((account)=>account.isDefault)?.id??allowed[0]?.id));
    setMessages([]);
  }

  async function saveSignature(signature: SignatureItem) {
    const now = new Date().toISOString();
    const cloudDocuments: Array<WorkspaceDocument<SignatureItem>> = [];

    if (signature.isDefault) {
      for (const item of signatures) {
        if (item.accountId !== signature.accountId || item.id === signature.id || !item.isDefault) continue;
        const demoted = {...item,isDefault:false};
        const document: WorkspaceDocument<SignatureItem> = {
          id: demoted.id,
          kind: "signature",
          updatedAt: now,
          payload: demoted,
        };
        await bridge.upsertWorkspace(document);
        cloudDocuments.push(document);
      }
    }

    const document: WorkspaceDocument<SignatureItem> = {
      id: signature.id,
      kind: "signature",
      updatedAt: now,
      payload: signature,
    };
    await bridge.upsertWorkspace(document);
    cloudDocuments.push(document);

    setSignatures((current)=>{
      const normalized = current.map((item)=>{
        if (signature.isDefault && item.accountId===signature.accountId && item.id!==signature.id) {
          return {...item,isDefault:false};
        }
        return item;
      });
      return [signature,...normalized.filter((item)=>item.id!==signature.id)];
    });

    for (const item of cloudDocuments) {
      void pushCloudDocument(item).catch(() => undefined);
    }
  }

  async function deleteSignature(signature: SignatureItem) {
    if (!window.confirm(`Excluir a assinatura "${signature.name}"?`)) return;
    const tombstone = await bridge.deleteWorkspace("signature",signature.id);
    setSignatures((current)=>current.filter((item)=>item.id!==signature.id));
    void pushCloudDocument(tombstone).catch(() => undefined);
  }

  async function saveCurrentSearch() {
    const query = search.trim();
    if (!query) return;
    const name = window.prompt("Nome da pesquisa salva",query)?.trim();
    if (!name) return;

    const existing = savedSearches.find((item)=>item.query===query);
    const item: SavedSearchItem = existing
      ? {...existing,name}
      : {id:crypto.randomUUID(),name,query};
    const document: WorkspaceDocument<SavedSearchItem> = {
      id:item.id,
      kind:"saved-search",
      updatedAt:new Date().toISOString(),
      payload:item,
    };
    await bridge.upsertWorkspace(document);
    setSavedSearches((current)=>[item,...current.filter((value)=>value.id!==item.id)]);
    void pushCloudDocument(document).catch(() => undefined);
  }

  async function deleteSavedSearch(item: SavedSearchItem) {
    const tombstone = await bridge.deleteWorkspace("saved-search",item.id);
    setSavedSearches((current)=>current.filter((value)=>value.id!==item.id));
    void pushCloudDocument(tombstone).catch(() => undefined);
  }

  async function refreshDrafts() {
    const documents = await bridge.listWorkspace<ComposeDraft>("draft").catch(() => []);
    setLocalDrafts(documents.map((document)=>document.payload));
  }

  function startNewMessage() {
    setDraftToOpen(undefined);
    setComposeOpen(true);
  }

  function openDraft(draft: ComposeDraft) {
    setDraftToOpen(draft);
    setComposeOpen(true);
  }

  function composeFromMessage(message: MailMessage, mode: "reply" | "replyAll" | "forward") {
    const originalText = message.bodyText?.trim() || message.preview.trim();
    const quoted = originalText
      ? originalText.split("\n").map((line)=>`> ${line}`).join("\n")
      : ">";
    const signature = signatures.find((item)=>item.accountId===message.accountId&&item.isDefault)
      ?? signatures.find((item)=>item.accountId===message.accountId);
    const signatureText = signature?.bodyText.trim() ?? "";

    const draft: ComposeDraft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      to: mode==="forward" ? "" : message.from.email,
      cc: mode==="replyAll"
        ? message.to
            .map((recipient)=>recipient.email)
            .filter((email)=>email.toLocaleLowerCase("pt-BR")!==message.from.email.toLocaleLowerCase("pt-BR")&&email.toLocaleLowerCase("pt-BR")!==(accounts.find((account)=>account.id===message.accountId)?.email??"").toLocaleLowerCase("pt-BR"))
            .join(", ")
        : "",
      bcc: "",
      subject: mode!=="forward"
        ? (/^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject || "(sem assunto)"}`)
        : (/^(enc|fw|fwd):/i.test(message.subject) ? message.subject : `Enc: ${message.subject || "(sem assunto)"}`),
      bodyText: `${signatureText ? `\n\n${signatureText}` : ""}\n\nEm ${new Date(message.receivedAt).toLocaleString()}, ${message.from.name || message.from.email} escreveu:\n${quoted}`,
      bodyHtml: "",
      mode: "plain",
      attachments: [],
    };

    setDraftToOpen(draft);
    setComposeOpen(true);
  }

  async function forwardAsAttachment(message: MailMessage) {
    const id=crypto.randomUUID();
    try{
      const attachment=await bridge.stageMessageAsEml(id,message.accountId,message.id,safeExportName(message.subject,"mensagem"));
      const signature=signatures.find((item)=>item.accountId===message.accountId&&item.isDefault)
        ?? signatures.find((item)=>item.accountId===message.accountId);
      const draft:ComposeDraft={
        id,
        accountId:message.accountId,
        to:"",
        cc:"",
        bcc:"",
        subject:/^(enc|fw|fwd):/i.test(message.subject)?message.subject:`Enc: ${message.subject||"(sem assunto)"}`,
        bodyText:signature?.bodyText.trim()?signature.bodyText.trim():"",
        bodyHtml:"",
        mode:"plain",
        attachments:[attachment],
      };
      setDraftToOpen(draft);
      setComposeOpen(true);
    }catch(reason){
      window.alert(reason instanceof Error?reason.message:String(reason));
    }
  }

  async function resendMessage(message: MailMessage) {
    const id=crypto.randomUUID();
    let attachments:ComposeDraft["attachments"]=[];
    if(message.hasAttachments){
      attachments=await bridge.stageMessageAttachments(id,message.accountId,message.id).catch(()=>[]);
    }
    const account=accounts.find((item)=>item.id===message.accountId);
    const own=(account?.email??"").toLocaleLowerCase("pt-BR");
    const recipients=message.to.map((item)=>item.email).filter((email)=>email.toLocaleLowerCase("pt-BR")!==own);
    const draft:ComposeDraft={
      id,
      accountId:message.accountId,
      fromAddress:account?.email,
      to:recipients.join(", "),
      cc:"",
      bcc:"",
      subject:message.subject,
      bodyText:message.bodyText??message.preview,
      bodyHtml:message.bodyHtml??"",
      mode:message.bodyHtml?.trim()?"rich":"plain",
      attachments,
      priority:message.importance??"normal",
    };
    setDraftToOpen(draft);
    setComposeOpen(true);
  }

  async function openRelatedMessage(messageId: string) {
    const cached = await bridge.listCachedMessages();
    const message = cached.find((item)=>item.id===messageId);
    if (!message) return;

    setActiveId(message.accountId);
    setSearch("");
    setFocusMessageId(message.id);
    setSection("mail");
  }

  async function importEmlPath(path:string) {
    const account = activeAccount ?? profileAccounts.find((item)=>item.isDefault) ?? profileAccounts[0];
    if (!account) {
      setAccountOpen(true);
      window.alert("Adicione uma conta antes de abrir um arquivo EML.");
      return;
    }
    const imported = await bridge.importEml(account.id,path);
    setMessages((current)=>[imported,...current.filter((item)=>item.id!==imported.id)]);
    setSelectedFolder(FALLBACK_FOLDERS[0]);
    setFocusMessageId(imported.id);
    setSection("mail");
  }

  async function importEml() {
    const selected = await open({
      multiple:false,
      directory:false,
      filters:[{name:"Mensagem EML",extensions:["eml"]}],
    });
    if (!selected || Array.isArray(selected)) return;
    await importEmlPath(selected);
  }

  async function syncLdapForAccount(account:AccountProfile) {
    if(!account.ldapUrl?.trim()) return;
    const entries=await bridge.syncLdap(account.id);
    const now=new Date().toISOString();
    for(const entry of entries){
      const payload:ContactItem={
        id:entry.id,
        displayName:entry.displayName,
        email:entry.email,
        phone:entry.phone,
        company:entry.company,
        jobTitle:entry.jobTitle,
        notes:`LDAP: ${entry.dn}`,
        favorite:false,
        categories:["LDAP"],
      };
      const document:WorkspaceDocument<ContactItem>={id:payload.id,kind:"contact",updatedAt:now,payload};
      await bridge.upsertWorkspace(document);
      void pushCloudDocument(document).catch(()=>undefined);
    }
  }

  async function syncDavForAccount(account:AccountProfile) {
    if(!account.caldavUrl?.trim()&&!account.carddavUrl?.trim()) return;
    const result=await bridge.syncDav(account.id);
    const now=new Date().toISOString();

    if(result.calendarObjects.length){
      const calendarId=`dav-${account.id}`;
      const calendar:CalendarListItem={
        id:calendarId,
        name:`${account.displayName} · DAV`,
        color:account.color,
        accountId:account.id,
        visible:true,
      };
      await bridge.upsertWorkspace({id:calendar.id,kind:"calendar-list",updatedAt:now,payload:calendar});

      for(const raw of result.calendarObjects){
        for(const event of eventsFromIcs(raw)){
          const payload:CalendarEvent={...event,calendarId,accountId:account.id,color:event.color||account.color};
          const document:WorkspaceDocument<CalendarEvent>={id:payload.id,kind:"calendar",updatedAt:now,payload};
          await bridge.upsertWorkspace(document);
          void pushCloudDocument(document).catch(()=>undefined);
        }
      }
    }

    for(const raw of result.contactObjects){
      for(const contact of contactsFromVcard(raw)){
        const payload:ContactItem={...contact};
        const document:WorkspaceDocument<ContactItem>={id:payload.id,kind:"contact",updatedAt:now,payload};
        await bridge.upsertWorkspace(document);
        void pushCloudDocument(document).catch(()=>undefined);
      }
    }
  }

  async function importIcsPath(path:string) {
    const raw=await bridge.readTextFile(path);
    const events=eventsFromIcs(raw);
    if(events.length===0){
      window.alert("Nenhum evento válido foi encontrado no arquivo ICS.");
      return;
    }
    for(const event of events){
      const document:WorkspaceDocument<CalendarEvent>={
        id:event.id,
        kind:"calendar",
        updatedAt:new Date().toISOString(),
        payload:event,
      };
      await bridge.upsertWorkspace(document);
      void pushCloudDocument(document).catch(()=>undefined);
    }
    setSection("calendar");
  }

  function mailtoDraft(value:string):ComposeDraft {
    const url=new URL(value);
    const to=decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return {
      id:crypto.randomUUID(),
      accountId:(activeAccount ?? profileAccounts.find((item)=>item.isDefault) ?? profileAccounts[0])?.id,
      to,
      cc:url.searchParams.get("cc")??"",
      bcc:url.searchParams.get("bcc")??"",
      subject:url.searchParams.get("subject")??"",
      bodyText:url.searchParams.get("body")??"",
      bodyHtml:"",
      mode:"plain",
      attachments:[],
    };
  }

  function normalizeExternalPath(value:string):string {
    const trimmed=value.trim().replace(/^["']|["']$/g,"");
    if(!/^file:/i.test(trimmed)) return trimmed;
    try{
      const url=new URL(trimmed);
      let path=decodeURIComponent(url.pathname);
      if(/^\/[A-Za-z]:\//.test(path)) path=path.slice(1);
      return path;
    }catch{
      return trimmed;
    }
  }

  async function handleExternalOpen(value:string) {
    const request=value.trim();
    if(!request) return;

    if(/^seven-mail:\/\/oauth\/callback/i.test(request)){
      const url=new URL(request);
      const error=url.searchParams.get("error");
      if(error){
        window.alert(`OAuth recusado pelo provedor: ${error}`);
        return;
      }
      const code=url.searchParams.get("code");
      const state=url.searchParams.get("state");
      if(!code||!state){
        window.alert("Callback OAuth inválido: código ou estado ausente.");
        return;
      }
      const pending=takePendingOAuth(state);
      if(!pending){
        window.alert("A sessão OAuth expirou ou não corresponde à autorização iniciada.");
        return;
      }
      await bridge.oauthExchangeCode(pending.accountId,code,pending.verifier,pending.redirectUri);
      window.dispatchEvent(new Event("seven-mail:oauth-authorized"));
      window.alert("Conta autorizada por OAuth com sucesso.");
      return;
    }

    if(/^mailto:/i.test(request)){
      if(profileAccounts.length===0){
        setAccountOpen(true);
        return;
      }
      setDraftToOpen(mailtoDraft(request));
      setComposeOpen(true);
      return;
    }

    const path=normalizeExternalPath(request);
    if(/\.eml$/i.test(path)){
      await importEmlPath(path);
    }else if(/\.ics$/i.test(path)){
      await importIcsPath(path);
    }
  }

  async function exportEml(message: MailMessage) {
    const destination = await saveDialog({
      defaultPath:`${safeExportName(message.subject,"mensagem")}.eml`,
      filters:[{name:"Mensagem EML",extensions:["eml"]}],
    });
    if (!destination) return;
    await bridge.writeTextFile(destination,messageToEml(message));
  }

  async function createEventFromMessage(message: MailMessage) {
    const start = new Date(Date.now()+60*60*1000);
    const end = new Date(start.getTime()+60*60*1000);
    const event: CalendarEvent = {
      id:crypto.randomUUID(),
      title:message.subject || "Evento a partir de e-mail",
      description:`Criado a partir de e-mail de ${message.from.name || message.from.email}.\n\n${message.preview}`,
      location:"",
      startAt:start.toISOString(),
      endAt:end.toISOString(),
      allDay:false,
      color:"#3d83f6",
      participants:[message.from.email],
    };
    const document: WorkspaceDocument<CalendarEvent> = {
      id:event.id,
      kind:"calendar",
      updatedAt:new Date().toISOString(),
      payload:event,
    };
    await bridge.upsertWorkspace(document);
    void pushCloudDocument(document).catch(() => undefined);
    setSection("calendar");
  }

  async function createTaskFromMessage(message: MailMessage, navigate = true) {
    const existing = await bridge.listWorkspace<TaskItem>("task").catch(() => []);
    const duplicate = existing.find((document)=>document.payload.relatedMessageId===message.id);
    if (duplicate) {
      if(navigate) setSection("tasks");
      return;
    }

    const task: TaskItem = {
      id: crypto.randomUUID(),
      title: message.subject.trim() || `Responder ${message.from.name || message.from.email}`,
      notes: `E-mail de ${message.from.name || message.from.email} <${message.from.email}>\n\n${message.preview}`,
      priority: message.isFlagged ? "high" : "normal",
      listName: "E-mails",
      relatedMessageId: message.id,
    };
    const document: WorkspaceDocument<TaskItem> = {
      id: task.id,
      kind: "task",
      updatedAt: new Date().toISOString(),
      payload: task,
    };

    await bridge.upsertWorkspace(document);
    void pushCloudDocument(document).catch(() => undefined);
    if(navigate) setSection("tasks");
  }

  function closeComposer() {
    setComposeOpen(false);
    setDraftToOpen(undefined);
    void refreshDrafts();
  }


  useEffect(()=>{
    if(!bootState.accounts || externalOpenInitialized.current) return;
    externalOpenInitialized.current=true;
    let disposed=false;
    let unlistenDesktop:(()=>void)|undefined;
    let unlistenDeep:(()=>void)|undefined;

    const register=async()=>{
      const initial=await bridge.initialOpenRequests().catch(()=>[]);
      for(const request of initial){
        if(disposed) return;
        await handleExternalOpen(request).catch(console.error);
      }

      const current=await getCurrent().catch(()=>null);
      for(const request of current??[]){
        if(disposed) return;
        await handleExternalOpen(request).catch(console.error);
      }

      unlistenDesktop=await listen<string[]>("seven-mail:desktop-open",(event)=>{
        for(const request of event.payload){
          void handleExternalOpen(request).catch(console.error);
        }
      });

      unlistenDeep=await onOpenUrl((urls)=>{
        for(const request of urls){
          void handleExternalOpen(request).catch(console.error);
        }
      });
    };

    void register();
    return ()=>{
      disposed=true;
      unlistenDesktop?.();
      unlistenDeep?.();
    };
  },[bootState.accounts]);

  useEffect(()=>{
    let disposed = false;

    void bridge.runtimeInfo()
      .then((info)=>{ if (!disposed) setRuntime(info); })
      .catch(console.error)
      .finally(()=>{
        if (!disposed) setBootState((current)=>({...current,runtime:true}));
      });

    const loadAccounts = async (initial = false) => {
      const local = await bridge.listAccounts().catch(() => [] as AccountProfile[]);

      if (!disposed) {
        setAccounts(local);
        setActiveId((current) => current || local.find((account) => account.isDefault)?.id || local[0]?.id);
        if (initial) setBootState((current)=>({...current,accounts:true}));
      }

      const merged = new Map(local.map((account) => [account.id, account]));
      try {
        const cloud = await pullCloudAccounts();
        for (const account of cloud) {
          if (!merged.has(account.id)) {
            await bridge.saveAccount(account);
            merged.set(account.id, account);
          }
        }
        void pushCloudAccounts(local).catch(() => undefined);
      } catch {
        // Offline or signed out: local account metadata remains available.
      }

      if (!disposed) {
        const list = [...merged.values()];
        setAccounts(list);
        setActiveId((current) => current || list.find((account) => account.isDefault)?.id || list[0]?.id);
      }
    };

    void loadAccounts(true);
    const onCloudSession = () => void loadAccounts(false);
    window.addEventListener("seven-mail:cloud-session", onCloudSession);
    return () => {
      disposed = true;
      window.removeEventListener("seven-mail:cloud-session", onCloudSession);
    };
  },[]);

  useEffect(()=>{
    let disposed = false;

    const loadInitialWorkspace = async () => {
      const [categoryDocs,searchDocs,signatureDocs,profileDocs] = await Promise.all([
        bridge.listWorkspace<CategoryItem>("category").catch(() => []),
        bridge.listWorkspace<SavedSearchItem>("saved-search").catch(() => []),
        bridge.listWorkspace<SignatureItem>("signature").catch(() => []),
        bridge.listWorkspace<ProfileItem>("profile").catch(() => []),
      ]);

      if (!disposed) {
        const nextProfiles=profileDocs.map((document)=>document.payload);
        setCategories(categoryDocs.map((document)=>document.payload));
        setSavedSearches(searchDocs.map((document)=>document.payload));
        setSignatures(signatureDocs.map((document)=>document.payload));
        setProfiles(nextProfiles);
        setActiveProfileId((current)=>current||nextProfiles.find((profile)=>profile.isDefault)?.id);
        setBootState((current)=>({...current,workspace:true}));
      }

      void refreshMailOrganization();
    };

    void loadInitialWorkspace();
    const onCloudSession = () => void refreshMailOrganization();
    window.addEventListener("seven-mail:cloud-session",onCloudSession);
    return ()=>{
      disposed = true;
      window.removeEventListener("seven-mail:cloud-session",onCloudSession);
    };
  },[]);

  useEffect(()=>{
    if (!bootState.accounts) return;

    if (accounts.length===0) {
      setMessages([]);
      setBootState((current)=>({...current,messages:true}));
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      const local = await bridge.listCachedMessages(unified ? undefined : activeAccount?.id).catch(() => [] as MailMessage[]);
      const sortedLocal = [...local].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));

      if (!cancelled) {
        setMessages(sortedLocal);
        setBootState((current)=>({...current,messages:true}));
      }

      const merged = new Map(local.map((message) => [message.id, message]));
      try {
        const targets = unified ? profileAccounts : (activeAccount ? [activeAccount] : []);
        for (const account of targets) {
          const cloud = await pullCloudMessages(account.id);
          for (const message of cloud) {
            if (!merged.has(message.id)) {
              await bridge.cacheMessage(message);
              merged.set(message.id, message);
            }
          }
        }
        void pushCloudMessages(local).catch(() => undefined);
      } catch {
        // Offline or signed out: keep using the APPDATA cache.
      }

      if (!cancelled) {
        setMessages([...merged.values()].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)));
      }
    };

    void loadMessages();
    const onCloudSession = () => void loadMessages();
    window.addEventListener("seven-mail:cloud-session", onCloudSession);
    return () => {
      cancelled = true;
      window.removeEventListener("seven-mail:cloud-session", onCloudSession);
    };
  },[activeAccount?.id,unified,accounts.length,bootState.accounts]);

  useEffect(()=>{
    if (unified || !activeAccount) {
      setMailFolders(FALLBACK_FOLDERS);
      setSelectedFolder(FALLBACK_FOLDERS[0]);
      return;
    }

    let cancelled = false;
    bridge.listFolders(activeAccount.id)
      .then((folders)=>{
        if (cancelled || folders.length===0) return;
        setMailFolders(folders);
        setSelectedFolder(folders.find((item)=>item.role==="inbox") ?? folders[0]);
      })
      .catch(()=>undefined);

    return ()=>{cancelled=true;};
  },[activeAccount?.id,unified]);

  useEffect(()=>{
    if (selectedFolder.role==="drafts") {
      void refreshDrafts();
    }
  },[selectedFolder.role]);

  useEffect(()=>{
    let disposed=false;
    void bridge.hasAppLock().then((enabled)=>{
      if(disposed) return;
      setLockConfigured(enabled);
      setAppLocked(enabled);
      setSettings((current)=>({...current,appLockEnabled:enabled}));
    }).catch(()=>undefined);
    const changed=(event:Event)=>{
      const enabled=Boolean((event as CustomEvent<boolean>).detail);
      setLockConfigured(enabled);
      if(!enabled) setAppLocked(false);
    };
    window.addEventListener("seven-mail:app-lock-changed",changed);
    return ()=>{
      disposed=true;
      window.removeEventListener("seven-mail:app-lock-changed",changed);
    };
  },[]);

  useEffect(()=>{
    if(!lockConfigured||appLocked) return;
    const minutes=settings.appLockMinutes??5;
    if(minutes<=0) return;
    let timer=0;
    const arm=()=>{
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>setAppLocked(true),minutes*60_000);
    };
    const events=["pointerdown","keydown","wheel","touchstart"] as const;
    for(const event of events) window.addEventListener(event,arm,{passive:true});
    arm();
    return ()=>{
      window.clearTimeout(timer);
      for(const event of events) window.removeEventListener(event,arm);
    };
  },[lockConfigured,appLocked,settings.appLockMinutes]);

  useEffect(()=>{
    const days=settings.localRetentionDays??90;
    if(days===0) return;
    const timer=window.setTimeout(()=>{
      void bridge.pruneMessageCache(days).then(async(removed)=>{
        if(removed>0){
          setMessages(await bridge.listCachedMessages(unified?undefined:activeAccount?.id));
        }
      }).catch(()=>undefined);
    },700);
    return ()=>window.clearTimeout(timer);
  },[settings.localRetentionDays,activeAccount?.id,unified]);

  useEffect(()=>{
    localStorage.setItem("seven-mail:settings",JSON.stringify(settings));
    const root=document.documentElement;
    const theme = settings.theme==="system" ? (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light") : settings.theme;
    root.dataset.theme=theme;
    root.dataset.density=settings.compact?"compact":"comfortable";
    root.dataset.contrast=settings.highContrast?"high":"normal";
    root.dataset.motion=settings.reduceMotion?"reduce":"full";
    root.dataset.fontSize=settings.fontSize??"medium";
    const fontScale=settings.fontSize==="small"?0.94:settings.fontSize==="large"?1.08:1;
    root.style.setProperty("--ui-scale",String((settings.uiScale??1)*fontScale));
  },[settings]);

  useEffect(()=>{
    localStorage.setItem("seven-mail:search-history",JSON.stringify(searchHistory.slice(0,20)));
  },[searchHistory]);

  useEffect(()=>{
    const query=search.trim();
    if(!query){
      setWorkspaceSearchResults([]);
      return;
    }
    const timer=window.setTimeout(()=>{
      void bridge.searchWorkspace(query)
        .then((documents)=>setWorkspaceSearchResults(documents.slice(0,12)))
        .catch(()=>setWorkspaceSearchResults([]));
    },180);
    return ()=>window.clearTimeout(timer);
  },[search]);

  useEffect(()=>{
    const closeToTray=(settings.closeBehavior??(settings.minimizeToTray?"tray":"exit"))==="tray";
    void bridge.setCloseToTray(closeToTray).catch(() => undefined);
  },[settings.minimizeToTray,settings.closeBehavior]);

  useEffect(()=>{
    const update = settings.startWithSystem ? enableAutostart : disableAutostart;
    void update().catch(() => undefined);
  },[settings.startWithSystem]);

  useEffect(()=>{
    if (!settings.notificationsEnabled) return;
    void ensureNotificationPermission().then((granted)=>{
      if (!granted) {
        setSettings((current)=>({...current,notificationsEnabled:false}));
      }
    });
  },[settings.notificationsEnabled]);

  useEffect(()=>{
    if (!settings.notificationsEnabled) return;

    let disposed = false;
    const checkReminders = async () => {
      const now = Date.now();
      const [taskDocuments,eventDocuments] = await Promise.all([
        bridge.listWorkspace<TaskItem>("task").catch(() => []),
        bridge.listWorkspace<CalendarEvent>("calendar").catch(() => []),
      ]);

      for (const document of taskDocuments) {
        if (disposed) return;
        const task = document.payload;
        if (task.completedAt || !task.reminderAt || task.reminderNotifiedAt) continue;

        const reminderAt = new Date(task.reminderAt).getTime();
        if (!Number.isFinite(reminderAt) || reminderAt > now) continue;

        if (notificationsMutedNow(settings)) continue;
        await notifyTaskReminder(task);
        const updated: TaskItem = { ...task, reminderNotifiedAt: new Date().toISOString() };
        const nextDocument: WorkspaceDocument<TaskItem> = {
          ...document,
          updatedAt: new Date().toISOString(),
          payload: updated,
        };
        await bridge.upsertWorkspace(nextDocument);
        void pushCloudDocument(nextDocument).catch(() => undefined);
      }

      for (const document of eventDocuments) {
        if (disposed) return;
        const event = document.payload;
        if (!event.reminderAt || event.reminderNotifiedAt) continue;

        const reminderAt = new Date(event.reminderAt).getTime();
        if (!Number.isFinite(reminderAt) || reminderAt > now) continue;

        if (notificationsMutedNow(settings)) continue;
        await notifyCalendarReminder(event);
        const updated: CalendarEvent = { ...event, reminderNotifiedAt: new Date().toISOString() };
        const nextDocument: WorkspaceDocument<CalendarEvent> = {
          ...document,
          updatedAt: new Date().toISOString(),
          payload: updated,
        };
        await bridge.upsertWorkspace(nextDocument);
        void pushCloudDocument(nextDocument).catch(() => undefined);
      }
    };

    void checkReminders();
    const timer = window.setInterval(()=>void checkReminders(),30_000);
    return ()=>{
      disposed=true;
      window.clearInterval(timer);
    };
  },[settings.notificationsEnabled]);

  useEffect(()=>{
    const flush = () => {
      if (!navigator.onLine) return;
      void bridge.flushOutbox().catch(() => undefined);
      for (const account of profileAccounts) {
        if (account.muted) continue;
        void bridge.flushMailActions(account.id).catch(() => undefined);
      }
    };

    flush();
    const timer = window.setInterval(flush, 15_000);
    window.addEventListener("online", flush);
    return ()=>{
      window.clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  },[profileAccounts]);

  useEffect(()=>{
    if (profileAccounts.length===0) return;

    let disposed = false;
    const run = async () => {
      if (!navigator.onLine || disposed) return;

      const targets=profileAccounts.filter((account)=>!account.muted);
      await forEachConcurrent(targets,settings.maxConcurrentSyncs??2,async(account)=>{
        if(disposed) return;
        try {
          const before = await bridge.listCachedMessages(account.id);
          const known = new Set(before.map((message)=>message.id));

          await bridge.syncFolder(account.id,"INBOX","Caixa de entrada",settings.memorySaverEnabled?25:50);
          const synced = await bridge.listCachedMessages(account.id);
          await applySenderPolicies(synced);
          const policyApplied = await bridge.listCachedMessages(account.id);
          await executeRules(policyApplied.filter((message)=>message.folder==="Caixa de entrada"));
          const after = await bridge.listCachedMessages(account.id);
          const fresh = before.length===0
            ? []
            : after.filter((message)=>message.folder==="Caixa de entrada"&&!known.has(message.id));

          await applyFreshAutomations(fresh,account);
          await Promise.all([
            syncDavForAccount(account).catch(()=>undefined),
            syncLdapForAccount(account).catch(()=>undefined),
          ]);

          if (!disposed && activeAccount?.id===account.id) {
            setMessages(after);
          }
          if (fresh.length>0 && settings.notificationsEnabled && !notificationsMutedNow(settings)) {
            void notifyNewMessages(fresh.filter((message)=>!message.isMuted));
          }
          void pushCloudMessages(after).catch(() => undefined);
        } catch {
          // A conta pode estar offline, sem credencial ou exigir nova autenticação.
        }
      });

      if (!disposed && unified) {
        const unifiedMessages = await bridge.listCachedMessages().catch(() => [] as MailMessage[]);
        if (!disposed) setMessages(unifiedMessages);
      }
    };

    const intervalMs = settings.syncIntervalMinutes * 60_000 * (settings.batterySaverEnabled ? 2 : 1);
    const timer = window.setInterval(()=>void run(),intervalMs);
    const online = () => void run();
    window.addEventListener("online",online);
    return ()=>{
      disposed=true;
      window.clearInterval(timer);
      window.removeEventListener("online",online);
    };
  },[profileAccounts,activeAccount?.id,unified,settings.notificationsEnabled,settings.syncIntervalMinutes,settings.batterySaverEnabled,settings.memorySaverEnabled,settings.maxConcurrentSyncs]);

  useEffect(()=>{
    const onKeyDown = (event: KeyboardEvent) => {
      const bindings=settings.shortcuts??DEFAULT_SETTINGS.shortcuts!;

      if (shortcutMatches(event,bindings.search)) {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".search input");
        input?.focus();
        input?.select();
        return;
      }

      if (shortcutMatches(event,bindings.newMessage) && profileAccounts.length>0) {
        event.preventDefault();
        startNewMessage();
        return;
      }

      if (event.altKey && event.key==="1") {
        event.preventDefault();
        setSection("mail");
      } else if (event.altKey && event.key==="2") {
        event.preventDefault();
        setSection("calendar");
      } else if (event.altKey && event.key==="3") {
        event.preventDefault();
        setSection("people");
      } else if (event.altKey && event.key==="4") {
        event.preventDefault();
        setSection("tasks");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return ()=>window.removeEventListener("keydown", onKeyDown);
  },[profileAccounts.length,settings.shortcuts]);

  async function applyIgnoredConversations(candidates: MailMessage[]): Promise<number> {
    const ignored=new Set(settings.ignoredConversationKeys??[]);
    if(ignored.size===0) return 0;
    let moved=0;
    for(const message of candidates){
      if(message.folder!=="Caixa de entrada"||!ignored.has(conversationKey(message.subject))) continue;
      await bridge.updateMessageMetadata(message.accountId,message.id,{isMuted:true}).catch(()=>undefined);
      await bridge.messageAction(message.accountId,message.id,"delete");
      moved+=1;
    }
    return moved;
  }

  async function ignoreConversation(message: MailMessage) {
    const key=conversationKey(message.subject);
    if(!key) return;
    setSettings((current)=>({
      ...current,
      ignoredConversationKeys:[...new Set([...(current.ignoredConversationKeys??[]),key])],
    }));
    const related=messages.filter((item)=>conversationKey(item.subject)===key&&item.folder!=="Lixeira");
    for(const item of related){
      await bridge.updateMessageMetadata(item.accountId,item.id,{isMuted:true}).catch(()=>undefined);
      await bridge.messageAction(item.accountId,item.id,"delete").catch(()=>undefined);
    }
    setMessages(await bridge.listCachedMessages(unified?undefined:activeAccount?.id));
    for(const accountId of new Set(related.map((item)=>item.accountId))){
      void bridge.flushMailActions(accountId).catch(()=>undefined);
    }
  }

  async function executeRules(candidates: MailMessage[]): Promise<number> {
    const documents = await bridge.listWorkspace<RuleItem>("rule").catch(() => []);
    const rules = documents.map((document) => document.payload);
    if (rules.length===0 || candidates.length===0) return 0;

    let actions = 0;
    const touchedAccounts = new Set<string>();

    for (const candidate of candidates) {
      let current = candidate;
      const matching = pendingRulesForMessage(rules,current);

      for (const rule of matching) {
        if (["archive","delete","spam","flag","read"].includes(rule.action)) {
          current = await bridge.messageAction(
            current.accountId,
            current.id,
            rule.action as "archive"|"delete"|"spam"|"flag"|"read",
          );
        } else if (rule.action==="move" && rule.target?.trim()) {
          current = await bridge.moveMessageToFolder(current.accountId,current.id,rule.target.trim(),rule.target.trim());
        } else if (rule.action==="copy" && rule.target?.trim()) {
          await bridge.copyMessageToFolder(current.accountId,current.id,rule.target.trim());
        } else if (rule.action==="category" && rule.target?.trim()) {
          current = {
            ...current,
            categories:[...new Set([...current.categories,rule.target.trim()])],
          };
        } else if (rule.action==="forward" && rule.target?.trim()) {
          const account=accounts.find((item)=>item.id===current.accountId);
          if(account){
            const operationId=crypto.randomUUID();
            await bridge.queueOperation({
              id:operationId,
              kind:"send",
              accountId:current.accountId,
              createdAt:new Date().toISOString(),
              attempts:0,
              payload:{
                fromAddress:account.email,
                to:rule.target.trim(),
                cc:"",
                bcc:"",
                subject:/^(enc|fw|fwd):/i.test(current.subject)?current.subject:`Enc: ${current.subject||"(sem assunto)"}`,
                bodyText:`Mensagem encaminhada automaticamente por regra.\n\nDe: ${current.from.name||current.from.email} <${current.from.email}>\nData: ${new Date(current.receivedAt).toLocaleString("pt-BR")}\nAssunto: ${current.subject}\n\n${current.bodyText||current.preview}`,
                bodyHtml:"",
                attachments:[],
                priority:"normal",
                requestReadReceipt:false,
                requestDeliveryReceipt:false,
                sendAt:new Date().toISOString(),
              },
            });
          }
        }

        current = {
          ...current,
          appliedRuleIds: [...new Set([...(current.appliedRuleIds ?? []),rule.id])],
        };
        await bridge.cacheMessage(current);
        void pushCloudMessage(current).catch(() => undefined);
        touchedAccounts.add(current.accountId);
        actions += 1;
        if (rule.stopProcessing) break;
      }
    }

    for (const accountId of touchedAccounts) {
      void bridge.flushMailActions(accountId).catch(() => undefined);
    }

    return actions;
  }

  async function runRulesNow(): Promise<number> {
    const cached = await bridge.listCachedMessages();
    const actions = await executeRules(cached);
    const refreshed = await bridge.listCachedMessages(unified ? undefined : activeAccount?.id);
    setMessages(refreshed);
    return actions;
  }

  async function syncNow() {
    if (profileAccounts.length===0 || syncState==="syncing") return;
    setSyncState("syncing");
    try {
      const targets = (unified ? profileAccounts : (activeAccount ? [activeAccount] : [])).filter((account)=>!account.muted);
      await forEachConcurrent(targets,settings.maxConcurrentSyncs??2,async(account)=>{
        await bridge.flushMailActions(account.id).catch(() => 0);
        const path = unified ? "INBOX" : selectedFolder.path;
        const label = unified ? "Caixa de entrada" : selectedFolder.name;
        await bridge.syncFolder(account.id,path,label,settings.memorySaverEnabled?25:50);
        await Promise.all([
          syncDavForAccount(account).catch(()=>undefined),
          syncLdapForAccount(account).catch(()=>undefined),
        ]);
      });
      const synced = await bridge.listCachedMessages(unified ? undefined : activeAccount?.id);
      await applySenderPolicies(synced);
      const policyApplied = await bridge.listCachedMessages(unified ? undefined : activeAccount?.id);
      await executeRules(policyApplied.filter((message)=>message.folder==="Caixa de entrada"));
      const refreshed = await bridge.listCachedMessages(unified ? undefined : activeAccount?.id);
      setMessages(refreshed);
      void pushCloudMessages(refreshed).catch(() => undefined);
      setSyncState("idle");
    } catch (reason) {
      console.error(reason);
      setSyncState("error");
    }
  }

  async function applyMessageAction(messageId:string, action:"read"|"unread"|"flag"|"unflag"|"pin"|"unpin"|"archive"|"delete"|"spam"|"inbox") {
    if (action==="delete" && settings.confirmBeforeDelete && !window.confirm("Excluir esta mensagem?")) return;
    const message = messages.find((item)=>item.id===messageId);
    const accountId = activeAccount?.id ?? message?.accountId;
    if (!accountId) return;
    const updated = await bridge.messageAction(accountId, messageId, action);
    if(action==="flag"){
      void createTaskFromMessage(updated,false).catch(()=>undefined);
    }
    setMessages(await bridge.listCachedMessages(unified ? undefined : accountId));
    void pushCloudMessage(updated).catch(() => undefined);
    void bridge.flushMailActions(accountId).catch(() => undefined);
  }

  function handleQueuedSend(info: QueuedSendInfo) {
    const dueAt = new Date(info.sendAt).getTime();
    if (info.canUndo) {
      setUndoSend({ id: info.id, expiresAt: dueAt });
    }

    const wait = Math.max(0, dueAt - Date.now() + 150);
    if (wait <= 60_000) {
      window.setTimeout(() => {
        setUndoSend((current) => current?.id === info.id ? null : current);
        void bridge.flushOutbox().catch(() => undefined);
      }, wait);
    }
  }

  async function undoQueuedSend() {
    if (!undoSend) return;
    const current = undoSend;
    setUndoSend(null);
    await bridge.cancelOperation(current.id).catch(() => false);
  }

  async function unlockApp(pin:string):Promise<boolean>{
    const valid=await bridge.verifyAppLock(pin);
    if(valid) setAppLocked(false);
    return valid;
  }

  useEffect(()=>{
    const query=search.trim();
    const hasOperators=/\b(?:from|to|subject|body|folder|category|is|has|after|before):/i.test(query);
    if(!query||hasOperators){
      setIndexedMessageIds(null);
      return;
    }
    let disposed=false;
    const timer=window.setTimeout(()=>{
      void bridge.searchCachedMessageIds(query,unified?undefined:activeAccount?.id)
        .then((ids)=>{if(!disposed)setIndexedMessageIds(ids);})
        .catch(()=>{if(!disposed)setIndexedMessageIds(null);});
    },120);
    return ()=>{disposed=true;window.clearTimeout(timer);};
  },[search,unified,activeAccount?.id,messages.length]);

  const filtered = useMemo(()=>{
    const query=search.trim();
    if(!query) return messages;
    const hasOperators=/\b(?:from|to|subject|body|folder|category|is|has|after|before):/i.test(query);
    if(!hasOperators&&indexedMessageIds){
      const indexed=new Set(indexedMessageIds);
      return messages.filter((message)=>indexed.has(message.id));
    }
    return messages.filter((message)=>matchesMailQuery(message,search));
  },[messages,search,indexedMessageIds]);

  const searchSuggestions=useMemo(()=>{
    const values=[
      ...searchHistory,
      ...messages.slice(0,80).flatMap((message)=>[message.from.email,message.from.name??"",message.subject]),
    ].map((value)=>value.trim()).filter(Boolean);
    return [...new Set(values)].slice(0,40);
  },[searchHistory,messages]);

  const workspaceSection=(kind:WorkspaceKind):AppSection=>{
    if(kind==="calendar") return "calendar";
    if(kind==="contact") return "people";
    if(kind==="task") return "tasks";
    if(kind==="note") return "notes";
    if(kind==="rule") return "rules";
    return "settings";
  };

  function commitSearchHistory(){
    const query=search.trim();
    if(!query) return;
    setSearchHistory((current)=>[query,...current.filter((value)=>value!==query)].slice(0,20));
  }

  function clearSearchHistory(){
    setSearchHistory([]);
  }

  return <><LaunchScreen ready={bootReady}/>{appLocked&&<AppLockScreen onUnlock={unlockApp}/>}<div className="app-shell">
    <aside className="nav-rail">
      <div className="rail-brand"><BrandLogo variant="rail"/></div>
      <nav>{navItems.map(item=><button key={item.id} className={section===item.id?"nav-item active":"nav-item"} title={item.label} onClick={()=>setSection(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <button className="profile" onClick={()=>setAccountOpen(true)}>{activeAccount?activeAccount.displayName[0].toUpperCase():<Icon name="userplus" size={17}/>}</button>
    </aside>
    <main className="main">
      <header className="topbar" data-tauri-drag-region>
        <div className="product"><strong>Seven Mail</strong><span>{NAV.find(n=>n.id===section)?.label}</span></div>
        {section==="mail"&&profileAccounts.length>0&&<select className="account-switcher" value={unified?"__all__":(activeAccount?.id??"")} onChange={e=>setActiveId(e.target.value)} aria-label="Selecionar conta"><option value="__all__">Todas as contas</option>{profileAccounts.map(account=><option key={account.id} value={account.id}>{account.email}</option>)}</select>}
        <label className="search"><Icon name="search" size={17}/><input list="seven-mail-search-suggestions" value={search} onFocus={()=>setGlobalSearchOpen(true)} onChange={e=>{setSearch(e.target.value);setGlobalSearchOpen(true);}} onKeyDown={e=>{if(e.key==="Enter"){commitSearchHistory();setGlobalSearchOpen(true);}else if(e.key==="Escape"){setGlobalSearchOpen(false);}}} placeholder="Pesquisar em todo o Seven Mail..."/><kbd>Ctrl K</kbd></label><datalist id="seven-mail-search-suggestions">{searchSuggestions.map((value)=><option value={value} key={value}/>)}</datalist>{section==="mail"&&search.trim()&&<button className="icon-button save-search-button" title="Salvar pesquisa" aria-label="Salvar pesquisa" onClick={()=>void saveCurrentSearch()}><Icon name="star" size={17}/></button>}
        <div className="top-actions">{lockConfigured&&<button className="icon-button" title="Bloquear agora" onClick={()=>setAppLocked(true)}><Icon name="lock" size={17}/></button>}<span className={"sync "+syncState}><i/> {syncState==="syncing"?"Sincronizando":syncState==="error"?"Erro de sincronização":"Sincronizado"}</span><button className="icon-button" onClick={()=>setSection("settings")}><Icon name="settings" size={18}/></button></div>
        {globalSearchOpen&&search.trim()&&<div className="global-search-popover">
          <header><span><Icon name="search" size={15}/><b>Pesquisa global</b></span><button onClick={()=>setGlobalSearchOpen(false)}><Icon name="x" size={13}/></button></header>
          <div className="global-search-group"><small>E-MAILS</small>{filtered.slice(0,6).map((message)=><button key={message.id} onClick={()=>{setActiveId(message.accountId);setFocusMessageId(message.id);setSection("mail");setGlobalSearchOpen(false);commitSearchHistory();}}><Icon name="mail" size={14}/><span><b>{message.subject||"(sem assunto)"}</b><small>{message.from.name||message.from.email}</small></span></button>)}{filtered.length===0&&<em>Nenhum e-mail encontrado.</em>}</div>
          <div className="global-search-group"><small>WORKSPACE</small>{workspaceSearchResults.slice(0,8).map((document)=><button key={`${document.kind}-${document.id}`} onClick={()=>{setSection(workspaceSection(document.kind));setGlobalSearchOpen(false);commitSearchHistory();}}><Icon name={document.kind==="calendar"?"calendar":document.kind==="contact"?"people":document.kind==="task"?"check":document.kind==="note"?"note":"settings"} size={14}/><span><b>{String((document.payload as Record<string,unknown>).title??(document.payload as Record<string,unknown>).displayName??(document.payload as Record<string,unknown>).name??document.kind)}</b><small>{document.kind}</small></span></button>)}{workspaceSearchResults.length===0&&<em>Nenhum item encontrado.</em>}</div>
          {searchHistory.length>0&&<footer><span>Histórico: {searchHistory.slice(0,4).join(" · ")}</span><button onClick={clearSearchHistory}>Limpar histórico</button></footer>}
        </div>}
      </header>
      <div className="content">
        {section==="mail"&&<MailView accounts={profileAccounts} messages={filtered} activeAccount={activeAccount} folders={mailFolders} folder={selectedFolder} localDrafts={localDrafts} categories={categories} savedSearches={savedSearches} onOpenDraft={openDraft} onComposeFromMessage={composeFromMessage} onForwardAsAttachment={(message)=>void forwardAsAttachment(message)} onResendMessage={(message)=>void resendMessage(message)} onCreateTaskFromMessage={(message)=>void createTaskFromMessage(message)} onCreateEventFromMessage={(message)=>void createEventFromMessage(message)} onImportEml={activeAccount?()=>void importEml():undefined} onExportEml={(message)=>void exportEml(message)} onCreateCategory={()=>void createCategory()} onEditCategory={(category)=>void editCategory(category)} onDeleteCategory={(category)=>void deleteCategory(category)} onToggleCategory={(message,category)=>void toggleMessageCategory(message,category)} onToggleCategoryFavorite={(category)=>void toggleCategoryFavorite(category)} onUseSavedSearch={(item)=>setSearch(item.query)} onDeleteSavedSearch={(item)=>void deleteSavedSearch(item)} onCreateFolder={activeAccount?()=>void createCustomFolder():undefined} onCreateSubfolder={activeAccount?(folder)=>void createCustomFolder(folder):undefined} onRenameFolder={activeAccount?(folder)=>void renameCustomFolder(folder):undefined} onDeleteFolder={activeAccount?(folder)=>void deleteCustomFolder(folder):undefined} onMoveToFolder={activeAccount?(message,folder)=>void moveToFolder(message,folder):undefined} onCopyToFolder={activeAccount?(message,folder)=>void copyToFolder(message,folder):undefined} onToggleFolderFavorite={activeAccount?(folder)=>void toggleFolderFavorite(folder):undefined} onReorderFolder={activeAccount?(folder,direction)=>reorderFolder(folder,direction):undefined} onUpdateMetadata={(message,metadata)=>void updateMessageMetadata(message,metadata)} onIgnoreConversation={(message)=>void ignoreConversation(message)} onSetSenderCleanup={setSenderCleanup} onAllowRemoteContent={(sender)=>setSettings((current)=>({...current,remoteContentAllowedSenders:[...new Set([...(current.remoteContentAllowedSenders??[]),sender.toLocaleLowerCase("pt-BR")])]}))} onBlockSender={(email)=>addPolicy("blockedSenders",email)} onTrustSender={(email)=>addPolicy("trustedSenders",email)} onReleaseSender={releaseSender} focusMessageId={focusMessageId} onFolderChange={(next)=>{setSelectedFolder(next);if(activeAccount){queueMicrotask(()=>void bridge.syncFolder(activeAccount.id,next.path,next.name,50).then(()=>bridge.listCachedMessages(activeAccount.id)).then(setMessages).catch(()=>undefined));}}} onCompose={startNewMessage} onAdd={()=>setAccountOpen(true)} onRefresh={()=>void syncNow()} onMessageAction={applyMessageAction} syncing={syncState==="syncing"} settings={{...settings,mailPageSize:settings.memorySaverEnabled?25:(settings.mailPageSize??50)}}/>} 
        {section==="calendar"&&<PersistentCalendarView accounts={profileAccounts} settings={settings}/>} 
        {section==="people"&&<PersistentPeopleView query={search}/>}
        {section==="tasks"&&<PersistentTasksView onOpenRelatedMessage={(messageId)=>void openRelatedMessage(messageId)}/>} 
        {section==="notes"&&<PersistentNotesView query={search}/>}
        {section==="rules"&&<PersistentRulesView onRunRules={runRulesNow}/>} 
        {section==="settings"&&<SettingsView settings={settings} onChange={setSettings} runtime={runtime} accounts={accounts} onAccountsChange={(next)=>{setAccounts(next);if(!next.some((account)=>account.id===activeId)){setActiveId(next.find((account)=>account.isDefault)?.id??next[0]?.id);}}} signatures={signatures} onSaveSignature={saveSignature} onDeleteSignature={deleteSignature} profiles={profiles} activeProfileId={activeProfileId} onActivateProfile={activateProfile} onSaveProfile={saveProfile} onDeleteProfile={deleteProfile}/>}
      </div>
    </main>
    {composeOpen&&<Composer accounts={profileAccounts} signatures={signatures} initialAccountId={composeAccount?.id} initialDraft={draftToOpen} settings={settings} onClose={closeComposer} onQueued={(info)=>{handleQueuedSend(info);void refreshDrafts();}}/>}
    {undoSend&&<div className="undo-send" role="status"><span><Icon name="send" size={16}/><b>Mensagem na fila</b><small>Envio em instantes</small></span><button onClick={()=>void undoQueuedSend()}>Desfazer</button></div>}
    {accountOpen&&<AddAccountModal onClose={()=>setAccountOpen(false)} onAdded={account=>{setAccounts(v=>[...v,account]);setActiveId(account.id);void pushCloudAccount(account).catch(()=>undefined);}}/>}
  </div></>;
}

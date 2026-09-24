import { useEffect, useMemo, useState, type ReactNode } from "react";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { Icon, type IconName } from "./icons";
import { bridge } from "./lib/bridge";
import { PersistentCalendarView, PersistentNotesView, PersistentPeopleView, PersistentRulesView, PersistentTasksView } from "./components/WorkspaceViews";
import { CloudPanel } from "./components/CloudPanel";
import { AccountsPanel } from "./components/AccountsPanel";
import { SignaturesPanel } from "./components/SignaturesPanel";
import { BrandLogo } from "./components/BrandLogo";
import { LaunchScreen } from "./components/LaunchScreen";
import { Composer, type ComposeDraft, type QueuedSendInfo } from "./components/Composer";
import { ensureNotificationPermission, notifyCalendarReminder, notifyNewMessages, notifyTaskReminder } from "./lib/notifications";
import { pullCloudAccounts, pullCloudMessages, pushCloudAccount, pushCloudAccounts, pushCloudDocument, pushCloudMessage, pushCloudMessages } from "./lib/neon";
import { syncWorkspaceCollection } from "./lib/workspace-sync";
import { matchesMailQuery, matchesQuickFilter, type MailQuickFilter } from "./lib/mail-search";
import { pendingRulesForMessage } from "./lib/rules";
import { messageToEml, safeExportName } from "./lib/interchange";
import type { AccountProfile, AppSection, AppSettings, CalendarEvent, CategoryItem, MailFolder, MailMessage, ProviderSettings, RuleItem, RuntimeInfo, SavedSearchItem, SignatureItem, TaskItem, WorkspaceDocument, WorkspaceKind } from "./types";

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
  syncIntervalMinutes: 5
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

function AddAccountModal({onClose,onAdded}:{onClose:()=>void;onAdded:(account:AccountProfile)=>void}) {
  const [provider,setProvider] = useState<AccountProfile["provider"]>("gmail");
  const [displayName,setDisplayName] = useState("");
  const [email,setEmail] = useState("");
  const [secret,setSecret] = useState("");
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
        <label><span>IMAP</span><input value={server.imapHost} onChange={e=>setServer(v=>({...v,imapHost:e.target.value}))} placeholder="imap.dominio.com"/></label>
        <label><span>Porta</span><input type="number" value={server.imapPort} onChange={e=>setServer(v=>({...v,imapPort:Number(e.target.value)}))}/></label>
        <label><span>SMTP</span><input value={server.smtpHost} onChange={e=>setServer(v=>({...v,smtpHost:e.target.value}))} placeholder="smtp.dominio.com"/></label>
        <label><span>Porta</span><input type="number" value={server.smtpPort} onChange={e=>setServer(v=>({...v,smtpPort:Number(e.target.value)}))}/></label>
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

function MailView({accounts,messages,activeAccount,folders,folder,localDrafts,categories,savedSearches,onOpenDraft,onComposeFromMessage,onCreateTaskFromMessage,onCreateEventFromMessage,onImportEml,onExportEml,onCreateCategory,onEditCategory,onDeleteCategory,onToggleCategory,onUseSavedSearch,onDeleteSavedSearch,onCreateFolder,onRenameFolder,onDeleteFolder,onMoveToFolder,focusMessageId,onFolderChange,onCompose,onAdd,onRefresh,onMessageAction,syncing,markReadDelayMs,readingPane,previewLines}:{accounts:AccountProfile[];messages:MailMessage[];activeAccount?:AccountProfile;folders:MailFolder[];folder:MailFolder;localDrafts:ComposeDraft[];categories:CategoryItem[];savedSearches:SavedSearchItem[];onOpenDraft:(draft:ComposeDraft)=>void;onComposeFromMessage:(message:MailMessage,mode:"reply"|"replyAll"|"forward")=>void;onCreateTaskFromMessage:(message:MailMessage)=>void;onCreateEventFromMessage:(message:MailMessage)=>void;onImportEml?:()=>void;onExportEml:(message:MailMessage)=>void;onCreateCategory:()=>void;onEditCategory:(category:CategoryItem)=>void;onDeleteCategory:(category:CategoryItem)=>void;onToggleCategory:(message:MailMessage,category:CategoryItem)=>void;onUseSavedSearch:(item:SavedSearchItem)=>void;onDeleteSavedSearch:(item:SavedSearchItem)=>void;onCreateFolder?:()=>void;onRenameFolder?:(folder:MailFolder)=>void;onDeleteFolder?:(folder:MailFolder)=>void;onMoveToFolder?:(message:MailMessage,folder:MailFolder)=>void;focusMessageId?:string;onFolderChange:(folder:MailFolder)=>void;onCompose:()=>void;onAdd:()=>void;onRefresh:()=>void;onMessageAction:(messageId:string,action:"read"|"unread"|"flag"|"unflag"|"pin"|"unpin"|"archive"|"delete"|"spam"|"inbox")=>Promise<void>;syncing:boolean;markReadDelayMs:number;readingPane:AppSettings["readingPane"];previewLines:AppSettings["previewLines"]}) {
  const [selectedId,setSelectedId] = useState<string>();
  const [quickFilter,setQuickFilter] = useState<MailQuickFilter>("all");
  const [sort,setSort] = useState<"newest"|"oldest"|"sender"|"subject"|"unread">("newest");
  const selected = messages.find(m=>m.id===selectedId);
  const folderMessages = [...messages.filter(message=>message.folder===folder.name && matchesQuickFilter(message,quickFilter))]
    .sort((a,b)=>{
      const pinned = Number(b.isPinned)-Number(a.isPinned);
      if (pinned!==0) return pinned;
      if (sort==="oldest") return a.receivedAt.localeCompare(b.receivedAt);
      if (sort==="sender") return (a.from.name||a.from.email).localeCompare(b.from.name||b.from.email);
      if (sort==="subject") return a.subject.localeCompare(b.subject);
      if (sort==="unread") return Number(a.isRead)-Number(b.isRead)||b.receivedAt.localeCompare(a.receivedAt);
      return b.receivedAt.localeCompare(a.receivedAt);
    });

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
      if (!current || event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key==="r") {
        event.preventDefault();
        onComposeFromMessage(current,event.shiftKey?"replyAll":"reply");
      } else if (key==="f") {
        event.preventDefault();
        onComposeFromMessage(current,"forward");
      } else if (key==="e") {
        event.preventDefault();
        void act(current.id,"archive");
      } else if (key==="u") {
        event.preventDefault();
        void act(current.id,current.isRead?"unread":"read");
      } else if (event.key==="Delete") {
        event.preventDefault();
        void act(current.id,"delete");
      }
    };
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[selectedId,folderMessages,messages]);

  const visibleFolders = folders.length ? folders : FALLBACK_FOLDERS;

  async function act(messageId:string, action:"read"|"unread"|"flag"|"unflag"|"pin"|"unpin"|"archive"|"delete"|"spam"|"inbox") {
    await onMessageAction(messageId, action);
    if (["archive","delete","spam","inbox"].includes(action)) setSelectedId(undefined);
  }

  return <div className={`mail-layout reading-${readingPane} preview-${previewLines}`}>
    <aside className="folder-pane">
      <button className="compose-button" onClick={onCompose}><Icon name="plus" size={17}/> Novo e-mail</button>
      <div className="account-line"><i style={{background:activeAccount?.color||"#7868ff"}}/><span>{activeAccount?.email||(accounts.length?"Todas as contas":"Nenhuma conta")}</span></div>
      <div className="group-title folder-group-title"><span>PASTAS</span>{activeAccount&&onCreateFolder&&<button className="group-add" aria-label="Nova pasta" onClick={onCreateFolder}><Icon name="plus" size={13}/></button>}</div>
      <nav className="folders">
        {visibleFolders.map(item=>{
          const unread = messages.filter(message=>message.folder===item.name&&!message.isRead).length;
          const button=<button className={folder.path===item.path?"folder active":"folder"} onClick={()=>onFolderChange(item)}>
            <Icon name={folderIcon(item.role)} size={17}/><span>{item.name}</span>{unread>0&&<b>{unread}</b>}
          </button>;
          if(item.role!=="custom"||!activeAccount) return <div key={item.path}>{button}</div>;
          return <div className="organizer-row folder-organizer" key={item.path}>{button}<div className="folder-actions"><button className="organizer-delete folder-edit" aria-label={`Renomear ${item.name}`} onClick={()=>onRenameFolder?.(item)}><Icon name="settings" size={12}/></button><button className="organizer-delete" aria-label={`Excluir ${item.name}`} onClick={()=>onDeleteFolder?.(item)}><Icon name="x" size={12}/></button></div></div>;
        })}
      </nav>
      <div className="group-title"><span>FAVORITOS</span></div>
      <button className="folder" onClick={()=>setQuickFilter("flagged")}><Icon name="star" size={17}/><span>Importantes</span></button>
      {savedSearches.length>0&&<>
        <div className="group-title"><span>PESQUISAS SALVAS</span></div>
        <div className="organizer-list">{savedSearches.map(item=><div className="organizer-row" key={item.id}><button className="folder" onClick={()=>onUseSavedSearch(item)}><Icon name="search" size={15}/><span>{item.name}</span></button><button className="organizer-delete" aria-label={`Excluir pesquisa ${item.name}`} onClick={()=>onDeleteSavedSearch(item)}><Icon name="x" size={12}/></button></div>)}</div>
      </>}
      <div className="group-title"><span>CATEGORIAS</span><button className="group-add" aria-label="Nova categoria" onClick={onCreateCategory}><Icon name="plus" size={13}/></button></div>
      <div className="organizer-list">{categories.map(category=><div className="organizer-row category-organizer-row" key={category.id}><button className="folder" onClick={()=>onUseSavedSearch({id:category.id,name:category.name,query:`category:"${category.name}"`})}><i className="category-dot" style={{background:category.color}}/><span>{category.name}</span></button><div className="folder-actions"><button className="organizer-delete folder-edit" aria-label={`Editar categoria ${category.name}`} onClick={()=>onEditCategory(category)}><Icon name="settings" size={12}/></button><button className="organizer-delete" aria-label={`Excluir categoria ${category.name}`} onClick={()=>onDeleteCategory(category)}><Icon name="x" size={12}/></button></div></div>)}</div>
      <div className="local-card"><div><Icon name="cloud" size={18}/></div><span><b>Local-first</b><small>Fila offline protegida</small></span></div>
    </aside>

    <section className="message-pane">
      <header className="pane-header">
        <div><span className="eyebrow">{folder.name.toUpperCase()}</span><h2>{folder.name}</h2></div>
        <div className="pane-tools">{onImportEml&&activeAccount&&<button className="icon-button" title="Importar EML" aria-label="Importar EML" onClick={onImportEml}><Icon name="upload" size={16}/></button>}<select className="mail-sort" value={sort} onChange={e=>setSort(e.target.value as typeof sort)} aria-label="Ordenar mensagens"><option value="newest">Mais recentes</option><option value="oldest">Mais antigas</option><option value="sender">Remetente</option><option value="subject">Assunto</option><option value="unread">Não lidas primeiro</option></select><div className="icon-group"><button className={syncing?"icon-button spinning":"icon-button"} onClick={onRefresh} disabled={accounts.length===0||syncing} aria-label="Sincronizar caixa"><Icon name="refresh"/></button><button className="icon-button"><Icon name="more"/></button></div></div>
      </header>
      <div className="segmented mail-filters">
        <button className={quickFilter==="all"?"active":""} onClick={()=>setQuickFilter("all")}>Todas</button>
        <button className={quickFilter==="unread"?"active":""} onClick={()=>setQuickFilter("unread")}>Não lidas</button>
        <button className={quickFilter==="flagged"?"active":""} onClick={()=>setQuickFilter("flagged")}>Sinalizadas</button>
        <button className={quickFilter==="pinned"?"active":""} onClick={()=>setQuickFilter("pinned")}>Fixadas</button>
        <button className={quickFilter==="attachments"?"active":""} onClick={()=>setQuickFilter("attachments")}>Anexos</button>
      </div>
      {accounts.length===0 ? <EmptyInbox onAdd={onAdd}/> : folderMessages.length===0 && (folder.role!=="drafts" || localDrafts.length===0) ? <div className="empty-state small"><div className="empty-symbol"><Icon name={folder.role==="drafts"?"draft":"inbox"} size={30}/></div><h3>{folder.role==="drafts"?"Nenhum rascunho":"Tudo limpo"}</h3><p>{folder.role==="drafts"?"Mensagens em edição aparecerão aqui automaticamente.":"As mensagens sincronizadas aparecerão aqui."}</p></div> :
        <div className="message-list">
          {folder.role==="drafts"&&localDrafts.map(draft=><button key={draft.id} className="message local-draft-message" onClick={()=>onOpenDraft(draft)}>
            <span className="avatar draft-avatar"><Icon name="draft" size={15}/></span>
            <span className="message-copy"><span className="message-meta"><b>Rascunho local</b><time>autosave</time></span><strong>{draft.subject||"(sem assunto)"}</strong><small>{draft.to?`Para: ${draft.to}`:(draft.bodyText||"Comece a escrever...")}</small></span>
            {draft.attachments.length>0&&<span className="draft-attachment-count"><Icon name="paperclip" size={13}/>{draft.attachments.length}</span>}
          </button>)}
          {folderMessages.map(message=><button key={message.id} className={"message "+(selectedId===message.id?"selected ":"")+(!message.isRead?"unread":"")} onClick={()=>{setSelectedId(message.id);if(!message.isRead){window.setTimeout(()=>void act(message.id,"read"),markReadDelayMs);}}}>
            <span className="avatar">{(message.from.name||message.from.email)[0].toUpperCase()}</span>
            <span className="message-copy"><span className="message-meta"><b>{message.from.name||message.from.email}</b><time>{new Date(message.receivedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></span><strong>{message.subject||"(sem assunto)"}</strong><small>{message.preview}</small>{message.categories.length>0&&<span className="message-category-dots">{message.categories.slice(0,4).map(name=>{const category=categories.find(item=>item.name===name);return <i key={name} title={name} style={{background:category?.color||"#888"}}/>;})}</span>}</span>
            <span className="message-indicators">{message.isPinned&&<Icon name="pin" size={13}/>} {message.hasAttachments&&<Icon name="paperclip" size={14}/>}</span>
          </button>)}
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
        <div className="sender"><span className="avatar big">{(selected.from.name||selected.from.email)[0].toUpperCase()}</span><div><b>{selected.from.name||selected.from.email}</b><small>{selected.from.email}</small></div><time>{new Date(selected.receivedAt).toLocaleString()}</time></div>
        {categories.length>0&&<div className="message-categories">{categories.map(category=>{const active=selected.categories.includes(category.name);return <button key={category.id} className={active?"category-chip active":"category-chip"} onClick={()=>onToggleCategory(selected,category)}><i style={{background:category.color}}/>{category.name}</button>;})}</div>}
        {activeAccount&&onMoveToFolder&&folders.length>1&&<div className="move-folder-row"><span>Mover para</span><select defaultValue="" onChange={e=>{const target=folders.find(item=>item.path===e.target.value);if(target){onMoveToFolder(selected,target);e.currentTarget.value="";}}}><option value="" disabled>Escolher pasta...</option>{folders.filter(item=>item.path!==selected.remoteFolder).map(item=><option key={item.path} value={item.path}>{item.name}</option>)}</select></div>}
        <article className="mail-body">{selected.bodyText||selected.preview}</article>
        <div className="reply-actions"><button className="secondary" onClick={()=>onComposeFromMessage(selected,"reply")}><Icon name="reply" size={15}/> Responder</button><button className="secondary" onClick={()=>onComposeFromMessage(selected,"replyAll")}><Icon name="people" size={15}/> Responder a todos</button><button className="secondary" onClick={()=>onComposeFromMessage(selected,"forward")}><Icon name="forward" size={15}/> Encaminhar</button><button className="secondary" onClick={()=>onCreateTaskFromMessage(selected)}><Icon name="check" size={15}/> Criar tarefa</button><button className="secondary" onClick={()=>onCreateEventFromMessage(selected)}><Icon name="calendar" size={15}/> Criar evento</button><button className="secondary" onClick={()=>onExportEml(selected)}><Icon name="download" size={15}/> Salvar EML</button></div>
      </> : <div className="reading-empty"><BrandLogo variant="hero"/><span className="eyebrow">SEVEN MAIL</span><h2>Selecione uma mensagem</h2><p>Leia, responda e organize sem sair da mesma tela.</p></div>}
    </section>
  </div>;
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

function SettingsView({settings,onChange,runtime,accounts,onAccountsChange,signatures,onSaveSignature,onDeleteSignature}:{settings:AppSettings;onChange:(s:AppSettings)=>void;runtime?:RuntimeInfo;accounts:AccountProfile[];onAccountsChange:(accounts:AccountProfile[])=>void;signatures:SignatureItem[];onSaveSignature:(signature:SignatureItem)=>Promise<void>;onDeleteSignature:(signature:SignatureItem)=>Promise<void>}) {
  const set = <K extends keyof AppSettings>(key:K,value:AppSettings[K])=>onChange({...settings,[key]:value});

  async function exportBackup() {
    const destination = await saveDialog({
      defaultPath:"seven-mail-backup.json",
      filters:[{name:"Backup Seven Mail",extensions:["json"]}],
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
    await bridge.writeTextFile(destination,JSON.stringify(backup,null,2));
  }

  async function importBackup() {
    const selected = await open({
      multiple:false,
      directory:false,
      filters:[{name:"Backup Seven Mail",extensions:["json"]}],
    });
    if (!selected || Array.isArray(selected)) return;
    const raw = await bridge.readTextFile(selected);
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

  return <Workspace title="Configurações" eyebrow="PREFERÊNCIAS">
    <div className="settings-row brand-settings-row"><div><h3>Sobre o Seven Mail</h3><p>Identidade e informações do aplicativo.</p></div><div className="brand-about-card"><BrandLogo variant="about"/><div><strong>Seven Mail</strong><span>Cliente desktop local-first</span><small>Windows · Linux</small></div></div></div>
    <div className="settings-row"><div><h3>Aparência</h3><p>Tema, densidade e pré-visualização da lista.</p></div><div className="appearance-settings"><div className="choices">{(["system","light","dark"] as const).map(t=><button className={settings.theme===t?"choice active":"choice"} key={t} onClick={()=>set("theme",t)}><Icon name={t==="dark"?"moon":"sun"} size={16}/>{t==="system"?"Sistema":t==="light"?"Claro":"Escuro"}</button>)}</div><label><input type="checkbox" checked={settings.compact} onChange={e=>set("compact",e.target.checked)}/> Lista compacta</label><label><span>Linhas de prévia</span><select value={settings.previewLines} onChange={e=>set("previewLines",Number(e.target.value) as AppSettings["previewLines"])}><option value={1}>1 linha</option><option value={2}>2 linhas</option></select></label></div></div>
    <div className="settings-row"><div><h3>Painel de leitura</h3><p>Posição padrão e tempo para marcar mensagens como lidas.</p></div><div className="appearance-settings"><select value={settings.readingPane} onChange={e=>set("readingPane",e.target.value as AppSettings["readingPane"])}><option value="right">À direita</option><option value="bottom">Abaixo</option><option value="off">Desativado</option></select><label><span>Marcar como lida</span><select value={settings.markReadDelayMs} onChange={e=>set("markReadDelayMs",Number(e.target.value))}><option value={0}>Imediatamente</option><option value={500}>Após 0,5 s</option><option value={1200}>Após 1,2 s</option><option value={3000}>Após 3 s</option></select></label></div></div>
    <div className="settings-row"><div><h3>Envio</h3><p>Defina o atraso usado para desfazer um envio e a confirmação antes de colocar a mensagem na fila.</p></div><div className="send-settings"><select value={settings.sendDelaySeconds} onChange={e=>set("sendDelaySeconds",Number(e.target.value) as AppSettings["sendDelaySeconds"])}><option value={0}>Imediato</option><option value={5}>Desfazer por 5 s</option><option value={10}>Desfazer por 10 s</option><option value={20}>Desfazer por 20 s</option><option value={30}>Desfazer por 30 s</option></select><label><input type="checkbox" checked={settings.confirmBeforeSend} onChange={e=>set("confirmBeforeSend",e.target.checked)}/> Confirmar antes de enviar</label></div></div>
    <div className="settings-row"><div><h3>Sincronização e notificações</h3><p>Atualização automática da caixa de entrada em segundo plano.</p></div><div className="send-settings"><select value={settings.syncIntervalMinutes} onChange={e=>set("syncIntervalMinutes",Number(e.target.value) as AppSettings["syncIntervalMinutes"])}><option value={1}>A cada 1 minuto</option><option value={5}>A cada 5 minutos</option><option value={10}>A cada 10 minutos</option><option value={15}>A cada 15 minutos</option><option value={30}>A cada 30 minutos</option></select><label><input type="checkbox" checked={settings.notificationsEnabled} onChange={e=>set("notificationsEnabled",e.target.checked)}/> Notificações nativas de novas mensagens</label></div></div>
    <div className="settings-row"><div><h3>Dados locais</h3><p>Cache pode ser limpo sem tocar na fila de saída. Backup inclui workspace, preferências e metadados das contas; senhas ficam somente no Keyring.</p></div><div className="paths"><span><b>Dados</b>{runtime?.dataDir||"Carregando..."}</span><span><b>Cache</b>{runtime?.cacheDir||"Carregando..."}</span><span><b>Fila</b>{runtime?.queueDir||"Carregando..."}</span><div className="data-actions"><button className="secondary" onClick={()=>void exportBackup()}><Icon name="download" size={14}/> Exportar backup</button><button className="secondary" onClick={()=>void importBackup()}><Icon name="upload" size={14}/> Restaurar backup</button><button className="secondary" onClick={()=>bridge.clearCache()}>Limpar apenas cache</button></div></div></div>
    <AccountsPanel accounts={accounts} onChange={onAccountsChange}/>
    <SignaturesPanel accounts={accounts} signatures={signatures} onSave={onSaveSignature} onDelete={onDeleteSignature}/>
    <CloudPanel/>
    <div className="settings-row"><div><h3>Desktop</h3><p>Integração real com Windows e Linux.</p></div><div className="toggles"><label><input type="checkbox" checked={settings.minimizeToTray} onChange={e=>set("minimizeToTray",e.target.checked)}/> Minimizar para bandeja</label><label><input type="checkbox" checked={settings.startWithSystem} onChange={e=>set("startWithSystem",e.target.checked)}/> Iniciar com o sistema</label><label><input type="checkbox" checked={settings.confirmBeforeDelete} onChange={e=>set("confirmBeforeDelete",e.target.checked)}/> Confirmar exclusão</label></div></div>
  </Workspace>;
}

function Workspace({title,eyebrow,action,onAction,children}:{title:string;eyebrow:string;action?:string;onAction?:()=>void;children:ReactNode}) {
  return <div className="workspace"><header className="workspace-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{action&&<button className="primary" onClick={onAction}><Icon name="plus" size={15}/>{action}</button>}</header>{children}</div>;
}
function Feature({icon,title,children}:{icon:IconName;title:string;children:ReactNode}) { return <article className="feature"><div className="empty-symbol small-symbol"><Icon name={icon}/></div><h3>{title}</h3><p>{children}</p></article>; }

export default function App() {
  const [section,setSection] = useState<AppSection>("mail");
  const [accounts,setAccounts] = useState<AccountProfile[]>([]);
  const [activeId,setActiveId] = useState<string>();
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
  const [focusMessageId,setFocusMessageId] = useState<string>();
  const [categories,setCategories] = useState<CategoryItem[]>([]);
  const [savedSearches,setSavedSearches] = useState<SavedSearchItem[]>([]);
  const [signatures,setSignatures] = useState<SignatureItem[]>([]);
  const [syncState,setSyncState] = useState<"idle"|"syncing"|"error">("idle");
  const [bootState,setBootState] = useState({
    runtime: false,
    accounts: false,
    workspace: false,
    messages: false,
  });
  const [settings,setSettings] = useState<AppSettings>(()=>{
    try { return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem("seven-mail:settings")||"{}")}; } catch { return DEFAULT_SETTINGS; }
  });

  const unified = activeId==="__all__";
  const activeAccount = unified ? undefined : (accounts.find(a=>a.id===activeId)||accounts[0]);
  const composeAccount = activeAccount ?? accounts.find((account)=>account.isDefault) ?? accounts[0];
  const bootReady = bootState.runtime && bootState.accounts && bootState.workspace && bootState.messages;

  async function loadWorkspaceCollection<T>(kind: WorkspaceKind): Promise<T[]> {
    const documents = await syncWorkspaceCollection<T>(kind).catch(() => []);
    return documents.map((document) => document.payload);
  }

  async function refreshMailOrganization() {
    const [nextCategories,nextSavedSearches,nextSignatures] = await Promise.all([
      loadWorkspaceCollection<CategoryItem>("category"),
      loadWorkspaceCollection<SavedSearchItem>("saved-search"),
      loadWorkspaceCollection<SignatureItem>("signature"),
    ]);
    setCategories(nextCategories);
    setSavedSearches(nextSavedSearches);
    setSignatures(nextSignatures);
  }

  async function refreshActiveFolders(account = activeAccount) {
    if (!account) return;
    const folders = await bridge.listFolders(account.id);
    setMailFolders(folders.length ? folders : FALLBACK_FOLDERS);
    return folders;
  }

  async function createCustomFolder() {
    if (!activeAccount) return;
    const name = window.prompt("Nome da nova pasta")?.trim();
    if (!name) return;
    await bridge.createFolder(activeAccount.id,name);
    const folders = await refreshActiveFolders(activeAccount);
    if (folders) {
      const created = folders.find((item)=>item.path===name||item.name===name);
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

  async function openRelatedMessage(messageId: string) {
    const cached = await bridge.listCachedMessages();
    const message = cached.find((item)=>item.id===messageId);
    if (!message) return;

    setActiveId(message.accountId);
    setSearch("");
    setFocusMessageId(message.id);
    setSection("mail");
  }

  async function importEml() {
    const account = activeAccount ?? accounts.find((item)=>item.isDefault) ?? accounts[0];
    if (!account) return;
    const selected = await open({
      multiple:false,
      directory:false,
      filters:[{name:"Mensagem EML",extensions:["eml"]}],
    });
    if (!selected || Array.isArray(selected)) return;
    const imported = await bridge.importEml(account.id,selected);
    setMessages((current)=>[imported,...current.filter((item)=>item.id!==imported.id)]);
    setSelectedFolder(FALLBACK_FOLDERS[0]);
    setFocusMessageId(imported.id);
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

  async function createTaskFromMessage(message: MailMessage) {
    const existing = await bridge.listWorkspace<TaskItem>("task").catch(() => []);
    const duplicate = existing.find((document)=>document.payload.relatedMessageId===message.id);
    if (duplicate) {
      setSection("tasks");
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
    setSection("tasks");
  }

  function closeComposer() {
    setComposeOpen(false);
    setDraftToOpen(undefined);
    void refreshDrafts();
  }


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
      const [categoryDocs,searchDocs,signatureDocs] = await Promise.all([
        bridge.listWorkspace<CategoryItem>("category").catch(() => []),
        bridge.listWorkspace<SavedSearchItem>("saved-search").catch(() => []),
        bridge.listWorkspace<SignatureItem>("signature").catch(() => []),
      ]);

      if (!disposed) {
        setCategories(categoryDocs.map((document)=>document.payload));
        setSavedSearches(searchDocs.map((document)=>document.payload));
        setSignatures(signatureDocs.map((document)=>document.payload));
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
        const targets = unified ? accounts : (activeAccount ? [activeAccount] : []);
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
    localStorage.setItem("seven-mail:settings",JSON.stringify(settings));
    const theme = settings.theme==="system" ? (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light") : settings.theme;
    document.documentElement.dataset.theme=theme;
    document.documentElement.dataset.density=settings.compact?"compact":"comfortable";
  },[settings]);

  useEffect(()=>{
    void bridge.setCloseToTray(settings.minimizeToTray).catch(() => undefined);
  },[settings.minimizeToTray]);

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
      for (const account of accounts) {
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
  },[accounts]);

  useEffect(()=>{
    if (accounts.length===0) return;

    let disposed = false;
    const run = async () => {
      if (!navigator.onLine || disposed) return;

      for (const account of accounts) {
        if (disposed) break;
        try {
          const before = await bridge.listCachedMessages(account.id);
          const known = new Set(before.map((message)=>message.id));

          await bridge.syncFolder(account.id,"INBOX","Caixa de entrada",50);
          const synced = await bridge.listCachedMessages(account.id);
          await executeRules(synced.filter((message)=>message.folder==="Caixa de entrada"));
          const after = await bridge.listCachedMessages(account.id);
          const fresh = before.length===0
            ? []
            : after.filter((message)=>message.folder==="Caixa de entrada"&&!known.has(message.id));

          if (!disposed && activeAccount?.id===account.id) {
            setMessages(after);
          }
          if (fresh.length>0 && settings.notificationsEnabled) {
            void notifyNewMessages(fresh);
          }
          void pushCloudMessages(after).catch(() => undefined);
        } catch {
          // A conta pode estar offline, sem credencial ou exigir nova autenticação.
        }
      }

      if (!disposed && unified) {
        const unifiedMessages = await bridge.listCachedMessages().catch(() => [] as MailMessage[]);
        if (!disposed) setMessages(unifiedMessages);
      }
    };

    const intervalMs = settings.syncIntervalMinutes * 60_000;
    const timer = window.setInterval(()=>void run(),intervalMs);
    const online = () => void run();
    window.addEventListener("online",online);
    return ()=>{
      disposed=true;
      window.clearInterval(timer);
      window.removeEventListener("online",online);
    };
  },[accounts,activeAccount?.id,unified,settings.notificationsEnabled,settings.syncIntervalMinutes]);

  useEffect(()=>{
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;

      if (event.key.toLowerCase()==="k") {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>(".search input");
        input?.focus();
        input?.select();
        return;
      }

      if (event.key.toLowerCase()==="n" && accounts.length>0) {
        event.preventDefault();
        startNewMessage();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return ()=>window.removeEventListener("keydown", onKeyDown);
  },[accounts.length]);

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
        current = await bridge.messageAction(current.accountId,current.id,rule.action);
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
    if (accounts.length===0 || syncState==="syncing") return;
    setSyncState("syncing");
    try {
      const targets = unified ? accounts : (activeAccount ? [activeAccount] : []);
      for (const account of targets) {
        await bridge.flushMailActions(account.id).catch(() => 0);
        const path = unified ? "INBOX" : selectedFolder.path;
        const label = unified ? "Caixa de entrada" : selectedFolder.name;
        await bridge.syncFolder(account.id, path, label, 50);
      }
      const synced = await bridge.listCachedMessages(unified ? undefined : activeAccount?.id);
      await executeRules(synced.filter((message)=>message.folder==="Caixa de entrada"));
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

  const filtered = useMemo(
    ()=>messages.filter((message)=>matchesMailQuery(message,search)),
    [messages,search],
  );

  return <><LaunchScreen ready={bootReady}/><div className="app-shell">
    <aside className="nav-rail">
      <div className="rail-brand"><BrandLogo variant="rail"/></div>
      <nav>{NAV.map(item=><button key={item.id} className={section===item.id?"nav-item active":"nav-item"} title={item.label} onClick={()=>setSection(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <button className="profile" onClick={()=>setAccountOpen(true)}>{activeAccount?activeAccount.displayName[0].toUpperCase():<Icon name="userplus" size={17}/>}</button>
    </aside>
    <main className="main">
      <header className="topbar" data-tauri-drag-region>
        <div className="product"><strong>Seven Mail</strong><span>{NAV.find(n=>n.id===section)?.label}</span></div>
        {section==="mail"&&accounts.length>0&&<select className="account-switcher" value={unified?"__all__":(activeAccount?.id??"")} onChange={e=>setActiveId(e.target.value)} aria-label="Selecionar conta"><option value="__all__">Todas as contas</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.email}</option>)}</select>}
        <label className="search"><Icon name="search" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar e-mails, pessoas, eventos..."/><kbd>Ctrl K</kbd></label>{section==="mail"&&search.trim()&&<button className="icon-button save-search-button" title="Salvar pesquisa" aria-label="Salvar pesquisa" onClick={()=>void saveCurrentSearch()}><Icon name="star" size={17}/></button>}
        <div className="top-actions"><span className={"sync "+syncState}><i/> {syncState==="syncing"?"Sincronizando":syncState==="error"?"Erro de sincronização":"Sincronizado"}</span><button className="icon-button" onClick={()=>setSection("settings")}><Icon name="settings" size={18}/></button></div>
      </header>
      <div className="content">
        {section==="mail"&&<MailView accounts={accounts} messages={filtered} activeAccount={activeAccount} folders={mailFolders} folder={selectedFolder} localDrafts={localDrafts} categories={categories} savedSearches={savedSearches} onOpenDraft={openDraft} onComposeFromMessage={composeFromMessage} onCreateTaskFromMessage={(message)=>void createTaskFromMessage(message)} onCreateEventFromMessage={(message)=>void createEventFromMessage(message)} onImportEml={activeAccount?()=>void importEml():undefined} onExportEml={(message)=>void exportEml(message)} onCreateCategory={()=>void createCategory()} onEditCategory={(category)=>void editCategory(category)} onDeleteCategory={(category)=>void deleteCategory(category)} onToggleCategory={(message,category)=>void toggleMessageCategory(message,category)} onUseSavedSearch={(item)=>setSearch(item.query)} onDeleteSavedSearch={(item)=>void deleteSavedSearch(item)} onCreateFolder={activeAccount?()=>void createCustomFolder():undefined} onRenameFolder={activeAccount?(folder)=>void renameCustomFolder(folder):undefined} onDeleteFolder={activeAccount?(folder)=>void deleteCustomFolder(folder):undefined} onMoveToFolder={activeAccount?(message,folder)=>void moveToFolder(message,folder):undefined} focusMessageId={focusMessageId} onFolderChange={(next)=>{setSelectedFolder(next);if(activeAccount){queueMicrotask(()=>void bridge.syncFolder(activeAccount.id,next.path,next.name,50).then(()=>bridge.listCachedMessages(activeAccount.id)).then(setMessages).catch(()=>undefined));}}} onCompose={startNewMessage} onAdd={()=>setAccountOpen(true)} onRefresh={()=>void syncNow()} onMessageAction={applyMessageAction} syncing={syncState==="syncing"} markReadDelayMs={settings.markReadDelayMs} readingPane={settings.readingPane} previewLines={settings.previewLines}/>} 
        {section==="calendar"&&<PersistentCalendarView/>}
        {section==="people"&&<PersistentPeopleView query={search}/>}
        {section==="tasks"&&<PersistentTasksView onOpenRelatedMessage={(messageId)=>void openRelatedMessage(messageId)}/>} 
        {section==="notes"&&<PersistentNotesView query={search}/>}
        {section==="rules"&&<PersistentRulesView onRunRules={runRulesNow}/>} 
        {section==="settings"&&<SettingsView settings={settings} onChange={setSettings} runtime={runtime} accounts={accounts} onAccountsChange={(next)=>{setAccounts(next);if(!next.some((account)=>account.id===activeId)){setActiveId(next.find((account)=>account.isDefault)?.id??next[0]?.id);}}} signatures={signatures} onSaveSignature={saveSignature} onDeleteSignature={deleteSignature}/>}
      </div>
    </main>
    {composeOpen&&<Composer accounts={accounts} signatures={signatures} initialAccountId={composeAccount?.id} initialDraft={draftToOpen} settings={settings} onClose={closeComposer} onQueued={(info)=>{handleQueuedSend(info);void refreshDrafts();}}/>}
    {undoSend&&<div className="undo-send" role="status"><span><Icon name="send" size={16}/><b>Mensagem na fila</b><small>Envio em instantes</small></span><button onClick={()=>void undoQueuedSend()}>Desfazer</button></div>}
    {accountOpen&&<AddAccountModal onClose={()=>setAccountOpen(false)} onAdded={account=>{setAccounts(v=>[...v,account]);setActiveId(account.id);void pushCloudAccount(account).catch(()=>undefined);}}/>}
  </div></>;
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { bridge } from "./lib/bridge";
import type { AccountProfile, AppSection, AppSettings, MailMessage, RuntimeInfo } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  readingPane: "right",
  compact: false,
  previewLines: 2,
  markReadDelayMs: 1200,
  confirmBeforeDelete: true,
  confirmBeforeSend: false,
  startWithSystem: false,
  minimizeToTray: true
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

const FOLDERS: Array<{name:string;icon:IconName}> = [
  {name:"Caixa de entrada",icon:"inbox"},
  {name:"Rascunhos",icon:"draft"},
  {name:"Enviados",icon:"send"},
  {name:"Arquivados",icon:"archive"},
  {name:"Spam",icon:"spam"},
  {name:"Lixeira",icon:"trash"}
];

const COLORS = ["#7868ff","#21a6a1","#ef7350","#cb59d8","#3d83f6"];

function Logo() {
  return <div className="brand-mark" aria-label="Seven Mail"><span>7</span><i /></div>;
}

function AddAccountModal({onClose,onAdded}:{onClose:()=>void;onAdded:(account:AccountProfile)=>void}) {
  const [provider,setProvider] = useState<AccountProfile["provider"]>("gmail");
  const [displayName,setDisplayName] = useState("");
  const [email,setEmail] = useState("");
  const [secret,setSecret] = useState("");

  async function connect() {
    if (!email.trim()) return;
    const account: AccountProfile = {
      id: crypto.randomUUID(),
      displayName: displayName.trim() || email.split("@")[0],
      email: email.trim(),
      provider,
      color: COLORS[Math.floor(Math.random()*COLORS.length)],
      isDefault: false
    };
    await bridge.saveAccount(account);
    if (secret.trim()) await bridge.storeSecret(account.id, secret);
    onAdded(account);
    onClose();
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal account-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}>
      <header className="modal-header">
        <div><span className="eyebrow">NOVA CONTA</span><h2>Conectar e-mail</h2><p>OAuth quando disponível. Segredos ficam no cofre nativo do sistema.</p></div>
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
      <div className="secure-note"><Icon name="lock" size={16}/><span>A credencial nunca é escrita no cache ou no banco local.</span></div>
      <footer className="modal-footer"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!email.trim()} onClick={connect}>Conectar</button></footer>
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

function MailView({accounts,messages,activeAccount,onCompose,onAdd}:{accounts:AccountProfile[];messages:MailMessage[];activeAccount?:AccountProfile;onCompose:()=>void;onAdd:()=>void}) {
  const [folder,setFolder] = useState("Caixa de entrada");
  const [selectedId,setSelectedId] = useState<string>();
  const selected = messages.find(m=>m.id===selectedId);

  return <div className="mail-layout">
    <aside className="folder-pane">
      <button className="compose-button" onClick={onCompose}><Icon name="plus" size={17}/> Novo e-mail</button>
      <div className="account-line"><i style={{background:activeAccount?.color||"#7868ff"}}/><span>{activeAccount?.email||"Nenhuma conta"}</span></div>
      <nav className="folders">
        {FOLDERS.map(item=><button key={item.name} className={folder===item.name?"folder active":"folder"} onClick={()=>setFolder(item.name)}>
          <Icon name={item.icon} size={17}/><span>{item.name}</span>{item.name==="Caixa de entrada"&&messages.some(m=>!m.isRead)&&<b>{messages.filter(m=>!m.isRead).length}</b>}
        </button>)}
      </nav>
      <div className="group-title"><span>FAVORITOS</span><Icon name="plus" size={13}/></div>
      <button className="folder"><Icon name="star" size={17}/><span>Importantes</span></button>
      <div className="local-card"><div><Icon name="cloud" size={18}/></div><span><b>Local-first</b><small>Fila offline protegida</small></span></div>
    </aside>

    <section className="message-pane">
      <header className="pane-header">
        <div><span className="eyebrow">{folder.toUpperCase()}</span><h2>{folder}</h2></div>
        <div className="icon-group"><button className="icon-button"><Icon name="filter"/></button><button className="icon-button"><Icon name="refresh"/></button><button className="icon-button"><Icon name="more"/></button></div>
      </header>
      <div className="segmented"><button className="active">Prioritários</button><button>Outros</button></div>
      {accounts.length===0 ? <EmptyInbox onAdd={onAdd}/> : messages.length===0 ? <div className="empty-state small"><div className="empty-symbol"><Icon name="inbox" size={30}/></div><h3>Tudo limpo</h3><p>As mensagens sincronizadas aparecerão aqui.</p></div> :
        <div className="message-list">{messages.map(message=><button key={message.id} className={"message "+(selectedId===message.id?"selected ":"")+(!message.isRead?"unread":"")} onClick={()=>setSelectedId(message.id)}>
          <span className="avatar">{(message.from.name||message.from.email)[0].toUpperCase()}</span>
          <span className="message-copy"><span className="message-meta"><b>{message.from.name||message.from.email}</b><time>{new Date(message.receivedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></span><strong>{message.subject||"(sem assunto)"}</strong><small>{message.preview}</small></span>
          {message.hasAttachments&&<Icon name="paperclip" size={14}/>}
        </button>)}</div>
      }
    </section>

    <section className="reading-pane">
      {selected ? <>
        <header className="reading-header"><div><span className="eyebrow">MENSAGEM</span><h1>{selected.subject}</h1></div><div className="icon-group"><button className="icon-button"><Icon name="reply"/></button><button className="icon-button"><Icon name="forward"/></button><button className="icon-button"><Icon name="more"/></button></div></header>
        <div className="sender"><span className="avatar big">{(selected.from.name||selected.from.email)[0].toUpperCase()}</span><div><b>{selected.from.name||selected.from.email}</b><small>{selected.from.email}</small></div><time>{new Date(selected.receivedAt).toLocaleString()}</time></div>
        <article className="mail-body">{selected.bodyText||selected.preview}</article>
        <div className="reply-actions"><button className="secondary"><Icon name="reply" size={15}/> Responder</button><button className="secondary"><Icon name="forward" size={15}/> Encaminhar</button></div>
      </> : <div className="reading-empty"><Logo/><span className="eyebrow">SEVEN MAIL</span><h2>Selecione uma mensagem</h2><p>Leia, responda e organize sem sair da mesma tela.</p></div>}
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

function SettingsView({settings,onChange,runtime}:{settings:AppSettings;onChange:(s:AppSettings)=>void;runtime?:RuntimeInfo}) {
  const set = <K extends keyof AppSettings>(key:K,value:AppSettings[K])=>onChange({...settings,[key]:value});
  return <Workspace title="Configurações" eyebrow="PREFERÊNCIAS">
    <div className="settings-row"><div><h3>Aparência</h3><p>Tema e densidade da interface.</p></div><div className="choices">{(["system","light","dark"] as const).map(t=><button className={settings.theme===t?"choice active":"choice"} key={t} onClick={()=>set("theme",t)}><Icon name={t==="dark"?"moon":"sun"} size={16}/>{t==="system"?"Sistema":t==="light"?"Claro":"Escuro"}</button>)}</div></div>
    <div className="settings-row"><div><h3>Painel de leitura</h3><p>Posição padrão para mensagens.</p></div><select value={settings.readingPane} onChange={e=>set("readingPane",e.target.value as AppSettings["readingPane"])}><option value="right">À direita</option><option value="bottom">Abaixo</option><option value="off">Desativado</option></select></div>
    <div className="settings-row"><div><h3>Dados locais</h3><p>Cache pode ser limpo sem tocar na fila de saída.</p></div><div className="paths"><span><b>Dados</b>{runtime?.dataDir||"Carregando..."}</span><span><b>Cache</b>{runtime?.cacheDir||"Carregando..."}</span><span><b>Fila</b>{runtime?.queueDir||"Carregando..."}</span><button className="secondary" onClick={()=>bridge.clearCache()}>Limpar apenas cache</button></div></div>
    <div className="settings-row"><div><h3>Desktop</h3><p>Integração com o sistema.</p></div><div className="toggles"><label><input type="checkbox" checked={settings.minimizeToTray} onChange={e=>set("minimizeToTray",e.target.checked)}/> Minimizar para bandeja</label><label><input type="checkbox" checked={settings.startWithSystem} onChange={e=>set("startWithSystem",e.target.checked)}/> Iniciar com o sistema</label><label><input type="checkbox" checked={settings.confirmBeforeDelete} onChange={e=>set("confirmBeforeDelete",e.target.checked)}/> Confirmar exclusão</label></div></div>
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
  const [runtime,setRuntime] = useState<RuntimeInfo>();
  const [composeOpen,setComposeOpen] = useState(false);
  const [accountOpen,setAccountOpen] = useState(false);
  const [search,setSearch] = useState("");
  const [settings,setSettings] = useState<AppSettings>(()=>{
    try { return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem("seven-mail:settings")||"{}")}; } catch { return DEFAULT_SETTINGS; }
  });

  const activeAccount = accounts.find(a=>a.id===activeId)||accounts[0];

  useEffect(()=>{
    bridge.runtimeInfo().then(setRuntime).catch(console.error);
    bridge.listAccounts().then(list=>{setAccounts(list);setActiveId(list.find(a=>a.isDefault)?.id||list[0]?.id);}).catch(()=>undefined);
  },[]);
  useEffect(()=>{bridge.listCachedMessages(activeAccount?.id).then(setMessages).catch(()=>setMessages([]));},[activeAccount?.id]);
  useEffect(()=>{
    localStorage.setItem("seven-mail:settings",JSON.stringify(settings));
    const theme = settings.theme==="system" ? (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light") : settings.theme;
    document.documentElement.dataset.theme=theme;
    document.documentElement.dataset.density=settings.compact?"compact":"comfortable";
  },[settings]);

  const filtered = useMemo(()=>{
    const q=search.trim().toLowerCase();
    return q ? messages.filter(m=>[m.subject,m.preview,m.from.name,m.from.email].filter(Boolean).some(v=>v!.toLowerCase().includes(q))) : messages;
  },[messages,search]);

  return <div className="app-shell">
    <aside className="nav-rail">
      <Logo/>
      <nav>{NAV.map(item=><button key={item.id} className={section===item.id?"nav-item active":"nav-item"} title={item.label} onClick={()=>setSection(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <button className="profile" onClick={()=>setAccountOpen(true)}>{activeAccount?activeAccount.displayName[0].toUpperCase():<Icon name="userplus" size={17}/>}</button>
    </aside>
    <main className="main">
      <header className="topbar" data-tauri-drag-region>
        <div className="product"><strong>Seven Mail</strong><span>{NAV.find(n=>n.id===section)?.label}</span></div>
        <label className="search"><Icon name="search" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar e-mails, pessoas, eventos..."/><kbd>Ctrl K</kbd></label>
        <div className="top-actions"><span className="sync"><i/> Sincronizado</span><button className="icon-button" onClick={()=>setSection("settings")}><Icon name="settings" size={18}/></button></div>
      </header>
      <div className="content">
        {section==="mail"&&<MailView accounts={accounts} messages={filtered} activeAccount={activeAccount} onCompose={()=>setComposeOpen(true)} onAdd={()=>setAccountOpen(true)}/>}
        {section==="calendar"&&<CalendarView/>}
        {section==="people"&&<PeopleView/>}
        {section==="tasks"&&<TasksView/>}
        {section==="notes"&&<NotesView/>}
        {section==="rules"&&<RulesView/>}
        {section==="settings"&&<SettingsView settings={settings} onChange={setSettings} runtime={runtime}/>}
      </div>
    </main>
    {composeOpen&&<ComposeModal account={activeAccount} onClose={()=>setComposeOpen(false)}/>}
    {accountOpen&&<AddAccountModal onClose={()=>setAccountOpen(false)} onAdded={account=>{setAccounts(v=>[...v,account]);setActiveId(account.id);}}/>}
  </div>;
}

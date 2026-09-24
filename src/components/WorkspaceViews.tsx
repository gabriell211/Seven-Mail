import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { bridge } from "../lib/bridge";
import { pushCloudDocument } from "../lib/neon";
import { syncWorkspaceCollection } from "../lib/workspace-sync";
import type {
  CalendarEvent,
  ContactItem,
  NoteItem,
  RuleItem,
  TaskItem,
  WorkspaceDocument,
  WorkspaceKind,
} from "../types";

const COLORS = ["#7868ff", "#21a6a1", "#ef7350", "#cb59d8", "#3d83f6"];

function nowLocalInput(offsetMinutes = 0): string {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function useWorkspace<T extends { id: string }>(kind: WorkspaceKind) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    try {
      const documents = await syncWorkspaceCollection<T>(kind);
      setItems(documents.map((document) => document.payload));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    const sync = () => void reload();
    window.addEventListener("seven-mail:cloud-session", sync);
    return () => window.removeEventListener("seven-mail:cloud-session", sync);
  }, [kind]);

  async function save(item: T) {
    const document: WorkspaceDocument<T> = {
      id: item.id,
      kind,
      updatedAt: new Date().toISOString(),
      payload: item,
    };
    await bridge.upsertWorkspace(document);
    setItems((current) => [item, ...current.filter((value) => value.id !== item.id)]);
    void pushCloudDocument(document).catch(() => undefined);
  }

  async function remove(id: string) {
    const tombstone = await bridge.deleteWorkspace(kind, id);
    setItems((current) => current.filter((value) => value.id !== id));
    void pushCloudDocument(tombstone).catch(() => undefined);
  }

  return { items, loading, save, remove, reload };
}

function Workspace({
  title,
  eyebrow,
  action,
  onAction,
  children,
}: {
  title: string;
  eyebrow: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="workspace">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
        </div>
        {action && (
          <button className="primary" onClick={onAction}>
            <Icon name="plus" size={15} />
            {action}
          </button>
        )}
      </header>
      {children}
    </div>
  );
}

function EditorModal({
  title,
  eyebrow,
  onClose,
  children,
  onSave,
  saveLabel = "Salvar",
  disabled = false,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  onSave: () => void | Promise<void>;
  saveLabel?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function save() {
    if (disabled || busy) return;
    setBusy(true);
    try {
      await onSave();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal entity-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header compact-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </header>
        <div className="entity-form">{children}</div>
        <footer className="modal-footer">
          <button className="secondary" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={disabled || busy} onClick={() => void save()}>
            {busy ? "Salvando..." : saveLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="empty-state small workspace-empty">
      <div className="empty-symbol"><Icon name={icon} size={29} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function PersistentCalendarView() {
  const store = useWorkspace<CalendarEvent>("calendar");
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [month, setMonth] = useState(() => new Date());

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of store.items) {
      const key = new Date(event.startAt).toDateString();
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [store.items]);

  function fresh(): CalendarEvent {
    return {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      location: "",
      startAt: nowLocalInput(60),
      endAt: nowLocalInput(120),
      allDay: false,
      color: COLORS[0],
      participants: [],
    };
  }

  return (
    <Workspace
      title={month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
      eyebrow="CALENDÁRIO"
      action="Novo evento"
      onAction={() => setEditing(fresh())}
    >
      <div className="calendar-toolbar">
        <button className="secondary" onClick={() => setMonth(new Date())}>Hoje</button>
        <div className="icon-group">
          <button className="icon-button" aria-label="Mês anterior" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><Icon name="chevron" size={16} /></button>
          <button className="icon-button next-chevron" aria-label="Próximo mês" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><Icon name="chevron" size={16} /></button>
        </div>
      </div>
      <div className="calendar">
        <div className="week">{["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="days">
          {days.map((date) => {
            const events = eventsByDay.get(date.toDateString()) ?? [];
            const outside = date.getMonth() !== month.getMonth();
            const today = date.toDateString() === new Date().toDateString();
            return (
              <div className={`day ${outside ? "outside" : ""} ${today ? "today" : ""}`} key={date.toISOString()}>
                <span>{date.getDate()}</span>
                <div className="day-events">
                  {events.slice(0, 3).map((event) => (
                    <button key={event.id} className="calendar-event" style={{ borderLeftColor: event.color }} onClick={() => setEditing(event)}>
                      <b>{event.title || "Sem título"}</b>
                      {!event.allDay && <small>{new Date(event.startAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>}
                    </button>
                  ))}
                  {events.length > 3 && <small className="more-events">+{events.length - 3} eventos</small>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {editing && (
        <CalendarEditor
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => store.save(editing)}
          onDelete={store.items.some((item) => item.id === editing.id) ? async () => { await store.remove(editing.id); setEditing(null); } : undefined}
        />
      )}
    </Workspace>
  );
}

function CalendarEditor({
  value,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  value: CalendarEvent;
  onChange: (value: CalendarEvent) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  return (
    <EditorModal title={value.title || "Novo evento"} eyebrow="EVENTO" onClose={onClose} onSave={onSave} disabled={!value.title.trim() || !value.startAt || !value.endAt}>
      <label className="full"><span>Título</span><input autoFocus value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label>
      <label><span>Início</span><input type="datetime-local" value={value.startAt.slice(0, 16)} onChange={(event) => onChange({ ...value, startAt: event.target.value })} /></label>
      <label><span>Fim</span><input type="datetime-local" value={value.endAt.slice(0, 16)} onChange={(event) => onChange({ ...value, endAt: event.target.value })} /></label>
      <label className="full"><span>Local</span><input value={value.location} onChange={(event) => onChange({ ...value, location: event.target.value })} placeholder="Local ou link da reunião" /></label>
      <label className="full"><span>Participantes</span><input value={value.participants.join(", ")} onChange={(event) => onChange({ ...value, participants: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="email@exemplo.com, outro@exemplo.com" /></label>
      <label className="full"><span>Descrição</span><textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      <label className="inline-check"><input type="checkbox" checked={value.allDay} onChange={(event) => onChange({ ...value, allDay: event.target.checked })} /> Dia inteiro</label>
      {onDelete && <button className="danger-link" onClick={() => void onDelete()}><Icon name="trash" size={14} /> Excluir evento</button>}
    </EditorModal>
  );
}

export function PersistentPeopleView({ query = "" }: { query?: string }) {
  const store = useWorkspace<ContactItem>("contact");
  const [editing, setEditing] = useState<ContactItem | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return store.items;
    return store.items.filter((contact) => [contact.displayName, contact.email, contact.company, contact.phone].some((value) => value.toLowerCase().includes(needle)));
  }, [store.items, query]);

  function fresh(): ContactItem {
    return { id: crypto.randomUUID(), displayName: "", email: "", phone: "", company: "", jobTitle: "", notes: "", favorite: false };
  }

  return (
    <Workspace title="Contatos" eyebrow="PESSOAS" action="Novo contato" onAction={() => setEditing(fresh())}>
      {store.loading ? <Empty icon="people" title="Carregando contatos" text="Lendo o cache local..." /> : filtered.length === 0 ? (
        <Empty icon="people" title="Nenhum contato ainda" text="Crie contatos locais; a sincronização em nuvem mantém a mesma identidade em outros dispositivos." />
      ) : (
        <div className="contact-grid">
          {filtered.map((contact) => (
            <article className="contact-card" key={contact.id}>
              <button className="contact-main" onClick={() => setEditing(contact)}>
                <span className="avatar big">{contact.displayName[0]?.toUpperCase() || "?"}</span>
                <span><b>{contact.displayName}</b><small>{contact.jobTitle}{contact.company ? ` · ${contact.company}` : ""}</small><em>{contact.email || contact.phone}</em></span>
              </button>
              <div className="contact-actions">
                <button className={contact.favorite ? "icon-button active" : "icon-button"} aria-label="Favoritar" onClick={() => void store.save({ ...contact, favorite: !contact.favorite })}><Icon name="star" size={15} /></button>
                <button className="icon-button" aria-label="Excluir" onClick={() => void store.remove(contact.id)}><Icon name="trash" size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <EditorModal title={editing.displayName || "Novo contato"} eyebrow="CONTATO" onClose={() => setEditing(null)} onSave={() => store.save(editing)} disabled={!editing.displayName.trim()}>
          <label className="full"><span>Nome</span><input autoFocus value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} /></label>
          <label><span>E-mail</span><input type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} /></label>
          <label><span>Telefone</span><input value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} /></label>
          <label><span>Empresa</span><input value={editing.company} onChange={(event) => setEditing({ ...editing, company: event.target.value })} /></label>
          <label><span>Cargo</span><input value={editing.jobTitle} onChange={(event) => setEditing({ ...editing, jobTitle: event.target.value })} /></label>
          <label className="full"><span>Observações</span><textarea value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
          <label className="inline-check"><input type="checkbox" checked={editing.favorite} onChange={(event) => setEditing({ ...editing, favorite: event.target.checked })} /> Favorito</label>
        </EditorModal>
      )}
    </Workspace>
  );
}

export function PersistentTasksView({ onOpenRelatedMessage }: { onOpenRelatedMessage?: (messageId: string) => void }) {
  const store = useWorkspace<TaskItem>("task");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<TaskItem | null>(null);

  const open = store.items.filter((task) => !task.completedAt);
  const completed = store.items.filter((task) => task.completedAt);

  async function quickAdd() {
    const title = draft.trim();
    if (!title) return;
    const task: TaskItem = {
      id: crypto.randomUUID(),
      title,
      notes: "",
      priority: "normal",
      listName: "Meu dia",
    };
    await store.save(task);
    setDraft("");
  }

  return (
    <Workspace title="Tarefas" eyebrow="MINHA AGENDA" action="Nova tarefa" onAction={() => setEditing({ id: crypto.randomUUID(), title: "", notes: "", priority: "normal", listName: "Meu dia" })}>
      <div className="task-board">
        <section className="task-column">
          <header><span>ABERTAS</span><b>{open.length}</b></header>
          {open.map((task) => (
            <div className="task-card" key={task.id}>
              <button className="task-check" aria-label="Concluir" onClick={() => void store.save({ ...task, completedAt: new Date().toISOString() })}><Icon name="check" size={13} /></button>
              <button className="task-copy" onClick={() => setEditing(task)}><b>{task.title}</b><small>{task.dueAt ? `Vence ${new Date(task.dueAt).toLocaleString("pt-BR")}` : task.listName}</small></button>
              <span className={`priority ${task.priority}`}>{task.priority === "high" ? "Alta" : task.priority === "low" ? "Baixa" : "Normal"}</span>
              {task.relatedMessageId && onOpenRelatedMessage && <button className="icon-button" title="Abrir e-mail relacionado" onClick={() => onOpenRelatedMessage(task.relatedMessageId!)}><Icon name="mail" size={14} /></button>}
              <button className="icon-button" onClick={() => void store.remove(task.id)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          <div className="quick-add"><Icon name="plus" size={15} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Adicionar tarefa" onKeyDown={(event) => { if (event.key === "Enter") void quickAdd(); }} /></div>
        </section>
        <section className="task-column muted">
          <header><span>CONCLUÍDAS</span><b>{completed.length}</b></header>
          {completed.slice(0, 10).map((task) => (
            <div className="task-card completed" key={task.id}>
              <button className="task-check done" aria-label="Reabrir" onClick={() => void store.save({ ...task, completedAt: undefined })}><Icon name="check" size={13} /></button>
              <button className="task-copy" onClick={() => setEditing(task)}><b>{task.title}</b><small>{task.completedAt ? new Date(task.completedAt).toLocaleDateString("pt-BR") : ""}</small></button>
              {task.relatedMessageId && onOpenRelatedMessage && <button className="icon-button" title="Abrir e-mail relacionado" onClick={() => onOpenRelatedMessage(task.relatedMessageId!)}><Icon name="mail" size={14} /></button>}
            </div>
          ))}
        </section>
      </div>
      {editing && (
        <EditorModal title={editing.title || "Nova tarefa"} eyebrow="TAREFA" onClose={() => setEditing(null)} onSave={() => store.save(editing)} disabled={!editing.title.trim()}>
          <label className="full"><span>Título</span><input autoFocus value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
          <label><span>Lista</span><input value={editing.listName} onChange={(event) => setEditing({ ...editing, listName: event.target.value })} /></label>
          <label><span>Prioridade</span><select value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: event.target.value as TaskItem["priority"] })}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>
          <label><span>Vencimento</span><input type="datetime-local" value={editing.dueAt?.slice(0, 16) ?? ""} onChange={(event) => setEditing({ ...editing, dueAt: event.target.value || undefined })} /></label>
          <label><span>Lembrete</span><input type="datetime-local" value={editing.reminderAt?.slice(0, 16) ?? ""} onChange={(event) => setEditing({ ...editing, reminderAt: event.target.value || undefined, reminderNotifiedAt: undefined })} /></label>
          <label className="full"><span>Notas</span><textarea value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
        </EditorModal>
      )}
    </Workspace>
  );
}

export function PersistentNotesView({ query = "" }: { query?: string }) {
  const store = useWorkspace<NoteItem>("note");
  const [editing, setEditing] = useState<NoteItem | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? store.items.filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(needle)) : store.items;
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [store.items, query]);

  const fresh = (): NoteItem => ({ id: crypto.randomUUID(), title: "", body: "", pinned: false, color: "#f5d96b" });

  return (
    <Workspace title="Notas" eyebrow="NOTAS" action="Nova nota" onAction={() => setEditing(fresh())}>
      {filtered.length === 0 ? <Empty icon="note" title="Nenhuma nota" text="Crie notas locais, fixe as importantes e encontre tudo pela pesquisa." /> : (
        <div className="notes">
          {filtered.map((note) => (
            <article className="note note-live" key={note.id} style={{ "--note-accent": note.color } as CSSProperties}>
              <div className="note-top"><i>●</i><button className={note.pinned ? "icon-button active" : "icon-button"} onClick={() => void store.save({ ...note, pinned: !note.pinned })}><Icon name="pin" size={14} /></button></div>
              <button className="note-content" onClick={() => setEditing(note)}><h3>{note.title || "Sem título"}</h3><p>{note.body || "Nota vazia"}</p></button>
              <footer><small>Salva localmente</small><button className="icon-button" onClick={() => void store.remove(note.id)}><Icon name="trash" size={13} /></button></footer>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <EditorModal title={editing.title || "Nova nota"} eyebrow="NOTA" onClose={() => setEditing(null)} onSave={() => store.save(editing)}>
          <label className="full"><span>Título</span><input autoFocus value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
          <label className="full"><span>Conteúdo</span><textarea className="note-editor" value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} /></label>
          <label><span>Cor</span><select value={editing.color} onChange={(event) => setEditing({ ...editing, color: event.target.value })}>{["#f5d96b", ...COLORS].map((color) => <option value={color} key={color}>{color}</option>)}</select></label>
          <label className="inline-check"><input type="checkbox" checked={editing.pinned} onChange={(event) => setEditing({ ...editing, pinned: event.target.checked })} /> Fixar nota</label>
        </EditorModal>
      )}
    </Workspace>
  );
}

export function PersistentRulesView({ onRunRules }: { onRunRules?: () => Promise<number> }) {
  const store = useWorkspace<RuleItem>("rule");
  const [editing, setEditing] = useState<RuleItem | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string>("");

  const fresh = (): RuleItem => ({
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    priority: store.items.length + 1,
    field: "from",
    operator: "contains",
    value: "",
    action: "archive",
    stopProcessing: false,
  });

  async function runRulesNow() {
    if (!onRunRules || running) return;
    setRunning(true);
    setRunResult("");
    try {
      const applied = await onRunRules();
      setRunResult(applied === 1 ? "1 ação aplicada" : `${applied} ações aplicadas`);
    } catch (reason) {
      setRunResult(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Workspace title="Regras" eyebrow="AUTOMAÇÕES" action="Nova regra" onAction={() => setEditing(fresh())}>
      <div className="rules-toolbar">
        <button className="secondary" disabled={!onRunRules || running || store.items.length === 0} onClick={() => void runRulesNow()}>
          <Icon name="refresh" size={14} /> {running ? "Executando..." : "Executar regras agora"}
        </button>
        {runResult && <span>{runResult}</span>}
      </div>
      {store.items.length === 0 ? (
        <div className="rule-card">
          <div className="empty-symbol"><Icon name="rule" size={28} /></div>
          <h2>Automatize a caixa de entrada</h2>
          <p>As regras ficam disponíveis offline e são avaliadas por prioridade. Ações compatíveis entram na mesma fila durável das operações de e-mail.</p>
        </div>
      ) : (
        <div className="rules-list">
          {[...store.items].sort((a, b) => a.priority - b.priority).map((rule) => (
            <article className={rule.enabled ? "rule-row" : "rule-row disabled"} key={rule.id}>
              <button className="rule-toggle" onClick={() => void store.save({ ...rule, enabled: !rule.enabled })}><i /></button>
              <button className="rule-copy" onClick={() => setEditing(rule)}>
                <b>{rule.name}</b>
                <span>SE <strong>{rule.field}</strong> {rule.operator === "contains" ? "contém" : "é"} <em>{rule.value}</em> → <strong>{rule.action}</strong></span>
              </button>
              <span className="rule-order">#{rule.priority}</span>
              <button className="icon-button" onClick={() => void store.remove(rule.id)}><Icon name="trash" size={14} /></button>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <EditorModal title={editing.name || "Nova regra"} eyebrow="REGRA" onClose={() => setEditing(null)} onSave={() => store.save(editing)} disabled={!editing.name.trim() || !editing.value.trim()}>
          <label className="full"><span>Nome</span><input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label><span>Campo</span><select value={editing.field} onChange={(event) => setEditing({ ...editing, field: event.target.value as RuleItem["field"] })}><option value="from">Remetente</option><option value="to">Destinatário</option><option value="subject">Assunto</option><option value="body">Corpo</option><option value="domain">Domínio</option></select></label>
          <label><span>Operador</span><select value={editing.operator} onChange={(event) => setEditing({ ...editing, operator: event.target.value as RuleItem["operator"] })}><option value="contains">Contém</option><option value="equals">É exatamente</option></select></label>
          <label className="full"><span>Valor</span><input value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} /></label>
          <label><span>Ação</span><select value={editing.action} onChange={(event) => setEditing({ ...editing, action: event.target.value as RuleItem["action"] })}><option value="archive">Arquivar</option><option value="delete">Excluir</option><option value="spam">Marcar como spam</option><option value="flag">Sinalizar</option><option value="read">Marcar como lida</option></select></label>
          <label><span>Prioridade</span><input type="number" min={1} value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: Math.max(1, Number(event.target.value) || 1) })} /></label>
          <label className="inline-check"><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} /> Regra ativa</label>
          <label className="inline-check"><input type="checkbox" checked={Boolean(editing.stopProcessing)} onChange={(event) => setEditing({ ...editing, stopProcessing: event.target.checked })} /> Parar após esta regra</label>
        </EditorModal>
      )}
    </Workspace>
  );
}

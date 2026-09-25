import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Icon, type IconName } from "../icons";
import { bridge } from "../lib/bridge";
import { pushCloudDocument } from "../lib/neon";
import { syncWorkspaceCollection } from "../lib/workspace-sync";
import {
  eventConflicts,
  exceptionOccurrence,
  expandCalendarEvents,
  splitRecurringSeries,
  suggestMeetingSlots,
  type CalendarOccurrence,
} from "../lib/calendar-recurrence";
import {
  contactsFromCsv,
  contactsFromVcard,
  contactsToCsv,
  contactsToVcard,
  eventsFromIcs,
  eventsToIcs,
  eventInvitationToIcs,
} from "../lib/interchange";
import type {
  AccountProfile,
  AppSettings,
  CalendarEvent,
  CalendarListItem,
  ContactGroupItem,
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

export function PersistentCalendarView({ accounts = [], settings }: { accounts?: AccountProfile[]; settings: AppSettings }) {
  const store = useWorkspace<CalendarEvent>("calendar");
  const calendars = useWorkspace<CalendarListItem>("calendar-list");
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [editingOccurrence,setEditingOccurrence]=useState<{sourceId:string;originalStart:string}|null>(null);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"day" | "three" | "week" | "workweek" | "month" | "agenda" | "side">("month");
  const [eventClipboard,setEventClipboard]=useState<{event:CalendarEvent;mode:"copy"|"cut"}|null>(null);
  const [clock,setClock]=useState(()=>new Date());
  const locale=settings.locale??"pt-BR";
  const hour12=settings.timeFormat==="12";
  const firstDayOfWeek=settings.firstDayOfWeek??0;
  const workDays=settings.workDays??[1,2,3,4,5];

  useEffect(()=>{
    const timer=window.setInterval(()=>setClock(new Date()),60_000);
    return ()=>window.clearInterval(timer);
  },[]);

  const dateStyle=settings.dateFormat==="long"?"long":settings.dateFormat==="medium"?"medium":"short";

  const formatCalendarTime=(value:string|Date,timeZone?:string)=>new Intl.DateTimeFormat(locale,{
    hour:"2-digit",
    minute:"2-digit",
    hour12,
    timeZone:timeZone||settings.timezone||undefined,
  }).format(typeof value==="string"?new Date(value):value);

  const formatCalendarDate=(value:string|Date,options?:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(locale,{
    ...(options??{dateStyle}),
    timeZone:settings.timezone||undefined,
  }).format(typeof value==="string"?new Date(value):value);

  const localCalendar:CalendarListItem={id:"local",name:"Local",color:COLORS[0],visible:true};
  const calendarList:CalendarListItem[]=calendars.items.some((item)=>item.id==="local")
    ? calendars.items
    : [localCalendar,...calendars.items];
  const visibleCalendarIds=new Set(calendarList.filter((item)=>item.visible!==false).map((item)=>item.id));
  const visibleEvents=store.items.filter((event)=>visibleCalendarIds.has(event.calendarId??"local"));
  const expandedEvents=useMemo(()=>{
    const rangeStart=new Date(cursor.getFullYear()-1,0,1);
    const rangeEnd=new Date(cursor.getFullYear()+2,11,31,23,59,59,999);
    return expandCalendarEvents(visibleEvents,rangeStart,rangeEnd);
  },[visibleEvents,cursor.getFullYear()]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(first);
  const monthOffset=(first.getDay()-firstDayOfWeek+7)%7;
  gridStart.setDate(first.getDate() - monthOffset);
  const monthDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  const weekStart = useMemo(() => {
    const date = new Date(cursor);
    date.setHours(0, 0, 0, 0);
    const offset=(date.getDay()-firstDayOfWeek+7)%7;
    date.setDate(date.getDate()-offset);
    return date;
  }, [cursor,firstDayOfWeek]);

  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const workWeekDays=weekDays.filter((date)=>workDays.includes(date.getDay()));
  const workWeekStart=workWeekDays[0]??weekStart;
  const threeDays=Array.from({length:3},(_,index)=>{
    const date=new Date(cursor);date.setHours(0,0,0,0);date.setDate(date.getDate()+index);return date;
  });
  const displayWeekDays=view==="workweek"?workWeekDays:view==="three"?threeDays:weekDays;

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const event of expandedEvents) {
      const key = new Date(event.startAt).toDateString();
      const list = [...(map.get(key) ?? []), event]
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      map.set(key, list);
    }
    return map;
  }, [expandedEvents]);

  const agenda = useMemo(
    () => [...expandedEvents].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [expandedEvents],
  );

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
      calendarId:calendarList.find((item)=>item.visible!==false)?.id??calendarList[0]?.id??"local",
      accountId:(calendarList.find((item)=>item.visible!==false)?.accountId)??accounts.find((account)=>account.isDefault)?.id??accounts[0]?.id,
      requiredParticipants:[],
      optionalParticipants:[],
      resources:[],
      isPrivate:false,
      recurrence:"none",
      categories:[],
      status:"confirmed",
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  function shiftPeriod(direction: -1 | 1) {
    setCursor((current) => {
      const next = new Date(current);
      if (view === "day") next.setDate(next.getDate() + direction);
      else if (view === "three") next.setDate(next.getDate() + direction * 3);
      else if (view === "week" || view === "workweek") next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  }

  function title(): string {
    if (view === "day") {
      return formatCalendarDate(cursor,{weekday:"long",day:"numeric",month:"long"});
    }
    if (view === "week" || view === "workweek" || view === "three") {
      const days=view==="workweek"?workWeekDays:view==="three"?threeDays:weekDays;
      const start=days[0]??cursor;
      const end=days[days.length-1]??cursor;
      return `${formatCalendarDate(start,{day:"2-digit",month:"short"})} – ${formatCalendarDate(end,{day:"2-digit",month:"short",year:"numeric"})}`;
    }
    if (view === "agenda") return "Agenda";
    return formatCalendarDate(cursor,{month:"long",year:"numeric"});
  }

  async function importIcs() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Calendário ICS", extensions: ["ics"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    const raw = await bridge.readTextFile(selected);
    const events = eventsFromIcs(raw);
    if (events.length === 0) {
      window.alert("Nenhum evento válido foi encontrado no arquivo ICS.");
      return;
    }
    for (const event of events) await store.save(event);
    window.alert(events.length === 1 ? "1 evento importado." : `${events.length} eventos importados.`);
  }

  async function addHolidayCalendar() {
    const calendarId=`holidays-${locale.toLowerCase()}`;
    if(!calendars.items.some((item)=>item.id===calendarId)){
      await calendars.save({id:calendarId,name:"Feriados",color:"#e15d5d",visible:true});
    }
    const year=cursor.getFullYear();
    const fixed=locale==="pt-BR"
      ? [
          [0,1,"Confraternização Universal"],
          [3,21,"Tiradentes"],
          [4,1,"Dia do Trabalho"],
          [8,7,"Independência do Brasil"],
          [9,12,"Nossa Senhora Aparecida"],
          [10,2,"Finados"],
          [10,15,"Proclamação da República"],
          [10,20,"Consciência Negra"],
          [11,25,"Natal"],
        ] as const
      : [
          [0,1,"New Year"],
          [11,25,"Christmas"],
        ] as const;
    for(const [month,day,title] of fixed){
      const start=new Date(year,month,day);
      const id=`${calendarId}-${year}-${month+1}-${day}`;
      await store.save({
        id,
        title,
        description:"",
        location:"",
        startAt:start.toISOString(),
        endAt:new Date(year,month,day+1).toISOString(),
        allDay:true,
        color:"#e15d5d",
        participants:[],
        calendarId,
        recurrence:"none",
        categories:["Feriado"],
        status:"confirmed",
      });
    }
  }

  async function importHolidayIcs() {
    const selected=await open({multiple:false,directory:false,filters:[{name:"Feriados ICS",extensions:["ics"]}]});
    if(!selected||Array.isArray(selected)) return;
    const raw=await bridge.readTextFile(selected);
    const events=eventsFromIcs(raw);
    if(events.length===0){window.alert("Nenhum feriado válido encontrado.");return;}
    const calendarId="holidays-custom";
    if(!calendars.items.some((item)=>item.id===calendarId)){
      await calendars.save({id:calendarId,name:"Feriados personalizados",color:"#d06d3f",visible:true});
    }
    for(const event of events){
      await store.save({...event,id:crypto.randomUUID(),calendarId,color:"#d06d3f",categories:[...new Set([...(event.categories??[]),"Feriado"])]});
    }
  }

  async function exportIcs() {
    const destination = await saveDialog({
      defaultPath: "seven-mail-calendar.ics",
      filters: [{ name: "Calendário ICS", extensions: ["ics"] }],
    });
    if (!destination) return;
    await bridge.writeTextFile(destination, eventsToIcs(store.items));
  }

  async function createCalendar() {
    const name=window.prompt("Nome do calendário")?.trim();
    if(!name) return;
    const defaultAccount=accounts.find((account)=>account.isDefault)??accounts[0];
    const accountEmail=accounts.length
      ? window.prompt("Conta do calendário (deixe vazio para local)",defaultAccount?.email??"")?.trim()
      : "";
    const account=accounts.find((item)=>item.email.toLocaleLowerCase("pt-BR")===accountEmail?.toLocaleLowerCase("pt-BR"));
    await calendars.save({
      id:crypto.randomUUID(),
      name,
      color:COLORS[calendarList.length%COLORS.length],
      visible:true,
      accountId:account?.id,
    });
  }

  async function toggleCalendar(calendar:CalendarListItem) {
    if(calendar.id==="local"&&!calendars.items.some((item)=>item.id==="local")){
      await calendars.save({...calendar,visible:false});
      return;
    }
    await calendars.save({...calendar,visible:calendar.visible===false});
  }

  async function removeCalendar(calendar:CalendarListItem) {
    if(calendar.id==="local") return;
    if(!window.confirm(`Excluir o calendário "${calendar.name}"? Os eventos permanecerão locais e serão movidos para Local.`)) return;
    for(const event of store.items.filter((item)=>item.calendarId===calendar.id)){
      await store.save({...event,calendarId:"local"});
    }
    await calendars.remove(calendar.id);
  }

  async function moveOccurrenceToDate(occurrence:CalendarOccurrence,targetDate:Date) {
    const source=store.items.find((item)=>item.id===occurrence.sourceEventId)??store.items.find((item)=>item.id===occurrence.id);
    if(!source) return;
    const oldStart=new Date(occurrence.startAt);
    const oldEnd=new Date(occurrence.endAt);
    const duration=Math.max(15*60_000,oldEnd.getTime()-oldStart.getTime());
    const nextStart=new Date(targetDate);
    nextStart.setHours(oldStart.getHours(),oldStart.getMinutes(),oldStart.getSeconds(),0);
    const nextEnd=new Date(nextStart.getTime()+duration);

    if(source.recurrence&&source.recurrence!=="none"&&occurrence.occurrenceOriginalStart){
      const {series,exception}=exceptionOccurrence(source,occurrence.occurrenceOriginalStart,{
        ...occurrence,
        id:undefined as never,
        startAt:nextStart.toISOString(),
        endAt:nextEnd.toISOString(),
        recurrence:"none",
        recurrenceParentId:source.id,
      });
      await store.save(series);
      await store.save(exception);
      return;
    }

    await store.save({...source,startAt:nextStart.toISOString(),endAt:nextEnd.toISOString()});
  }

  async function pasteCalendarEvent(targetDate?:Date) {
    if(!eventClipboard) return;
    const source=eventClipboard.event;
    const originalStart=new Date(source.startAt);
    const duration=Math.max(15*60_000,new Date(source.endAt).getTime()-originalStart.getTime());
    const nextStart=targetDate?new Date(targetDate):new Date(originalStart.getTime()+24*60*60_000);
    if(targetDate) nextStart.setHours(originalStart.getHours(),originalStart.getMinutes(),originalStart.getSeconds(),0);
    const next:CalendarEvent={
      ...source,
      id:crypto.randomUUID(),
      title:eventClipboard.mode==="copy"?`${source.title} (cópia)`:source.title,
      startAt:nextStart.toISOString(),
      endAt:new Date(nextStart.getTime()+duration).toISOString(),
      recurrenceParentId:undefined,
      occurrenceOriginalStart:undefined,
      reminderNotifiedAt:undefined,
    };
    await store.save(next);
    if(eventClipboard.mode==="cut"){
      await store.remove(source.id);
      setEventClipboard(null);
    }
    setEditing(next);
  }

  async function duplicateEvent(event:CalendarEvent) {
    await store.save({
      ...event,
      id:crypto.randomUUID(),
      title:`${event.title} (cópia)`,
      status:"confirmed",
      reminderNotifiedAt:undefined,
      recurrenceParentId:undefined,
      occurrenceOriginalStart:undefined,
    });
  }

  function openOccurrence(event:CalendarOccurrence) {
    const source=store.items.find((item)=>item.id===event.sourceEventId);
    if(!source||!source.recurrence||source.recurrence==="none"||event.recurrenceParentId){
      setEditing(event);
      setEditingOccurrence(null);
      return;
    }
    setEditing({...source,startAt:event.startAt,endAt:event.endAt});
    setEditingOccurrence({sourceId:source.id,originalStart:event.startAt});
  }

  async function saveThisOccurrence() {
    if(!editing||!editingOccurrence) return;
    const source=store.items.find((item)=>item.id===editingOccurrence.sourceId);
    if(!source) return;
    const {series,exception}=exceptionOccurrence(source,editingOccurrence.originalStart,{
      ...editing,
      id:undefined as never,
      recurrence:"none",
      recurrenceParentId:source.id,
    });
    await store.save(series);
    await store.save(exception);
    setEditing(null);
    setEditingOccurrence(null);
  }

  async function saveFollowingOccurrences() {
    if(!editing||!editingOccurrence) return;
    const source=store.items.find((item)=>item.id===editingOccurrence.sourceId);
    if(!source) return;
    const {previous,following}=splitRecurringSeries(source,editingOccurrence.originalStart,{
      ...editing,
      id:undefined as never,
    });
    await store.save(previous);
    await store.save(following);
    setEditing(null);
    setEditingOccurrence(null);
  }

  function eventAccount(event:CalendarEvent):AccountProfile|undefined {
    const calendar=calendarList.find((item)=>item.id===(event.calendarId??"local"));
    return accounts.find((item)=>item.id===(event.accountId??calendar?.accountId))
      ?? accounts.find((item)=>item.isDefault)
      ?? accounts[0];
  }

  async function sendMeeting(event:CalendarEvent,method:"REQUEST"|"CANCEL") {
    const account=eventAccount(event);
    if(!account) {
      window.alert("Associe o calendário a uma conta de e-mail antes de enviar convites.");
      return;
    }
    const recipients=[...(event.requiredParticipants?.length?event.requiredParticipants:event.participants),...(event.optionalParticipants??[])];
    const unique=[...new Set(recipients.map((item)=>item.trim()).filter(Boolean).filter((item)=>item.toLocaleLowerCase("pt-BR")!==account.email.toLocaleLowerCase("pt-BR")))];
    if(unique.length===0){
      window.alert("Adicione pelo menos um participante.");
      return;
    }
    const ics=eventInvitationToIcs({...event,organizer:account.email},account.email,method);
    await bridge.queueOperation({
      id:crypto.randomUUID(),
      kind:"send",
      accountId:account.id,
      createdAt:new Date().toISOString(),
      attempts:0,
      payload:{
        fromAddress:account.email,
        to:unique.join(", "),
        cc:"",
        bcc:"",
        subject:`${method==="CANCEL"?"Cancelado:":event.status==="draft"?"Convite:":"Reunião:"} ${event.title}`,
        bodyText:`${method==="CANCEL"?"Esta reunião foi cancelada.":"Você foi convidado para uma reunião."}\n\n${event.title}\n${new Date(event.startAt).toLocaleString("pt-BR")}${event.location?`\n${event.location}`:""}`,
        bodyHtml:"",
        attachments:[],
        calendarIcs:ics,
        calendarMethod:method,
        priority:"normal",
        requestReadReceipt:false,
        requestDeliveryReceipt:false,
        sendAt:new Date().toISOString(),
      },
    });
    await bridge.flushOutbox().catch(()=>undefined);
    await store.save({...event,organizer:account.email,status:method==="CANCEL"?"cancelled":"confirmed"});
    window.alert(method==="CANCEL"?"Cancelamento enviado.":"Convite/atualização enviado.");
  }

  async function respondMeeting(event:CalendarEvent,response:NonNullable<CalendarEvent["attendeeResponse"]>) {
    const account=eventAccount(event);
    if(!account||!event.organizer) return;
    const updated={
      ...event,
      attendeeResponse:response,
      freeBusyStatus:response==="declined"?"free":response==="tentative"?"tentative":"busy",
    } as CalendarEvent;
    await store.save(updated);
    const ics=eventInvitationToIcs(updated,event.organizer,"REPLY",response,account.email);
    await bridge.queueOperation({
      id:crypto.randomUUID(),
      kind:"send",
      accountId:account.id,
      createdAt:new Date().toISOString(),
      attempts:0,
      payload:{
        fromAddress:account.email,
        to:event.organizer,
        cc:"",
        bcc:"",
        subject:`Re: ${event.title}`,
        bodyText:response==="accepted"?"Aceito":response==="tentative"?"Aceito provisoriamente":"Recusado",
        bodyHtml:"",
        attachments:[],
        calendarIcs:ics,
        calendarMethod:"REPLY",
        priority:"normal",
        requestReadReceipt:false,
        requestDeliveryReceipt:false,
        sendAt:new Date().toISOString(),
      },
    });
    await bridge.flushOutbox().catch(()=>undefined);
    setEditing(updated);
  }

  const EventButton = ({ event }: { event: CalendarOccurrence }) => (
    <button
      className="calendar-event"
      draggable
      style={{ borderLeftColor: event.color }}
      onClick={() => openOccurrence(event)}
      onDragStart={(dragEvent)=>{
        dragEvent.dataTransfer.effectAllowed="move";
        dragEvent.dataTransfer.setData("application/x-seven-calendar-event",event.occurrenceId);
      }}
    >
      <b>{event.title || "Sem título"}</b>
      {!event.allDay && <small>{formatCalendarTime(event.startAt,event.timezone)}</small>}
      {event.location && <small>{event.location}</small>}
    </button>
  );

  function CalendarDropZone({date,children,className}:{date:Date;children:ReactNode;className?:string}){
    return <div className={className} onDragOver={(event)=>{if(event.dataTransfer.types.includes("application/x-seven-calendar-event"))event.preventDefault();}} onDrop={(event)=>{
      const id=event.dataTransfer.getData("application/x-seven-calendar-event");
      const occurrence=expandedEvents.find((item)=>item.occurrenceId===id);
      if(occurrence){event.preventDefault();void moveOccurrenceToDate(occurrence,date);}
    }}>{children}</div>;
  }

  return (
    <Workspace
      title={title()}
      eyebrow="CALENDÁRIO"
      action="Novo evento"
      onAction={() => setEditing(fresh())}
    >
      <div className="calendar-toolbar">
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => setCursor(new Date())}>Hoje</button>
          <div className="calendar-view-switch">
            {(["day","three","week","workweek","month","agenda","side"] as const).map((item) => (
              <button className={view === item ? "active" : ""} key={item} onClick={() => setView(item)}>
                {item==="day"?"Dia":item==="three"?"3 dias":item==="week"?"Semana":item==="workweek"?"Semana útil":item==="month"?"Mês":item==="agenda"?"Agenda":"Lado a lado"}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={() => void createCalendar()}><Icon name="plus" size={14}/> Calendário</button>
          <button className="secondary" onClick={()=>void addHolidayCalendar()}><Icon name="calendar" size={14}/> Feriados</button>
          <button className="secondary" onClick={()=>void importHolidayIcs()}><Icon name="upload" size={14}/> Feriados ICS</button>
          {eventClipboard&&<button className="secondary" onClick={()=>void pasteCalendarEvent(cursor)}><Icon name="copy" size={14}/> Colar evento</button>}
          <button className="secondary" onClick={() => void importIcs()}><Icon name="upload" size={14}/> Importar ICS</button>
          <button className="secondary" disabled={store.items.length===0} onClick={() => void exportIcs()}><Icon name="download" size={14}/> Exportar ICS</button>
        </div>
        {view !== "agenda" && <div className="icon-group">
          <button className="icon-button" aria-label="Período anterior" onClick={() => shiftPeriod(-1)}><Icon name="chevron" size={16} /></button>
          <button className="icon-button next-chevron" aria-label="Próximo período" onClick={() => shiftPeriod(1)}><Icon name="chevron" size={16} /></button>
        </div>}
      </div>

      <div className="calendar-timezones"><span><b>{settings.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone}</b>{formatCalendarTime(clock,settings.timezone)}</span>{(settings.secondaryTimezones??[]).map((zone)=><span key={zone}><b>{zone}</b>{formatCalendarTime(clock,zone)}</span>)}{settings.workplace&&<span><b>Local</b>{settings.workplace}</span>}</div>
      <div className="calendar-list-bar">
        {calendarList.map((calendar)=><span className={calendar.visible===false?"calendar-pill muted":"calendar-pill"} key={calendar.id}>
          <button onClick={()=>void toggleCalendar(calendar)}><i style={{background:calendar.color}}/>{calendar.name}{calendar.accountId&&<small>{accounts.find((item)=>item.id===calendar.accountId)?.email??""}</small>}</button>
          {calendar.id!=="local"&&<button aria-label={`Excluir calendário ${calendar.name}`} onClick={()=>void removeCalendar(calendar)}><Icon name="x" size={10}/></button>}
        </span>)}
      </div>

      {view==="side"&&<div className="calendar-side-by-side">
        {calendarList.filter((calendar)=>calendar.visible!==false).map((calendar)=>{
          const events=expandedEvents.filter((event)=>(event.calendarId??"local")===calendar.id).slice(0,30);
          return <section key={calendar.id}><header><i style={{background:calendar.color}}/><div><b>{calendar.name}</b><small>{calendar.accountId?accounts.find((item)=>item.id===calendar.accountId)?.email??"Conta removida":"Local"}</small></div></header><div>{events.length?events.map((event)=><EventButton key={event.occurrenceId} event={event}/>):<small className="mini-empty">Sem eventos</small>}</div></section>;
        })}
      </div>}

      {view === "month" && <div className="calendar">
        <div className="week">{["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="days">
          {monthDays.map((date) => {
            const events = eventsByDay.get(date.toDateString()) ?? [];
            const outside = date.getMonth() !== cursor.getMonth();
            const today = date.toDateString() === new Date().toDateString();
            return (
              <CalendarDropZone className={`day ${outside ? "outside" : ""} ${today ? "today" : ""}`} date={date} key={date.toISOString()}>
                <span>{date.getDate()}</span>
                <div className="day-events">
                  {events.slice(0, 3).map((event) => <EventButton key={event.occurrenceId} event={event} />)}
                  {events.length > 3 && <small className="more-events">+{events.length - 3} eventos</small>}
                </div>
              </CalendarDropZone>
            );
          })}
        </div>
      </div>}

      {(view==="week"||view==="workweek"||view==="three") && <div className="calendar-week-grid" style={{gridTemplateColumns:`repeat(${displayWeekDays.length},minmax(160px,1fr))`}}>
        {displayWeekDays.map((date) => {
          const events = eventsByDay.get(date.toDateString()) ?? [];
          const today = date.toDateString() === new Date().toDateString();
          return <CalendarDropZone className={today ? "calendar-week-day today" : "calendar-week-day"} date={date} key={date.toISOString()}>
            <header><span>{formatCalendarDate(date,{weekday:"short"}).toUpperCase()}</span><b>{date.getDate()}</b></header>
            <div>{events.length ? events.map((event)=><EventButton key={event.occurrenceId} event={event}/>) : <small className="mini-empty">Sem eventos</small>}</div>
          </CalendarDropZone>;
        })}
      </div>}

      {view === "day" && <div className="calendar-day-list">
        {(eventsByDay.get(cursor.toDateString()) ?? []).length
          ? (eventsByDay.get(cursor.toDateString()) ?? []).map((event) => (
              <article className="agenda-row" key={event.occurrenceId}>
                <time>{event.allDay ? "Dia inteiro" : formatCalendarTime(event.startAt,event.timezone)}</time>
                <EventButton event={event}/>
              </article>
            ))
          : <Empty icon="calendar" title="Agenda livre" text="Nenhum evento neste dia."/>}
      </div>}

      {view === "agenda" && <div className="calendar-agenda">
        {agenda.length ? agenda.map((event) => (
          <article className="agenda-row" key={event.occurrenceId}>
            <time>{formatCalendarDate(event.startAt,{day:"2-digit",month:"short",year:"numeric"})}</time>
            <EventButton event={event}/>
          </article>
        )) : <Empty icon="calendar" title="Agenda vazia" text="Crie ou importe eventos para começar."/>}
      </div>}

      {editing && (
        <CalendarEditor
          value={editing}
          calendars={calendarList}
          allEvents={store.items}
          occurrence={editingOccurrence}
          onChange={setEditing}
          onClose={() => {setEditing(null);setEditingOccurrence(null);}}
          onSave={editingOccurrence?saveThisOccurrence:()=>store.save(editing)}
          onSaveFollowing={editingOccurrence?saveFollowingOccurrences:undefined}
          onEditSeries={editingOccurrence?()=>{const source=store.items.find((item)=>item.id===editingOccurrence.sourceId);if(source){setEditing(source);setEditingOccurrence(null);}}:undefined}
          onSendInvite={(event)=>sendMeeting(event,"REQUEST")}
          onCancelMeeting={(event)=>sendMeeting(event,"CANCEL")}
          onRespondMeeting={respondMeeting}
          currentAccount={editing?eventAccount(editing):undefined}
          onDuplicate={store.items.some((item)=>item.id===editing.id)?async()=>{await duplicateEvent(editing);setEditing(null);}:undefined}
          onCopy={()=>setEventClipboard({event:editing,mode:"copy"})}
          onCut={store.items.some((item)=>item.id===editing.id)?()=>{setEventClipboard({event:editing,mode:"cut"});setEditing(null);}:undefined}
          onDelete={store.items.some((item) => item.id === editing.id) ? async () => { await store.remove(editing.id); setEditing(null); } : undefined}
        />
      )}
    </Workspace>
  );
}

function CalendarEditor({
  value,
  calendars,
  allEvents,
  occurrence,
  onChange,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  onCopy,
  onCut,
  onSaveFollowing,
  onEditSeries,
  onSendInvite,
  onCancelMeeting,
  onRespondMeeting,
  currentAccount,
}: {
  value: CalendarEvent;
  calendars: CalendarListItem[];
  allEvents: CalendarEvent[];
  occurrence?: {sourceId:string;originalStart:string}|null;
  onChange: (value: CalendarEvent) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
  onCopy?: () => void;
  onCut?: () => void;
  onSaveFollowing?: () => Promise<void>;
  onEditSeries?: () => void;
  onSendInvite?: (event:CalendarEvent) => Promise<void>;
  onCancelMeeting?: (event:CalendarEvent) => Promise<void>;
  onRespondMeeting?: (event:CalendarEvent,response:NonNullable<CalendarEvent["attendeeResponse"]>) => Promise<void>;
  currentAccount?: AccountProfile;
}) {
  const conflicts=useMemo(()=>eventConflicts(value,allEvents),[value.startAt,value.endAt,value.id,allEvents]);
  const suggestions=useMemo(()=>conflicts.length?suggestMeetingSlots(value,allEvents,4):[],[value.startAt,value.endAt,value.id,allEvents,conflicts.length]);

  return (
    <EditorModal title={value.title || "Novo evento"} eyebrow={occurrence?"OCORRÊNCIA":"EVENTO"} onClose={onClose} onSave={onSave} saveLabel={occurrence?"Salvar esta ocorrência":"Salvar"} disabled={!value.title.trim() || !value.startAt || !value.endAt}>
      <label className="full"><span>Título</span><input autoFocus value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label>
      <label><span>Início</span><input type="datetime-local" value={value.startAt.slice(0, 16)} onChange={(event) => onChange({ ...value, startAt: event.target.value })} /></label>
      <label><span>Fim</span><input type="datetime-local" value={value.endAt.slice(0, 16)} onChange={(event) => onChange({ ...value, endAt: event.target.value })} /><span className="duration-controls"><button type="button" onClick={()=>onChange({...value,endAt:new Date(Math.max(new Date(value.startAt).getTime()+15*60_000,new Date(value.endAt).getTime()-15*60_000)).toISOString()})}>−15 min</button><button type="button" onClick={()=>onChange({...value,endAt:new Date(new Date(value.endAt).getTime()+15*60_000).toISOString()})}>+15 min</button></span></label>
      <label><span>Calendário</span><select value={value.calendarId??"local"} onChange={(event)=>onChange({...value,calendarId:event.target.value,color:calendars.find((item)=>item.id===event.target.value)?.color??value.color})}>{calendars.map((calendar)=><option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
      <label><span>Status</span><select value={value.status??"confirmed"} onChange={(event)=>onChange({...value,status:event.target.value as CalendarEvent["status"]})}><option value="confirmed">Confirmado</option><option value="draft">Rascunho</option><option value="cancelled">Cancelado</option></select></label>
      <label className="full"><span>Local</span><input value={value.location} onChange={(event) => onChange({ ...value, location: event.target.value })} placeholder="Local ou sala" /></label>
      <label className="full"><span>Reunião online</span><input value={value.onlineMeetingUrl??""} onChange={(event)=>onChange({...value,onlineMeetingUrl:event.target.value||undefined})} placeholder="https://..." /></label>
      <label className="full"><span>Participantes obrigatórios</span><input value={(value.requiredParticipants?.length?value.requiredParticipants:value.participants).join(", ")} onChange={(event) => {const list=event.target.value.split(",").map((item)=>item.trim()).filter(Boolean);onChange({ ...value, requiredParticipants:list,participants:list });}} placeholder="email@exemplo.com" /></label>
      <label className="full"><span>Participantes opcionais</span><input value={(value.optionalParticipants??[]).join(", ")} onChange={(event)=>onChange({...value,optionalParticipants:event.target.value.split(",").map((item)=>item.trim()).filter(Boolean)})}/></label>
      <label className="full"><span>Salas e recursos</span><input value={(value.resources??[]).join(", ")} onChange={(event)=>onChange({...value,resources:event.target.value.split(",").map((item)=>item.trim()).filter(Boolean)})} placeholder="Sala 1, Projetor"/></label>
      <label><span>Recorrência</span><select value={value.recurrence??"none"} onChange={(event)=>onChange({...value,recurrence:event.target.value as CalendarEvent["recurrence"]})}><option value="none">Não repetir</option><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
      <label><span>Repetir até</span><input type="date" value={value.recurrenceUntil?.slice(0,10)??""} disabled={!value.recurrence||value.recurrence==="none"} onChange={(event)=>onChange({...value,recurrenceUntil:event.target.value||undefined})}/></label>
      <label><span>Fuso horário</span><input value={value.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event)=>onChange({...value,timezone:event.target.value})}/></label>
      <label><span>Categorias</span><input value={(value.categories??[]).join(", ")} onChange={(event)=>onChange({...value,categories:event.target.value.split(",").map((item)=>item.trim()).filter(Boolean)})}/></label>
      {conflicts.length>0&&<div className="full scheduling-assistant"><header><b>{conflicts.length} conflito(s) detectado(s)</b><span>Horários livres sugeridos</span></header><div>{suggestions.map((slot)=><button key={slot.startAt} type="button" onClick={()=>onChange({...value,startAt:slot.startAt,endAt:slot.endAt})}>{new Date(slot.startAt).toLocaleString("pt-BR",{weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</button>)}</div></div>}
      <label><span>Mostrar como</span><select value={value.freeBusyStatus??"busy"} onChange={(event)=>onChange({...value,freeBusyStatus:event.target.value as CalendarEvent["freeBusyStatus"]})}><option value="busy">Ocupado</option><option value="tentative">Provisório</option><option value="free">Livre</option></select></label>
            <label className="full"><span>Descrição</span><textarea value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      <label><span>Lembrete</span><input type="datetime-local" value={value.reminderAt?.slice(0,16) ?? ""} onChange={(event) => onChange({ ...value, reminderAt: event.target.value || undefined, reminderNotifiedAt: undefined })} /></label>
      <label className="inline-check"><input type="checkbox" checked={value.allDay} onChange={(event) => onChange({ ...value, allDay: event.target.checked })} /> Dia inteiro</label>
      <label className="inline-check"><input type="checkbox" checked={Boolean(value.isPrivate)} onChange={(event)=>onChange({...value,isPrivate:event.target.checked})}/> Evento privado</label>
      <div className="full meeting-actions">
        {value.organizer&&currentAccount&&value.organizer.toLocaleLowerCase("pt-BR")!==currentAccount.email.toLocaleLowerCase("pt-BR")&&onRespondMeeting&&<>
          <button className={value.attendeeResponse==="accepted"?"secondary active":"secondary"} onClick={()=>void onRespondMeeting(value,"accepted")}>Aceitar</button>
          <button className={value.attendeeResponse==="tentative"?"secondary active":"secondary"} onClick={()=>void onRespondMeeting(value,"tentative")}>Provisório</button>
          <button className={value.attendeeResponse==="declined"?"secondary active":"secondary"} onClick={()=>void onRespondMeeting(value,"declined")}>Recusar</button>
        </>}
        {onSendInvite&&((value.requiredParticipants?.length??value.participants.length)+(value.optionalParticipants?.length??0)>0)&&<button className="secondary" onClick={()=>void onSendInvite(value)}><Icon name="send" size={13}/> Enviar/atualizar convite</button>}
        {onCancelMeeting&&value.organizer&&currentAccount&&value.organizer.toLocaleLowerCase("pt-BR")===currentAccount.email.toLocaleLowerCase("pt-BR")&&<button className="danger-link" onClick={()=>void onCancelMeeting(value)}>Cancelar reunião</button>}
      </div>
      {occurrence&&onEditSeries&&<button className="secondary" onClick={onEditSeries}>Editar série inteira</button>}
      {occurrence&&onSaveFollowing&&<button className="secondary" onClick={()=>void onSaveFollowing()}>Salvar esta e as próximas</button>}
      {onCopy&&<button className="secondary" onClick={onCopy}><Icon name="copy" size={14}/> Copiar</button>}
      {onCut&&<button className="secondary" onClick={onCut}>Recortar</button>}
      {onDuplicate && <button className="secondary" onClick={()=>void onDuplicate()}><Icon name="copy" size={14}/> Duplicar evento</button>}
      {onDelete && <button className="danger-link" onClick={() => void onDelete()}><Icon name="trash" size={14} /> Excluir evento</button>}
    </EditorModal>
  );
}

export function PersistentPeopleView({ query = "" }: { query?: string }) {
  const store = useWorkspace<ContactItem>("contact");
  const groups = useWorkspace<ContactGroupItem>("contact-group");
  const [editing, setEditing] = useState<ContactItem | null>(null);
  const [groupFilter,setGroupFilter]=useState("");
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return store.items.filter((contact) => {
      const groupIds=contact.groupIds??[];
      if(groupFilter&&!groupIds.includes(groupFilter)) return false;
      if(!needle) return true;
      const values=[
        contact.displayName,contact.firstName??"",contact.lastName??"",contact.nickname??"",
        contact.email,contact.company,contact.phone,contact.jobTitle,contact.notes,
        ...(contact.emails??[]),...(contact.phones??[]),...(contact.addresses??[]),...(contact.categories??[]),
      ];
      return values.some((value)=>value.toLowerCase().includes(needle));
    });
  }, [store.items, query, groupFilter]);

  function fresh(): ContactItem {
    return { id: crypto.randomUUID(), displayName: "", email: "", phone: "", company: "", jobTitle: "", notes: "", favorite: false, firstName:"", lastName:"", nickname:"", emails:[], phones:[], addresses:[], importantDates:[], categories:[], groupIds:[] };
  }

  async function importContacts() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Contatos", extensions: ["csv", "vcf", "vcard"] },
      ],
    });
    if (!selected || Array.isArray(selected)) return;
    const raw = await bridge.readTextFile(selected);
    const lower = selected.toLowerCase();
    const contacts = lower.endsWith(".csv") ? contactsFromCsv(raw) : contactsFromVcard(raw);
    if (contacts.length === 0) {
      window.alert("Nenhum contato válido foi encontrado.");
      return;
    }
    for (const contact of contacts) await store.save(contact);
    window.alert(contacts.length === 1 ? "1 contato importado." : `${contacts.length} contatos importados.`);
  }

  async function exportContacts(format: "csv" | "vcf") {
    const destination = await saveDialog({
      defaultPath: format === "csv" ? "seven-mail-contacts.csv" : "seven-mail-contacts.vcf",
      filters: [{
        name: format === "csv" ? "Contatos CSV" : "vCard",
        extensions: [format],
      }],
    });
    if (!destination) return;
    const content = format === "csv" ? contactsToCsv(store.items) : contactsToVcard(store.items);
    await bridge.writeTextFile(destination, content);
  }

  async function createContactGroup() {
    const name=window.prompt("Nome do grupo/lista")?.trim();
    if(!name) return;
    await groups.save({id:crypto.randomUUID(),name});
  }

  function toggleContactSelection(id:string) {
    setSelectedIds((current)=>current.includes(id)?current.filter((value)=>value!==id):[...current,id]);
  }

  async function deleteSelectedContacts() {
    if(selectedIds.length===0||!window.confirm(`Excluir ${selectedIds.length} contato(s)?`)) return;
    for(const id of selectedIds) await store.remove(id);
    setSelectedIds([]);
  }

  async function categorizeSelectedContacts() {
    if(selectedIds.length===0) return;
    const category=window.prompt("Categoria para adicionar")?.trim();
    if(!category) return;
    for(const contact of store.items.filter((item)=>selectedIds.includes(item.id))){
      await store.save({...contact,categories:[...new Set([...(contact.categories??[]),category])]});
    }
  }

  function duplicateSets(): string[][] {
    const byKey=new Map<string,Set<string>>();
    for(const contact of store.items){
      const values=[contact.email,contact.phone,...(contact.emails??[]),...(contact.phones??[])]
        .map((value)=>value.trim().toLowerCase()).filter(Boolean);
      for(const key of values){
        const ids=byKey.get(key)??new Set<string>();
        ids.add(contact.id);
        byKey.set(key,ids);
      }
    }
    const unique=new Map<string,string[]>();
    for(const ids of byKey.values()){
      if(ids.size<2) continue;
      const list=[...ids].sort();
      unique.set(list.join("|"),list);
    }
    return [...unique.values()];
  }

  async function pickContactPhoto() {
    if(!editing) return;
    const selected=await open({
      multiple:false,
      directory:false,
      filters:[{name:"Imagem do contato",extensions:["png","jpg","jpeg","gif","webp"]}],
    });
    if(!selected||Array.isArray(selected)) return;
    const dataUrl=await bridge.readFileDataUrl(selected);
    setEditing({...editing,photoDataUrl:dataUrl});
  }

  async function mergeDuplicateContacts() {
    const duplicates=duplicateSets();
    if(duplicates.length===0){
      window.alert("Nenhum duplicado por e-mail ou telefone foi encontrado.");
      return;
    }
    let merged=0;
    const used=new Set<string>();
    for(const ids of duplicates){
      const items=store.items.filter((item)=>ids.includes(item.id)&&!used.has(item.id));
      if(items.length<2) continue;
      const [base,...rest]=items;
      const allEmails=[...new Set(items.flatMap((item)=>item.emails?.length?item.emails:[item.email]).filter(Boolean))];
      const allPhones=[...new Set(items.flatMap((item)=>item.phones?.length?item.phones:[item.phone]).filter(Boolean))];
      const next:ContactItem={
        ...base,
        email:allEmails[0]??base.email,
        phone:allPhones[0]??base.phone,
        emails:allEmails,
        phones:allPhones,
        addresses:[...new Set(items.flatMap((item)=>item.addresses??[]))],
        categories:[...new Set(items.flatMap((item)=>item.categories??[]))],
        groupIds:[...new Set(items.flatMap((item)=>item.groupIds??[]))],
        importantDates:items.flatMap((item)=>item.importantDates??[]),
        notes:items.map((item)=>item.notes).filter(Boolean).join("\n\n"),
        favorite:items.some((item)=>item.favorite),
      };
      await store.save(next);
      for(const item of rest){await store.remove(item.id);used.add(item.id);merged+=1;}
      used.add(base.id);
    }
    window.alert(`${merged} contato(s) mesclado(s).`);
  }

  return (
    <Workspace title="Contatos" eyebrow="PESSOAS" action="Novo contato" onAction={() => setEditing(fresh())}>
      <div className="workspace-toolbar people-toolbar">
        <button className="secondary" onClick={() => void importContacts()}><Icon name="upload" size={14}/> Importar</button>
        <button className="secondary" disabled={store.items.length===0} onClick={() => void exportContacts("csv")}><Icon name="download" size={14}/> CSV</button>
        <button className="secondary" disabled={store.items.length===0} onClick={() => void exportContacts("vcf")}><Icon name="download" size={14}/> vCard</button>
        <button className="secondary" onClick={()=>void createContactGroup()}><Icon name="people" size={14}/> Novo grupo</button>
        <select value={groupFilter} onChange={(event)=>setGroupFilter(event.target.value)}><option value="">Todos os grupos</option>{groups.items.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <button className="secondary" disabled={store.items.length<2} onClick={()=>void mergeDuplicateContacts()}><Icon name="people" size={14}/> Mesclar duplicados</button>
        {selectedIds.length>0&&<button className="secondary" onClick={()=>void categorizeSelectedContacts()}>Categorizar {selectedIds.length}</button>}
        {selectedIds.length>0&&<button className="secondary danger-lite" onClick={()=>void deleteSelectedContacts()}><Icon name="trash" size={14}/> Excluir {selectedIds.length}</button>}
      </div>
      {groups.items.length>0&&<div className="contact-groups">{groups.items.map((group)=><span key={group.id}><button onClick={()=>setGroupFilter(group.id)}>{group.name}</button><button aria-label={`Excluir ${group.name}`} onClick={()=>void groups.remove(group.id)}><Icon name="x" size={10}/></button></span>)}</div>}
      {store.loading ? <Empty icon="people" title="Carregando contatos" text="Lendo o cache local..." /> : filtered.length === 0 ? (
        <Empty icon="people" title="Nenhum contato ainda" text="Crie contatos locais; a sincronização em nuvem mantém a mesma identidade em outros dispositivos." />
      ) : (
        <div className="contact-grid">
          {filtered.map((contact) => (
            <article className={selectedIds.includes(contact.id)?"contact-card selected":"contact-card"} key={contact.id}>
              <label className="contact-select"><input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={()=>toggleContactSelection(contact.id)}/></label>
              <button className="contact-main" onClick={() => setEditing(contact)}>
                <span className="avatar big contact-photo">{contact.photoDataUrl?<img src={contact.photoDataUrl} alt="" />:contact.displayName[0]?.toUpperCase() || "?"}</span>
                <span><b>{contact.displayName}</b><small>{contact.nickname ? contact.nickname+" · " : ""}{contact.jobTitle}{contact.company ? ` · ${contact.company}` : ""}</small><em>{contact.emails?.[0] || contact.email || contact.phones?.[0] || contact.phone}</em>{(contact.categories??[]).length>0&&<small>{(contact.categories??[]).join(" · ")}</small>}</span>
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
          <div className="contact-photo-editor full">
            <span className="avatar contact-photo-preview">{editing.photoDataUrl?<img src={editing.photoDataUrl} alt="" />:(editing.displayName[0]?.toUpperCase()||"?")}</span>
            <div><button className="secondary" type="button" onClick={()=>void pickContactPhoto()}><Icon name="upload" size={13}/> Escolher foto</button>{editing.photoDataUrl&&<button className="ghost" type="button" onClick={()=>setEditing({...editing,photoDataUrl:undefined})}>Remover</button>}</div>
          </div>
          <label><span>Nome</span><input autoFocus value={editing.firstName??""} onChange={(event) => setEditing({ ...editing, firstName:event.target.value, displayName:(event.target.value+" "+(editing.lastName??"")).trim()||editing.displayName })} /></label>
          <label><span>Sobrenome</span><input value={editing.lastName??""} onChange={(event) => setEditing({ ...editing, lastName:event.target.value, displayName:((editing.firstName??"")+" "+event.target.value).trim()||editing.displayName })} /></label>
          <label className="full"><span>Nome de exibição</span><input value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} /></label>
          <label><span>Apelido</span><input value={editing.nickname??""} onChange={(event)=>setEditing({...editing,nickname:event.target.value})}/></label>
          <label><span>Empresa</span><input value={editing.company} onChange={(event) => setEditing({ ...editing, company: event.target.value })} /></label>
          <label><span>Cargo</span><input value={editing.jobTitle} onChange={(event) => setEditing({ ...editing, jobTitle: event.target.value })} /></label>
          <label className="full"><span>E-mails</span><input value={(editing.emails?.length?editing.emails:[editing.email]).filter(Boolean).join(", ")} onChange={(event)=>{const values=event.target.value.split(",").map((value)=>value.trim()).filter(Boolean);setEditing({...editing,emails:values,email:values[0]??""});}} placeholder="principal@dominio.com, outro@dominio.com"/></label>
          <label className="full"><span>Telefones</span><input value={(editing.phones?.length?editing.phones:[editing.phone]).filter(Boolean).join(", ")} onChange={(event)=>{const values=event.target.value.split(",").map((value)=>value.trim()).filter(Boolean);setEditing({...editing,phones:values,phone:values[0]??""});}} /></label>
          <label className="full"><span>Endereços</span><textarea value={(editing.addresses??[]).join("\n")} onChange={(event)=>setEditing({...editing,addresses:event.target.value.split("\n").map((value)=>value.trim()).filter(Boolean)})} placeholder="Um endereço por linha"/></label>
          <label className="full"><span>Datas importantes</span><input value={(editing.importantDates??[]).map((item)=>item.label+":"+item.date).join("; ")} onChange={(event)=>setEditing({...editing,importantDates:event.target.value.split(";").map((part)=>part.trim()).filter(Boolean).map((part)=>{const separator=part.indexOf(":");return{label:separator>0?part.slice(0,separator).trim():"Data",date:separator>0?part.slice(separator+1).trim():part};})})} placeholder="Aniversário:2020-01-01; Casamento:2024-05-10"/></label>
          <label className="full"><span>Categorias</span><input value={(editing.categories??[]).join(", ")} onChange={(event)=>setEditing({...editing,categories:event.target.value.split(",").map((value)=>value.trim()).filter(Boolean)})}/></label>
          <label className="full"><span>Grupos / listas</span><select multiple value={editing.groupIds??[]} onChange={(event)=>setEditing({...editing,groupIds:Array.from(event.currentTarget.selectedOptions).map((option)=>option.value)})}>{groups.items.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
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
  const [filter, setFilter] = useState<"all" | "today" | "overdue" | "upcoming">("all");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

  const openTasks = store.items
    .filter((task) => !task.completedAt)
    .sort((a, b) => {
      const left = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const right = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  const completed = store.items.filter((task) => task.completedAt);

  const todayTasks = openTasks.filter((task) => {
    const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    return Number.isFinite(due) && due >= todayStart && due < tomorrowStart;
  });
  const overdueTasks = openTasks.filter((task) => {
    const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    return Number.isFinite(due) && due < todayStart;
  });
  const upcomingTasks = openTasks.filter((task) => {
    const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    return Number.isFinite(due) && due >= tomorrowStart;
  });

  const visible = filter === "today"
    ? todayTasks
    : filter === "overdue"
      ? overdueTasks
      : filter === "upcoming"
        ? upcomingTasks
        : openTasks;

  async function quickAdd() {
    const title = draft.trim();
    if (!title) return;
    const task: TaskItem = {
      id: crypto.randomUUID(),
      title,
      notes: "",
      priority: "normal",
      listName: "Meu dia",
      dueAt: nowLocalInput(60),
    };
    await store.save(task);
    setDraft("");
  }

  const fresh = (): TaskItem => ({
    id: crypto.randomUUID(),
    title: "",
    notes: "",
    priority: "normal",
    listName: "Meu dia",
    recurrence:"none",
    categories:[],
  });

  function shiftRecurringDate(value:string|undefined, recurrence:TaskItem["recurrence"]): string|undefined {
    if(!value||!recurrence||recurrence==="none") return value;
    const date=new Date(value);
    if(!Number.isFinite(date.getTime())) return value;
    if(recurrence==="daily") date.setDate(date.getDate()+1);
    if(recurrence==="weekly") date.setDate(date.getDate()+7);
    if(recurrence==="monthly") date.setMonth(date.getMonth()+1);
    if(recurrence==="yearly") date.setFullYear(date.getFullYear()+1);
    return date.toISOString();
  }

  async function completeTask(task:TaskItem) {
    const completedAt=new Date().toISOString();
    await store.save({...task,completedAt});
    if(task.recurrence&&task.recurrence!=="none"){
      const next:TaskItem={
        ...task,
        id:crypto.randomUUID(),
        completedAt:undefined,
        startsAt:shiftRecurringDate(task.startsAt,task.recurrence),
        dueAt:shiftRecurringDate(task.dueAt,task.recurrence),
        reminderAt:shiftRecurringDate(task.reminderAt,task.recurrence),
        reminderNotifiedAt:undefined,
      };
      await store.save(next);
    }
  }

  async function exportTasks(){
    const destination=await saveDialog({defaultPath:"seven-mail-tasks.json",filters:[{name:"Tarefas Seven Mail",extensions:["json"]}]});
    if(!destination) return;
    await bridge.writeTextFile(destination,JSON.stringify({format:"seven-mail-tasks",version:1,exportedAt:new Date().toISOString(),tasks:store.items},null,2));
  }

  async function importTasks(){
    const selected=await open({multiple:false,directory:false,filters:[{name:"Tarefas Seven Mail",extensions:["json"]}]});
    if(!selected||Array.isArray(selected)) return;
    const raw=await bridge.readTextFile(selected);
    const parsed=JSON.parse(raw) as {format?:string;tasks?:TaskItem[]};
    if(parsed.format!=="seven-mail-tasks"||!Array.isArray(parsed.tasks)){
      window.alert("Arquivo de tarefas inválido.");
      return;
    }
    for(const task of parsed.tasks){
      if(!task?.title) continue;
      await store.save({...task,id:crypto.randomUUID(),reminderNotifiedAt:undefined});
    }
  }

  return (
    <Workspace title="Tarefas" eyebrow="MINHA AGENDA" action="Nova tarefa" onAction={() => setEditing(fresh())}>
      <div className="workspace-toolbar task-io-toolbar"><button className="secondary" onClick={()=>void importTasks()}><Icon name="upload" size={14}/> Importar</button><button className="secondary" disabled={store.items.length===0} onClick={()=>void exportTasks()}><Icon name="download" size={14}/> Exportar</button></div>
      <div className="task-filter-bar">
        <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>Todas <b>{openTasks.length}</b></button>
        <button className={filter==="today"?"active":""} onClick={()=>setFilter("today")}>Hoje <b>{todayTasks.length}</b></button>
        <button className={filter==="overdue"?"active":""} onClick={()=>setFilter("overdue")}>Atrasadas <b>{overdueTasks.length}</b></button>
        <button className={filter==="upcoming"?"active":""} onClick={()=>setFilter("upcoming")}>Próximas <b>{upcomingTasks.length}</b></button>
      </div>
      <div className="task-board">
        <section className="task-column">
          <header><span>{filter==="today"?"HOJE":filter==="overdue"?"ATRASADAS":filter==="upcoming"?"PRÓXIMAS":"ABERTAS"}</span><b>{visible.length}</b></header>
          {visible.length===0&&<p className="mini-empty">Nenhuma tarefa nesta visualização.</p>}
          {visible.map((task) => {
            const due = task.dueAt ? new Date(task.dueAt) : null;
            const isOverdue = due ? due.getTime() < Date.now() : false;
            return <div className={isOverdue ? "task-card overdue" : "task-card"} key={task.id}>
              <button className="task-check" aria-label="Concluir" onClick={() => void completeTask(task)}><Icon name="check" size={13} /></button>
              <button className="task-copy" onClick={() => setEditing(task)}>
                <b>{task.title}</b>
                <small>{task.dueAt ? `${isOverdue ? "Atrasada · " : "Vence "}${new Date(task.dueAt).toLocaleString("pt-BR")}` : task.listName}{task.recurrence&&task.recurrence!=="none" ? " · recorrente" : ""}{(task.categories??[]).length ? " · "+(task.categories??[]).join(", ") : ""}</small>
              </button>
              <span className={`priority ${task.priority}`}>{task.priority === "high" ? "Alta" : task.priority === "low" ? "Baixa" : "Normal"}</span>
              {task.relatedMessageId && onOpenRelatedMessage && <button className="icon-button" title="Abrir e-mail relacionado" onClick={() => onOpenRelatedMessage(task.relatedMessageId!)}><Icon name="mail" size={14} /></button>}
              <button className="icon-button" onClick={() => void store.remove(task.id)}><Icon name="trash" size={14} /></button>
            </div>;
          })}
          <div className="quick-add"><Icon name="plus" size={15} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Adicionar tarefa para hoje" onKeyDown={(event) => { if (event.key === "Enter") void quickAdd(); }} /></div>
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
          <label><span>Início</span><input type="datetime-local" value={editing.startsAt?.slice(0, 16) ?? ""} onChange={(event) => setEditing({ ...editing, startsAt: event.target.value || undefined })} /></label>
          <label><span>Vencimento</span><input type="datetime-local" value={editing.dueAt?.slice(0, 16) ?? ""} onChange={(event) => setEditing({ ...editing, dueAt: event.target.value || undefined })} /></label>
          <label><span>Lembrete</span><input type="datetime-local" value={editing.reminderAt?.slice(0, 16) ?? ""} onChange={(event) => setEditing({ ...editing, reminderAt: event.target.value || undefined, reminderNotifiedAt: undefined })} /></label>
          <label><span>Recorrência</span><select value={editing.recurrence??"none"} onChange={(event)=>setEditing({...editing,recurrence:event.target.value as TaskItem["recurrence"]})}><option value="none">Não repetir</option><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
          <label className="full"><span>Categorias</span><input value={(editing.categories??[]).join(", ")} onChange={(event)=>setEditing({...editing,categories:event.target.value.split(",").map((value)=>value.trim()).filter(Boolean)})}/></label>
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

  async function exportRules() {
    const destination = await saveDialog({
      defaultPath:"seven-mail-rules.json",
      filters:[{name:"Regras Seven Mail",extensions:["json"]}],
    });
    if(!destination) return;
    await bridge.writeTextFile(destination,JSON.stringify({
      format:"seven-mail-rules",
      version:1,
      exportedAt:new Date().toISOString(),
      rules:store.items,
    },null,2));
  }

  async function importRules() {
    const selected=await open({
      multiple:false,
      directory:false,
      filters:[{name:"Regras Seven Mail",extensions:["json"]}],
    });
    if(!selected||Array.isArray(selected)) return;
    const raw=await bridge.readTextFile(selected);
    const parsed=JSON.parse(raw) as {format?:string;rules?:RuleItem[]};
    if(parsed.format!=="seven-mail-rules"||!Array.isArray(parsed.rules)){
      window.alert("Arquivo de regras inválido.");
      return;
    }
    for(const rule of parsed.rules){
      if(!rule?.id||!rule.name) continue;
      await store.save({...rule,id:crypto.randomUUID()});
    }
    setRunResult(`${parsed.rules.length} regra(s) importada(s)`);
  }

  return (
    <Workspace title="Regras" eyebrow="AUTOMAÇÕES" action="Nova regra" onAction={() => setEditing(fresh())}>
      <div className="rules-toolbar">
        <button className="secondary" disabled={!onRunRules || running || store.items.length === 0} onClick={() => void runRulesNow()}>
          <Icon name="refresh" size={14} /> {running ? "Executando..." : "Executar regras agora"}
        </button>
        <button className="secondary" onClick={()=>void importRules()}><Icon name="upload" size={14}/> Importar</button>
        <button className="secondary" disabled={store.items.length===0} onClick={()=>void exportRules()}><Icon name="download" size={14}/> Exportar</button>
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
                <span>SE <strong>{rule.field}</strong> {rule.operator === "contains" ? "contém" : rule.operator === "equals" ? "é" : rule.operator === "greater" ? ">" : "<"} <em>{rule.value}</em> → <strong>{rule.action}</strong>{rule.target ? ` · ${rule.target}` : ""}</span>
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
          <label><span>Campo</span><select value={editing.field} onChange={(event) => setEditing({ ...editing, field: event.target.value as RuleItem["field"], operator: event.target.value==="size" ? "greater" : editing.operator })}><option value="from">Remetente</option><option value="to">Destinatário</option><option value="subject">Assunto</option><option value="body">Corpo</option><option value="domain">Domínio</option><option value="size">Tamanho (bytes)</option><option value="attachment">Nome do anexo</option><option value="priority">Prioridade</option></select></label>
          <label><span>Operador</span><select value={editing.operator} onChange={(event) => setEditing({ ...editing, operator: event.target.value as RuleItem["operator"] })}><option value="contains">Contém</option><option value="equals">É exatamente</option>{editing.field==="size"&&<><option value="greater">Maior que</option><option value="less">Menor que</option></>}</select></label>
          <label className="full"><span>Valor</span><input value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} /></label>
          <label><span>Ação</span><select value={editing.action} onChange={(event) => setEditing({ ...editing, action: event.target.value as RuleItem["action"], target: undefined })}><option value="archive">Arquivar</option><option value="delete">Excluir</option><option value="spam">Marcar como spam</option><option value="flag">Sinalizar</option><option value="read">Marcar como lida</option><option value="move">Mover para pasta</option><option value="copy">Copiar para pasta</option><option value="category">Adicionar categoria</option><option value="forward">Encaminhar para</option></select></label>
          <label><span>Prioridade</span><input type="number" min={1} value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: Math.max(1, Number(event.target.value) || 1) })} /></label>
          {["move","copy","category","forward"].includes(editing.action)&&<label className="full"><span>{editing.action==="category"?"Categoria":editing.action==="forward"?"E-mail de destino":"Pasta IMAP de destino"}</span><input value={editing.target??""} onChange={(event)=>setEditing({...editing,target:event.target.value})} placeholder={editing.action==="forward"?"destino@dominio.com":editing.action==="category"?"Financeiro":"Archive/Projetos"}/></label>}
          <label className="inline-check"><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} /> Regra ativa</label>
          <label className="inline-check"><input type="checkbox" checked={Boolean(editing.stopProcessing)} onChange={(event) => setEditing({ ...editing, stopProcessing: event.target.checked })} /> Parar após esta regra</label>
        </EditorModal>
      )}
    </Workspace>
  );
}

import type { CalendarEvent, ContactItem, MailMessage } from "../types";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function icsDate(value: string, allDay = false): string {
  const date = new Date(value);
  if (allDay) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseIcsDate(value: string): { value: string; allDay: boolean } {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    const date = new Date(year, month - 1, day);
    return { value: date.toISOString(), allDay: true };
  }
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const iso = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(9,11)}:${raw.slice(11,13)}:${raw.slice(13,15)}Z`;
    return { value: new Date(iso).toISOString(), allDay: false };
  }
  if (/^\d{8}T\d{6}$/.test(raw)) {
    const date = new Date(
      Number(raw.slice(0, 4)),
      Number(raw.slice(4, 6)) - 1,
      Number(raw.slice(6, 8)),
      Number(raw.slice(9, 11)),
      Number(raw.slice(11, 13)),
      Number(raw.slice(13, 15)),
    );
    return { value: date.toISOString(), allDay: false };
  }
  const date = new Date(raw);
  return {
    value: Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(),
    allDay: false,
  };
}

function unfold(value: string): string[] {
  return value.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}


function recurrenceRule(event: CalendarEvent): string | null {
  const recurrence=event.recurrence??"none";
  if(recurrence==="none") return null;
  const freq=recurrence==="daily"?"DAILY":recurrence==="weekly"?"WEEKLY":recurrence==="monthly"?"MONTHLY":"YEARLY";
  const parts=["FREQ="+freq];
  if(event.recurrenceUntil){
    const until=new Date(event.recurrenceUntil+"T23:59:59");
    if(Number.isFinite(until.getTime())) parts.push("UNTIL="+icsDate(until.toISOString()));
  }
  return parts.join(";");
}

function eventIcsLines(event: CalendarEvent, organizer?: string): string[] {
  const lines=[
    "BEGIN:VEVENT",
    "UID:"+event.id+"@seven-mail.local",
    "DTSTAMP:"+icsDate(new Date().toISOString()),
    event.allDay ? "DTSTART;VALUE=DATE:"+icsDate(event.startAt,true) : "DTSTART:"+icsDate(event.startAt),
    event.allDay ? "DTEND;VALUE=DATE:"+icsDate(event.endAt,true) : "DTEND:"+icsDate(event.endAt),
    "SUMMARY:"+escapeText(event.title),
  ];
  if(event.description) lines.push("DESCRIPTION:"+escapeText(event.description));
  if(event.location) lines.push("LOCATION:"+escapeText(event.location));
  if(event.onlineMeetingUrl) lines.push("URL:"+escapeText(event.onlineMeetingUrl));
  if(event.isPrivate) lines.push("CLASS:PRIVATE");
  if(event.status) lines.push("STATUS:"+(event.status==="cancelled"?"CANCELLED":event.status==="draft"?"TENTATIVE":"CONFIRMED"));
  lines.push("TRANSP:"+(event.freeBusyStatus==="free"?"TRANSPARENT":"OPAQUE"));
  if(event.timezone) lines.push("X-WR-TIMEZONE:"+escapeText(event.timezone));
  if(organizer||event.organizer) lines.push("ORGANIZER:mailto:"+(organizer??event.organizer));

  const required=event.requiredParticipants?.length?event.requiredParticipants:event.participants;
  const attendeeLine=(participant:string,role:string)=>{
    const response=event.participantResponses?.[participant.toLocaleLowerCase("pt-BR")]??"needs-action";
    const partstat=response==="accepted"?"ACCEPTED":response==="tentative"?"TENTATIVE":response==="declined"?"DECLINED":"NEEDS-ACTION";
    return `ATTENDEE;ROLE=${role};PARTSTAT=${partstat}:mailto:${participant}`;
  };
  for(const participant of required) lines.push(attendeeLine(participant,"REQ-PARTICIPANT"));
  for(const participant of event.optionalParticipants??[]) lines.push(attendeeLine(participant,"OPT-PARTICIPANT"));
  for(const resource of event.resources??[]) lines.push("ATTENDEE;CUTYPE=RESOURCE;ROLE=NON-PARTICIPANT:mailto:"+resource);

  const rule=recurrenceRule(event);
  if(rule) lines.push("RRULE:"+rule);
  if((event.recurrenceExceptions??[]).length){
    lines.push("EXDATE:"+event.recurrenceExceptions!.map((value)=>icsDate(value)).join(","));
  }
  lines.push("X-SEVEN-COLOR:"+event.color);
  lines.push("END:VEVENT");
  return lines;
}

export function eventsToIcs(events: CalendarEvent[]): string {
  const lines=[
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seven Mail//Calendar Export//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for(const event of events) lines.push(...eventIcsLines(event));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n")+"\r\n";
}

export function eventInvitationToIcs(
  event: CalendarEvent,
  organizer: string,
  method: "REQUEST" | "CANCEL" | "REPLY",
  response?: CalendarEvent["attendeeResponse"],
  responder?: string,
): string {
  const target=method==="CANCEL"?{...event,status:"cancelled" as const}:event;
  const lines=[
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seven Mail//Meeting//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:"+method,
    ...eventIcsLines(target,organizer),
  ];
  if(method==="REPLY"&&response&&responder){
    const attendee="ATTENDEE;PARTSTAT="+response.toUpperCase().replace("-","")+";RSVP=FALSE:mailto:"+responder;
    const endIndex=lines.lastIndexOf("END:VEVENT");
    if(endIndex>=0) lines.splice(endIndex,0,attendee);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n")+"\r\n";
}

export function eventsFromIcs(raw: string): CalendarEvent[] {
  const lines = unfold(raw);
  const events: CalendarEvent[] = [];
  let current: Record<string, string[]> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT" && current) {
      const startLine = Object.entries(current).find(([key]) => key.startsWith("DTSTART"));
      const endLine = Object.entries(current).find(([key]) => key.startsWith("DTEND"));
      const start = parseIcsDate(startLine?.[1]?.[0] ?? new Date().toISOString());
      const end = parseIcsDate(endLine?.[1]?.[0] ?? start.value);
      const rrule=current.RRULE?.[0]??"";
      const frequency=rrule.match(/(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i)?.[1]?.toLowerCase() as CalendarEvent["recurrence"]|undefined;
      const untilRaw=rrule.match(/(?:^|;)UNTIL=([^;]+)/i)?.[1];
      const until=untilRaw?parseIcsDate(untilRaw).value.slice(0,10):undefined;
      const attendeeEntries=Object.entries(current)
        .filter(([key])=>key==="ATTENDEE"||key.startsWith("ATTENDEE;"))
        .flatMap(([key,values])=>values.map((value)=>({key,value})));
      const attendeeEmail=(value:string)=>value.replace(/^.*mailto:/i,"").trim();
      const required=[...new Set(attendeeEntries.filter(({key})=>!/ROLE=OPT-PARTICIPANT|CUTYPE=RESOURCE/i.test(key)).map(({value})=>attendeeEmail(value)).filter(Boolean))];
      const optional=[...new Set(attendeeEntries.filter(({key})=>/ROLE=OPT-PARTICIPANT/i.test(key)).map(({value})=>attendeeEmail(value)).filter(Boolean))];
      const resources=[...new Set(attendeeEntries.filter(({key})=>/CUTYPE=RESOURCE/i.test(key)).map(({value})=>attendeeEmail(value)).filter(Boolean))];
      const participantResponses=Object.fromEntries(attendeeEntries
        .map(({key,value})=>{
          const email=attendeeEmail(value).toLocaleLowerCase("pt-BR");
          const raw=key.match(/(?:^|;)PARTSTAT=([^;]+)/i)?.[1]?.toUpperCase();
          const response:NonNullable<CalendarEvent["attendeeResponse"]>=raw==="ACCEPTED"?"accepted":raw==="TENTATIVE"?"tentative":raw==="DECLINED"?"declined":"needs-action";
          return [email,response];
        })
        .filter(([email])=>Boolean(email)));
      events.push({
        id: (current.UID?.[0] ?? crypto.randomUUID()).split("@")[0] || crypto.randomUUID(),
        title: unescapeText(current.SUMMARY?.[0] ?? "Evento importado"),
        description: unescapeText(current.DESCRIPTION?.[0] ?? ""),
        location: unescapeText(current.LOCATION?.[0] ?? ""),
        startAt: start.value,
        endAt: end.value,
        allDay: start.allDay,
        color: current["X-SEVEN-COLOR"]?.[0] ?? "#7868ff",
        participants:required,
        requiredParticipants:required,
        optionalParticipants:optional,
        resources,
        organizer:(current.ORGANIZER?.[0]??"").replace(/^mailto:/i,"").trim()||undefined,
        recurrence:frequency??"none",
        recurrenceUntil:until,
        recurrenceExceptions:(current.EXDATE??[]).flatMap((value)=>value.split(",")).map((value)=>parseIcsDate(value).value),
        isPrivate:(current.CLASS?.[0]??"").toUpperCase()==="PRIVATE",
        status:(current.STATUS?.[0]??"").toUpperCase()==="CANCELLED"?"cancelled":(current.STATUS?.[0]??"").toUpperCase()==="TENTATIVE"?"draft":"confirmed",
        freeBusyStatus:(current.TRANSP?.[0]??"").toUpperCase()==="TRANSPARENT"?"free":"busy",
        onlineMeetingUrl:current.URL?.[0] ? unescapeText(current.URL[0]) : undefined,
        timezone:current["X-WR-TIMEZONE"]?.[0],
        participantResponses,
        lastSentParticipants:[...new Set([...required,...optional])],
      });
      current = null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const base = key.split(";")[0].toUpperCase();
    const value = line.slice(separator + 1);
    (current[base] ??= []).push(value);
    if (base === "DTSTART" || base === "DTEND" || base === "ATTENDEE" || base === "ORGANIZER") {
      (current[key.toUpperCase()] ??= []).push(value);
    }
  }

  return events;
}

export function contactsToVcard(contacts: ContactItem[]): string {
  return contacts.map((contact) => [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeText(contact.displayName)}`,
    contact.email ? `EMAIL;TYPE=INTERNET:${contact.email}` : "",
    contact.phone ? `TEL;TYPE=CELL:${contact.phone}` : "",
    contact.company ? `ORG:${escapeText(contact.company)}` : "",
    contact.jobTitle ? `TITLE:${escapeText(contact.jobTitle)}` : "",
    contact.notes ? `NOTE:${escapeText(contact.notes)}` : "",
    "END:VCARD",
  ].filter(Boolean).join("\r\n")).join("\r\n") + "\r\n";
}

export function contactsFromVcard(raw: string): ContactItem[] {
  const lines = unfold(raw);
  const contacts: ContactItem[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VCARD") {
      current = {};
      continue;
    }
    if (line === "END:VCARD" && current) {
      const rawId = current.UID || current.EMAIL || crypto.randomUUID();
      const stableId = `carddav-${rawId.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90) || crypto.randomUUID()}`;
      contacts.push({
        id: stableId,
        displayName: unescapeText(current.FN || current.N || current.EMAIL || "Contato importado"),
        email: current.EMAIL || "",
        phone: current.TEL || "",
        company: unescapeText(current.ORG || ""),
        jobTitle: unescapeText(current.TITLE || ""),
        notes: unescapeText(current.NOTE || ""),
        favorite: false,
      });
      current = null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).split(";")[0].toUpperCase();
    if (!(key in current)) current[key] = line.slice(separator + 1);
  }

  return contacts.filter((contact) => contact.displayName.trim() || contact.email.trim());
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function contactsToCsv(contacts: ContactItem[]): string {
  const rows = [
    ["Nome", "Email", "Telefone", "Empresa", "Cargo", "Observacoes", "Favorito"],
    ...contacts.map((contact) => [
      contact.displayName,
      contact.email,
      contact.phone,
      contact.company,
      contact.jobTitle,
      contact.notes,
      contact.favorite ? "sim" : "nao",
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export function contactsFromCsv(raw: string): ContactItem[] {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const indexOf = (...names: string[]) => headers.findIndex((value) => names.includes(value));

  const nameIndex = indexOf("nome", "name");
  const emailIndex = indexOf("email", "e-mail");
  const phoneIndex = indexOf("telefone", "phone");
  const companyIndex = indexOf("empresa", "company");
  const jobIndex = indexOf("cargo", "title", "jobtitle");
  const notesIndex = indexOf("observacoes", "observações", "notes");
  const favoriteIndex = indexOf("favorito", "favorite");

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const get = (index: number) => index >= 0 ? (values[index] ?? "").trim() : "";
    return {
      id: crypto.randomUUID(),
      displayName: get(nameIndex) || get(emailIndex) || "Contato importado",
      email: get(emailIndex),
      phone: get(phoneIndex),
      company: get(companyIndex),
      jobTitle: get(jobIndex),
      notes: get(notesIndex),
      favorite: /^(sim|yes|true|1)$/i.test(get(favoriteIndex)),
    };
  }).filter((contact) => contact.displayName || contact.email);
}

function headerAddress(address: { name?: string; email: string }): string {
  const name = address.name?.replace(/[\r\n"]/g, " ").trim();
  return name ? `"${name}" <${address.email}>` : address.email;
}

export function messageToEml(message: MailMessage): string {
  const boundary = `seven-mail-${crypto.randomUUID()}`;
  const headers = [
    `From: ${headerAddress(message.from)}`,
    `To: ${message.to.map(headerAddress).join(", ")}`,
    `Subject: ${message.subject.replace(/[\r\n]/g, " ")}`,
    `Date: ${new Date(message.receivedAt).toUTCString()}`,
    "MIME-Version: 1.0",
  ];

  if (message.bodyHtml?.trim() && message.bodyText?.trim()) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.bodyText,
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.bodyHtml,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  return [
    ...headers,
    `Content-Type: ${message.bodyHtml?.trim() ? 'text/html' : 'text/plain'}; charset="utf-8"`,
    "Content-Transfer-Encoding: 8bit",
    "",
    message.bodyHtml?.trim() || message.bodyText || message.preview,
    "",
  ].join("\r\n");
}

export function safeExportName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || fallback;
}

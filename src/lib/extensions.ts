import type { CalendarEvent, ExtensionManifestItem } from "../types";

const ALLOWED_PERMISSIONS = new Set([
  "external.open",
  "meeting.create",
  "storage.open",
] as const);

export function validateExtensionManifest(value: unknown): ExtensionManifestItem {
  if (!value || typeof value !== "object") throw new Error("Manifesto de extensão inválido.");
  const source=value as Partial<ExtensionManifestItem>;
  const id=String(source.id??"").trim();
  const name=String(source.name??"").trim();
  const version=String(source.version??"").trim();
  if(!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(id)) throw new Error("ID da extensão inválido.");
  if(!name || name.length>120) throw new Error("Nome da extensão inválido.");
  if(!version || version.length>40) throw new Error("Versão da extensão inválida.");

  const permissions=(source.permissions??[]).map((permission)=>{
    if(!permission||!ALLOWED_PERMISSIONS.has(permission.id)) throw new Error("Permissão de extensão não suportada.");
    return {id:permission.id,granted:Boolean(permission.granted)};
  });

  const ensureHttps=(url:string|undefined,label:string)=>{
    if(!url) return;
    let parsed:URL;
    try{parsed=new URL(url.replace(/{{[^}]+}}/g,"placeholder"));}catch{throw new Error(`${label} possui URL inválida.`);}
    if(parsed.protocol!=="https:") throw new Error(`${label} deve usar HTTPS.`);
  };

  ensureHttps(source.meeting?.urlTemplate,"Integração de reunião");
  ensureHttps(source.storage?.url,"Integração de armazenamento");
  for(const action of source.actions??[]){
    if(!action.id?.trim()||!action.label?.trim()) throw new Error("Ação externa inválida.");
    if(!ALLOWED_PERMISSIONS.has(action.permission)) throw new Error("Permissão de ação externa inválida.");
    ensureHttps(action.urlTemplate,`Ação ${action.label}`);
  }

  return {
    id,
    name,
    version,
    description:String(source.description??"").slice(0,500),
    enabled:source.enabled!==false,
    permissions,
    actions:(source.actions??[]).map((action)=>({...action})),
    meeting:source.meeting?{label:source.meeting.label?.slice(0,100),urlTemplate:source.meeting.urlTemplate}:undefined,
    storage:source.storage?{label:source.storage.label?.slice(0,100),url:source.storage.url}:undefined,
  };
}

export function extensionHasPermission(extension:ExtensionManifestItem,permission:ExtensionManifestItem["permissions"][number]["id"]):boolean{
  return extension.enabled && extension.permissions.some((item)=>item.id===permission&&item.granted);
}

function encode(value:string|undefined):string {
  return encodeURIComponent(value??"");
}

export function renderExtensionUrl(template:string,context:{
  event?:CalendarEvent;
  email?:string;
  account?:string;
  uuid?:string;
}):string {
  const values:Record<string,string>={
    title:encode(context.event?.title),
    start:encode(context.event?.startAt),
    end:encode(context.event?.endAt),
    email:encode(context.email),
    account:encode(context.account),
    uuid:encode(context.uuid??crypto.randomUUID()),
  };
  const rendered=template.replace(/{{(title|start|end|email|account|uuid)}}/g,(_,key:string)=>values[key]??"");
  const url=new URL(rendered);
  if(url.protocol!=="https:") throw new Error("A extensão tentou abrir uma URL não segura.");
  return url.toString();
}

export const BUILTIN_EXTENSIONS:ExtensionManifestItem[]=[
  {
    id:"seven.meeting.jitsi",
    name:"Reunião online · Jitsi",
    version:"1.0.0",
    description:"Gera uma sala HTTPS exclusiva no Jitsi Meet e a adiciona ao evento.",
    enabled:false,
    permissions:[{id:"meeting.create",granted:false},{id:"external.open",granted:false}],
    meeting:{label:"Criar sala Jitsi",urlTemplate:"https://meet.jit.si/seven-mail-{{uuid}}"},
  },
  {
    id:"seven.storage.drive",
    name:"Google Drive",
    version:"1.0.0",
    description:"Abre o Google Drive em uma ação externa isolada.",
    enabled:false,
    permissions:[{id:"storage.open",granted:false}],
    storage:{label:"Abrir Google Drive",url:"https://drive.google.com/drive/my-drive"},
  },
  {
    id:"seven.storage.dropbox",
    name:"Dropbox",
    version:"1.0.0",
    description:"Abre o Dropbox em uma ação externa isolada.",
    enabled:false,
    permissions:[{id:"storage.open",granted:false}],
    storage:{label:"Abrir Dropbox",url:"https://www.dropbox.com/home"},
  },
];

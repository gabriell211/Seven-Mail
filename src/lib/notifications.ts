import {invoke} from "@tauri-apps/api/core";
import type {CalendarEvent,MailMessage,TaskItem} from "../types";
import {notificationPayloads} from "./notification-policy";

// Native submission is not proof of display: the OS can suppress a toast.
async function submit(title:string,body:string):Promise<boolean>{
 try{await invoke("show_native_notification",{title,body});return true;}catch{return false;}
}
export async function notifyNewMessages(messages:MailMessage[]):Promise<boolean>{
 const payloads=notificationPayloads(messages);
 if(!payloads.length)return false;
 const results=await Promise.all(payloads.map(item=>submit(item.title,item.body)));
 return results.some(Boolean);
}
export async function notifyTaskReminder(task:TaskItem):Promise<boolean>{
 const date=task.dueAt?new Date(task.dueAt):null;
 const due=date&&Number.isFinite(date.getTime())?date.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):null;
 return submit("Lembrete de tarefa",due?`${task.title} · vence ${due}`:task.title);
}
export async function notifyCalendarReminder(event:CalendarEvent):Promise<boolean>{
 const date=new Date(event.startAt);
 const starts=Number.isFinite(date.getTime())?date.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"";
 return submit("Lembrete de evento",starts?`${event.title} · ${starts}`:event.title);
}

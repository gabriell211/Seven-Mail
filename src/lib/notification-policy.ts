export type NotificationMessage={id:string;accountId:string;folder:string;isRead:boolean;isMuted?:boolean|null;from:{name?:string|null;email:string};subject:string};
export function freshNotificationMessages<T extends NotificationMessage>(messages:readonly T[],seen:Set<string>):T[]{
 const fresh:T[]=[];
 for(const message of messages){
  if(message.folder!=="Caixa de entrada"||message.isRead!==false||message.isMuted)continue;
  const key=JSON.stringify([message.accountId,message.id]);
  if(seen.has(key))continue;
  seen.add(key);fresh.push(message);
 }
 while(seen.size>4096){const first=seen.values().next();if(first.done)break;seen.delete(first.value);}
 return fresh;
}
export function notificationPayloads(messages:readonly NotificationMessage[]):{title:string;body:string}[]{
 const unread=freshNotificationMessages(messages,new Set());
 const payloads=unread.slice(0,3).map(message=>({title:message.from.name?.trim()||message.from.email||"Nova mensagem",body:message.subject.trim()||"(sem assunto)"}));
 const extra=unread.length-3;
 if(extra>0)payloads.push({title:"Seven Mail",body:extra===1?"+1 nova mensagem":`+${extra} novas mensagens`});
 return payloads;
}

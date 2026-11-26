import type { MailMessage } from "../types";

type FolderMessage = Pick<MailMessage,"accountId"|"folder"|"isRead">;
export function mailboxMessages<T extends FolderMessage>(messages: readonly T[], allowedIds: readonly string[], activeId?: string): T[] {
  const allowed=new Set(allowedIds);
  return messages.filter(message=>allowed.has(message.accountId)&&(!activeId||message.accountId===activeId));
}
export function countUnreadByFolder(messages: readonly FolderMessage[], accountId?:string): Map<string,number> {
  const counts=new Map<string,number>();
  for(const message of messages){
    if(message.isRead||(accountId&&message.accountId!==accountId)) continue;
    counts.set(message.folder,(counts.get(message.folder)??0)+1);
  }
  return counts;
}
export function readExpandedMailboxes(): string[] {
  try{
    const value:unknown=JSON.parse(localStorage.getItem("seven-mail:expanded-mailboxes")??"[]");
    return Array.isArray(value)?[...new Set(value.filter((item):item is string=>typeof item==="string"))]:[];
  }catch{return [];}
}

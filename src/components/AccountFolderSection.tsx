import { useEffect, useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { bridge } from "../lib/bridge";
import { countUnreadByFolder } from "../lib/mailbox-navigation";
import type { AccountProfile, MailFolder } from "../types";

export function AccountFolderSection({id,account,title,active,expanded,onToggle,folderIcon,folders,counts,onSelect,onCreate,onDropMessage,children}:{
  id:string;account?:AccountProfile;title:string;active:boolean;expanded:boolean;onToggle:()=>void;
  folderIcon:(role:MailFolder["role"])=>IconName;folders?:readonly MailFolder[];counts?:ReadonlyMap<string,number>;
  onSelect:(folder:MailFolder)=>void;onCreate?:()=>void;onDropMessage?:(id:string)=>void;children?:ReactNode;
}) {
  const contentId=useId();
  const [remoteFolders,setRemoteFolders]=useState<MailFolder[]>([]);
  const [remoteCounts,setRemoteCounts]=useState<ReadonlyMap<string,number>>(new Map());
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(false);
  const [retry,setRetry]=useState(0);
  const accountId=account?.id;
  useEffect(()=>{
    if(!expanded||active||!accountId) return;
    let cancelled=false;
    setLoading(true);setError(false);
    void Promise.allSettled([bridge.listFolders(accountId),bridge.listCachedMessages(accountId)]).then(([remote,local])=>{
      if(cancelled) return;
      if(remote.status==="fulfilled") setRemoteFolders(remote.value);
      else setError(true);
      if(local.status==="fulfilled") setRemoteCounts(countUnreadByFolder(local.value,accountId));
      setLoading(false);
    });
    return ()=>{cancelled=true;};
  },[expanded,active,accountId,retry]);
  const available=folders??remoteFolders;
  const badges=counts??remoteCounts;
  return <section className={"mailbox-section"+(active?" current":"")} data-mailbox={id}>
    <div className="mailbox-section-heading">
      <button type="button" className="mailbox-toggle" aria-expanded={expanded} aria-controls={contentId} title={title} onClick={onToggle}
        onDragOver={event=>{if(onDropMessage){event.preventDefault();event.dataTransfer.dropEffect="move";}}}
        onDrop={event=>{if(!onDropMessage)return;event.preventDefault();const messageId=event.dataTransfer.getData("application/x-seven-mail-message");if(messageId)onDropMessage(messageId);}}>
        <Icon name="chevron" className={expanded?"mailbox-chevron expanded":"mailbox-chevron"} size={14}/>
        {account?<span className="mailbox-initial" style={{backgroundColor:account.color}} aria-hidden="true">{Array.from(account.displayName.trim()||account.email.trim())[0]?.toUpperCase()||"?"}</span>:<Icon name="inbox" size={17}/>}
        <span className="mailbox-title">{title}</span>
      </button>
      {onCreate&&<button type="button" className="group-add" title="Nova pasta" aria-label={`Nova pasta em ${title}`} onClick={onCreate}><Icon name="plus" size={14}/></button>}
    </div>
    <div id={contentId} className="mailbox-children" hidden={!expanded}>
      {active?children:expanded&&<>
        {loading&&!available.length&&<p className="mailbox-status" role="status">Carregando pastas…</p>}
        {error&&<p className="mailbox-status">Não foi possível atualizar as pastas. <button type="button" className="ghost" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button></p>}
        <nav className="folders" aria-label={`Pastas de ${title}`}>{available.map(folder=><button type="button" key={folder.path} className="folder" onClick={()=>onSelect(folder)}><Icon name={folderIcon(folder.role)} size={16}/><span>{folder.name}</span>{(badges.get(folder.name)??0)>0&&<b>{badges.get(folder.name)}</b>}</button>)}</nav>
      </>}
    </div>
  </section>;
}

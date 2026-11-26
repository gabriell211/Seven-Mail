import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icons";
import type { AccountProfile } from "../types";

function AccountAvatar({account}: {account?:AccountProfile}) {
  const initial=Array.from(account?.displayName.trim() || account?.email.trim() || "")[0]?.toUpperCase();
  return <span className="rail-account-avatar" style={account?{backgroundColor:account.color}:undefined} aria-hidden="true">
    {initial || <Icon name="people" size={19}/>}
  </span>;
}

export function AccountSwitcher({accounts,activeId,onSelect,onAdd,onManage}: {
  accounts: readonly AccountProfile[];
  activeId?: string;
  onSelect:(id:string)=>void;
  onAdd:()=>void;
  onManage:()=>void;
}) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  const panelId=useId();
  const headingId=useId();
  const active=accounts.find(account=>account.id===activeId);
  const label=active?.displayName.trim()||active?.email||(accounts.length?"Todas as contas":"Nenhuma conta conectada");

  useEffect(()=>{
    if(!open) return;
    const outside=(event:PointerEvent)=>{
      if(event.target instanceof Node&&!root.current?.contains(event.target)) setOpen(false);
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown",outside,true);
    document.addEventListener("keydown",escape,true);
    (panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')??panel.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    return ()=>{
      document.removeEventListener("pointerdown",outside,true);
      document.removeEventListener("keydown",escape,true);
    };
  },[open]);

  function select(id:string) {
    onSelect(id);
    setOpen(false);
    trigger.current?.focus();
  }

  return <div className="rail-account-switcher" ref={root} onBlur={event=>{
    if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="rail-account-trigger" title={active?.email||label} aria-label={`Contas de e-mail: ${label}`} aria-expanded={open} aria-controls={open?panelId:undefined} onClick={()=>setOpen(value=>!value)}>
      <AccountAvatar account={active}/>
      <span className="rail-account-chevron"><Icon name="chevron" size={11}/></span>
    </button>
    {open&&<div id={panelId} ref={panel} className="rail-account-popover" role="region" aria-labelledby={headingId}>
      <header><strong id={headingId}>Contas de e-mail</strong><small>Selecione uma conta para alternar.</small></header>
      <div className="rail-account-options">
        {accounts.length>0&&<button type="button" className="rail-account-option" aria-pressed={activeId==="__all__"} onClick={()=>select("__all__")}><AccountAvatar/><span><b>Todas as contas</b><small>Caixa de entrada unificada</small></span>{activeId==="__all__"&&<Icon name="check" size={17}/>}</button>}
        {accounts.map(account=><button type="button" key={account.id} className="rail-account-option" aria-pressed={activeId===account.id} onClick={()=>select(account.id)}><AccountAvatar account={account}/><span><b>{account.displayName.trim()||account.email}</b><small>{account.email}</small></span>{activeId===account.id&&<Icon name="check" size={17}/>}</button>)}
        {!accounts.length&&<p>Nenhuma conta conectada.</p>}
      </div>
      <footer>
        <button type="button" onClick={()=>{setOpen(false);onAdd();}}><Icon name="userplus" size={18}/> Adicionar conta</button>
        <button type="button" onClick={()=>{setOpen(false);onManage();}}><Icon name="settings" size={18}/> Gerenciar contas</button>
      </footer>
    </div>}
  </div>;
}

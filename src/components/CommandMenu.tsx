import { useEffect,useId,useRef,useState,type ReactNode } from "react";
import { Icon } from "../icons";
export function CommandMenu({label,className="",children}:{label:string;className?:string;children:ReactNode}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const content=useRef<HTMLDivElement>(null);
  const id=useId();
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener("pointerdown",outside,true);
    document.addEventListener("keydown",escape,true);
    content.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return()=>{document.removeEventListener("pointerdown",outside,true);document.removeEventListener("keydown",escape,true);};
  },[open]);
  return <div className={`command-menu ${className}`} ref={root} onBlur={event=>{if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <button type="button" ref={trigger} className="command-menu-trigger" title={label} aria-label={label} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)}><Icon name="more" size={20}/></button>
    {open&&<div id={id} className="command-menu-panel" ref={content} role="group" aria-label={label} onClick={event=>{if(event.target instanceof Element&&event.target.closest("button")){setOpen(false);trigger.current?.focus();}}}>{children}</div>}
  </div>;
}

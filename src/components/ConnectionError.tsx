import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { connectionGuidance } from "../lib/connection-guidance";
import { Icon } from "../icons";

export function ConnectionError({error,email,provider}: {error:string;email:string;provider:string}) {
  const guidance = connectionGuidance(error,email,provider);
  const [linkError,setLinkError] = useState("");
  async function openOfficial(url:string) {
    setLinkError("");
    try { await openUrl(url); }
    catch { setLinkError("Não foi possível abrir o navegador. Copie o endereço exibido abaixo."); }
  }
  if(!guidance) return <div role="alert" style={{overflowWrap:"anywhere"}}>{error}</div>;
  return <div style={{display:"grid",gap:10,fontSize:13,lineHeight:1.5,overflowWrap:"anywhere",whiteSpace:"normal"}}>
    <div role="alert">
      <strong style={{fontSize:15}}>{guidance.title}</strong>
      <p style={{margin:"6px 0 0"}}>{guidance.description}</p>
    </div>
    <ol style={{margin:0,paddingInlineStart:20}}>
      {guidance.steps.map(step=><li key={step}>{step}</li>)}
    </ol>
    <small>Se a opção não estiver disponível, verifique as restrições da sua Conta Google ou consulte o administrador do Google Workspace.</small>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {guidance.links.map(link=><button key={link.url} type="button" className="secondary" style={{minHeight:34,padding:"6px 10px",fontSize:12}} onClick={()=>void openOfficial(link.url)}><Icon name="lock" size={14}/>{link.label}</button>)}
    </div>
    {linkError&&<div role="alert">{linkError}{guidance.links.map(link=><div key={link.url}>{link.url}</div>)}</div>}
    <details>
      <summary style={{cursor:"pointer"}}>Detalhes técnicos</summary>
      <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:11,marginBottom:0}}>{error}</pre>
    </details>
  </div>;
}

import { Fragment, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { bridge } from "../lib/bridge";
import { sanitizeSignatureHtml, signatureTextHtml } from "../lib/signatures";
import type { SignatureItem } from "../types";
export type CreativeMode="chat"|"image"|"signature"|"document";
export type CreativeResult={text:string;image?:{mimeType:string;data:string}|null;signature?:{name:string;bodyText:string;bodyHtml:string}|null};
function inline(text:string){
  return text.split(/(\*\*[^*\n]+\*\*|\x60[^\x60\n]+\x60|\*[^*\n]+\*)/g).map((part,i)=>part.startsWith("**")&&part.endsWith("**")&&part.length>4?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith("\x60")&&part.endsWith("\x60")&&part.length>2?<code key={i}>{part.slice(1,-1)}</code>:part.startsWith("*")&&part.endsWith("*")&&part.length>2?<em key={i}>{part.slice(1,-1)}</em>:<Fragment key={i}>{part}</Fragment>);
}
// Render only React text nodes and a small markdown subset; never execute model HTML.
export function GeminiMarkdown({text}:{text:string}){
  const lines=text.split(/\r?\n/);return <div className="gemini-markdown">{lines.map((line,i)=>{
    if(/^---+$/.test(line.trim()))return <hr key={i}/>;
    const heading=line.match(/^#{1,6}\s+(.+)$/);if(heading)return <p className="gemini-md-heading" key={i}>{inline(heading[1])}</p>;
    const bullet=line.match(/^\s*[-*]\s+(.+)$/);if(bullet)return <p className="gemini-md-bullet" key={i}>• {inline(bullet[1])}</p>;
    return <p key={i}>{line?inline(line):<br/>}</p>;
  })}</div>;
}
function safePreview(html:string,text:string){
  try{
    const template=document.createElement("template");template.innerHTML=sanitizeSignatureHtml(html);
    // Block remote images and links before any preview DOM is mounted.
    template.content.querySelectorAll("img").forEach(el=>{if(!el.getAttribute("src")?.startsWith("data:image/"))el.remove();});
    template.content.querySelectorAll("a").forEach(el=>el.removeAttribute("href"));
    return template.innerHTML||signatureTextHtml(text);
  }catch{return signatureTextHtml(text);}
}
export function CreativePreview({result,mode,accountId,email,onSaveSignature,busy}:{result:CreativeResult;mode:CreativeMode;accountId:string;email:string;onSaveSignature:(signature:SignatureItem)=>Promise<void>;busy:boolean}){
  const [saving,setSaving]=useState(false);const [saved,setSaved]=useState(false);const [error,setError]=useState("");
  const sig=result.signature;const html=sig?safePreview(sig.bodyHtml,sig.bodyText):"";
  async function save(){
    if(!sig||!accountId||busy||saving||saved)return;
    if(!window.confirm("Salvar nova assinatura na conta "+email+"? A assinatura atual não será substituída."))return;
    setSaving(true);setError("");
    try{await onSaveSignature({id:crypto.randomUUID(),accountId,name:sig.name,bodyText:sig.bodyText,bodyHtml:html,isDefault:false,isReplyDefault:false});setSaved(true);}catch(reason){setError(String(reason));}finally{setSaving(false);}
  }
  async function copy(text:string){try{await navigator.clipboard.writeText(text);}catch{setError("Não foi possível copiar o conteúdo.");}}
  const image=result.image;
  async function exportResult(){
    if(busy||saving)return;
    setSaving(true);setError("");
    try{
      const extension=image?(image.mimeType==="image/jpeg"?"jpg":image.mimeType==="image/webp"?"webp":"png"):sig?"html":"md";
      const path=await saveDialog({defaultPath:`seven-mail-gemini.${extension}`,filters:[{name:image?"Imagem":sig?"Assinatura HTML":"Documento Markdown",extensions:[extension]}]});
      if(!path)return;
      if(image){await invoke("gemini_save_image",{path,mimeType:image.mimeType,data:image.data});}
      else{await bridge.writeTextFile(path,sig?html:result.text);}
    }catch(reason){setError(String(reason));}finally{setSaving(false);}
  }
  return <div className="gemini-creative-result">
    {image&&<><img className="gemini-generated-image" alt="Imagem gerada pelo Gemini" src={"data:"+image.mimeType+";base64,"+image.data}/><button className="secondary" type="button" disabled={busy||saving} onClick={()=>void exportResult()}>Salvar imagem</button></>}
    {sig&&<><b>Prévia da assinatura · {email}</b><div className="gemini-signature-preview" dangerouslySetInnerHTML={{__html:html}}/><button className="secondary" type="button" onClick={()=>void copy(html)}>Copiar HTML</button><button className="secondary" type="button" disabled={busy||saving} onClick={()=>void exportResult()}>Exportar HTML</button><button className="primary" type="button" disabled={busy||saving||saved} onClick={()=>void save()}>{saved?"Assinatura salva":saving?"Salvando…":"Salvar nova assinatura"}</button><small>A assinatura existente será preservada. Defina como padrão nas configurações da conta.</small></>}
    {mode==="document"&&<><button className="secondary" type="button" onClick={()=>void copy(result.text)}>Copiar documento</button><button className="secondary" type="button" disabled={busy||saving} onClick={()=>void exportResult()}>Salvar documento (.md)</button></>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}

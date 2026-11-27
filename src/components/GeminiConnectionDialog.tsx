import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {openUrl} from "@tauri-apps/plugin-opener";
import {Icon} from "../icons";
export type GeminiStatus={configured:boolean;selectedModel:string;authMode:"none"|"api_key"|"google"};
const DEFAULT_MODEL="gemini-3.5-flash-lite";
export function GeminiConnectionDialog({mode,onConnected,onClose,onPreferences}:{mode:"connect"|"replace";onConnected:(changed:boolean)=>void;onClose:()=>void;onPreferences:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),mounted=useRef(false),validating=useRef(false);
 const [visible,setVisible]=useState(mode==="replace"),[key,setKey]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[model,setModel]=useState(DEFAULT_MODEL);
 useEffect(()=>{
  mounted.current=true;let active=true;
  void invoke<GeminiStatus>("gemini_status").then(status=>{
   if(!active)return;
   if(mode==="replace"){setModel(status.selectedModel||DEFAULT_MODEL);return;}
   if(status.configured&&status.authMode==="api_key")onConnected(false);
   else setVisible(true);
  }).catch(()=>{if(active){setError("Não foi possível consultar a conexão. Informe sua chave.");setVisible(true);}});
  return()=>{active=false;mounted.current=false;};
 },[mode,onConnected]);
 useEffect(()=>{if(!visible)return;const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();};},[visible]);
 async function connect(){
  if(validating.current||!key.trim())return;
  validating.current=true;setBusy(true);setError("");
  try{await invoke("gemini_configure",{apiKey:key.trim(),model});if(mounted.current){setKey("");onConnected(true);}}
  catch{if(mounted.current){setKey("");setError("Não foi possível validar a chave. Confira a chave, a conexão e o acesso ao modelo.");}}
  finally{validating.current=false;if(mounted.current)setBusy(false);}
 }
 function cancel(){if(!validating.current){setKey("");onClose();}}
 if(!visible)return null;
 return <dialog ref={dialog} className="gemini-connection-dialog" aria-labelledby="gemini-connection-title" onCancel={e=>{e.preventDefault();cancel();}}>
  <div className="gemini-connection-heading"><h2 id="gemini-connection-title">Chave da API Gemini</h2><button className="icon-button" type="button" aria-label="Fechar conexão Gemini" disabled={busy} onClick={cancel}><Icon name="x" size={18}/></button></div>
  <form onSubmit={e=>{e.preventDefault();void connect();}}>
   <p>{mode==="replace"?"Informe a nova chave. A anterior só será substituída após validação.":"Informe sua chave para começar."}</p>
   <input type="password" autoFocus aria-label="Chave da API Gemini" autoComplete="off" spellCheck={false} placeholder="Informe a chave da API" value={key} maxLength={4096} disabled={busy} onChange={e=>setKey(e.target.value)}/>
   <button className="primary gemini-connect-submit" type="submit" disabled={busy||!key.trim()}>{busy?"Validando…":"Validar e conectar"}</button>
   <button className="gemini-key-link" type="button" disabled={busy} onClick={()=>void openUrl("https://aistudio.google.com/apikey").catch(()=>setError("Não foi possível abrir o Google AI Studio."))}>Obter chave da API ↗</button>
   {mode==="replace"&&<button className="gemini-key-link gemini-preferences-link" type="button" disabled={busy} onClick={()=>{setKey("");onPreferences();}}>Preferências avançadas</button>}
   {error&&<p className="gemini-error" role="alert">{error}</p>}
  </form>
 </dialog>;
}

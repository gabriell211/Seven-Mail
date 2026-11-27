import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "../icons";

type Provider="google_drive"|"one_drive";
type Status={provider:Provider;connected:boolean;expiresAt:number|null;accountLabel:string|null;defaultConfigured:boolean};
const providers:ReadonlyArray<{id:Provider;name:string;description:string;logo:string}>=[
  {id:"google_drive",name:"Google Drive",description:"Conta Google",logo:"/providers/google-drive.png"},
  {id:"one_drive",name:"OneDrive",description:"Conta Microsoft",logo:"/providers/onedrive.svg"},
];

function ProviderLogo({src}:{src:string}){
  const [failed,setFailed]=useState(false);
  return <span className="seven-storage-logo">{failed?<Icon name="cloud" size={32}/>:<img src={src} alt="" width={40} height={40} decoding="async" onError={()=>setFailed(true)}/>}</span>;
}

export function ExternalStoragePanel(){
  const [statuses,setStatuses]=useState<Status[]>([]);
  const [clients,setClients]=useState<Record<Provider,string>>({google_drive:"",one_drive:""});
  const [googleSecret,setGoogleSecret]=useState("");
  const [busy,setBusy]=useState<Provider|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState("");
  const alive=useRef(true);
  const attempt=useRef<string|null>(null);
  useEffect(()=>{
    alive.current=true;
    void invoke<Status[]>("external_storage_status").then(value=>{if(alive.current){setStatuses(value);setLoaded(true);}}).catch(()=>{if(alive.current)setError("Não foi possível consultar as conexões de armazenamento.");});
    return()=>{alive.current=false;const id=attempt.current;if(id)void invoke("external_storage_cancel",{attemptId:id}).catch(()=>{});};
  },[]);
  function update(value:Status){setStatuses(previous=>[...previous.filter(item=>item.provider!==value.provider),value]);}
  async function connect(provider:Provider){
    if(busy||!loaded)return;
    const id=crypto.randomUUID();attempt.current=id;setBusy(provider);setError("");
    try{const result=await invoke<Status>("external_storage_connect",{provider,attemptId:id,clientId:clients[provider],clientSecret:provider==="google_drive"?googleSecret:""});if(alive.current)update(result);}
    catch(reason){if(alive.current)setError(String(reason));}
    finally{attempt.current=null;if(alive.current){setBusy(null);setGoogleSecret("");}}
  }
  async function action(provider:Provider,disconnect:boolean){
    if(busy||!loaded)return;setBusy(provider);setError("");
    try{
      if(disconnect){await invoke("external_storage_disconnect",{provider});if(alive.current)setStatuses(previous=>previous.map(s=>s.provider===provider?{...s,connected:false,accountLabel:null,expiresAt:null}:s));}
      else{const result=await invoke<Status>("external_storage_verify",{provider});if(alive.current)update(result);}
    }catch(reason){if(alive.current)setError(String(reason));}finally{if(alive.current)setBusy(null);}
  }
  return <div className="settings-row cloud-settings seven-storage-settings">
    <div><h3>Armazenamentos externos</h3><p>Conecte suas contas pessoais à Nuvem Seven. A conexão não ativa backup nem envia e-mails automaticamente.</p></div>
    <div className="seven-storage-list">
      <div className="seven-storage-grid">
      {providers.map(provider=>{
        const current=statuses.find(s=>s.provider===provider.id);
        const expired=current?.expiresAt!=null&&current.expiresAt<=Date.now()/1000;
        return <section className="seven-storage-card" key={provider.id}>
          <div className="seven-storage-title"><ProviderLogo src={provider.logo}/><span><b>{provider.name}</b><small>{provider.description}</small></span></div>
          <small role="status">{current?.connected?(expired?"Autorização expirada — verifique a conexão":current.accountLabel||"Conta autorizada"):"Não conectado"}</small>
          {!current?.connected&&<details className="seven-storage-advanced"><summary>Configuração de conexão</summary><label>Client ID desktop<input value={clients[provider.id]} disabled={!!busy} onChange={event=>setClients(prev=>({...prev,[provider.id]:event.target.value}))} placeholder={current?.defaultConfigured?"Cliente padrão do Seven Mail":"Informe o Client ID registrado"} maxLength={256}/></label>{provider.id==="google_drive"&&<label>Client secret de aplicativo instalado (se exigido)<input type="password" autoComplete="off" value={googleSecret} disabled={!!busy} onChange={event=>setGoogleSecret(event.target.value)} maxLength={512}/></label>}</details>}
          <div>{current?.connected?<><button className="secondary" disabled={!!busy||!loaded} onClick={()=>void action(provider.id,false)}>Verificar conexão</button><button className="secondary" disabled={!!busy||!loaded} onClick={()=>void action(provider.id,true)}>Desconectar</button></>:<button className="primary" disabled={!!busy||!loaded||(!current?.defaultConfigured&&!clients[provider.id].trim())} title={`Conectar ${provider.name}`} aria-label={`Conectar ${provider.name}`} onClick={()=>void connect(provider.id)}>Conectar</button>}{busy===provider.id&&attempt.current&&<button className="secondary" onClick={()=>void invoke("external_storage_cancel",{attemptId:attempt.current}).catch(()=>setError("Não foi possível cancelar."))}>Cancelar</button>}</div>
        </section>;
      })}
      <section className="seven-storage-card"><div className="seven-storage-title"><ProviderLogo src="/providers/terabox.png"/><span><b>TeraBox</b><small>Conta pessoal</small></span></div><small role="status">Em preparação</small><div><button className="secondary" title="Conectar TeraBox" aria-label="Conectar TeraBox" disabled>Conectar</button></div></section>
      </div>
      {error&&<small className="cloud-error" role="alert">{error}</small>}
      <small>Backup e restauração em armazenamentos externos ainda não estão disponíveis. Desconectar remove apenas a autorização local.</small>
    </div>
  </div>;
}

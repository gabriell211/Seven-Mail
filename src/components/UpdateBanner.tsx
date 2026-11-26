import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";

export type UpdateInfo = {
  available:boolean;
  currentVersion:string;
  version:string;
  releaseUrl:string;
  assetName?:string;
  assetUrl?:string;
  assetSize?:number;
  digest?:string;
  notes?:string;
};

export function UpdateBanner({
  info,
  onDismiss,
  platform,
}:{
  info:UpdateInfo;
  onDismiss:()=>void;
  platform?:string;
}){
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [scheduled,setScheduled]=useState(false);
  const [canSchedule,setCanSchedule]=useState(false);
  useEffect(()=>{
    if(platform!=="windows") return;
    let disposed=false;
    void bridge.silentUpdateStatus().then(value=>{if(!disposed){setCanSchedule(value.supported);setScheduled(value.pending);}}).catch(()=>undefined);
    return ()=>{disposed=true;};
  },[platform]);

  async function install(silent=false){
    if(busy) return;
    setBusy(true);
    setError("");
    setStatus("Baixando e verificando a atualização…");
    try{
      const path=await bridge.downloadUpdate(info);
      if(silent){
        setStatus(await bridge.scheduleSilentUpdate(path));
        setScheduled(true);
      }else{
        setStatus("Instalador verificado. Abrindo atualização…");
        setStatus(await bridge.installUpdate(path));
      }
    }catch(reason){
      setStatus("");
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function cancelScheduled(){
    setBusy(true);
    setError("");
    try{await bridge.cancelSilentUpdate();setScheduled(false);setStatus("Agendamento cancelado.");}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  return <aside className="update-banner" role="status">
    <div className="update-banner-icon"><Icon name="download" size={18}/></div>
    <div className="update-banner-copy">
      <b>Seven Mail {info.version} disponível</b>
      <span>Você está usando {info.currentVersion}. O instalador será validado por SHA-256 antes de abrir.</span>
      {scheduled&&!status&&<small>Atualização silenciosa agendada. Encerre pelo menu Sair da bandeja.</small>}
      {status&&<small>{status}</small>}
      {error&&<small className="form-error">{error}</small>}
    </div>
    <div className="update-banner-actions">
      {scheduled?<button className="secondary" onClick={()=>void cancelScheduled()} disabled={busy}>Cancelar agendamento</button>:<>
        <button className="secondary" onClick={onDismiss} disabled={busy}>Depois</button>
        {canSchedule&&<button className="secondary" onClick={()=>void install(true)} disabled={busy||!info.assetUrl}>Instalar ao sair (silencioso)</button>}
        <button className="primary" onClick={()=>void install()} disabled={busy||!info.assetUrl}>{busy?"Preparando…":"Atualizar"}</button>
      </>}
    </div>
  </aside>;
}

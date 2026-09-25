import { useState } from "react";
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
}:{
  info:UpdateInfo;
  onDismiss:()=>void;
}){
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");

  async function install(){
    if(busy) return;
    setBusy(true);
    setError("");
    setStatus("Baixando e verificando a atualização…");
    try{
      const path=await bridge.downloadUpdate(info);
      setStatus("Instalador verificado. Abrindo atualização…");
      const result=await bridge.installUpdate(path);
      setStatus(result);
    }catch(reason){
      setStatus("");
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  return <aside className="update-banner" role="status">
    <div className="update-banner-icon"><Icon name="download" size={18}/></div>
    <div className="update-banner-copy">
      <b>Seven Mail {info.version} disponível</b>
      <span>Você está usando {info.currentVersion}. O instalador será validado por SHA-256 antes de abrir.</span>
      {status&&<small>{status}</small>}
      {error&&<small className="form-error">{error}</small>}
    </div>
    <div className="update-banner-actions">
      <button className="secondary" onClick={onDismiss} disabled={busy}>Depois</button>
      <button className="primary" onClick={()=>void install()} disabled={busy||!info.assetUrl}>{busy?"Preparando…":"Atualizar"}</button>
    </div>
  </aside>;
}

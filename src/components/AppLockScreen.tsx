import { useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "../icons";

export function AppLockScreen({
  onUnlock,
}: {
  onUnlock: (pin: string) => Promise<boolean>;
}) {
  const [pin,setPin]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function unlock(){
    if(!pin.trim()||busy) return;
    setBusy(true);
    setError("");
    try{
      if(await onUnlock(pin)){
        setPin("");
      }else{
        setError("PIN incorreto.");
      }
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  return <div className="app-lock-screen" role="dialog" aria-modal="true" aria-label="Seven Mail bloqueado">
    <section className="app-lock-card">
      <BrandLogo variant="about"/>
      <span className="eyebrow">SEVEN MAIL</span>
      <h1>Aplicativo bloqueado</h1>
      <p>Digite seu PIN para continuar. O PIN fica protegido pelo Keyring do sistema operacional.</p>
      <label className="app-lock-field">
        <Icon name="lock" size={17}/>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(event)=>setPin(event.target.value)}
          onKeyDown={(event)=>{if(event.key==="Enter")void unlock();}}
          placeholder="PIN"
        />
      </label>
      {error&&<div className="form-error">{error}</div>}
      <button className="primary app-lock-submit" disabled={!pin.trim()||busy} onClick={()=>void unlock()}>
        {busy?"Verificando...":"Desbloquear"}
      </button>
    </section>
  </div>;
}

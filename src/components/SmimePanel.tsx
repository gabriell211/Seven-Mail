import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile } from "../types";

type IdentityStatus={configured:boolean;subject?:string};

export function SmimePanel({accounts}:{accounts:AccountProfile[]}) {
  const [statuses,setStatuses]=useState<Record<string,IdentityStatus>>({});
  const [busy,setBusy]=useState("");

  async function refresh() {
    const entries=await Promise.all(accounts.map(async(account)=>{
      const status=await bridge.smimeIdentityStatus(account.id).catch(()=>({configured:false}));
      return [account.id,status] as const;
    }));
    setStatuses(Object.fromEntries(entries));
  }

  useEffect(()=>{void refresh();},[accounts.map((account)=>account.id).join("|")]);

  async function importIdentity(account:AccountProfile) {
    const selected=await open({
      multiple:false,
      directory:false,
      filters:[{name:"Identidade PKCS#12",extensions:["p12","pfx"]}],
    });
    if(!selected||Array.isArray(selected)) return;
    const password=window.prompt("Senha do arquivo PKCS#12");
    if(password===null) return;
    setBusy(account.id);
    try{
      await bridge.importSmimeIdentity(account.id,selected,password);
      await refresh();
    }catch(reason){
      window.alert(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy("");
    }
  }

  async function removeIdentity(account:AccountProfile) {
    if(!window.confirm(`Remover a identidade S/MIME de ${account.email}?`)) return;
    setBusy(account.id);
    try{
      await bridge.removeSmimeIdentity(account.id);
      await refresh();
    }finally{
      setBusy("");
    }
  }

  async function importRecipient() {
    const email=window.prompt("E-mail do destinatário do certificado")?.trim();
    if(!email) return;
    const selected=await open({
      multiple:false,
      directory:false,
      filters:[{name:"Certificado X.509",extensions:["pem","cer","crt","der"]}],
    });
    if(!selected||Array.isArray(selected)) return;
    setBusy("__recipient__");
    try{
      await bridge.importSmimeRecipientCertificate(email,selected);
      window.alert(`Certificado S/MIME salvo para ${email}.`);
    }catch(reason){
      window.alert(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy("");
    }
  }

  return <div className="settings-row smime-settings">
    <div>
      <h3>S/MIME</h3>
      <p>Assinatura digital e criptografia usando identidades PKCS#12 e certificados X.509. A senha fica no Keyring do sistema.</p>
    </div>
    <div className="smime-panel">
      {accounts.length===0&&<div className="mini-empty">Adicione uma conta para configurar S/MIME.</div>}
      {accounts.map((account)=>{
        const status=statuses[account.id];
        return <article className="smime-account" key={account.id}>
          <span><i style={{background:account.color}}/><b>{account.email}</b><small>{status?.configured?(status.subject||"Identidade configurada"):"Sem identidade"}</small></span>
          <div>
            <button className="secondary" disabled={busy===account.id} onClick={()=>void importIdentity(account)}><Icon name="lock" size={13}/> {status?.configured?"Substituir":"Importar PKCS#12"}</button>
            {status?.configured&&<button className="danger-ghost" disabled={busy===account.id} onClick={()=>void removeIdentity(account)}>Remover</button>}
          </div>
        </article>;
      })}
      <button className="secondary" disabled={busy==="__recipient__"} onClick={()=>void importRecipient()}><Icon name="plus" size={13}/> Certificado de destinatário</button>
    </div>
  </div>;
}

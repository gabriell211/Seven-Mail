import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile } from "../types";

type Catalog = {
  capabilities: Record<string, boolean>;
  sensitivityLabels: Array<Record<string, unknown>>;
  retentionLabels: Array<Record<string, unknown>>;
  sensitivityError?: string;
  retentionError?: string;
};

function labelName(item: Record<string, unknown>): string {
  return String(item.displayName ?? item.name ?? item.id ?? "Rótulo");
}

export function CorporatePoliciesPanel({ accounts }: { accounts: AccountProfile[] }) {
  const eligible = accounts.filter((account) => account.oauthEnabled);
  const [selected,setSelected]=useState(eligible[0]?.id ?? "");
  const [catalog,setCatalog]=useState<Catalog>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [rights,setRights]=useState<Record<string,string>>({});

  useEffect(()=>{
    if(!eligible.some((account)=>account.id===selected)) setSelected(eligible[0]?.id??"");
  },[accounts.map((account)=>account.id).join("|")]);

  async function refresh(accountId=selected) {
    if(!accountId) return;
    setBusy(true);
    setError("");
    setRights({});
    try{
      const capabilities=await bridge.providerCapabilities(accountId);
      if(!capabilities.nativeApi){
        throw new Error("Esta conta não possui API corporativa nativa disponível.");
      }
      setCatalog(await bridge.providerCorporateCatalog(accountId));
    }catch(reason){
      setCatalog(undefined);
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function inspectRights(label:Record<string,unknown>) {
    if(!selected) return;
    const id=String(label.id??"");
    if(!id) return;
    try{
      const result=await bridge.providerSensitivityRights(
        selected,
        id,
        accounts.find((account)=>account.id===selected)?.email,
      );
      const value=result.value;
      setRights((current)=>({...current,[id]:Array.isArray(value)?value.join(", "):String(value??"Sem direitos retornados")}));
    }catch(reason){
      setRights((current)=>({...current,[id]:reason instanceof Error?reason.message:String(reason)}));
    }
  }

  return <div className="settings-row corporate-settings">
    <div>
      <h3>Políticas corporativas</h3>
      <p>Consulta APIs nativas do provedor para sensibilidade, retenção e direitos de uso quando o tenant e o OAuth permitirem.</p>
    </div>
    <div className="corporate-panel">
      {eligible.length===0?<div className="mini-empty">Autorize uma conta corporativa por OAuth para consultar políticas.</div>:<>
        <div className="corporate-toolbar">
          <select value={selected} onChange={(event)=>{setSelected(event.target.value);setCatalog(undefined);setRights({});}}>
            {eligible.map((account)=><option key={account.id} value={account.id}>{account.email}</option>)}
          </select>
          <button className="secondary" disabled={busy||!selected} onClick={()=>void refresh()}><Icon name="refresh" size={14}/>{busy?"Consultando...":"Consultar provedor"}</button>
        </div>
        {error&&<div className="form-error">{error}</div>}
        {catalog&&<div className="corporate-columns">
          <section>
            <header><b>Rótulos de sensibilidade</b><span>{catalog.sensitivityLabels.length}</span></header>
            {catalog.sensitivityError&&<small className="policy-error">{catalog.sensitivityError}</small>}
            {catalog.sensitivityLabels.map((label)=>{
              const id=String(label.id??crypto.randomUUID());
              return <article className="policy-card" key={id}>
                <span className="policy-color" style={{background:String(label.color??"#6f60f4")}}/>
                <div><b>{labelName(label)}</b><small>{String(label.description??label.toolTip??"Sem descrição")}</small>{rights[id]&&<em>Direitos: {rights[id]}</em>}</div>
                <button className="ghost" onClick={()=>void inspectRights(label)}>Direitos</button>
              </article>;
            })}
          </section>
          <section>
            <header><b>Políticas de retenção</b><span>{catalog.retentionLabels.length}</span></header>
            {catalog.retentionError&&<small className="policy-error">{catalog.retentionError}</small>}
            {catalog.retentionLabels.map((label)=>{
              const id=String(label.id??crypto.randomUUID());
              return <article className="policy-card" key={id}>
                <span className="policy-color retention"/>
                <div><b>{labelName(label)}</b><small>{String(label.descriptionForUsers??label.descriptionForAdmins??"Sem descrição")}</small></div>
              </article>;
            })}
          </section>
        </div>}
      </>}
    </div>
  </div>;
}

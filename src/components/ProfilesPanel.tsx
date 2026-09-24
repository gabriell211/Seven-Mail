import { useState } from "react";
import { Icon } from "../icons";
import type { AccountProfile, AppSettings, ProfileItem } from "../types";

function freshProfile(accounts: AccountProfile[]): ProfileItem {
  return {
    id: crypto.randomUUID(),
    name: "Novo perfil",
    accountIds: accounts.map((account)=>account.id),
    settings: {},
    isDefault: false,
  };
}

export function ProfilesPanel({
  accounts,
  profiles,
  activeProfileId,
  onActivate,
  onSave,
  onDelete,
}: {
  accounts: AccountProfile[];
  profiles: ProfileItem[];
  activeProfileId?: string;
  onActivate: (profile: ProfileItem | null) => void;
  onSave: (profile: ProfileItem) => Promise<void>;
  onDelete: (profile: ProfileItem) => Promise<void>;
}) {
  const [editing,setEditing]=useState<ProfileItem|null>(null);
  const [busy,setBusy]=useState(false);

  async function save() {
    if(!editing?.name.trim()||busy) return;
    setBusy(true);
    try{
      await onSave({...editing,name:editing.name.trim()});
      setEditing(null);
    }finally{
      setBusy(false);
    }
  }

  function toggleAccount(id:string) {
    if(!editing) return;
    setEditing({
      ...editing,
      accountIds:editing.accountIds.includes(id)
        ? editing.accountIds.filter((value)=>value!==id)
        : [...editing.accountIds,id],
    });
  }

  return <>
    <div className="settings-row profile-settings-row">
      <div>
        <h3>Perfis</h3>
        <p>Separe conjuntos de contas e preferências sem misturar o fluxo de trabalho.</p>
      </div>
      <div className="profiles-panel">
        <div className="profile-toolbar">
          <select
            value={activeProfileId??"__all__"}
            onChange={(event)=>{
              const profile=profiles.find((item)=>item.id===event.target.value)??null;
              onActivate(profile);
            }}
          >
            <option value="__all__">Todas as contas</option>
            {profiles.map((profile)=><option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
          <button className="secondary" onClick={()=>setEditing(freshProfile(accounts))}>
            <Icon name="plus" size={13}/> Novo perfil
          </button>
        </div>
        {profiles.length===0
          ? <div className="mini-empty profile-empty">Nenhum perfil criado. O modo padrão mostra todas as contas.</div>
          : <div className="profile-list">{profiles.map((profile)=><article className={profile.id===activeProfileId?"profile-card active":"profile-card"} key={profile.id}>
              <button className="profile-main" onClick={()=>onActivate(profile)}>
                <b>{profile.name}</b>
                <small>{profile.accountIds.length} conta(s){profile.isDefault?" · padrão":""}</small>
              </button>
              <button className="icon-button" title="Editar perfil" onClick={()=>setEditing({...profile,accountIds:[...profile.accountIds],settings:{...profile.settings}})}><Icon name="settings" size={14}/></button>
              <button className="icon-button" title="Excluir perfil" onClick={()=>void onDelete(profile)}><Icon name="trash" size={14}/></button>
            </article>)}</div>}
      </div>
    </div>

    {editing&&<div className="modal-backdrop" onMouseDown={()=>setEditing(null)}>
      <section className="modal entity-modal profile-modal" onMouseDown={(event)=>event.stopPropagation()}>
        <header className="modal-header compact-header">
          <div><span className="eyebrow">PERFIL</span><h2>{editing.name||"Novo perfil"}</h2></div>
          <button className="icon-button" onClick={()=>setEditing(null)} aria-label="Fechar"><Icon name="x"/></button>
        </header>
        <div className="entity-form">
          <label className="full"><span>Nome</span><input autoFocus value={editing.name} onChange={(event)=>setEditing({...editing,name:event.target.value})}/></label>
          <div className="full profile-account-picker">
            <span>Contas deste perfil</span>
            {accounts.map((account)=><label key={account.id}><input type="checkbox" checked={editing.accountIds.includes(account.id)} onChange={()=>toggleAccount(account.id)}/><i style={{background:account.color}}/>{account.displayName}<small>{account.email}</small></label>)}
          </div>
          <label className="inline-check"><input type="checkbox" checked={Boolean(editing.isDefault)} onChange={(event)=>setEditing({...editing,isDefault:event.target.checked})}/> Perfil padrão</label>
          <label><span>Tema do perfil</span><select value={(editing.settings.theme as AppSettings["theme"]|undefined)??""} onChange={(event)=>setEditing({...editing,settings:{...editing.settings,theme:(event.target.value||undefined) as AppSettings["theme"]}})}><option value="">Usar global</option><option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
          <label><span>Densidade</span><select value={editing.settings.compact===undefined?"":editing.settings.compact?"compact":"comfortable"} onChange={(event)=>setEditing({...editing,settings:{...editing.settings,compact:event.target.value===""?undefined:event.target.value==="compact"}})}><option value="">Usar global</option><option value="comfortable">Confortável</option><option value="compact">Compacta</option></select></label>
        </div>
        <footer className="modal-footer"><button className="secondary" onClick={()=>setEditing(null)}>Cancelar</button><button className="primary" disabled={busy||!editing.name.trim()} onClick={()=>void save()}>{busy?"Salvando...":"Salvar perfil"}</button></footer>
      </section>
    </div>}
  </>;
}

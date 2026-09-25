import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import { BUILTIN_EXTENSIONS, extensionHasPermission, validateExtensionManifest } from "../lib/extensions";
import { pushCloudDocument } from "../lib/neon";
import type { ExtensionManifestItem, WorkspaceDocument } from "../types";

export function ExtensionsPanel() {
  const [items,setItems]=useState<ExtensionManifestItem[]>([]);
  const [error,setError]=useState("");

  async function load() {
    const docs=await bridge.listWorkspace<ExtensionManifestItem>("extension").catch(()=>[]);
    setItems(docs.map((document)=>document.payload));
  }

  useEffect(()=>{void load();},[]);

  async function persist(item:ExtensionManifestItem) {
    const document:WorkspaceDocument<ExtensionManifestItem>={
      id:item.id,
      kind:"extension",
      updatedAt:new Date().toISOString(),
      payload:item,
    };
    await bridge.upsertWorkspace(document);
    setItems((current)=>[item,...current.filter((value)=>value.id!==item.id)]);
    void pushCloudDocument(document).catch(()=>undefined);
  }

  async function installBuiltin(item:ExtensionManifestItem) {
    await persist({...item,permissions:item.permissions.map((permission)=>({...permission,granted:false})),enabled:false});
  }

  async function importManifest() {
    setError("");
    try{
      const selected=await open({multiple:false,directory:false,filters:[{name:"Extensão Seven Mail",extensions:["json"]}]});
      if(!selected||Array.isArray(selected)) return;
      const raw=await bridge.readTextFile(selected);
      await persist(validateExtensionManifest(JSON.parse(raw)));
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  async function remove(item:ExtensionManifestItem) {
    if(!window.confirm(`Remover a extensão "${item.name}"?`)) return;
    const tombstone=await bridge.deleteWorkspace("extension",item.id);
    setItems((current)=>current.filter((value)=>value.id!==item.id));
    void pushCloudDocument(tombstone).catch(()=>undefined);
  }

  async function testExternal(item:ExtensionManifestItem) {
    setError("");
    try{
      if(item.storage&&extensionHasPermission(item,"storage.open")){
        await openUrl(item.storage.url);
        return;
      }
      const action=item.actions?.find((candidate)=>extensionHasPermission(item,candidate.permission));
      if(action){
        const url=new URL(action.urlTemplate);
        if(url.protocol!=="https:") throw new Error("Somente ações HTTPS são permitidas.");
        await openUrl(url.toString());
        return;
      }
      throw new Error("Esta extensão não possui uma ação externa permitida para testar.");
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  const missingBuiltins=BUILTIN_EXTENSIONS.filter((builtin)=>!items.some((item)=>item.id===builtin.id));

  return <div className="settings-row extension-settings">
    <div><h3>Extensões</h3><p>Integrações declarativas, sem execução de scripts. Cada permissão é isolada e pode ser revogada individualmente.</p></div>
    <div className="extension-panel">
      <div className="extension-toolbar">
        <button className="secondary" onClick={()=>void importManifest()}><Icon name="upload" size={14}/> Importar manifesto</button>
        {missingBuiltins.map((item)=><button className="secondary" key={item.id} onClick={()=>void installBuiltin(item)}><Icon name="plus" size={13}/> {item.name}</button>)}
      </div>
      {error&&<div className="form-error">{error}</div>}
      {items.length===0?<div className="mini-empty">Nenhuma extensão instalada. As extensões não podem executar JavaScript dentro do Seven Mail.</div>:<div className="extension-list">
        {items.map((item)=><article className="extension-card" key={item.id}>
          <header><div><b>{item.name}</b><small>{item.id} · v{item.version}</small></div><label className="switch-line"><input type="checkbox" checked={item.enabled} onChange={(event)=>void persist({...item,enabled:event.target.checked})}/> Ativa</label></header>
          {item.description&&<p>{item.description}</p>}
          <div className="extension-permissions">
            {item.permissions.map((permission)=><label key={permission.id}><input type="checkbox" checked={permission.granted} disabled={!item.enabled} onChange={(event)=>void persist({...item,permissions:item.permissions.map((value)=>value.id===permission.id?{...value,granted:event.target.checked}:value)})}/><span>{permission.id}</span></label>)}
          </div>
          <footer><button className="ghost" disabled={!item.enabled} onClick={()=>void testExternal(item)}>Testar ação segura</button><button className="danger-link" onClick={()=>void remove(item)}>Remover</button></footer>
        </article>)}
      </div>}
    </div>
  </div>;
}

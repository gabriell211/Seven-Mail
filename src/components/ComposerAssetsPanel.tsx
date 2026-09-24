import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import { pushCloudDocument } from "../lib/neon";
import type { ContentBlockItem, MailTemplateItem, WorkspaceDocument } from "../types";

type EditorState =
  | { kind: "template"; value: MailTemplateItem }
  | { kind: "content-block"; value: ContentBlockItem }
  | null;

function textHtml(value: string): string {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML.replace(/\n/g, "<br>");
}

export function ComposerAssetsPanel() {
  const [templates,setTemplates]=useState<MailTemplateItem[]>([]);
  const [blocks,setBlocks]=useState<ContentBlockItem[]>([]);
  const [editing,setEditing]=useState<EditorState>(null);

  async function reload(){
    const [templateDocs,blockDocs]=await Promise.all([
      bridge.listWorkspace<MailTemplateItem>("template").catch(()=>[]),
      bridge.listWorkspace<ContentBlockItem>("content-block").catch(()=>[]),
    ]);
    setTemplates(templateDocs.map((document)=>document.payload));
    setBlocks(blockDocs.map((document)=>document.payload));
  }

  useEffect(()=>{void reload();},[]);

  async function save(){
    if(!editing) return;
    const now=new Date().toISOString();
    if(editing.kind==="template"){
      const value={...editing.value,bodyHtml:textHtml(editing.value.bodyText)};
      const document:WorkspaceDocument<MailTemplateItem>={id:value.id,kind:"template",updatedAt:now,payload:value};
      await bridge.upsertWorkspace(document);
      void pushCloudDocument(document).catch(()=>undefined);
    }else{
      const value={...editing.value,bodyHtml:textHtml(editing.value.bodyText)};
      const document:WorkspaceDocument<ContentBlockItem>={id:value.id,kind:"content-block",updatedAt:now,payload:value};
      await bridge.upsertWorkspace(document);
      void pushCloudDocument(document).catch(()=>undefined);
    }
    setEditing(null);
    await reload();
  }

  async function remove(kind:"template"|"content-block",id:string){
    const tombstone=await bridge.deleteWorkspace(kind,id);
    void pushCloudDocument(tombstone).catch(()=>undefined);
    await reload();
  }

  function newTemplate(){
    setEditing({kind:"template",value:{id:crypto.randomUUID(),name:"",subject:"",bodyText:"",bodyHtml:""}});
  }
  function newBlock(){
    setEditing({kind:"content-block",value:{id:crypto.randomUUID(),name:"",bodyText:"",bodyHtml:""}});
  }

  return <>
    <div className="settings-row composer-assets-row">
      <div><h3>Modelos e blocos</h3><p>Conteúdo reutilizável para acelerar a composição sem depender de serviços externos.</p></div>
      <div className="composer-assets">
        <section>
          <header><b>Modelos</b><button className="secondary" onClick={newTemplate}><Icon name="plus" size={13}/> Novo modelo</button></header>
          {templates.length===0?<small>Nenhum modelo salvo.</small>:templates.map((item)=><article key={item.id}><button onClick={()=>setEditing({kind:"template",value:{...item}})}><b>{item.name}</b><span>{item.subject||"(sem assunto)"}</span></button><button className="icon-button" onClick={()=>void remove("template",item.id)}><Icon name="trash" size={13}/></button></article>)}
        </section>
        <section>
          <header><b>Blocos reutilizáveis</b><button className="secondary" onClick={newBlock}><Icon name="plus" size={13}/> Novo bloco</button></header>
          {blocks.length===0?<small>Nenhum bloco salvo.</small>:blocks.map((item)=><article key={item.id}><button onClick={()=>setEditing({kind:"content-block",value:{...item}})}><b>{item.name}</b><span>{item.bodyText.slice(0,80)||"Bloco vazio"}</span></button><button className="icon-button" onClick={()=>void remove("content-block",item.id)}><Icon name="trash" size={13}/></button></article>)}
        </section>
      </div>
    </div>
    {editing&&<div className="modal-backdrop" onMouseDown={()=>setEditing(null)}>
      <section className="modal entity-modal" onMouseDown={(event)=>event.stopPropagation()}>
        <header className="modal-header compact-header"><div><span className="eyebrow">{editing.kind==="template"?"MODELO":"BLOCO"}</span><h2>{editing.value.name||"Novo conteúdo"}</h2></div><button className="icon-button" onClick={()=>setEditing(null)}><Icon name="x"/></button></header>
        <div className="entity-form">
          <label className="full"><span>Nome</span><input autoFocus value={editing.value.name} onChange={(event)=>setEditing({...editing,value:{...editing.value,name:event.target.value}} as EditorState)}/></label>
          {editing.kind==="template"&&<label className="full"><span>Assunto</span><input value={editing.value.subject} onChange={(event)=>setEditing({kind:"template",value:{...editing.value,subject:event.target.value}})}/></label>}
          <label className="full"><span>Conteúdo</span><textarea className="note-editor" value={editing.value.bodyText} onChange={(event)=>setEditing({...editing,value:{...editing.value,bodyText:event.target.value}} as EditorState)}/></label>
        </div>
        <footer className="modal-footer"><button className="secondary" onClick={()=>setEditing(null)}>Cancelar</button><button className="primary" disabled={!editing.value.name.trim()} onClick={()=>void save()}>Salvar</button></footer>
      </section>
    </div>}
  </>;
}

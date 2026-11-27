import { useEffect,useRef,useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile,MailMessage } from "../types";
import type { ComposeDraft } from "./Composer";

type Turn={role:"user"|"assistant";text:string};
type Draft={id:string;accountId:string;to:string;subject:string;bodyText:string};
type Answer={answer:string;proposalId?:string|null;draft?:Draft|null;messageCount:number};
type Grant={accountId:string;token:string};
type ModelOption={id:string;label:string};
const docs="https://aistudio.google.com/apikey";
export function GeminiMark(){return <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path fill="currentColor" d="M12 0c0 6.63 5.37 12 12 12-6.63 0-12 5.37-12 12 0-6.63-5.37-12-12-12C6.63 12 12 6.63 12 0Z"/></svg>}
export function GeminiPanel({accounts,initialAccountId,onClose,onDraft,composeOpen}:{accounts:AccountProfile[];initialAccountId?:string;onClose:()=>void;onDraft:(draft:ComposeDraft)=>void;composeOpen:boolean}){
  const [accountId,setAccountId]=useState(initialAccountId??accounts[0]?.id??"");
  const grantRef=useRef<Grant|null>(null);
  const alive=useRef(true);
  const [messages,setMessages]=useState<MailMessage[]>([]);
  const [messageId,setMessageId]=useState("");
  const [history,setHistory]=useState<Turn[]>([]);
  const [question,setQuestion]=useState("");
  const [busy,setBusy]=useState(false);
  const [streaming,setStreaming]=useState(false);
  const [partial,setPartial]=useState("");
  const requestActive=useRef(false);
  const [error,setError]=useState("");
  const [answer,setAnswer]=useState<Answer|null>(null);
  const [configured,setConfigured]=useState(false);
  const [apiKey,setApiKey]=useState("");
  const [model,setModel]=useState("gemini-3.8-flash");
  const [selectedModel,setSelectedModel]=useState("gemini-3.8-flash");
  const [models,setModels]=useState<ModelOption[]>([]);
  const [modelStatus,setModelStatus]=useState("");
  const [loadingConfig,setLoadingConfig]=useState(true);
  const [search,setSearch]=useState("");
  const [replyMode,setReplyMode]=useState(false);
  const account=accounts.find(item=>item.id===accountId);
  const readable=!!account&&configured;
  const searchTerm=search.trim().toLocaleLowerCase();
  const matchingMessages=messages.filter(item=>!searchTerm||[item.subject,item.from.email,item.bodyText??item.preview].some(value=>value?.toLocaleLowerCase().includes(searchTerm)));
  const bottom=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{
    alive.current=true;
    let active=true;
    void invoke<{configured:boolean;selectedModel:string}>("gemini_status").then(value=>{if(active){setConfigured(value.configured);setModel(value.selectedModel);setSelectedModel(value.selectedModel);}}).catch(reason=>{if(active)setError(String(reason));}).finally(()=>{if(active)setLoadingConfig(false);});
    return()=>{active=false;alive.current=false;requestActive.current=false;const token=grantRef.current?.token;grantRef.current=null;if(token)void invoke("gemini_revoke",{token}).catch(()=>{});};
  },[]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:"nearest"});},[history,busy,partial]);
  useEffect(()=>{
    let active=true;
    setMessages([]);
    if(readable){void bridge.listCachedMessages(accountId).then(cached=>{if(active)setMessages(cached.filter(item=>item.accountId===accountId).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)));}).catch(reason=>{if(active)setError(String(reason));});}
    return()=>{active=false;};
  },[accountId,readable]);
  async function revoke(){
    const token=grantRef.current?.token;
    grantRef.current=null;setPartial("");setHistory([]);setAnswer(null);setMessageId("");setSearch("");setQuestion("");setReplyMode(false);
    if(token)await invoke("gemini_revoke",{token}).catch(()=>{});
  }
  async function configure(){
    if(busy||loadingConfig||!apiKey.trim()||!model.trim())return;
    setBusy(true);setError("");
    try{await invoke("gemini_configure",{apiKey:apiKey.trim(),model:model.trim()});if(alive.current){await revoke();setConfigured(true);setSelectedModel(model.trim());setModel(model.trim());setModels([]);setModelStatus("Configuração salva.");}}
    catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current){setApiKey("");setBusy(false);}}
  }
  async function loadModels(){
    if(busy||loadingConfig||(!configured&&!apiKey.trim()))return;
    setBusy(true);setError("");setModelStatus("");
    try{
      const options=await invoke<ModelOption[]>("gemini_list_models",{apiKey:apiKey.trim()||null});
      if(alive.current){setModels(options);setModelStatus(options.length?"Catálogo atualizado. Escolha um modelo.":"Nenhum modelo de texto encontrado.");}
    }catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current)setBusy(false);}
  }
  async function saveModel(){
    if(busy||loadingConfig||!configured||!model.trim()||model.trim()===selectedModel)return;
    setBusy(true);setError("");setModelStatus("");
    try{
      await invoke("gemini_set_model",{model:model.trim()});
      if(alive.current){
        grantRef.current=null;setAnswer(null);setSelectedModel(model.trim());setModel(model.trim());setModelStatus("Modelo salvo. Será usado nas próximas respostas.");
      }
    }catch(reason){if(alive.current){setModel(selectedModel);setError(String(reason));}}
    finally{if(alive.current)setBusy(false);}
  }
  async function disconnect(){
    if(busy)return;setBusy(true);setError("");
    try{await revoke();await invoke("gemini_disconnect");if(alive.current){setConfigured(false);setModels([]);setModelStatus("");}}
    catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current)setBusy(false);}
  }
  async function ask(){
    const text=question.trim();
    if(!text||busy||requestActive.current||!account||!configured)return;
    const id=account.id;
    if(replyMode&&!messageId){setError("Selecione o e-mail para responder.");return;}
    requestActive.current=true;
    setBusy(true);setStreaming(true);setPartial("");setError("");setAnswer(null);setQuestion("");
    const prior=history.slice(-6).map(turn=>({...turn,text:Array.from(turn.text).slice(0,1200).join("")}));
    setHistory(value=>[...value,{role:"user",text}]);
    try{
      let current=grantRef.current;
      if(!current||current.accountId!==id){
        const token=await invoke<string>("gemini_open_read_session",{accountId:id});
        if(!alive.current||!requestActive.current){void invoke("gemini_revoke",{token}).catch(()=>{});return;}
        current={token,accountId:id};grantRef.current=current;
      }
      const sessionToken=current.token;
      const onDelta=new Channel<string>();
      onDelta.onmessage=delta=>{if(alive.current&&requestActive.current&&grantRef.current?.token===sessionToken)setPartial(value=>value+delta);};
      const result=await invoke<Answer>("gemini_ask",{token:sessionToken,accountId:current.accountId,question:text,history:prior,messageId:messageId||null,draftReply:replyMode,onDelta});
      if(!alive.current||!requestActive.current||grantRef.current?.token!==sessionToken)return;
      setHistory(value=>[...value,{role:"assistant",text:result.answer}]);
      setAnswer(result);
    }catch(reason){if(alive.current&&requestActive.current){const token=grantRef.current?.token;grantRef.current=null;if(token)void invoke("gemini_revoke",{token}).catch(()=>{});setError(String(reason));setQuestion(text);}}
    finally{requestActive.current=false;if(alive.current){setPartial("");setStreaming(false);setBusy(false);}}
  }
  function stop(){
    requestActive.current=false;
    const token=grantRef.current?.token;
    grantRef.current=null;setPartial("");setAnswer(null);setError("Geração interrompida.");setStreaming(false);
    if(token)void invoke("gemini_revoke",{token}).catch(()=>{});
  }
  async function approve(){
    const current=grantRef.current,proposal=answer?.proposalId,preview=answer?.draft;
    if(!current||!proposal||!preview||!account||busy||composeOpen||preview.accountId!==accountId)return;
    if(!window.confirm(`Criar um rascunho para ${preview.to} usando a conta ${account?.email}? O e-mail não será enviado.`))return;
    setBusy(true);setError("");
    try{
      const approved=await invoke<Draft>("gemini_approve_draft",{token:current.token,accountId:current.accountId,proposalId:proposal});
      if(!alive.current||grantRef.current?.token!==current.token)return;
      setAnswer(null);
      onDraft({...approved,cc:"",bcc:"",bodyHtml:"",mode:"plain",attachments:[]});
    }catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current)setBusy(false);}
  }
  return <aside className="gemini-panel" aria-label="Google Gemini">
    <header><span className="gemini-heading"><GeminiMark/><b>Google Gemini</b></span><button type="button" className="icon-button" title="Nova conversa" aria-label="Nova conversa" disabled={busy} onClick={()=>{setHistory([]);setAnswer(null);setQuestion("");setError("");}}><Icon name="plus" size={17}/></button><button type="button" className="icon-button" title="Fechar" aria-label="Fechar Gemini" onClick={onClose}><Icon name="x" size={18}/></button></header>
    <div className="gemini-scroll">
      <label className="gemini-label">Conta de e-mail<select value={accountId} disabled={busy} onChange={e=>{void revoke();setAccountId(e.target.value);}}><option value="">Selecione uma conta</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.email}</option>)}</select></label>
      {!readable?<div className="gemini-welcome"><GeminiMark/><h3>Seu assistente de e-mail</h3><p>{configured?"Selecione uma conta de e-mail.":"Configure a chave da API abaixo para começar."}</p></div>:<>
        <div className="gemini-permission"><Icon name="shield" size={16}/><span>Somente leitura · alterações exigem sua aprovação</span></div>
        <small className="gemini-context-count">Modelo ativo: {selectedModel}</small>
        <label className="gemini-label">Buscar e-mail no cache<input value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setMessageId("");setAnswer(null);}} placeholder="Assunto, remetente ou texto"/></label>
        <label className="gemini-label">Contexto<select disabled={busy} value={messageId} onChange={e=>{setMessageId(e.target.value);setAnswer(null);}}><option value="">Até 20 e-mails recentes da conta</option>{matchingMessages.slice(0,100).map(item=><option key={item.id} value={item.id}>{item.subject||"(sem assunto)"}</option>)}</select></label>
        {!history.length&&<div className="gemini-suggestions"><p>Como posso ajudar?</p>{["Resuma meus e-mails recentes","Quais mensagens exigem atenção?","Identifique tarefas e compromissos","Prepare uma resposta para este e-mail"].map((item,index)=><button key={item} type="button" className="secondary" disabled={busy} onClick={()=>{setQuestion(item);setReplyMode(index===3);input.current?.focus();}}>{item}</button>)}</div>}
        <div className="gemini-history" aria-live="polite">{history.map((turn,index)=><div key={index} className={`gemini-turn ${turn.role}`}><b>{turn.role==="user"?"Você":"Gemini"}</b><p>{turn.text}</p></div>)}{streaming&&<div className="gemini-turn assistant" aria-busy="true"><b>Gemini</b><p>{partial||"Consultando Gemini…"}</p></div>}{busy&&!streaming&&<p role="status">Processando…</p>}</div>
        {answer&&<small className="gemini-context-count">Contexto: {answer.messageCount} mensagem(ns) armazenada(s) localmente.</small>}
        {answer?.proposalId&&answer.draft&&<div className="gemini-approval"><b><Icon name="shield" size={16}/> Autorização necessária</b><small>Conta: {account?.email}</small><small>Para: {answer.draft.to}</small><small>Assunto: {answer.draft.subject}</small><p>Nenhum e-mail será enviado.</p><div><button type="button" className="secondary" onClick={()=>setAnswer(null)}>Recusar</button><button type="button" className="primary" disabled={busy||composeOpen} onClick={()=>void approve()}>Criar rascunho</button></div></div>}
      </>}
      {error&&<div role="alert" className="gemini-error">{error}</div>}
      <details className="gemini-setup" open={!configured||undefined}><summary>Configurar Google Gemini</summary><p>Crie uma chave da API no Google AI Studio. A chave será guardada no cofre do sistema operacional. Ao configurar, você habilita leitura local das contas selecionadas e o envio de contexto de e-mail ao Google somente quando fizer uma pergunta. Alterações exigem aprovação. Não é necessário instalar programas adicionais.</p><button className="secondary" type="button" onClick={()=>void openUrl(docs).catch(()=>setError("Não foi possível abrir o Google AI Studio."))}>Obter chave da API</button><label className="gemini-label">Modelo<input list="gemini-model-catalog" value={model} disabled={busy||loadingConfig} onChange={e=>{setModel(e.target.value);setModelStatus("");}} maxLength={100}/></label><datalist id="gemini-model-catalog">{models.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</datalist><div><button type="button" className="secondary" disabled={busy||loadingConfig||(!configured&&!apiKey.trim())} onClick={()=>void loadModels()}>Atualizar lista de modelos</button>{configured&&<button type="button" className="primary" disabled={busy||loadingConfig||!model.trim()||model.trim()===selectedModel} onClick={()=>void saveModel()}>Salvar modelo</button>}</div>{modelStatus&&<small role="status">{modelStatus}</small>}<label className="gemini-label">Chave da API<input type="password" autoComplete="off" spellCheck={false} value={apiKey} disabled={busy} onChange={e=>setApiKey(e.target.value)} placeholder={configured?"Chave armazenada":"Informe a chave"} maxLength={4096}/></label><div><button className="primary" type="button" disabled={busy||loadingConfig||!apiKey.trim()||!model.trim()} onClick={()=>void configure()}>Validar e salvar chave</button>{configured&&<button className="secondary" type="button" disabled={busy} onClick={()=>void disconnect()}>Desconectar</button>}</div><small>{configured?"Chave armazenada no cofre.":"Nenhuma chave configurada."} A chave gratuita não deve ser usada para dados sensíveis ou confidenciais; use um projeto faturado e autorizado pela organização.</small></details>
      <div ref={bottom}/>
    </div>
    <footer><label className="gemini-check"><input type="checkbox" checked={replyMode} disabled={!readable||busy} onChange={e=>setReplyMode(e.target.checked)}/> Preparar resposta para aprovação</label><textarea ref={input} disabled={!readable||busy} value={question} maxLength={4000} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte sobre seus e-mails…" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void ask();}}}/>{streaming?<button type="button" className="secondary" onClick={stop}>Parar geração</button>:<button type="button" className="primary" disabled={!readable||busy||!question.trim()} onClick={()=>void ask()}><Icon name="send" size={16}/> Enviar pergunta</button>}</footer>
  </aside>;
}

import { useEffect,useRef,useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile,MailMessage } from "../types";
import type { ComposeDraft } from "./Composer";

type Turn={role:"user"|"assistant";text:string};
type Draft={id:string;accountId:string;to:string;subject:string;bodyText:string};
type Answer={answer:string;proposalId?:string|null;draft?:Draft|null;messageCount:number};
type Grant={accountId:string;token:string};
const docs="https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate";
export function CopilotMark(){return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8V6a4 4 0 0 1 4-3h6a4 4 0 0 1 4 3v2M3 10h18v6c0 2-2 4-4 4H7c-2 0-4-2-4-4zM8 10v4h3v-4m2 0v4h3v-4M8 17h8M12 3v-1"/></svg>}
export function CopilotPanel({accounts,initialAccountId,onClose,onDraft,composeOpen}:{accounts:AccountProfile[];initialAccountId?:string;onClose:()=>void;onDraft:(draft:ComposeDraft)=>void;composeOpen:boolean}){
  const [accountId,setAccountId]=useState(initialAccountId??accounts[0]?.id??"");
  const [grant,setGrant]=useState<Grant|null>(null);
  const grantRef=useRef<Grant|null>(null);
  const alive=useRef(true);
  const [messages,setMessages]=useState<MailMessage[]>([]);
  const [messageId,setMessageId]=useState("");
  const [history,setHistory]=useState<Turn[]>([]);
  const [question,setQuestion]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [answer,setAnswer]=useState<Answer|null>(null);
  const [setupPath,setSetupPath]=useState("");
  const [consent,setConsent]=useState(false);
  const [replyMode,setReplyMode]=useState(false);
  const account=accounts.find(item=>item.id===accountId);
  const bottom=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{
    alive.current=true;
    void invoke<string>("copilot_setup_path").then(value=>{if(alive.current)setSetupPath(value);}).catch(()=>{});
    return()=>{alive.current=false;const token=grantRef.current?.token;grantRef.current=null;if(token)void invoke("copilot_revoke",{token}).catch(()=>{});};
  },[]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:"nearest"});},[history,busy]);
  async function revoke(){
    const token=grantRef.current?.token;
    grantRef.current=null;setGrant(null);setHistory([]);setAnswer(null);setMessages([]);setMessageId("");setConsent(false);setReplyMode(false);
    if(token)await invoke("copilot_revoke",{token}).catch(()=>{});
  }
  async function authorize(){
    if(!account||!consent||busy)return;
    const id=account.id;
    setBusy(true);setError("");
    try{
      const token=await invoke<string>("copilot_authorize",{accountId:id});
      if(!alive.current){void invoke("copilot_revoke",{token});return;}
      const value={token,accountId:id};
      grantRef.current=value;setGrant(value);
      const cached=await bridge.listCachedMessages(id);
      if(alive.current&&grantRef.current?.token===token)setMessages(cached.filter(item=>item.accountId===id).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)));
    }catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current)setBusy(false);}
  }
  async function ask(){
    const text=question.trim(),current=grantRef.current;
    if(!text||!current||busy||!account||current.accountId!==account.id)return;
    if(replyMode&&!messageId){setError("Selecione o e-mail para responder.");return;}
    setBusy(true);setError("");setAnswer(null);setQuestion("");
    const prior=history.slice(-6).map(turn=>({...turn,text:Array.from(turn.text).slice(0,1200).join("")}));
    setHistory(value=>[...value,{role:"user",text}]);
    try{
      const result=await invoke<Answer>("copilot_ask",{token:current.token,accountId:current.accountId,question:text,history:prior,messageId:messageId||null,draftReply:replyMode});
      if(!alive.current||grantRef.current?.token!==current.token)return;
      setHistory(value=>[...value,{role:"assistant",text:result.answer}]);
      setAnswer(result);
    }catch(reason){if(alive.current&&grantRef.current?.token===current.token){setError(String(reason));setQuestion(text);}}
    finally{if(alive.current)setBusy(false);}
  }
  async function approve(){
    const current=grantRef.current,proposal=answer?.proposalId,preview=answer?.draft;
    if(!current||!proposal||!preview||!account||busy||composeOpen||preview.accountId!==accountId)return;
    if(!window.confirm(`Criar um rascunho para ${preview.to} usando a conta ${account?.email}? O e-mail não será enviado.`))return;
    setBusy(true);setError("");
    try{
      const approved=await invoke<Draft>("copilot_approve_draft",{token:current.token,accountId:current.accountId,proposalId:proposal});
      if(!alive.current||grantRef.current?.token!==current.token)return;
      setAnswer(null);
      onDraft({...approved,cc:"",bcc:"",bodyHtml:"",mode:"plain",attachments:[]});
    }catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current)setBusy(false);}
  }
  return <aside className="copilot-panel" aria-label="GitHub Copilot">
    <header><span className="copilot-heading"><CopilotMark/><b>GitHub Copilot</b></span><button type="button" className="icon-button" title="Nova conversa" aria-label="Nova conversa" disabled={busy} onClick={()=>{setHistory([]);setAnswer(null);setQuestion("");setError("");}}><Icon name="plus" size={17}/></button><button type="button" className="icon-button" title="Fechar" aria-label="Fechar Copilot" onClick={onClose}><Icon name="x" size={18}/></button></header>
    <div className="copilot-scroll">
      <label className="copilot-label">Conta autorizada<select value={accountId} disabled={busy} onChange={e=>{void revoke();setAccountId(e.target.value);}}><option value="">Selecione uma conta</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.email}</option>)}</select></label>
      {!grant?<div className="copilot-welcome"><CopilotMark/><h3>Seu assistente de e-mail</h3><p>Use sua assinatura do GitHub Copilot. Nenhuma mensagem será compartilhada até você autorizar a conta e enviar uma pergunta. O texto será processado pelo serviço do GitHub, conforme suas políticas.</p><label className="copilot-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Permitir leitura dos e-mails locais desta conta e processamento pelo GitHub Copilot por 30 minutos.</label><button type="button" className="primary" disabled={!account||!consent||busy} onClick={()=>void authorize()}>Autorizar leitura</button></div>:<>
        <div className="copilot-permission"><Icon name="shield" size={16}/><span>Leitura autorizada · alterações exigem aprovação</span><button type="button" className="ghost" disabled={busy} onClick={()=>void revoke()}>Revogar</button></div>
        <label className="copilot-label">Contexto<select disabled={busy} value={messageId} onChange={e=>{setMessageId(e.target.value);setAnswer(null);}}><option value="">Até 20 e-mails recentes da conta</option>{messages.slice(0,100).map(item=><option key={item.id} value={item.id}>{item.subject||"(sem assunto)"}</option>)}</select></label>
        {!history.length&&<div className="copilot-suggestions"><p>Como posso ajudar?</p>{["Resuma meus e-mails recentes","Quais mensagens exigem atenção?","Identifique tarefas e compromissos","Prepare uma resposta para este e-mail"].map((item,index)=><button key={item} type="button" className="secondary" disabled={busy} onClick={()=>{setQuestion(item);setReplyMode(index===3);input.current?.focus();}}>{item}</button>)}</div>}
        <div className="copilot-history" aria-live="polite">{history.map((turn,index)=><div key={index} className={`copilot-turn ${turn.role}`}><b>{turn.role==="user"?"Você":"Copilot"}</b><p>{turn.text}</p></div>)}{busy&&<p role="status">Consultando Copilot…</p>}</div>
        {answer&&<small className="copilot-context-count">Contexto: {answer.messageCount} mensagem(ns) armazenada(s) localmente.</small>}
        {answer?.proposalId&&answer.draft&&<div className="copilot-approval"><b><Icon name="shield" size={16}/> Autorização necessária</b><small>Conta: {account?.email}</small><small>Para: {answer.draft.to}</small><small>Assunto: {answer.draft.subject}</small><p>Nenhum e-mail será enviado.</p><div><button type="button" className="secondary" onClick={()=>setAnswer(null)}>Recusar</button><button type="button" className="primary" disabled={busy||composeOpen} onClick={()=>void approve()}>Criar rascunho</button></div></div>}
      </>}
      {error&&<div role="alert" className="copilot-error">{error}</div>}
      <details className="copilot-setup"><summary>Configurar e entrar com GitHub</summary><p>Instale Node.js 22.12+ e o SDK oficial no diretório abaixo. Autentique-se pelo fluxo oficial do Copilot CLI antes de conversar.</p>{setupPath&&<code>{setupPath}</code>}<p>Instale nesse diretório: <code>npm install --save-exact @microsoft/copilot-sdk@2.0.3</code></p><button className="secondary" type="button" onClick={()=>void openUrl(docs).catch(()=>setError("Não foi possível abrir a documentação."))}>Guia oficial de autenticação</button><small>O runtime ainda é opcional e não vem no instalador.</small></details>
      <div ref={bottom}/>
    </div>
    <footer><label className="copilot-check"><input type="checkbox" checked={replyMode} disabled={!grant||busy} onChange={e=>setReplyMode(e.target.checked)}/> Preparar resposta para aprovação</label><textarea ref={input} disabled={!grant||busy} value={question} maxLength={4000} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte sobre seus e-mails…" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void ask();}}}/><button type="button" className="primary" disabled={!grant||busy||!question.trim()} onClick={()=>void ask()}><Icon name="send" size={16}/> Enviar pergunta</button></footer>
  </aside>;
}

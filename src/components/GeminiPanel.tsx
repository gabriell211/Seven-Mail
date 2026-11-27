import { useEffect,useRef,useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../icons";
import { CreativePreview,GeminiMarkdown,type CreativeMode,type CreativeResult } from "./GeminiCreative";
import type { SignatureItem } from "../types";
import { bridge } from "../lib/bridge";
import type { AccountProfile,MailMessage } from "../types";
import type { ComposeDraft } from "./Composer";

type Turn={role:"user"|"assistant";text:string};
type Draft={id:string;accountId:string;to:string;subject:string;bodyText:string};
type Answer={answer:string;proposalId?:string|null;draft?:Draft|null;messageCount:number;outputTokens?:number|null;outputTokenLimit?:number};
const OUTPUT_TOKEN_LIMIT=8192;
type Grant={accountId:string;token:string};
type ModelOption={id:string;label:string};
type GeminiStatus={configured:boolean;selectedModel:string;authMode:"none"|"api_key"|"google";googleEmail?:string|null;googleProject?:string|null};
type SelectedFile={id:string;file:File;mimeType:string};
const MAX_FILES=4,MAX_FILE_BYTES=5*1024*1024,MAX_MEDIA_BYTES=8*1024*1024,MAX_TEXT_BYTES=64*1024;
const fileTypes:Record<string,string>={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",pdf:"application/pdf",txt:"text/plain",csv:"text/csv",md:"text/markdown",mp3:"audio/mp3",wav:"audio/wav",mp4:"video/mp4"};
const fileAccept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.md,.mp3,.wav,.mp4";
const imageAccept=".png,.jpg,.jpeg,.webp";
function fileMime(file:File):string|undefined{
  const ext=file.name.split(".").pop()?.toLowerCase()??"";
  return Object.prototype.hasOwnProperty.call(fileTypes,ext)?fileTypes[ext]:undefined;
}
function encodeFile(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Não foi possível ler o arquivo."));
    reader.onabort=()=>reject(new Error("Leitura do arquivo cancelada."));
    reader.onload=()=>{
      const result=reader.result;
      if(typeof result!=="string"||!result.includes(",")){reject(new Error("Arquivo inválido."));return;}
      resolve(result.slice(result.indexOf(",")+1));
    };
    reader.readAsDataURL(file);
  });
}
function AttachmentPreview({item,onRemove,disabled}:{item:SelectedFile;onRemove:()=>void;disabled:boolean}){
  const [url,setUrl]=useState("");
  useEffect(()=>{
    if(!item.mimeType.startsWith("image/"))return;
    const preview=URL.createObjectURL(item.file);
    setUrl(preview);
    return()=>URL.revokeObjectURL(preview);
  },[item]);
  return <div className="gemini-attachment">{url&&<img src={url} alt="" loading="lazy"/>}<span><b>{item.file.name}</b><small>{Math.max(1,Math.ceil(item.file.size/1024))} KiB</small></span><button type="button" className="icon-button" title="Remover arquivo" aria-label={`Remover ${item.file.name}`} disabled={disabled} onClick={onRemove}><Icon name="x" size={15}/></button></div>;
}
const docs="https://aistudio.google.com/apikey";
export function GeminiMark(){return <img className="gemini-brand-mark" src="/providers/gemini.svg" width={21} height={21} alt="" aria-hidden="true"/>}
export function GeminiPanel({accounts,initialAccountId,onClose,onDraft,composeOpen,onSaveSignature}:{accounts:AccountProfile[];initialAccountId?:string;onClose:()=>void;onDraft:(draft:ComposeDraft)=>void;composeOpen:boolean;onSaveSignature:(signature:SignatureItem)=>Promise<void>}){
  const [accountId,setAccountId]=useState(initialAccountId??accounts[0]?.id??"");
  const grantRef=useRef<Grant|null>(null);
  const alive=useRef(true);
  const [messages,setMessages]=useState<MailMessage[]>([]);
  const [messageId,setMessageId]=useState("");
  const [history,setHistory]=useState<Turn[]>([]);
  const [question,setQuestion]=useState("");
  const [creativeMode,setCreativeMode]=useState<CreativeMode>("chat");
  const [creativeResult,setCreativeResult]=useState<CreativeResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [streaming,setStreaming]=useState(false);
  const [partial,setPartial]=useState("");
  const requestActive=useRef(false);
  const [error,setError]=useState("");
  const [answer,setAnswer]=useState<Answer|null>(null);
  const [configured,setConfigured]=useState(false);
  const [authMode,setAuthMode]=useState<GeminiStatus["authMode"]>("none");
  const [apiKey,setApiKey]=useState("");
  const [settingsOpen,setSettingsOpen]=useState(false);
  const settingsButton=useRef<HTMLButtonElement>(null);
  const settingsTitle=useRef<HTMLHeadingElement>(null);
  const settingsScroll=useRef<HTMLDivElement>(null);
  const [model,setModel]=useState("gemini-3.5-flash-lite");
  const [selectedModel,setSelectedModel]=useState("gemini-3.5-flash-lite");
  const [models,setModels]=useState<ModelOption[]>([]);
  const [modelStatus,setModelStatus]=useState("");
  const [loadingConfig,setLoadingConfig]=useState(true);
  const [search,setSearch]=useState("");
  const [replyMode,setReplyMode]=useState(false);
  const [includeMail,setIncludeMail]=useState(true);
  const [files,setFiles]=useState<SelectedFile[]>([]);
  const fileInput=useRef<HTMLInputElement>(null);
  const imageInput=useRef<HTMLInputElement>(null);
  const account=accounts.find(item=>item.id===accountId);
  const readable=!!account&&configured;
  const searchTerm=search.trim().toLocaleLowerCase();
  const matchingMessages=messages.filter(item=>!searchTerm||[item.subject,item.from.email,item.bodyText??item.preview].some(value=>value?.toLocaleLowerCase().includes(searchTerm)));
  const bottom=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{
    alive.current=true;
    let active=true;
    void invoke<GeminiStatus>("gemini_status").then(value=>{if(active){const ready=value.configured&&value.authMode==="api_key";setConfigured(ready);setSettingsOpen(!ready);setModel(value.selectedModel);setSelectedModel(value.selectedModel);setAuthMode(value.authMode);}}).catch(reason=>{if(active)setError(String(reason));}).finally(()=>{if(active)setLoadingConfig(false);});
    return()=>{active=false;alive.current=false;requestActive.current=false;const token=grantRef.current?.token;grantRef.current=null;if(token)void invoke("gemini_revoke",{token}).catch(()=>{});};
  },[]);
  useEffect(()=>{if(!settingsOpen)bottom.current?.scrollIntoView({block:"nearest"});},[history,busy,partial,settingsOpen]);
  useEffect(()=>{if(settingsOpen){settingsScroll.current?.scrollTo({top:0});settingsTitle.current?.focus();}},[settingsOpen]);
  useEffect(()=>{
    let active=true;
    setMessages([]);
    if(readable){void bridge.listCachedMessages(accountId).then(cached=>{if(active)setMessages(cached.filter(item=>item.accountId===accountId).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)));}).catch(reason=>{if(active)setError(String(reason));});}
    return()=>{active=false;};
  },[accountId,readable]);
  function closeSettings(){
    if(busy)return;
    setApiKey("");setModel(selectedModel);
    setModelStatus("");setError("");if(!configured){onClose();return;}setSettingsOpen(false);
    settingsButton.current?.focus();
  }
  function openSettings(){
    if(busy)return;
    setError("");setSettingsOpen(true);
  }
  function newConversation(){
    if(busy||!configured)return;
    if(settingsOpen)closeSettings();
    setFiles([]);setHistory([]);setAnswer(null);setCreativeResult(null);setQuestion("");setError("");
  }
  function changeContext(value:boolean){
    if(includeMail===value)return;
    setIncludeMail(value);setHistory([]);setAnswer(null);setMessageId("");setReplyMode(false);
    const token=grantRef.current?.token;grantRef.current=null;if(token)void invoke("gemini_revoke",{token}).catch(()=>{});
  }
  function addFiles(incoming:File[]){
    if(busy||!readable||!incoming.length)return;
    const next=[...files];let total=next.reduce((sum,item)=>sum+item.file.size,0);
    for(const file of incoming){
      const mimeType=fileMime(file);
      if(!mimeType){setError("Formato não suportado. Use imagens, PDF, TXT, CSV, MD, MP3, WAV ou MP4.");return;}
      if(file.size===0||file.size>(mimeType.startsWith("text/")?MAX_TEXT_BYTES:MAX_FILE_BYTES)){setError("Arquivo vazio ou acima do limite (5 MiB; texto: 64 KiB).");return;}
      if(next.length>=MAX_FILES||total+file.size>MAX_MEDIA_BYTES){setError("Limite de quatro arquivos e 8 MiB no total.");return;}
      next.push({id:crypto.randomUUID(),file,mimeType});total+=file.size;
    }
    setError("");setFiles(next);
    if(!files.length)changeContext(false);
  }
  async function revoke(){
    const token=grantRef.current?.token;
    grantRef.current=null;setCreativeResult(null);setFiles([]);setIncludeMail(true);setPartial("");setHistory([]);setAnswer(null);setMessageId("");setSearch("");setQuestion("");setReplyMode(false);
    if(token)await invoke("gemini_revoke",{token}).catch(()=>{});
  }
  async function configure(){
    if(busy||loadingConfig||!apiKey.trim())return;
    setBusy(true);setError("");
    try{await invoke("gemini_configure",{apiKey:apiKey.trim(),model:configured?selectedModel:"gemini-3.5-flash-lite"});if(alive.current){await revoke();setConfigured(true);setAuthMode("api_key");setSelectedModel(configured?selectedModel:"gemini-3.5-flash-lite");setModel(configured?selectedModel:"gemini-3.5-flash-lite");setModels([]);setModelStatus("Configuração salva.");setSettingsOpen(false);}}
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
    try{await revoke();await invoke("gemini_disconnect");if(alive.current){setConfigured(false);setSettingsOpen(true);setAuthMode("none");setModels([]);setModelStatus("");}}
    catch(reason){if(alive.current)setError(String(reason));}
    finally{if(alive.current)setBusy(false);}
  }
  async function ask(){
    const text=question.trim()||(files.length?"Analise os arquivos anexados.":"");
    if(!text||busy||requestActive.current||!account||!configured)return;
    const id=account.id;
    if(creativeMode==="chat"&&replyMode&&!messageId){setError("Selecione o e-mail para responder.");return;}
    requestActive.current=true;
    setBusy(true);setStreaming(creativeMode==="chat");setPartial("");setError("");setAnswer(null);setCreativeResult(null);setQuestion("");
    const prior=history.slice(-6).map(turn=>({...turn,text:Array.from(turn.text).slice(0,1200).join("")}));
    const displayText=files.length?`${text}\nArquivos: ${files.map(item=>item.file.name).join(", ")}`:text;
    setHistory(value=>[...value,{role:"user",text:displayText}]);
    try{
      const payloadFiles=await Promise.all(files.map(async item=>({name:item.file.name,mimeType:item.mimeType,data:await encodeFile(item.file)})));
      if(!alive.current||!requestActive.current)return;
      let current=grantRef.current;
      if(!current||current.accountId!==id){
        const token=await invoke<string>("gemini_open_read_session",{accountId:id});
        if(!alive.current||!requestActive.current){void invoke("gemini_revoke",{token}).catch(()=>{});return;}
        current={token,accountId:id};grantRef.current=current;
      }
      const sessionToken=current.token;
      if(creativeMode!=="chat"){
        const result=await invoke<CreativeResult>("gemini_create",{token:sessionToken,accountId:id,mode:creativeMode,question:text,files:payloadFiles});
        if(!alive.current||!requestActive.current||grantRef.current?.token!==sessionToken)return;
        setCreativeResult(result);setHistory(value=>[...value,{role:"assistant",text:result.text||"Imagem criada."}]);setFiles([]);return;
      }
      const onDelta=new Channel<string>();
      onDelta.onmessage=delta=>{if(alive.current&&requestActive.current&&grantRef.current?.token===sessionToken)setPartial(value=>value+delta);};
      const result=await invoke<Answer>("gemini_ask",{token:sessionToken,accountId:current.accountId,question:text,history:prior,messageId:includeMail?(messageId||null):null,draftReply:includeMail&&replyMode,includeMail,files:payloadFiles,onDelta});
      if(!alive.current||!requestActive.current||grantRef.current?.token!==sessionToken)return;
      setHistory(value=>[...value,{role:"assistant",text:result.answer}]);
      setAnswer(result);setFiles([]);
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
  const tokenLimit=answer?.outputTokenLimit&&answer.outputTokenLimit>0?answer.outputTokenLimit:OUTPUT_TOKEN_LIMIT;
  const reportedTokens=answer?.outputTokens;
  const estimatedTokens=streaming?Math.ceil(Array.from(partial).length/4):0;
  const usedTokens=typeof reportedTokens==="number"&&Number.isFinite(reportedTokens)?reportedTokens:estimatedTokens;
  const remainingTokens=Math.max(0,tokenLimit-usedTokens);
  const tokenPercent=Math.min(100,Math.max(0,remainingTokens/tokenLimit*100));
  const tokenTitle=streaming?`Estimativa pelo texto visível: ${remainingTokens} de ${tokenLimit} tokens de saída restantes (não inclui raciocínio oculto).`:answer?(reportedTokens==null?"Consumo não informado pelo Gemini.":`Última resposta: ${remainingTokens} de ${tokenLimit} tokens de saída restantes (inclui raciocínio reportado).`):`Limite de saída por resposta: ${tokenLimit} tokens. Não representa a cota da conta.`;
  return <aside className="gemini-panel" aria-label="Google Gemini">
    <header><span className="gemini-heading"><GeminiMark/><b>Google Gemini</b></span><button type="button" className="icon-button" title="Nova conversa" aria-label="Nova conversa" disabled={busy||loadingConfig||!configured} onClick={newConversation}><Icon name="plus" size={17}/></button><button ref={settingsButton} type="button" className="icon-button gemini-settings-toggle" title="Configurações do Gemini" aria-label="Configurações do Gemini" aria-expanded={settingsOpen} aria-controls="gemini-panel-content" disabled={busy||loadingConfig} onClick={settingsOpen?closeSettings:openSettings}><Icon name="settings" size={17}/></button><button type="button" className="icon-button" title="Fechar" aria-label="Fechar Gemini" onClick={onClose}><Icon name="x" size={18}/></button></header>
    <div id="gemini-panel-content" ref={settingsScroll} className="gemini-scroll" onKeyDown={e=>{if(e.key==="Escape"&&settingsOpen&&!busy){e.stopPropagation();closeSettings();}}}>
      {loadingConfig?<p role="status">Verificando conexão Gemini…</p>:settingsOpen||!configured?<section className="gemini-setup" aria-labelledby="gemini-settings-title">
        <div className="gemini-settings-heading"><h3 id="gemini-settings-title" ref={settingsTitle} tabIndex={-1}>Configurações</h3><button type="button" className="secondary" disabled={busy} onClick={closeSettings}>{configured?"Voltar":"Fechar"}</button></div>
        <div className="gemini-settings-card"><h4>Chave da API Gemini</h4><p>Cole sua chave do Google AI Studio para começar. Ela será guardada no cofre do sistema.</p>{authMode==="google"&&<small>O acesso antigo pelo Google foi substituído pela chave da API. Informe uma chave para continuar.</small>}<button className="secondary" type="button" onClick={()=>void openUrl(docs).catch(()=>setError("Não foi possível abrir o Google AI Studio."))}>Obter chave da API</button><label className="gemini-label">Chave da API<input type="password" autoComplete="off" spellCheck={false} value={apiKey} disabled={busy} onChange={e=>setApiKey(e.target.value)} placeholder={authMode==="api_key"?"Chave armazenada":"Informe a chave"} maxLength={4096}/></label><div><button className="primary" type="button" disabled={busy||loadingConfig||!apiKey.trim()} onClick={()=>void configure()}>Validar e salvar chave</button>{configured&&<button className="secondary" type="button" disabled={busy} onClick={()=>void disconnect()}>Desconectar</button>}</div>{configured&&<details><summary>Modelo avançado</summary><label className="gemini-label">Modelo<input list="gemini-model-catalog" value={model} disabled={busy||loadingConfig} onChange={e=>{setModel(e.target.value);setModelStatus("");}} maxLength={100}/></label><datalist id="gemini-model-catalog">{models.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</datalist><div><button type="button" className="secondary" disabled={busy||loadingConfig||(!configured&&!apiKey.trim())} onClick={()=>void loadModels()}>Atualizar lista de modelos</button>{configured&&<button type="button" className="primary" disabled={busy||loadingConfig||!model.trim()||model.trim()===selectedModel} onClick={()=>void saveModel()}>Salvar modelo</button>}</div>{modelStatus&&<small role="status">{modelStatus}</small>}</details>}<small>{configured?"Credencial armazenada no cofre.":"Nenhuma credencial configurada."} A chave gratuita não deve ser usada para dados sensíveis ou confidenciais; use um projeto faturado e autorizado pela organização.</small></div>
        {configured&&<div className="gemini-settings-card"><h4>Contexto de e-mail</h4><label className="gemini-label">Conta de e-mail<select value={accountId} disabled={busy} onChange={e=>{void revoke();setAccountId(e.target.value);}}><option value="">Selecione uma conta</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.email}</option>)}</select></label>{readable&&<><label className="gemini-check"><input type="checkbox" checked={includeMail} disabled={busy} onChange={e=>changeContext(e.target.checked)}/> Incluir contexto de e-mails</label>
        {includeMail&&<><label className="gemini-label">Buscar e-mail no cache<input value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setMessageId("");setAnswer(null);}} placeholder="Assunto, remetente ou texto"/></label>
        <label className="gemini-label">Contexto<select disabled={busy} value={messageId} onChange={e=>{setMessageId(e.target.value);setAnswer(null);}}><option value="">Até 20 e-mails recentes da conta</option>{matchingMessages.slice(0,100).map(item=><option key={item.id} value={item.id}>{item.subject||"(sem assunto)"}</option>)}</select></label></>}<label className="gemini-check"><input type="checkbox" checked={replyMode} disabled={!readable||busy||!includeMail} onChange={e=>setReplyMode(e.target.checked)}/> Preparar resposta para aprovação</label></>}</div>}
        {error&&<div role="alert" className="gemini-error">{error}</div>}
      </section>:<>

      {!readable?<div className="gemini-welcome"><GeminiMark/><h3>Seu assistente de e-mail</h3><p>{configured?"Selecione uma conta de e-mail nas configurações.":"Informe sua chave da API nas configurações."}</p>{<button type="button" className="secondary gemini-welcome-setup" disabled={busy} onClick={openSettings}><Icon name="settings" size={16}/> Configurar Gemini</button>}</div>:<>
        <div className="gemini-permission gemini-compact-context"><Icon name="shield" size={14}/><span>{includeMail?`Contexto: ${account?.email}`:"Contexto de e-mail desativado"} · somente leitura</span></div>
        {!history.length&&!streaming&&<div className="gemini-empty-conversation"><GeminiMark/><h3>Como posso ajudar?</h3><p>Pergunte sobre seus e-mails ou arquivos.</p></div>}

        <div className="gemini-history" aria-live="polite">{history.map((turn,index)=><div key={index} className={`gemini-turn ${turn.role}`}><b>{turn.role==="user"?"Você":"Gemini"}</b>{turn.role==="assistant"?<GeminiMarkdown text={turn.text}/>:<p>{turn.text}</p>}</div>)}{streaming&&<div className="gemini-turn assistant" aria-busy="true"><b>Gemini</b><GeminiMarkdown text={partial||"Consultando Gemini…"}/></div>}{busy&&!streaming&&<p role="status">Processando…</p>}</div>
        {creativeResult&&account&&<CreativePreview key={account.id+creativeMode} result={creativeResult} mode={creativeMode} accountId={account.id} email={account.email} onSaveSignature={onSaveSignature} busy={busy}/>}
        {answer&&<small className="gemini-context-count">Contexto: {answer.messageCount} mensagem(ns) armazenada(s) localmente.</small>}
        {answer?.proposalId&&answer.draft&&<div className="gemini-approval"><b><Icon name="shield" size={16}/> Autorização necessária</b><small>Conta: {account?.email}</small><small>Para: {answer.draft.to}</small><small>Assunto: {answer.draft.subject}</small><p>Nenhum e-mail será enviado.</p><div><button type="button" className="secondary" onClick={()=>setAnswer(null)}>Recusar</button><button type="button" className="primary" disabled={busy||composeOpen} onClick={()=>void approve()}>Criar rascunho</button></div></div>}
      </>}
      {error&&<div role="alert" className="gemini-error">{error}</div>}
      <div ref={bottom}/>
      </>}
    </div>
    {configured&&!loadingConfig&&!settingsOpen&&<footer>
      <div className="gemini-composer">
        <input type="file" ref={fileInput} accept={fileAccept} multiple hidden onChange={e=>{addFiles(Array.from(e.currentTarget.files??[]));e.currentTarget.value="";}}/>
        <input type="file" ref={imageInput} accept={imageAccept} multiple hidden onChange={e=>{
          const images=Array.from(e.currentTarget.files??[]);e.currentTarget.value="";
          if(images.some(file=>!fileMime(file)?.startsWith("image/"))){setError("Selecione imagens PNG, JPEG ou WebP.");return;}
          addFiles(images);
        }}/>
        {files.length>0&&<div className="gemini-attachments"><small>Arquivos serão enviados ao Google ao clicar em enviar.</small>{files.map(item=><AttachmentPreview key={item.id} item={item} disabled={busy} onRemove={()=>setFiles(value=>value.filter(file=>file.id!==item.id))}/>)}</div>}
        <div className="gemini-creative-mode"><select aria-label="Modo Gemini" value={creativeMode} disabled={busy} onChange={e=>{setCreativeMode(e.target.value as CreativeMode);setCreativeResult(null);setError("");}}><option value="chat">Conversar</option><option value="image">Criar / editar imagem</option><option value="signature">Criar assinatura</option><option value="document">Criar documento</option></select>{creativeMode!=="chat"&&<small>Envia somente sua solicitação e anexos selecionados. Pode consumir cota paga.</small>}</div>
        <textarea ref={input} aria-label="Pergunte ao Gemini" disabled={!readable||busy} value={question} maxLength={4000} rows={2} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte ao Gemini..." onPaste={e=>{const pasted=Array.from(e.clipboardData.files);if(pasted.length){e.preventDefault();addFiles(pasted);}}} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask();}}}/>
        <div className="gemini-composer-toolbar">
          <button type="button" className="icon-button gemini-composer-attach" title="Anexar arquivo · até 4 arquivos, 8 MiB no total" aria-label="Anexar arquivo" disabled={!readable||busy||files.length>=MAX_FILES} onClick={()=>fileInput.current?.click()}><Icon name="paperclip" size={17}/></button>
          <button type="button" className="icon-button gemini-composer-attach" title="Anexar imagem · PNG, JPEG ou WebP" aria-label="Anexar imagem" disabled={!readable||busy||files.length>=MAX_FILES} onClick={()=>imageInput.current?.click()}><Icon name="image" size={17}/></button>
          <div className="gemini-token-ring" title={tokenTitle}>
          <svg className="gemini-token-arc" viewBox="0 0 40 40" aria-hidden="true"><circle className="gemini-token-track" cx="20" cy="20" r="18"/><circle className="gemini-token-value" cx="20" cy="20" r="18" pathLength="100" strokeDasharray={`${answer&&reportedTokens==null?0:tokenPercent} 100`}/></svg>
          {streaming?<button type="button" className="gemini-composer-send" title="Parar geração" aria-label="Parar geração" onClick={stop}><Icon name="stop" size={15}/></button>:<button type="button" className="gemini-composer-send" title="Enviar pergunta" aria-label="Enviar pergunta" disabled={!readable||busy||(!question.trim()&&!files.length)} onClick={()=>void ask()}><Icon name="arrow-up" size={17}/></button>}
          </div>
        </div>
      </div>
    </footer>}
  </aside>;
}

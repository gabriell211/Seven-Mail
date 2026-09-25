import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile, AppSettings, ContactItem, ContentBlockItem, MailTemplateItem, QueuedAttachment, SignatureItem, WorkspaceDocument } from "../types";

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface QueuedSendInfo {
  id: string;
  sendAt: string;
  canUndo: boolean;
}

export interface ComposeDraft {
  id: string;
  accountId: string;
  fromAddress?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  mode: "rich" | "plain";
  sendAt?: string;
  priority?: "low" | "normal" | "high";
  requestReadReceipt?: boolean;
  requestDeliveryReceipt?: boolean;
  smimeSign?: boolean;
  smimeEncrypt?: boolean;
  disallowReactions?: boolean;
  attachments: QueuedAttachment[];
}

function sanitizeOutgoingHtml(raw: string): string {
  if (!raw.trim()) return "";
  const documentNode = new DOMParser().parseFromString(raw, "text/html");

  documentNode
    .querySelectorAll("script, iframe, object, embed, form, meta, link")
    .forEach((node) => node.remove());

  documentNode.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    }
  });

  return documentNode.body.innerHTML;
}

function plainTextToHtml(value: string): string {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML.replace(/\n/g, "<br>");
}

function parseMergeCsv(raw:string):{headers:string[];rows:Array<Record<string,string>>}{
  const text=raw.replace(/^\uFEFF/,"");
  const records:string[][]=[];
  let row:string[]=[];
  let field="";
  let quoted=false;
  for(let index=0;index<text.length;index+=1){
    const char=text[index];
    if(char==='"'){
      if(quoted&&text[index+1]==='"'){
        field+='"';
        index+=1;
      }else{
        quoted=!quoted;
      }
      continue;
    }
    if(char===","&&!quoted){
      row.push(field);
      field="";
      continue;
    }
    if((char==="\n"||char==="\r")&&!quoted){
      if(char==="\r"&&text[index+1]==="\n") index+=1;
      row.push(field);
      field="";
      if(row.some((value)=>value.trim())) records.push(row);
      row=[];
      continue;
    }
    field+=char;
  }
  row.push(field);
  if(row.some((value)=>value.trim())) records.push(row);
  const headers=(records.shift()??[]).map((value,index)=>value.trim()||`coluna_${index+1}`);
  const rows=records.map((values)=>Object.fromEntries(headers.map((header,index)=>[header,(values[index]??"").trim()])));
  return {headers,rows};
}

function mergeFields(template:string,row:Record<string,string>):string{
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,key:string)=>row[key]??"");
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function applyTypingAssists(value:string,settings:AppSettings):string {
  let next=value;
  if(settings.autoCorrectEnabled){
    const language=(settings.composeLanguage??"pt-BR").toLowerCase();
    const corrections:Record<string,string>=language.startsWith("pt")
      ? {nao:"não",voce:"você",tambem:"também",sera:"será",esta:"está",obrigado:"obrigado"}
      : {teh:"the",adn:"and",recieve:"receive",adress:"address"};
    const custom=new Set((settings.customDictionary??[]).map((word)=>word.toLocaleLowerCase("pt-BR")));
    next=next.replace(/\b[\p{L}']+\b/gu,(word)=>{
      const lower=word.toLocaleLowerCase("pt-BR");
      if(custom.has(lower)||!corrections[lower]) return word;
      const replacement=corrections[lower];
      return /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(word)
        ? replacement.charAt(0).toLocaleUpperCase("pt-BR")+replacement.slice(1)
        : replacement;
    });
  }
  if(settings.autoCapitalizeEnabled){
    next=next.replace(/(^|[.!?]\s+)([a-zà-ÿ])/g,(_,prefix:string,letter:string)=>prefix+letter.toLocaleUpperCase("pt-BR"));
  }
  return next;
}

export function Composer({
  accounts,
  signatures,
  initialAccountId,
  settings,
  initialDraft,
  onClose,
  onQueued,
}: {
  accounts: AccountProfile[];
  signatures: SignatureItem[];
  initialAccountId?: string;
  settings: AppSettings;
  initialDraft?: ComposeDraft;
  onClose: () => void;
  onQueued: (info: QueuedSendInfo) => void;
}) {
  const [draft, setDraft] = useState<ComposeDraft>(() => {
    if (initialDraft) return { ...initialDraft };

    const accountId = initialAccountId ?? accounts.find((account) => account.isDefault)?.id ?? accounts[0]?.id ?? "";
    const signature = signatures.find((item) => item.accountId === accountId && item.isDefault)
      ?? signatures.find((item) => item.accountId === accountId);
    const signatureText = signature?.bodyText.trim() ?? "";

    return {
      id: crypto.randomUUID(),
      accountId,
      fromAddress: accounts.find((item)=>item.id===accountId)?.email ?? "",
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      bodyText: signatureText ? `\n\n${signatureText}` : "",
      bodyHtml: signatureText ? `<br><br>${plainTextToHtml(signatureText)}` : "",
      mode: "rich",
      priority: "normal",
      requestReadReceipt: false,
      requestDeliveryReceipt: false,
      smimeSign: false,
      smimeEncrypt: false,
      disallowReactions: false,
      attachments: [],
    };
  });
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMerge,setShowMerge]=useState(false);
  const [mergeHeaders,setMergeHeaders]=useState<string[]>([]);
  const [mergeRows,setMergeRows]=useState<Array<Record<string,string>>>([]);
  const [mergeEmailColumn,setMergeEmailColumn]=useState("");
  const [mergeFileName,setMergeFileName]=useState("");
  const [mergeBusy,setMergeBusy]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<MailTemplateItem[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlockItem[]>([]);
  const [recipientDirectory,setRecipientDirectory]=useState<Array<{name:string;email:string;source:"contact"|"ldap"}>>([]);
  const [recipientSuggestionsOpen,setRecipientSuggestionsOpen]=useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [dictating,setDictating]=useState(false);
  const [smimeIdentity,setSmimeIdentity]=useState(false);
  const [uploadProgress,setUploadProgress]=useState<{done:number;total:number;name:string}|null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const recognitionRef=useRef<SpeechRecognitionLike|null>(null);
  const cancelUploadRef=useRef(false);

  const linkPreview=useMemo(()=>{
    const match=draft.bodyText.match(/https?:\/\/[^\s<>"']+/i);
    if(!match) return null;
    try{
      const url=new URL(match[0]);
      return {href:url.href,host:url.hostname,path:`${url.pathname}${url.search}`};
    }catch{return null;}
  },[draft.bodyText]);

  const account = useMemo(
    () => accounts.find((item) => item.id === draft.accountId) ?? accounts[0],
    [accounts, draft.accountId],
  );

  const accountSignatures = useMemo(
    () => signatures.filter((item) => item.accountId === draft.accountId),
    [draft.accountId, signatures],
  );

  const fromAddresses = useMemo(() => {
    if (!account) return [] as string[];
    return [account.email, ...(account.aliases ?? [])].filter((value,index,array)=>value && array.indexOf(value)===index);
  }, [account]);

  const recipientToken=useMemo(()=>{
    const pieces=draft.to.split(/[;,]/);
    return (pieces[pieces.length-1]??"").trim().toLocaleLowerCase("pt-BR");
  },[draft.to]);

  const recipientSuggestions=useMemo(()=>{
    if(!recipientToken) return recipientDirectory.slice(0,8);
    return recipientDirectory.filter((item)=>
      item.email.toLocaleLowerCase("pt-BR").includes(recipientToken)||
      item.name.toLocaleLowerCase("pt-BR").includes(recipientToken)
    ).slice(0,8);
  },[recipientDirectory,recipientToken]);

  function chooseRecipient(email:string){
    const pieces=draft.to.split(/([;,])/);
    let lastValueIndex=-1;
    for(let index=pieces.length-1;index>=0;index-=1){
      if(pieces[index]!==","&&pieces[index]!==";"){lastValueIndex=index;break;}
    }
    if(lastValueIndex<0){
      setDraft((current)=>({...current,to:email}));
    }else{
      pieces[lastValueIndex]=` ${email}`;
      setDraft((current)=>({...current,to:pieces.join("").replace(/^\s+/,"")}));
    }
    setRecipientSuggestionsOpen(false);
  }

  useEffect(() => {
    void Promise.all([
      bridge.listWorkspace<MailTemplateItem>("template").catch(() => []),
      bridge.listWorkspace<ContentBlockItem>("content-block").catch(() => []),
    ]).then(([templateDocs,blockDocs])=>{
      setTemplates(templateDocs.map((document)=>document.payload));
      setContentBlocks(blockDocs.map((document)=>document.payload));
    });
  }, []);

  useEffect(()=>{
    let disposed=false;
    const loadDirectory=async()=>{
      const localDocs=await bridge.listWorkspace<ContactItem>("contact").catch(()=>[]);
      const local=localDocs.flatMap((document)=>{
        const contact=document.payload;
        const emails=(contact.emails?.length?contact.emails:[contact.email]).filter(Boolean);
        return emails.map((email)=>({name:contact.displayName||email,email,source:"contact" as const}));
      });

      let ldap:Array<{name:string;email:string;source:"ldap"}>=[];
      if(account?.ldapUrl?.trim()){
        const directory=await bridge.syncLdap(account.id).catch(()=>[]);
        ldap=directory.filter((item)=>item.email).map((item)=>({name:item.displayName||item.email,email:item.email,source:"ldap" as const}));
      }

      if(disposed) return;
      const seen=new Set<string>();
      setRecipientDirectory([...local,...ldap].filter((item)=>{
        const key=item.email.toLocaleLowerCase("pt-BR");
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
    };
    void loadDirectory();
    return ()=>{disposed=true;};
  },[account?.id,account?.ldapUrl]);

  useEffect(() => {
    if (draft.mode !== "rich" || !editorRef.current) return;
    if (document.activeElement !== editorRef.current && editorRef.current.innerHTML !== draft.bodyHtml) {
      editorRef.current.innerHTML = draft.bodyHtml;
    }
  }, [draft.bodyHtml, draft.mode]);

  useEffect(() => {
    if (!account) return;
    if (!draft.fromAddress || !fromAddresses.includes(draft.fromAddress)) {
      setDraft((current)=>({...current,fromAddress:account.email}));
    }
  }, [account?.id,fromAddresses.join("|")]);

  useEffect(()=>{
    let disposed=false;
    if(!account){
      setSmimeIdentity(false);
      return;
    }
    void bridge.smimeIdentityStatus(account.id)
      .then((status)=>{if(!disposed)setSmimeIdentity(status.configured);})
      .catch(()=>{if(!disposed)setSmimeIdentity(false);});
    return ()=>{disposed=true;};
  },[account?.id]);

  useEffect(() => {
    let unlisten: (()=>void) | undefined;
    void getCurrentWebview().onDragDropEvent((event)=>{
      if (event.payload.type === "over") {
        setDraggingFiles(true);
      } else if (event.payload.type === "leave") {
        setDraggingFiles(false);
      } else if (event.payload.type === "drop") {
        setDraggingFiles(false);
        void stageFiles(event.payload.paths);
      }
    }).then((fn)=>{unlisten=fn;}).catch(()=>undefined);
    return ()=>unlisten?.();
  }, [draft.id,settings.maxAttachmentMb]);

  useEffect(()=>{
    return ()=>recognitionRef.current?.stop();
  },[]);

  useEffect(() => {
    if (finishedRef.current) return;
    const timer = window.setTimeout(() => {
      const document: WorkspaceDocument<ComposeDraft> = {
        id: draft.id,
        kind: "draft",
        updatedAt: new Date().toISOString(),
        payload: draft,
      };
      void bridge.upsertWorkspace(document).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft]);

  function syncEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    setDraft((current) => ({
      ...current,
      bodyText: editor.innerText,
      bodyHtml: editor.innerHTML,
    }));
  }

  function toggleDictation() {
    if(dictating){
      recognitionRef.current?.stop();
      setDictating(false);
      return;
    }

    const speechWindow=window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Constructor=speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;
    if(!Constructor){
      window.alert("Ditado por voz não está disponível neste sistema.");
      return;
    }

    const recognition=new Constructor();
    recognition.lang=settings.composeLanguage??"pt-BR";
    recognition.continuous=true;
    recognition.interimResults=false;
    recognition.onresult=(event)=>{
      let transcript="";
      for(let index=0;index<event.results.length;index+=1){
        const result=event.results[index];
        if(result?.isFinal) transcript+=result[0]?.transcript??"";
      }
      const text=transcript.trim();
      if(!text) return;
      if(draft.mode==="rich"){
        editorRef.current?.focus();
        document.execCommand("insertText",false,`${text} `);
        syncEditor();
      }else{
        setDraft((current)=>({...current,bodyText:`${current.bodyText}${current.bodyText&&!/\s$/.test(current.bodyText)?" ":""}${text} `}));
      }
    };
    recognition.onerror=()=>setDictating(false);
    recognition.onend=()=>setDictating(false);
    recognitionRef.current=recognition;
    recognition.start();
    setDictating(true);
  }

  function format(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditor();
  }

  function insertSignature(signatureId: string) {
    const signature = accountSignatures.find((item) => item.id === signatureId);
    if (!signature?.bodyText.trim()) return;

    const signatureText = signature.bodyText.trim();
    setDraft((current) => {
      const textSeparator = current.bodyText.trim() ? "\n\n" : "";
      const htmlSeparator = current.bodyHtml.trim() ? "<br><br>" : "";
      return {
        ...current,
        bodyText: `${current.bodyText.trimEnd()}${textSeparator}${signatureText}`,
        bodyHtml: current.mode === "rich"
          ? `${current.bodyHtml}${htmlSeparator}${plainTextToHtml(signatureText)}`
          : "",
      };
    });
  }

  async function addLink() {
    const url = window.prompt("URL do link");
    if (!url?.trim()) return;
    const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    format("createLink", normalized);
  }

  async function stageFiles(sources: string[]) {
    if (sources.length === 0) return;
    setError("");
    cancelUploadRef.current=false;
    const added:QueuedAttachment[]=[];
    try {
      const perFile = settings.maxAttachmentMb ?? 25;
      for(let index=0;index<sources.length;index+=1){
        if(cancelUploadRef.current) break;
        const source=sources[index];
        const name=source.split(/[\\/]/).pop()||`arquivo ${index+1}`;
        setUploadProgress({done:index,total:sources.length,name});
        const staged=await bridge.stageAttachments(draft.id,[source],perFile,Math.min(perFile*4,500));
        added.push(...staged);
        setUploadProgress({done:index+1,total:sources.length,name});
      }
      if(added.length){
        setDraft((current)=>({...current,attachments:[...current.attachments,...added]}));
      }
      if(cancelUploadRef.current){
        setError("Upload de anexos cancelado. Os arquivos já concluídos foram mantidos.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploadProgress(null);
      cancelUploadRef.current=false;
    }
  }

  async function pickAttachments() {
    const selected = await open({ multiple: true, directory: false });
    const sources = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await stageFiles(sources);
  }

  async function pickInlineImage() {
    if(draft.mode!=="rich") return;
    const selected=await open({
      multiple:false,
      directory:false,
      filters:[{name:"Imagem",extensions:["png","jpg","jpeg","gif","webp"]}],
    });
    if(!selected||Array.isArray(selected)) return;
    setError("");
    try{
      const [staged]=await bridge.stageAttachments(draft.id,[selected],settings.maxAttachmentMb??25,Math.min((settings.maxAttachmentMb??25)*4,500));
      if(!staged) return;
      const contentId=`seven-${crypto.randomUUID()}`;
      const inline={...staged,inline:true,contentId};
      setDraft((current)=>({...current,attachments:[...current.attachments,inline]}));
      const safeName=staged.name.replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]??char));
      format("insertHTML",`<img src="cid:${contentId}" alt="${safeName}" style="max-width:100%;height:auto"><br>`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  function insertTable() {
    if (draft.mode !== "rich") return;
    format("insertHTML", '<table border="1" cellpadding="6" cellspacing="0"><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>');
  }

  function insertEmoji() {
    const emoji = window.prompt("Emoji para inserir", "🙂")?.trim();
    if (!emoji) return;
    if (draft.mode === "rich") {
      format("insertText", emoji);
    } else {
      setDraft((current)=>({...current,bodyText:`${current.bodyText}${emoji}`}));
    }
  }

  function insertMention() {
    const query=window.prompt("Nome ou e-mail para mencionar")?.trim();
    if(!query) return;
    const needle=query.toLocaleLowerCase("pt-BR");
    const match=recipientDirectory.find((item)=>
      item.email.toLocaleLowerCase("pt-BR")===needle||
      item.email.toLocaleLowerCase("pt-BR").includes(needle)||
      item.name.toLocaleLowerCase("pt-BR").includes(needle)
    );
    const name=(match?.name||query).replace(/[<>]/g,"").trim();
    const email=(match?.email||query).replace(/[\r\n<>"']/g,"").trim();
    if(!email.includes("@")){
      window.alert("Escolha um contato ou informe um e-mail válido.");
      return;
    }
    if(draft.mode==="rich"){
      const safeName=name.replace(/&/g,"&amp;").replace(/"/g,"&quot;");
      const safeEmail=email.replace(/&/g,"&amp;").replace(/"/g,"&quot;");
      format("insertHTML",`<a href="mailto:${safeEmail}" data-seven-mention="${safeEmail}">@${safeName}</a>&nbsp;`);
    }else{
      setDraft((current)=>({...current,bodyText:`${current.bodyText}${current.bodyText&&!/\s$/.test(current.bodyText)?" ":""}@${name} <${email}> `}));
    }
  }

  function useTemplate(id: string) {
    const template = templates.find((item)=>item.id===id);
    if (!template) return;
    setDraft((current)=>({
      ...current,
      subject:template.subject,
      bodyText:template.bodyText,
      bodyHtml:template.bodyHtml,
      mode:template.bodyHtml.trim()?"rich":"plain",
    }));
  }

  function insertContentBlock(id: string) {
    const block = contentBlocks.find((item)=>item.id===id);
    if (!block) return;
    setDraft((current)=>({
      ...current,
      bodyText:`${current.bodyText}${current.bodyText.trim()?"\n\n":""}${block.bodyText}`,
      bodyHtml:current.mode==="rich"
        ? `${current.bodyHtml}${current.bodyHtml.trim()?"<br><br>":""}${block.bodyHtml || plainTextToHtml(block.bodyText)}`
        : current.bodyHtml,
    }));
  }

  function recipientsValid(raw: string): boolean {
    const values = raw.split(/[;,]/).map((value)=>value.trim()).filter(Boolean);
    return values.every((value)=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.replace(/^.*<([^>]+)>$/,"$1")));
  }

  async function pickMergeCsv(){
    if(draft.attachments.length>0){
      setError("Mala direta com anexos ainda não é permitida neste modo. Remova os anexos antes de criar o lote.");
      return;
    }
    const selected=await open({
      multiple:false,
      directory:false,
      filters:[{name:"Lista CSV",extensions:["csv"]}],
    });
    if(!selected||Array.isArray(selected)) return;
    const raw=await bridge.readTextFile(selected);
    const parsed=parseMergeCsv(raw);
    if(parsed.headers.length===0||parsed.rows.length===0){
      setError("O CSV não possui cabeçalho e linhas válidas.");
      return;
    }
    if(parsed.rows.length>500){
      setError("A mala direta aceita no máximo 500 destinatários por lote.");
      return;
    }
    const emailHeader=parsed.headers.find((header)=>/^(e-?mail|email_address|correo)$/i.test(header))
      ?? parsed.headers.find((header)=>header.toLowerCase().includes("mail"))
      ?? parsed.headers[0];
    setMergeHeaders(parsed.headers);
    setMergeRows(parsed.rows);
    setMergeEmailColumn(emailHeader);
    setMergeFileName(selected.split(/[\\/]/).pop()??"lista.csv");
    setError("");
  }

  async function queueMailMerge(){
    if(!account||mergeBusy||mergeRows.length===0||!mergeEmailColumn) return;
    if(draft.attachments.length>0){
      setError("Remova os anexos antes de enviar mala direta.");
      return;
    }
    const validRows=mergeRows.filter((row)=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row[mergeEmailColumn]??""));
    if(validRows.length===0){
      setError("Nenhum endereço válido foi encontrado na coluna selecionada.");
      return;
    }
    if(!window.confirm(`Enfileirar ${validRows.length} mensagens personalizadas? Cada destinatário receberá uma mensagem separada.`)) return;

    setMergeBusy(true);
    setError("");
    try{
      const now=Date.now();
      for(let index=0;index<validRows.length;index+=1){
        const row=validRows[index];
        const id=crypto.randomUUID();
        const sendAt=new Date(now+index*350).toISOString();
        await bridge.queueOperation({
          id,
          kind:"send",
          accountId:account.id,
          createdAt:new Date().toISOString(),
          attempts:0,
          payload:{
            fromAddress:draft.fromAddress||account.email,
            to:row[mergeEmailColumn],
            cc:"",
            bcc:"",
            subject:mergeFields(draft.subject,row),
            bodyText:mergeFields(draft.bodyText,row),
            bodyHtml:draft.mode==="rich"?sanitizeOutgoingHtml(mergeFields(draft.bodyHtml,row)):"",
            attachments:[],
            priority:draft.priority??"normal",
            requestReadReceipt:Boolean(draft.requestReadReceipt),
            requestDeliveryReceipt:Boolean(draft.requestDeliveryReceipt),
            smimeSign:Boolean(draft.smimeSign),
            smimeEncrypt:Boolean(draft.smimeEncrypt),
            disallowReactions:Boolean(draft.disallowReactions),
            sendAt,
          },
        });
      }
      setShowMerge(false);
      setMergeRows([]);
      setMergeHeaders([]);
      setMergeFileName("");
      window.alert(`${validRows.length} mensagens foram adicionadas à fila local.`);
      void bridge.flushOutbox().catch(()=>undefined);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMergeBusy(false);
    }
  }

  async function discard() {
    if (!window.confirm("Descartar este rascunho?")) return;
    finishedRef.current = true;
    await bridge.deleteWorkspace("draft", draft.id).catch(() => undefined);
    await bridge.cancelOperation(draft.id).catch(() => false);
    onClose();
  }

  async function queueSend() {
    if (!account || busy || !draft.to.trim()) return;

    if (!recipientsValid(draft.to) || (draft.cc.trim()&&!recipientsValid(draft.cc)) || (draft.bcc.trim()&&!recipientsValid(draft.bcc))) {
      setError("Revise os destinatários: há um endereço de e-mail inválido.");
      return;
    }
    if (settings.confirmBeforeSend && !window.confirm("Enviar esta mensagem?")) return;
    if (!draft.subject.trim() && !window.confirm("O assunto está vazio. Enviar mesmo assim?")) return;

    const mentionsAttachment = /\b(anex(?:o|os|ei|ado|ados|ar)|attach(?:ed|ment|ments)?)\b/i.test(
      `${draft.subject} ${draft.bodyText}`,
    );
    if (mentionsAttachment && draft.attachments.length === 0 && !window.confirm("A mensagem menciona anexo, mas nenhum arquivo foi adicionado. Enviar mesmo assim?")) {
      return;
    }

    if(draft.smimeSign&&!smimeIdentity){
      setError("Configure uma identidade S/MIME para esta conta antes de assinar.");
      return;
    }
    if(draft.smimeEncrypt){
      const recipients=[draft.to,draft.cc,draft.bcc]
        .flatMap((value)=>value.split(/[;,]/))
        .map((value)=>value.trim().replace(/^.*<([^>]+)>.*$/,"$1"))
        .filter((value)=>value.includes("@"));
      const missing:string[]=[];
      for(const email of [...new Set(recipients)]){
        if(!(await bridge.hasSmimeRecipientCertificate(email).catch(()=>false))) missing.push(email);
      }
      if(missing.length){
        setError(`Faltam certificados S/MIME para: ${missing.join(", ")}`);
        return;
      }
    }

    setBusy(true);
    setError("");

    try {
      const explicitSchedule = draft.sendAt ? new Date(draft.sendAt) : null;
      const now = Date.now();
      const delayMs = settings.sendDelaySeconds * 1000;
      const effectiveSendAt =
        explicitSchedule && Number.isFinite(explicitSchedule.getTime()) && explicitSchedule.getTime() > now
          ? explicitSchedule
          : new Date(now + delayMs);

      const bodyHtml = draft.mode === "rich" ? sanitizeOutgoingHtml(draft.bodyHtml) : "";
      const bodyText = draft.bodyText.trim();

      await bridge.queueOperation({
        id: draft.id,
        kind: "send",
        accountId: account.id,
        createdAt: new Date().toISOString(),
        attempts: 0,
        payload: {
          fromAddress: draft.fromAddress || account.email,
          to: draft.to.trim(),
          cc: draft.cc.trim(),
          bcc: draft.bcc.trim(),
          subject: draft.subject,
          bodyText,
          bodyHtml,
          attachments: draft.attachments,
          priority: draft.priority ?? "normal",
          requestReadReceipt: Boolean(draft.requestReadReceipt),
          requestDeliveryReceipt: Boolean(draft.requestDeliveryReceipt),
          smimeSign: Boolean(draft.smimeSign),
          smimeEncrypt: Boolean(draft.smimeEncrypt),
          disallowReactions: Boolean(draft.disallowReactions),
          sendAt: effectiveSendAt.toISOString(),
        },
      });

      finishedRef.current = true;
      await bridge.deleteWorkspace("draft", draft.id).catch(() => undefined);

      const isExplicitlyScheduled =
        explicitSchedule !== null &&
        Number.isFinite(explicitSchedule.getTime()) &&
        explicitSchedule.getTime() > now + Math.max(delayMs, 1000);

      onQueued({
        id: draft.id,
        sendAt: effectiveSendAt.toISOString(),
        canUndo: !isExplicitlyScheduled && settings.sendDelaySeconds > 0,
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop composer-backdrop" onMouseDown={onClose}>
      <section className={draggingFiles?"modal compose-modal composer-pro dragging-files":"modal compose-modal composer-pro"} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        {draggingFiles&&<div className="composer-drop-overlay"><Icon name="paperclip" size={28}/><b>Solte para anexar</b></div>}
        <header className="modal-header compact-header">
          <div>
            <span className="eyebrow">NOVA MENSAGEM</span>
            <h2>Escrever e-mail</h2>
          </div>
          <div className="composer-header-actions">
            <span className="draft-state"><i /> Rascunho salvo localmente</span>
            <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
          </div>
        </header>

        <div className="compose-fields composer-fields">
          <label>
            <span>De</span>
            <div className="composer-from-row">
              <select
                value={account?.id ?? ""}
                onChange={(event) => {
                  const next=accounts.find((item)=>item.id===event.target.value);
                  setDraft((current) => ({ ...current, accountId: event.target.value, fromAddress: next?.email ?? "" }));
                }}
                disabled={accounts.length === 0}
              >
                {accounts.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}
              </select>
              <select value={draft.fromAddress || account?.email || ""} onChange={(event)=>setDraft((current)=>({...current,fromAddress:event.target.value}))} aria-label="Endereço remetente">
                {fromAddresses.map((address)=><option key={address} value={address}>{address}</option>)}
              </select>
            </div>
          </label>
          <label className="recipient-field">
            <span>Para</span>
            <input autoFocus value={draft.to} onFocus={()=>setRecipientSuggestionsOpen(true)} onChange={(event) => {setDraft((current) => ({ ...current, to: event.target.value }));setRecipientSuggestionsOpen(true);}} placeholder="destinatario@dominio.com" autoComplete="off" />
            {recipientSuggestionsOpen&&recipientSuggestions.length>0&&<div className="recipient-suggestions" role="listbox">
              {recipientSuggestions.map((item)=><button type="button" key={item.email} onMouseDown={(event)=>event.preventDefault()} onClick={()=>chooseRecipient(item.email)}>
                <span className="avatar">{item.name[0]?.toUpperCase()||"@"}</span>
                <span><b>{item.name}</b><small>{item.email}</small></span>
                <em>{item.source==="ldap"?"Diretório":"Contato"}</em>
              </button>)}
            </div>}
            <span className="recipient-toggles">
              <button type="button" onClick={() => setShowCc((value) => !value)}>CC</button>
              <button type="button" onClick={() => setShowBcc((value) => !value)}>CCO</button>
            </span>
          </label>
          {showCc && <label><span>CC</span><input value={draft.cc} onChange={(event) => setDraft((current) => ({ ...current, cc: event.target.value }))} placeholder="copia@dominio.com" /></label>}
          {showBcc && <label><span>CCO</span><input value={draft.bcc} onChange={(event) => setDraft((current) => ({ ...current, bcc: event.target.value }))} placeholder="copia.oculta@dominio.com" /></label>}
          <label>
            <span>Assunto</span>
            <input value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Assunto" />
          </label>
        </div>

        <div className="format-bar composer-toolbar">
          <div className="format-group">
            <button type="button" className={draft.mode === "rich" ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, mode: "rich" }))}>HTML</button>
            <button type="button" className={draft.mode === "plain" ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, mode: "plain", bodyHtml: "" }))}>Texto</button>
          </div>
          {draft.mode === "rich" && <>
            <span className="toolbar-separator" />
            <button type="button" aria-label="Negrito" onClick={() => format("bold")}><b>B</b></button>
            <button type="button" aria-label="Itálico" onClick={() => format("italic")}><i>I</i></button>
            <button type="button" aria-label="Sublinhado" onClick={() => format("underline")}><u>U</u></button>
            <button type="button" aria-label="Tachado" onClick={() => format("strikeThrough")}><s>S</s></button>
            <span className="toolbar-separator" />
            <button type="button" onClick={() => format("insertUnorderedList")}>• Lista</button>
            <button type="button" onClick={() => format("insertOrderedList")}>1. Lista</button>
            <button type="button" onClick={() => format("outdent")}>← Recuo</button>
            <button type="button" onClick={() => format("indent")}>Recuo →</button>
            <button type="button" onClick={() => format("justifyLeft")}>← Texto</button>
            <button type="button" onClick={() => format("justifyCenter")}>↔ Texto</button>
            <button type="button" onClick={() => format("justifyRight")}>Texto →</button>
            <span className="toolbar-separator" />
            <button type="button" onClick={() => void addLink()}>Link</button>
            <button type="button" onClick={() => void pickInlineImage()}>Imagem</button>
            <button type="button" onClick={insertTable}>Tabela</button>
            <button type="button" onClick={insertEmoji}>Emoji</button>
            <button type="button" onClick={insertMention}>@ Menção</button>
            <button type="button" onClick={() => format("removeFormat")}>Limpar</button>
          </>}
        </div>

        {draft.mode === "rich" ? (
          <div
            ref={editorRef}
            className="editor rich-editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            lang={settings.composeLanguage??"pt-BR"}
            autoCorrect={settings.autoCorrectEnabled?"on":"off"}
            autoCapitalize={settings.autoCapitalizeEnabled?"sentences":"off"}
            role="textbox"
            aria-multiline="true"
            data-placeholder="Escreva sua mensagem..."
            onInput={syncEditor}
          />
        ) : (
          <textarea
            className="editor"
            spellCheck
            lang={settings.composeLanguage??"pt-BR"}
            autoCorrect={settings.autoCorrectEnabled?"on":"off"}
            autoCapitalize={settings.autoCapitalizeEnabled?"sentences":"off"}
            value={draft.bodyText}
            onChange={(event) => {
              const raw=event.target.value;
              const assisted=/[\s.!?,;:]$/.test(raw)?applyTypingAssists(raw,settings):raw;
              setDraft((current) => ({ ...current, bodyText: assisted, bodyHtml: "" }));
            }}
            placeholder="Escreva sua mensagem..."
          />
        )}

        {linkPreview&&<div className="composer-link-preview"><span className="link-preview-glyph">↗</span><div><b>{linkPreview.host}</b><small>{linkPreview.path||"/"}</small><code>{linkPreview.href}</code></div></div>}

                {draft.attachments.length > 0 && (
          <div className="attachment-strip">
            {draft.attachments.map((attachment, index) => (
              <div className="attachment-chip" key={`${attachment.path}-${index}`}>
                <Icon name="paperclip" size={15} />
                <span><b>{attachment.name}</b><small>{humanSize(attachment.size)}{attachment.inline?" · inline":""}</small></span>
                <button
                  className="icon-button"
                  aria-label={`Remover ${attachment.name}`}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    attachments: current.attachments.filter((_, itemIndex) => itemIndex !== index),
                  }))}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showMerge&&<div className="mail-merge-panel">
          <header><div><span className="eyebrow">MALA DIRETA</span><b>Envio personalizado por CSV</b></div><button className="icon-button" onClick={()=>setShowMerge(false)}><Icon name="x" size={14}/></button></header>
          <p>Use placeholders como <code>{"{{nome}}"}</code> ou <code>{"{{empresa}}"}</code> no assunto e no corpo da mensagem.</p>
          <div className="mail-merge-controls">
            <button className="secondary" onClick={()=>void pickMergeCsv()}><Icon name="upload" size={14}/>{mergeFileName||"Selecionar CSV"}</button>
            {mergeHeaders.length>0&&<label><span>Coluna de e-mail</span><select value={mergeEmailColumn} onChange={(event)=>setMergeEmailColumn(event.target.value)}>{mergeHeaders.map((header)=><option key={header} value={header}>{header}</option>)}</select></label>}
            {mergeRows.length>0&&<span className="merge-count"><b>{mergeRows.length}</b> linhas</span>}
            <button className="primary" disabled={mergeRows.length===0||!mergeEmailColumn||mergeBusy} onClick={()=>void queueMailMerge()}>{mergeBusy?"Enfileirando...":"Criar lote"}</button>
          </div>
          {mergeHeaders.length>0&&<small>Campos disponíveis: {mergeHeaders.map((header)=>`{{${header}}}`).join(" · ")}</small>}
        </div>}

        {showSchedule && (
          <div className="schedule-row">
            <Icon name="clock" size={16} />
            <label>
              <span>Enviar em</span>
              <input
                type="datetime-local"
                value={draft.sendAt ?? ""}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
                onChange={(event) => setDraft((current) => ({ ...current, sendAt: event.target.value || undefined }))}
              />
            </label>
            {draft.sendAt && <button className="ghost" onClick={() => setDraft((current) => ({ ...current, sendAt: undefined }))}>Limpar</button>}
          </div>
        )}

        {uploadProgress&&<div className="attachment-upload-progress">
          <div><span><b>{uploadProgress.done}/{uploadProgress.total}</b> {uploadProgress.name}</span><small>{Math.round((uploadProgress.done/uploadProgress.total)*100)}%</small></div>
          <progress max={uploadProgress.total} value={uploadProgress.done}/>
          <button className="secondary" onClick={()=>{cancelUploadRef.current=true;}}>Cancelar upload</button>
        </div>}
        {error && <div className="form-error composer-error">{error}</div>}

        <footer className="compose-footer composer-footer">
          <div>
            <button className="icon-button attachment-button" title="Anexar arquivo" onClick={() => void pickAttachments()}><Icon name="paperclip" /></button>
            <button className={dictating?"icon-button active":"icon-button"} title={dictating?"Parar ditado":"Ditado por voz"} onClick={toggleDictation}><Icon name="mic"/></button>
            {accountSignatures.length > 0 && <select className="signature-picker" aria-label="Inserir assinatura" defaultValue="" onChange={(event) => { if (event.target.value) insertSignature(event.target.value); event.currentTarget.value = ""; }}><option value="">Assinatura</option>{accountSignatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name}{signature.isDefault ? " · padrão" : ""}</option>)}</select>}
            {templates.length>0&&<select className="signature-picker" aria-label="Aplicar modelo" defaultValue="" onChange={(event)=>{if(event.target.value)useTemplate(event.target.value);event.currentTarget.value="";}}><option value="">Modelo</option>{templates.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            {contentBlocks.length>0&&<select className="signature-picker" aria-label="Inserir bloco" defaultValue="" onChange={(event)=>{if(event.target.value)insertContentBlock(event.target.value);event.currentTarget.value="";}}><option value="">Bloco</option>{contentBlocks.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <select className="signature-picker" value={draft.priority??"normal"} onChange={(event)=>setDraft((current)=>({...current,priority:event.target.value as ComposeDraft["priority"]}))} aria-label="Prioridade"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select>
            <label className="composer-mini-check"><input type="checkbox" checked={Boolean(draft.requestReadReceipt)} onChange={(event)=>setDraft((current)=>({...current,requestReadReceipt:event.target.checked}))}/> Recibo leitura</label>
            <label className="composer-mini-check"><input type="checkbox" checked={Boolean(draft.requestDeliveryReceipt)} onChange={(event)=>setDraft((current)=>({...current,requestDeliveryReceipt:event.target.checked}))}/> Recibo entrega</label>
            <label className="composer-mini-check"><input type="checkbox" disabled={!smimeIdentity} checked={Boolean(draft.smimeSign)} onChange={(event)=>setDraft((current)=>({...current,smimeSign:event.target.checked}))}/> Assinar S/MIME</label>
            <label className="composer-mini-check"><input type="checkbox" checked={Boolean(draft.smimeEncrypt)} onChange={(event)=>setDraft((current)=>({...current,smimeEncrypt:event.target.checked}))}/> Criptografar S/MIME</label>
            <label className="composer-mini-check" title="Exchange Online e clientes compatíveis respeitam esta política quando suportada pelo provedor"><input type="checkbox" checked={Boolean(draft.disallowReactions)} onChange={(event)=>setDraft((current)=>({...current,disallowReactions:event.target.checked}))}/> Bloquear reações</label>
            <button className={showSchedule ? "ghost active" : "ghost"} onClick={() => setShowSchedule((value) => !value)}><Icon name="clock" size={15} /> Programar</button>
            <button className={showMerge?"ghost active":"ghost"} onClick={()=>setShowMerge((value)=>!value)}><Icon name="people" size={15}/> Mala direta</button>
            <span className="send-delay">{settings.sendDelaySeconds > 0 ? `Desfazer por ${settings.sendDelaySeconds}s` : "Envio imediato"}</span>
          </div>
          <div>
            <button className="danger-ghost" onClick={() => void discard()}>Descartar</button>
            <button className="secondary" onClick={onClose}>Fechar</button>
            <button className="primary" disabled={!account || !draft.to.trim() || busy} onClick={() => void queueSend()}>
              <Icon name="send" size={15} /> {busy ? "Preparando..." : draft.sendAt ? "Agendar" : "Enviar"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

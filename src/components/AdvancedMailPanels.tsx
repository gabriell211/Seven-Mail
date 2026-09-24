import { useEffect, useMemo, useState } from "react";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AppSettings, MailAttachmentInfo, MailAttachmentPreview, MailMessage } from "../types";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MessageDetailsModal({
  message,
  initialTab = "attachments",
  onClose,
}: {
  message: MailMessage;
  initialTab?: "attachments" | "security" | "headers" | "source";
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [source, setSource] = useState("");
  const [attachments, setAttachments] = useState<MailAttachmentInfo[]>([]);
  const [preview, setPreview] = useState<MailAttachmentPreview | null>(null);
  const [previewBusy,setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      bridge.readMessageSource(message.accountId, message.id).catch(() => ""),
      bridge.listMessageAttachments(message.accountId, message.id).catch(() => [] as MailAttachmentInfo[]),
    ]).then(([nextSource, nextAttachments]) => {
      if (disposed) return;
      setSource(nextSource);
      setAttachments(nextAttachments);
      setBusy(false);
    }).catch((reason) => {
      if (disposed) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    });
    return () => { disposed = true; };
  }, [message.accountId, message.id]);

  const headers = useMemo(() => {
    const separator = source.search(/\r?\n\r?\n/);
    return separator >= 0 ? source.slice(0, separator) : source;
  }, [source]);

  const authentication=useMemo(()=>{
    const normalized=headers.replace(/\r?\n[ \t]+/g," ");
    const find=(name:string)=>{
      const match=normalized.match(new RegExp(`\\b${name}=([a-zA-Z_-]+)`,"i"));
      return match?.[1]?.toLowerCase()??"indisponível";
    };
    return {
      spf:find("spf"),
      dkim:find("dkim"),
      dmarc:find("dmarc"),
      results:normalized.match(/^Authentication-Results:.*$/gim)??[],
    };
  },[headers]);

  async function saveOne(item: MailAttachmentInfo) {
    const destination = await saveDialog({ defaultPath: item.name });
    if (!destination) return;
    await bridge.saveMessageAttachment(message.accountId, message.id, item.index, destination);
  }

  async function saveAll() {
    const directory = await open({ directory: true, multiple: false });
    if (!directory || Array.isArray(directory)) return;
    const count = await bridge.saveAllMessageAttachments(message.accountId, message.id, directory);
    window.alert(count === 1 ? "1 anexo salvo." : `${count} anexos salvos.`);
  }

  async function previewOne(item: MailAttachmentInfo) {
    setPreviewBusy(true);
    setError("");
    try{
      setPreview(await bridge.previewMessageAttachment(message.accountId,message.id,item.index));
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setPreviewBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal message-details-modal" role="dialog" aria-modal="true" onMouseDown={(event)=>event.stopPropagation()}>
      <header className="modal-header compact-header">
        <div><span className="eyebrow">DETALHES DA MENSAGEM</span><h2>{message.subject || "(sem assunto)"}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="x"/></button>
      </header>
      <div className="details-tabs">
        <button className={tab==="attachments"?"active":""} onClick={()=>setTab("attachments")}>Anexos {attachments.length ? `(${attachments.length})` : ""}</button>
        <button className={tab==="security"?"active":""} onClick={()=>setTab("security")}>Segurança</button>
        <button className={tab==="headers"?"active":""} onClick={()=>setTab("headers")}>Cabeçalhos</button>
        <button className={tab==="source"?"active":""} onClick={()=>setTab("source")}>Código-fonte</button>
      </div>
      <div className="message-details-body">
        {busy ? <div className="mini-empty">Carregando detalhes...</div> : error ? <div className="form-error">{error}</div> : null}
        {!busy && tab==="attachments" && (
          attachments.length ? <div className="attachment-browser">
            <div className="attachment-browser-toolbar"><span>{attachments.length} arquivo(s)</span><button className="secondary" onClick={()=>void saveAll()}><Icon name="download" size={14}/> Baixar todos</button></div>
            {attachments.map((item)=><article key={item.index} className="attachment-browser-row">
              <span className="attachment-file-icon"><Icon name="paperclip" size={17}/></span>
              <span><b>{item.name}</b><small>{item.mime} · {humanSize(item.size)}{item.inline ? " · inline" : ""}</small></span>
              <div className="attachment-row-actions"><button className="secondary" onClick={()=>void previewOne(item)}>Visualizar</button><button className="secondary" onClick={()=>void saveOne(item)}><Icon name="download" size={14}/> Salvar</button></div>
            </article>)}
            {(previewBusy||preview)&&<div className="attachment-preview">
              <header><b>{preview?.name??"Carregando..."}</b>{preview&&<small>{preview.mime} · {humanSize(preview.size)}</small>}<button className="icon-button" aria-label="Fechar pré-visualização" onClick={()=>setPreview(null)}><Icon name="x" size={13}/></button></header>
              {previewBusy?<div className="mini-empty">Preparando pré-visualização...</div>:preview?.kind==="image"&&preview.dataUrl?<img src={preview.dataUrl} alt={preview.name}/>:preview?.kind==="pdf"&&preview.dataUrl?<iframe title={preview.name} src={preview.dataUrl}/>:<pre>{preview?.text??"Pré-visualização indisponível."}</pre>}
            </div>}
          </div> : <div className="mini-empty">Nenhum anexo disponível na fonte local. Mensagens antigas podem precisar ser sincronizadas novamente.</div>
        )}
        {!busy && tab==="security" && <div className="auth-results">
          {(["spf","dkim","dmarc"] as const).map((key)=>{const value=authentication[key];const good=value==="pass";const bad=["fail","softfail","permerror"].includes(value);return <article className={good?"pass":bad?"fail":"neutral"} key={key}><b>{key.toUpperCase()}</b><span>{value}</span><small>{good?"Validação aprovada pelo servidor.":bad?"O servidor reportou falha nesta validação.":"Resultado não disponível ou inconclusivo."}</small></article>;})}
          {authentication.results.length>0&&<details><summary>Authentication-Results original</summary><pre className="message-source">{authentication.results.join("\n")}</pre></details>}
        </div>}
        {!busy && tab==="headers" && <pre className="message-source">{headers || "Cabeçalhos originais indisponíveis. Sincronize a mensagem novamente."}</pre>}
        {!busy && tab==="source" && <pre className="message-source">{source || "Fonte original indisponível. Sincronize a mensagem novamente."}</pre>}
      </div>
    </section>
  </div>;
}

export function SenderPoliciesPanel({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const blocked = settings.blockedSenders ?? [];
  const trusted = settings.trustedSenders ?? [];
  const domains = settings.blockedDomains ?? [];

  function add(key: "blockedSenders" | "trustedSenders" | "blockedDomains", label: string) {
    const value = window.prompt(label)?.trim().toLocaleLowerCase("pt-BR");
    if (!value) return;
    const current = settings[key] ?? [];
    if (current.includes(value)) return;
    onChange({ ...settings, [key]: [...current, value] });
  }

  function remove(key: "blockedSenders" | "trustedSenders" | "blockedDomains", value: string) {
    onChange({ ...settings, [key]: (settings[key] ?? []).filter((item)=>item!==value) });
  }

  const Group = ({ title, values, keyName, addLabel }: {
    title: string;
    values: string[];
    keyName: "blockedSenders" | "trustedSenders" | "blockedDomains";
    addLabel: string;
  }) => <div className="sender-policy-group">
    <header><b>{title}</b><button className="secondary" onClick={()=>add(keyName,addLabel)}><Icon name="plus" size={13}/> Adicionar</button></header>
    {values.length ? <div className="sender-policy-list">{values.map((value)=><span key={value}>{value}<button aria-label={`Remover ${value}`} onClick={()=>remove(keyName,value)}><Icon name="x" size={11}/></button></span>)}</div> : <small>Nenhum item.</small>}
  </div>;

  return <div className="settings-row">
    <div><h3>Remetentes e domínios</h3><p>Listas locais de bloqueio e confiança aplicadas durante a sincronização e organização da caixa.</p></div>
    <div className="sender-policies">
      <Group title="Remetentes bloqueados" values={blocked} keyName="blockedSenders" addLabel="E-mail do remetente a bloquear"/>
      <Group title="Remetentes confiáveis" values={trusted} keyName="trustedSenders" addLabel="E-mail do remetente confiável"/>
      <Group title="Domínios bloqueados" values={domains} keyName="blockedDomains" addLabel="Domínio a bloquear (ex.: exemplo.com)"/>
    </div>
  </div>;
}

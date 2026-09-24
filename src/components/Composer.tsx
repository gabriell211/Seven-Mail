import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile, AppSettings, ContentBlockItem, MailTemplateItem, QueuedAttachment, SignatureItem, WorkspaceDocument } from "../types";

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
      attachments: [],
    };
  });
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<MailTemplateItem[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlockItem[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);

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

  useEffect(() => {
    void Promise.all([
      bridge.listWorkspace<MailTemplateItem>("template").catch(() => []),
      bridge.listWorkspace<ContentBlockItem>("content-block").catch(() => []),
    ]).then(([templateDocs,blockDocs])=>{
      setTemplates(templateDocs.map((document)=>document.payload));
      setContentBlocks(blockDocs.map((document)=>document.payload));
    });
  }, []);

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
    try {
      const perFile = settings.maxAttachmentMb ?? 25;
      const staged = await bridge.stageAttachments(draft.id, sources, perFile, Math.min(perFile * 4, 500));
      setDraft((current) => ({ ...current, attachments: [...current.attachments, ...staged] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
          <label>
            <span>Para</span>
            <input autoFocus value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} placeholder="destinatario@dominio.com" />
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

        {error && <div className="form-error composer-error">{error}</div>}

        <footer className="compose-footer composer-footer">
          <div>
            <button className="icon-button attachment-button" title="Anexar arquivo" onClick={() => void pickAttachments()}><Icon name="paperclip" /></button>
            {accountSignatures.length > 0 && <select className="signature-picker" aria-label="Inserir assinatura" defaultValue="" onChange={(event) => { if (event.target.value) insertSignature(event.target.value); event.currentTarget.value = ""; }}><option value="">Assinatura</option>{accountSignatures.map((signature) => <option key={signature.id} value={signature.id}>{signature.name}{signature.isDefault ? " · padrão" : ""}</option>)}</select>}
            {templates.length>0&&<select className="signature-picker" aria-label="Aplicar modelo" defaultValue="" onChange={(event)=>{if(event.target.value)useTemplate(event.target.value);event.currentTarget.value="";}}><option value="">Modelo</option>{templates.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            {contentBlocks.length>0&&<select className="signature-picker" aria-label="Inserir bloco" defaultValue="" onChange={(event)=>{if(event.target.value)insertContentBlock(event.target.value);event.currentTarget.value="";}}><option value="">Bloco</option>{contentBlocks.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <select className="signature-picker" value={draft.priority??"normal"} onChange={(event)=>setDraft((current)=>({...current,priority:event.target.value as ComposeDraft["priority"]}))} aria-label="Prioridade"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select>
            <label className="composer-mini-check"><input type="checkbox" checked={Boolean(draft.requestReadReceipt)} onChange={(event)=>setDraft((current)=>({...current,requestReadReceipt:event.target.checked}))}/> Recibo leitura</label>
            <label className="composer-mini-check"><input type="checkbox" checked={Boolean(draft.requestDeliveryReceipt)} onChange={(event)=>setDraft((current)=>({...current,requestDeliveryReceipt:event.target.checked}))}/> Recibo entrega</label>
            <button className={showSchedule ? "ghost active" : "ghost"} onClick={() => setShowSchedule((value) => !value)}><Icon name="clock" size={15} /> Programar</button>
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

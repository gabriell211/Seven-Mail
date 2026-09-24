import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { AccountProfile, AppSettings, QueuedAttachment, WorkspaceDocument } from "../types";

export interface QueuedSendInfo {
  id: string;
  sendAt: string;
  canUndo: boolean;
}

export interface ComposeDraft {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  mode: "rich" | "plain";
  sendAt?: string;
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Composer({
  accounts,
  initialAccountId,
  settings,
  initialDraft,
  onClose,
  onQueued,
}: {
  accounts: AccountProfile[];
  initialAccountId?: string;
  settings: AppSettings;
  initialDraft?: ComposeDraft;
  onClose: () => void;
  onQueued: (info: QueuedSendInfo) => void;
}) {
  const [draft, setDraft] = useState<ComposeDraft>(() => initialDraft ? { ...initialDraft } : ({
    id: crypto.randomUUID(),
    accountId: initialAccountId ?? accounts.find((account) => account.isDefault)?.id ?? accounts[0]?.id ?? "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    bodyText: "",
    bodyHtml: "",
    mode: "rich",
    attachments: [],
  }));
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);

  const account = useMemo(
    () => accounts.find((item) => item.id === draft.accountId) ?? accounts[0],
    [accounts, draft.accountId],
  );

  useEffect(() => {
    if (draft.mode !== "rich" || !editorRef.current) return;
    if (document.activeElement !== editorRef.current && editorRef.current.innerHTML !== draft.bodyHtml) {
      editorRef.current.innerHTML = draft.bodyHtml;
    }
  }, [draft.bodyHtml, draft.mode]);

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

  async function addLink() {
    const url = window.prompt("URL do link");
    if (!url?.trim()) return;
    const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    format("createLink", normalized);
  }

  async function pickAttachments() {
    setError("");
    try {
      const selected = await open({ multiple: true, directory: false });
      const sources = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (sources.length === 0) return;
      const staged = await bridge.stageAttachments(draft.id, sources);
      setDraft((current) => ({ ...current, attachments: [...current.attachments, ...staged] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
          to: draft.to.trim(),
          cc: draft.cc.trim(),
          bcc: draft.bcc.trim(),
          subject: draft.subject,
          bodyText,
          bodyHtml,
          attachments: draft.attachments,
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
      <section className="modal compose-modal composer-pro" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
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
            <select
              value={account?.id ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, accountId: event.target.value }))}
              disabled={accounts.length === 0}
            >
              {accounts.map((item) => <option value={item.id} key={item.id}>{item.displayName} &lt;{item.email}&gt;</option>)}
            </select>
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
            <span className="toolbar-separator" />
            <button type="button" onClick={() => void addLink()}>Link</button>
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
            role="textbox"
            aria-multiline="true"
            data-placeholder="Escreva sua mensagem..."
            onInput={syncEditor}
          />
        ) : (
          <textarea
            className="editor"
            spellCheck
            value={draft.bodyText}
            onChange={(event) => setDraft((current) => ({ ...current, bodyText: event.target.value, bodyHtml: "" }))}
            placeholder="Escreva sua mensagem..."
          />
        )}

        {draft.attachments.length > 0 && (
          <div className="attachment-strip">
            {draft.attachments.map((attachment, index) => (
              <div className="attachment-chip" key={`${attachment.path}-${index}`}>
                <Icon name="paperclip" size={15} />
                <span><b>{attachment.name}</b><small>{humanSize(attachment.size)}</small></span>
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

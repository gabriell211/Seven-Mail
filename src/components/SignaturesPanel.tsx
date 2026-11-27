import { useState } from "react";
import { Icon } from "../icons";
import { SignatureEditor } from "./SignatureEditor";
import { sanitizeSignatureHtml } from "../lib/signatures";
import type { AccountProfile, SignatureItem } from "../types";

function emptySignature(accounts: AccountProfile[], activeAccountId?:string): SignatureItem {
  const account = accounts.find(item=>item.id===activeAccountId) ?? accounts.find((item) => item.isDefault) ?? accounts[0];
  return {
    id: crypto.randomUUID(),
    accountId: account?.id ?? "",
    name: "Padrão",
    bodyText: "",
    bodyHtml: "",
    isDefault: true,
    isReplyDefault: true,
  };
}

export function SignaturesPanel({
  accounts,
  activeAccountId,
  signatures,
  onSave,
  onDelete,
}: {
  accounts: AccountProfile[];
  activeAccountId?:string;
  signatures: SignatureItem[];
  onSave: (signature: SignatureItem) => Promise<void>;
  onDelete: (signature: SignatureItem) => Promise<void>;
}) {
  const [editing, setEditing] = useState<SignatureItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState("");

  async function save() {
    if (!editing || !editing.accountId || !editing.name.trim() || busy) return;
    setBusy(true);setError("");
    try {
      await onSave({
        ...editing,
        name: editing.name.trim(),
        bodyHtml:sanitizeSignatureHtml(editing.bodyHtml||""),
        bodyText: editing.bodyText.replace(/\r\n/g, "\n"),
      });
      setEditing(null);
    } catch(reason){setError(reason instanceof Error?reason.message:String(reason));} finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-row signature-settings">
        <div>
          <h3>Assinaturas</h3>
          <p>Crie assinaturas por conta e escolha qual entra como padrão no compositor.</p>
        </div>
        <div className="signature-panel">
          <div className="signature-panel-head">
            <span>{signatures.length === 1 ? "1 assinatura" : `${signatures.length} assinaturas`}</span>
            <button className="secondary" disabled={accounts.length === 0} onClick={() => (setError(""),setEditing(emptySignature(accounts,activeAccountId)))}>
              <Icon name="plus" size={14} /> Nova assinatura
            </button>
          </div>
          {accounts.length === 0 ? (
            <div className="mini-empty signature-empty">Adicione uma conta antes de criar assinaturas.</div>
          ) : signatures.length === 0 ? (
            <div className="mini-empty signature-empty">Nenhuma assinatura configurada. Crie uma nova ou importe o HTML da assinatura existente.</div>
          ) : (
            <div className="signature-list">
              {signatures.map((signature) => {
                const account = accounts.find((item) => item.id === signature.accountId);
                return (
                  <article className="signature-card" key={signature.id}>
                    <button className="signature-main" onClick={() => {setError("");setEditing({ ...signature });}}>
                      <span>
                        <b>{signature.name}</b>
                        <small>{account?.email ?? "Conta removida"}{signature.isDefault ? " · padrão" : ""}</small>
                      </span>
                      <p>{signature.bodyText || "Assinatura vazia"}</p>
                    </button>
                    <button className="icon-button danger-icon" title="Excluir assinatura" onClick={() => void onDelete(signature)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <section className="modal entity-modal signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header compact-header">
              <div><span className="eyebrow">ASSINATURA</span><h2 id="signature-dialog-title">{editing.name || "Nova assinatura"}</h2></div>
              <button className="icon-button" onClick={() => setEditing(null)} aria-label="Fechar"><Icon name="x" /></button>
            </header>
            <div className="entity-form">
              <label><span>Nome</span><input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
              <label><span>Conta</span><select value={editing.accountId} onChange={(event) => setEditing({ ...editing, accountId: event.target.value })}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.email}</option>)}</select></label>
              <SignatureEditor key={editing.id} initialHtml={editing.bodyHtml} initialText={editing.bodyText} onChange={(bodyHtml,bodyText)=>setEditing(current=>current?{...current,bodyHtml,bodyText}:current)}/>
              <label className="inline-check"><input type="checkbox" checked={editing.isDefault} onChange={event=>setEditing({...editing,isDefault:event.target.checked})}/> Usar em novas mensagens</label>
              <label className="inline-check"><input type="checkbox" checked={editing.isReplyDefault??editing.isDefault} onChange={event=>setEditing({...editing,isReplyDefault:event.target.checked})}/> Usar em respostas e encaminhamentos</label>
              {error&&<p className="full signature-notice" role="alert">{error}</p>}
            </div>
            <footer className="modal-footer">
              <button className="secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="primary" disabled={busy || !editing.name.trim() || !editing.accountId} onClick={() => void save()}>{busy ? "Salvando..." : "Salvar assinatura"}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

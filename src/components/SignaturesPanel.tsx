import { useState } from "react";
import { Icon } from "../icons";
import type { AccountProfile, SignatureItem } from "../types";

function emptySignature(accounts: AccountProfile[]): SignatureItem {
  const account = accounts.find((item) => item.isDefault) ?? accounts[0];
  return {
    id: crypto.randomUUID(),
    accountId: account?.id ?? "",
    name: "Padrão",
    bodyText: "",
    bodyHtml: "",
    isDefault: true,
  };
}

export function SignaturesPanel({
  accounts,
  signatures,
  onSave,
  onDelete,
}: {
  accounts: AccountProfile[];
  signatures: SignatureItem[];
  onSave: (signature: SignatureItem) => Promise<void>;
  onDelete: (signature: SignatureItem) => Promise<void>;
}) {
  const [editing, setEditing] = useState<SignatureItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing || !editing.accountId || !editing.name.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({
        ...editing,
        name: editing.name.trim(),
        bodyText: editing.bodyText.replace(/\r\n/g, "\n"),
      });
      setEditing(null);
    } finally {
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
            <button className="secondary" disabled={accounts.length === 0} onClick={() => setEditing(emptySignature(accounts))}>
              <Icon name="plus" size={14} /> Nova assinatura
            </button>
          </div>
          {accounts.length === 0 ? (
            <div className="mini-empty signature-empty">Adicione uma conta antes de criar assinaturas.</div>
          ) : signatures.length === 0 ? (
            <div className="mini-empty signature-empty">Nenhuma assinatura configurada.</div>
          ) : (
            <div className="signature-list">
              {signatures.map((signature) => {
                const account = accounts.find((item) => item.id === signature.accountId);
                return (
                  <article className="signature-card" key={signature.id}>
                    <button className="signature-main" onClick={() => setEditing({ ...signature })}>
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
          <section className="modal signature-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header compact-header">
              <div><span className="eyebrow">ASSINATURA</span><h2>{editing.name || "Nova assinatura"}</h2></div>
              <button className="icon-button" onClick={() => setEditing(null)} aria-label="Fechar"><Icon name="x" /></button>
            </header>
            <div className="entity-form">
              <label><span>Nome</span><input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
              <label><span>Conta</span><select value={editing.accountId} onChange={(event) => setEditing({ ...editing, accountId: event.target.value })}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.email}</option>)}</select></label>
              <label className="full"><span>Conteúdo</span><textarea className="signature-editor" value={editing.bodyText} onChange={(event) => setEditing({ ...editing, bodyText: event.target.value })} placeholder={"Seu nome\nCargo · Empresa\nTelefone"} /></label>
              <label className="inline-check"><input type="checkbox" checked={editing.isDefault} onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })} /> Usar como padrão nesta conta</label>
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

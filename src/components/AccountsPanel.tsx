import { useState } from "react";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import { deleteCloudAccount, pushCloudAccount, pushCloudAccounts } from "../lib/neon";
import type { AccountProfile } from "../types";

export function AccountsPanel({
  accounts,
  onChange,
}: {
  accounts: AccountProfile[];
  onChange: (accounts: AccountProfile[]) => void;
}) {
  const [editing, setEditing] = useState<AccountProfile | null>(null);
  const [secret, setSecret] = useState("");
  const [busyId, setBusyId] = useState<string>();
  const [status, setStatus] = useState<Record<string, string>>({});

  async function setDefault(accountId: string) {
    setBusyId(accountId);
    try {
      const next = await bridge.setDefaultAccount(accountId);
      onChange(next);
      void pushCloudAccounts(next).catch(() => undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(account: AccountProfile) {
    if (!window.confirm(`Remover ${account.email} deste dispositivo? O cache local e a fila desta conta também serão removidos.`)) return;
    setBusyId(account.id);
    try {
      const next = await bridge.deleteAccount(account.id);
      onChange(next);
      void deleteCloudAccount(account.id).catch(() => undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  async function test(account: AccountProfile) {
    setBusyId(account.id);
    setStatus((current) => ({ ...current, [account.id]: "Testando IMAP e SMTP..." }));
    try {
      await bridge.testImapConnection(account.id);
      await bridge.testSmtpConnection(account.id);
      setStatus((current) => ({ ...current, [account.id]: "IMAP e SMTP conectados" }));
    } catch (reason) {
      setStatus((current) => ({
        ...current,
        [account.id]: reason instanceof Error ? reason.message : String(reason),
      }));
    } finally {
      setBusyId(undefined);
    }
  }

  async function save() {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      await bridge.saveAccount(editing);
      if (secret.trim()) await bridge.storeSecret(editing.id, secret.trim());
      const next = accounts.map((account) => account.id === editing.id ? editing : account);
      onChange(next);
      void pushCloudAccount(editing).catch(() => undefined);
      setEditing(null);
      setSecret("");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <>
      <div className="settings-row account-settings">
        <div>
          <h3>Contas de e-mail</h3>
          <p>Edite servidores, troque a credencial do keyring, teste IMAP/SMTP e escolha a conta padrão.</p>
        </div>
        <div className="account-settings-list">
          {accounts.length === 0 && <div className="mini-empty">Nenhuma conta conectada.</div>}
          {accounts.map((account) => (
            <article className="account-settings-card" key={account.id}>
              <span className="account-dot" style={{ background: account.color }} />
              <div className="account-settings-copy">
                <b>{account.displayName}</b>
                <span>{account.email}</span>
                <small>{status[account.id] || (account.isDefault ? "Conta padrão" : account.provider)}</small>
              </div>
              <div className="account-settings-actions">
                {!account.isDefault && <button className="ghost" disabled={busyId === account.id} onClick={() => void setDefault(account.id)}>Tornar padrão</button>}
                <button className="icon-button" title="Testar conexão" disabled={busyId === account.id} onClick={() => void test(account)}><Icon name="refresh" size={15} /></button>
                <button className="icon-button" title="Editar" onClick={() => { setEditing({ ...account }); setSecret(""); }}><Icon name="settings" size={15} /></button>
                <button className="icon-button danger-icon" title="Remover" disabled={busyId === account.id} onClick={() => void remove(account)}><Icon name="trash" size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <section className="modal account-edit-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header compact-header">
              <div><span className="eyebrow">CONTA</span><h2>Editar {editing.email}</h2></div>
              <button className="icon-button" onClick={() => setEditing(null)}><Icon name="x" /></button>
            </header>
            <div className="form-grid account-edit-grid">
              <label><span>Nome</span><input value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} /></label>
              <label><span>E-mail</span><input type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value, username: event.target.value })} /></label>
              <label><span>Servidor IMAP</span><input value={editing.imapHost ?? ""} onChange={(event) => setEditing({ ...editing, imapHost: event.target.value })} /></label>
              <label><span>Porta IMAP</span><input type="number" value={editing.imapPort ?? 993} onChange={(event) => setEditing({ ...editing, imapPort: Number(event.target.value) })} /></label>
              <label><span>Servidor SMTP</span><input value={editing.smtpHost ?? ""} onChange={(event) => setEditing({ ...editing, smtpHost: event.target.value })} /></label>
              <label><span>Porta SMTP</span><input type="number" value={editing.smtpPort ?? 465} onChange={(event) => setEditing({ ...editing, smtpPort: Number(event.target.value) })} /></label>
              <label><span>Segurança</span><select value={editing.securityMode ?? "tls"} onChange={(event) => setEditing({ ...editing, securityMode: event.target.value as AccountProfile["securityMode"] })}><option value="tls">TLS direto</option><option value="starttls">STARTTLS</option></select></label>
              <label><span>Cor</span><input type="color" value={editing.color} onChange={(event) => setEditing({ ...editing, color: event.target.value })} /></label>
              <label className="full"><span>Aliases de envio</span><input value={(editing.aliases??[]).join(", ")} onChange={(event) => setEditing({ ...editing, aliases: event.target.value.split(",").map((value)=>value.trim()).filter(Boolean) })} placeholder="alias@dominio.com, outro@dominio.com" /></label>
              <label className="full"><span>Nova senha / senha de aplicativo</span><input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Deixe vazio para manter a credencial atual" /></label>
            </div>
            <div className="secure-note"><Icon name="lock" size={16} /><span>A senha continua somente no Credential Manager/Keyring do sistema operacional.</span></div>
            <footer className="modal-footer">
              <button className="secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="primary" disabled={busyId === editing.id || !editing.email.trim()} onClick={() => void save()}>Salvar alterações</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

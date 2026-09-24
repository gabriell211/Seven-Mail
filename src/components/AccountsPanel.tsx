import { useState } from "react";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import { oauthPreset, startOAuthAuthorization } from "../lib/oauth-client";
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
  const [oauthStatus,setOauthStatus] = useState<Record<string,boolean>>({});

  async function authorizeOAuth(account:AccountProfile) {
    setBusyId(account.id);
    try {
      await startOAuthAuthorization(account);
      setStatus((current)=>({...current,[account.id]:"Aguardando autorização no navegador..."}));
    } catch (reason) {
      setStatus((current)=>({...current,[account.id]:reason instanceof Error?reason.message:String(reason)}));
    } finally {
      setBusyId(undefined);
    }
  }

  async function revokeOAuth(account:AccountProfile) {
    await bridge.oauthClear(account.id);
    setOauthStatus((current)=>({...current,[account.id]:false}));
    setStatus((current)=>({...current,[account.id]:"Autorização OAuth removida"}));
  }

  async function refreshOAuthStatus(account:AccountProfile) {
    const active=await bridge.oauthStatus(account.id).catch(()=>false);
    setOauthStatus((current)=>({...current,[account.id]:active}));
  }

  async function addSharedMailbox() {
    if(accounts.length===0){
      window.alert("Adicione uma conta proprietária antes da caixa compartilhada.");
      return;
    }
    const ownerEmail=window.prompt("Conta proprietária/autenticadora",accounts.find((item)=>item.isDefault)?.email??accounts[0].email)?.trim();
    const owner=accounts.find((item)=>item.email.toLocaleLowerCase("pt-BR")===ownerEmail?.toLocaleLowerCase("pt-BR"));
    if(!owner){
      window.alert("Conta proprietária não encontrada.");
      return;
    }
    const email=window.prompt("Endereço da caixa compartilhada")?.trim();
    if(!email) return;
    const displayName=window.prompt("Nome da caixa compartilhada",email.split("@")[0])?.trim()||email;
    const shared:AccountProfile={
      ...owner,
      id:crypto.randomUUID(),
      displayName,
      email,
      username:email,
      isDefault:false,
      isSharedMailbox:true,
      sharedOwnerAccountId:owner.id,
      sharedOwnerEmail:owner.email,
      sharedMode:"account",
      sharedPermissions:["read","edit","calendar","manage-calendar","send"],
      sendMode:"as",
      aliases:[],
      muted:false,
    };
    await bridge.saveAccount(shared);
    const next=[...accounts,shared];
    onChange(next);
    void pushCloudAccount(shared).catch(()=>undefined);
    setEditing(shared);
  }

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
    setStatus((current) => ({ ...current, [account.id]: `Testando ${account.incomingProtocol==="pop3"?"POP3":"IMAP"} e SMTP...` }));
    try {
      await bridge.testImapConnection(account.id);
      await bridge.testSmtpConnection(account.id);
      if(account.caldavUrl?.trim()||account.carddavUrl?.trim()) await bridge.testDavConnection(account.id);
      if(account.ldapUrl?.trim()) await bridge.testLdapConnection(account.id);
      setStatus((current) => ({ ...current, [account.id]: `${account.incomingProtocol==="pop3"?"POP3":"IMAP"} e SMTP conectados${account.caldavUrl?.trim()||account.carddavUrl?.trim()?" · DAV conectado":""}` }));
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
          <p>Edite IMAP/POP3/SMTP, OAuth, DAV/LDAP, delegação e escolha a conta padrão.</p>
          <button className="secondary account-shared-add" onClick={()=>void addSharedMailbox()}><Icon name="plus" size={14}/> Caixa compartilhada</button>
        </div>
        <div className="account-settings-list">
          {accounts.length === 0 && <div className="mini-empty">Nenhuma conta conectada.</div>}
          {accounts.map((account) => (
            <article className="account-settings-card" key={account.id}>
              <span className="account-dot" style={{ background: account.color }} />
              <div className="account-settings-copy">
                <b>{account.displayName}</b>
                <span>{account.email}</span>
                <small>{status[account.id] || (account.muted ? "Conta silenciada" : account.isSharedMailbox ? `Compartilhada · ${account.sendMode==="on-behalf"?"em nome de":"enviar como"}` : account.isDefault ? "Conta padrão" : account.provider)}</small>
              </div>
              <div className="account-settings-actions">
                {!account.isDefault && <button className="ghost" disabled={busyId === account.id} onClick={() => void setDefault(account.id)}>Tornar padrão</button>}
                {account.oauthEnabled&&<button className="ghost" disabled={busyId===account.id} onMouseEnter={()=>void refreshOAuthStatus(account)} onClick={()=>void authorizeOAuth(account)}>{oauthStatus[account.id]?"Reautorizar OAuth":"Autorizar OAuth"}</button>}
                {account.oauthEnabled&&oauthStatus[account.id]&&<button className="ghost danger-text" onClick={()=>void revokeOAuth(account)}>Revogar</button>}
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
              <label><span>Protocolo de entrada</span><select value={editing.incomingProtocol ?? "imap"} onChange={(event) => setEditing({ ...editing, incomingProtocol: event.target.value as "imap"|"pop3" })}><option value="imap">IMAP</option><option value="pop3">POP3 (TLS)</option></select></label>
              {(editing.incomingProtocol??"imap")==="imap"?<>
                <label><span>Servidor IMAP</span><input value={editing.imapHost ?? ""} onChange={(event) => setEditing({ ...editing, imapHost: event.target.value })} /></label>
                <label><span>Porta IMAP</span><input type="number" value={editing.imapPort ?? 993} onChange={(event) => setEditing({ ...editing, imapPort: Number(event.target.value) })} /></label>
              </>:<>
                <label><span>Servidor POP3</span><input value={editing.pop3Host ?? ""} onChange={(event) => setEditing({ ...editing, pop3Host: event.target.value })} /></label>
                <label><span>Porta POP</span><input type="number" value={editing.pop3Port ?? 995} onChange={(event) => setEditing({ ...editing, pop3Port: Number(event.target.value) })} /></label>
              </>}
              <label><span>Servidor SMTP</span><input value={editing.smtpHost ?? ""} onChange={(event) => setEditing({ ...editing, smtpHost: event.target.value })} /></label>
              <label><span>Porta SMTP</span><input type="number" value={editing.smtpPort ?? 465} onChange={(event) => setEditing({ ...editing, smtpPort: Number(event.target.value) })} /></label>
              <label><span>Segurança</span><select value={editing.securityMode ?? "tls"} onChange={(event) => setEditing({ ...editing, securityMode: event.target.value as AccountProfile["securityMode"] })}><option value="tls">TLS direto</option><option value="starttls">STARTTLS</option></select></label>
              <label><span>Timeout</span><select value={editing.connectionTimeoutSeconds ?? 30} onChange={(event) => setEditing({ ...editing, connectionTimeoutSeconds: Number(event.target.value) as AccountProfile["connectionTimeoutSeconds"] })}><option value={10}>10 s</option><option value={20}>20 s</option><option value={30}>30 s</option><option value={60}>60 s</option><option value={120}>120 s</option></select></label>
              <label><span>Cor</span><input type="color" value={editing.color} onChange={(event) => setEditing({ ...editing, color: event.target.value })} /></label>
              <label className="inline-check"><input type="checkbox" checked={Boolean(editing.muted)} onChange={(event) => setEditing({ ...editing, muted: event.target.checked })} /> Silenciar sincronização e notificações desta conta</label>
              {editing.isSharedMailbox&&<>
                <label><span>Modo compartilhado</span><select value={editing.sharedMode??"account"} onChange={(event)=>setEditing({...editing,sharedMode:event.target.value as "resource"|"account"})}><option value="account">Como conta</option><option value="resource">Como recurso</option></select></label>
                <label><span>Modo de envio</span><select value={editing.sendMode??"as"} onChange={(event)=>setEditing({...editing,sendMode:event.target.value as "as"|"on-behalf"})}><option value="as">Enviar como</option><option value="on-behalf">Enviar em nome de</option></select></label>
                <label className="full"><span>Permissões</span><div className="permission-checks">{(["read","edit","calendar","manage-calendar","send"] as const).map((permission)=><label key={permission}><input type="checkbox" checked={(editing.sharedPermissions??[]).includes(permission)} onChange={(event)=>{const current=editing.sharedPermissions??[];setEditing({...editing,sharedPermissions:event.target.checked?[...new Set([...current,permission])]:current.filter((item)=>item!==permission)})}}/>{permission==="read"?"Leitura":permission==="edit"?"Edição":permission==="calendar"?"Calendário":permission==="manage-calendar"?"Gerenciar calendário":"Envio"}</label>)}</div></label>
              </>}
              <label className="full"><span>URL CalDAV</span><input value={editing.caldavUrl ?? ""} onChange={(event) => setEditing({ ...editing, caldavUrl: event.target.value })} placeholder="https://servidor/dav/calendario/"/></label>
              <label className="full"><span>URL CardDAV</span><input value={editing.carddavUrl ?? ""} onChange={(event) => setEditing({ ...editing, carddavUrl: event.target.value })} placeholder="https://servidor/dav/contatos/"/></label>
              <label className="full inline-check"><input type="checkbox" checked={Boolean(editing.oauthEnabled)} onChange={(event)=>{
                const enabled=event.target.checked;
                const preset=enabled?oauthPreset(editing.provider):{};
                setEditing({...editing,...preset,oauthEnabled:enabled});
              }}/> Usar OAuth 2.0 + PKCE para IMAP/SMTP</label>
              {editing.oauthEnabled&&<>
                <label className="full"><span>Client ID OAuth</span><input value={editing.oauthClientId ?? ""} onChange={(event)=>setEditing({...editing,oauthClientId:event.target.value})} placeholder="Client ID do aplicativo público"/></label>
                <label className="full"><span>URL de autorização</span><input value={editing.oauthAuthorizationUrl ?? ""} onChange={(event)=>setEditing({...editing,oauthAuthorizationUrl:event.target.value})}/></label>
                <label className="full"><span>URL de token</span><input value={editing.oauthTokenUrl ?? ""} onChange={(event)=>setEditing({...editing,oauthTokenUrl:event.target.value})}/></label>
                <label className="full"><span>Scopes</span><input value={(editing.oauthScopes??[]).join(" ")} onChange={(event)=>setEditing({...editing,oauthScopes:event.target.value.split(/\s+/).filter(Boolean)})}/></label>
                <label className="full"><span>Redirect URI</span><input value={editing.oauthRedirectUri ?? "seven-mail://oauth/callback"} onChange={(event)=>setEditing({...editing,oauthRedirectUri:event.target.value})}/></label>
              </>}
              <label className="full"><span>URL LDAP</span><input value={editing.ldapUrl ?? ""} onChange={(event) => setEditing({ ...editing, ldapUrl: event.target.value })} placeholder="ldaps://servidor:636"/></label>
              <label><span>Base DN LDAP</span><input value={editing.ldapBaseDn ?? ""} onChange={(event) => setEditing({ ...editing, ldapBaseDn: event.target.value })} placeholder="dc=empresa,dc=local"/></label>
              <label><span>Filtro LDAP</span><input value={editing.ldapFilter ?? ""} onChange={(event) => setEditing({ ...editing, ldapFilter: event.target.value })} placeholder="(&(objectClass=person)(mail=*))"/></label>
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

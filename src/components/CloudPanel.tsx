import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { getCloudSession, neonConfigured, signInCloud, signOutCloud, signUpCloud, setCloudSyncConsent, getLastCloudSyncError, clearCloudSyncError } from "../lib/neon";
import { bridge, type CloudBinding } from "../lib/bridge";

type SessionState = Awaited<ReturnType<typeof getCloudSession>>;

export function CloudPanel() {
  const [session, setSession] = useState<SessionState>(null);
  const [binding, setBinding] = useState<CloudBinding | null>(null);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState(getLastCloudSyncError);
  useEffect(() => {
    const listener = () => setSyncError(getLastCloudSyncError());
    window.addEventListener("seven-mail:cloud-sync-error", listener);
    listener();
    return () => window.removeEventListener("seven-mail:cloud-sync-error", listener);
  }, []);

  async function refresh() {
    if (!neonConfigured) {
      setBusy(false);
      return;
    }
    try {
      const current = await getCloudSession();
      setSession(current);
      setBindingLoaded(false);
      if (current?.user) {
        setBinding(await bridge.getCloudBinding());
        setBindingLoaded(true);
      } else {
        setBinding(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener("seven-mail:cloud-session", listener);
    return () => window.removeEventListener("seven-mail:cloud-session", listener);
  }, []);

  async function authenticate() {
    if (!email.trim() || password.length < 8 || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        await signUpCloud(name.trim() || email.split("@")[0], email.trim(), password);
      } else {
        await signInCloud(email.trim(), password);
      }
      await refresh();
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await signOutCloud();
      setSession(null);
      setBinding(null);
      setBindingLoaded(false);
      setConsent(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changeConsent(enabled: boolean) {
    if (busy || !bindingLoaded || (enabled && !consent)) return;
    setBusy(true);
    setError("");
    try {
      await setCloudSyncConsent(enabled);
      setConsent(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!neonConfigured) {
    return (
      <div className="settings-row cloud-settings">
        <div>
          <h3>Sincronização Neon</h3>
          <p>O cliente está pronto para Neon Auth + Data API, mas este build ainda não recebeu os endpoints públicos.</p>
        </div>
        <div className="cloud-status warning">
          <Icon name="cloud" size={18} />
          <span><b>Configuração necessária</b><small>VITE_NEON_AUTH_URL + VITE_NEON_DATA_API_URL (endpoints HTTPS públicos)</small></span>
        </div>
      </div>
    );
  }

  const user = session?.user;
  const otherOwner = Boolean(binding && binding.ownerId !== user?.id);
  const syncEnabled = Boolean(bindingLoaded && binding?.enabled && !otherOwner);

  return (
    <div className="settings-row cloud-settings">
      <div>
        <h3>Sincronização Neon</h3>
        <p>A sincronização é opcional. Quando ativada, envia contas, documentos, metadados e o texto e HTML integrais dos e-mails ao Neon. Senhas e tokens dos provedores não são enviados.</p>
      </div>
      <div className="cloud-panel">
        {user ? (
          <>
            <div className="cloud-identity">
              <span className="avatar">{(user.name || user.email || "?")[0]?.toUpperCase()}</span>
              <span><b>{user.name || "Conta Seven"}</b><small>{user.email}</small></span>
              <span className="cloud-ok"><i /> {syncEnabled ? "Sincronização ativa" : "Sincronização pausada"}</span>
            </div>
            {bindingLoaded && otherOwner ? (
              <small className="cloud-error" role="alert">Este armazenamento local já pertence a outra conta Neon. A sincronização está bloqueada para evitar mistura de dados.</small>
            ) : bindingLoaded && syncEnabled ? (
              <button className="secondary" disabled={busy} onClick={() => void changeConsent(false)}>Pausar sincronização</button>
            ) : bindingLoaded ? (
              <>
                <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Autorizo o envio dos dados e do conteúdo integral dos meus e-mails para a conta Neon exibida acima.</label>
                <button className="primary" disabled={busy || !consent} onClick={() => void changeConsent(true)}>Ativar sincronização</button>
                <small>Este armazenamento local ficará vinculado a esta identidade. Sair da nuvem não transfere os dados a outra conta.</small>
              </>
            ) : null}
            {syncError && <div role="alert" className="cloud-error"><p>{syncError.message}</p><button className="secondary" onClick={clearCloudSyncError}>Dispensar aviso</button></div>}
            {error && <small className="cloud-error" role="alert">{error}</small>}
            <button className="secondary" disabled={busy} onClick={() => void signOut()}>Sair da nuvem</button>
          </>
        ) : (
          <>
            <div className="cloud-tabs">
              <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Entrar</button>
              <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Criar conta</button>
            </div>
            {mode === "signup" && <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" />}
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@exemplo.com" />
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha com pelo menos 8 caracteres" onKeyDown={(event) => { if (event.key === "Enter") void authenticate(); }} />
            {error && <small className="cloud-error">{error}</small>}
            <button className="primary" disabled={busy || !email.trim() || password.length < 8} onClick={() => void authenticate()}>
              <Icon name="cloud" size={15} /> {busy ? "Conectando..." : mode === "signin" ? "Entrar" : "Criar conta"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

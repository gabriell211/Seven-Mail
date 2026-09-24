import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { getCloudSession, neonConfigured, signInCloud, signOutCloud, signUpCloud } from "../lib/neon";

type SessionState = Awaited<ReturnType<typeof getCloudSession>>;

export function CloudPanel() {
  const [session, setSession] = useState<SessionState>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    if (!neonConfigured) {
      setBusy(false);
      return;
    }
    try {
      setSession(await getCloudSession());
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
          <span><b>Configuração necessária</b><small>VITE_NEON_DATABASE_URL (endpoint HTTPS público, sem credenciais)</small></span>
        </div>
      </div>
    );
  }

  const user = session?.user;

  return (
    <div className="settings-row cloud-settings">
      <div>
        <h3>Sincronização Neon</h3>
        <p>Calendário, contatos, tarefas, notas, regras e preferências são reconciliados com a nuvem usando RLS por usuário.</p>
      </div>
      <div className="cloud-panel">
        {user ? (
          <>
            <div className="cloud-identity">
              <span className="avatar">{(user.name || user.email || "?")[0]?.toUpperCase()}</span>
              <span><b>{user.name || "Conta Seven"}</b><small>{user.email}</small></span>
              <span className="cloud-ok"><i /> Online</span>
            </div>
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
              <Icon name="cloud" size={15} /> {busy ? "Conectando..." : mode === "signin" ? "Entrar e sincronizar" : "Criar e sincronizar"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

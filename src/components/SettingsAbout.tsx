import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "../icons";
import { bridge } from "../lib/bridge";
import type { RuntimeInfo } from "../types";
import { BrandLogo } from "./BrandLogo";
import type { UpdateInfo } from "./UpdateBanner";

const RELEASES_URL = "https://github.com/gabriell211/Seven-Mail/releases";

export function SettingsAbout({ runtime, onUpdateInfo }: {
  runtime?: RuntimeInfo;
  onUpdateInfo: (info: UpdateInfo) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const desktop = Boolean(runtime && runtime.platform !== "browser");

  async function checkUpdate() {
    if (checking || !desktop) return;
    setChecking(true);
    setStatus("");
    setError("");
    try {
      const info = await bridge.checkForUpdate();
      if (info.available && info.assetUrl) {
        onUpdateInfo(info);
        setStatus(`Versão ${info.version} disponível para instalação.`);
      } else if (info.available) {
        setStatus(`Versão ${info.version} disponível, mas sem instalador compatível para esta plataforma.`);
      } else {
        setStatus("Você está usando a versão mais recente.");
      }
    } catch (reason) {
      setError(`Não foi possível verificar atualizações: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setChecking(false);
    }
  }

  async function openReleaseNotes() {
    setError("");
    try {
      if (desktop) await openUrl(RELEASES_URL);
      else window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(`Não foi possível abrir as notas da versão: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  return <div className="brand-about-card">
    <div className="settings-about-identity">
      <BrandLogo variant="about"/>
      <div>
        <strong>Seven Mail</strong>
        <span>Cliente de e-mail desktop local-first</span>
        <span className="settings-version">{runtime?.platform === "browser" ? "Prévia web" : runtime?.version ? `Versão instalada: ${runtime.version}` : "Versão instalada: carregando…"}</span>
      </div>
    </div>
    <dl className="settings-about-details">
      <div><dt>Plataformas</dt><dd>Windows · Linux · macOS</dd></div>
      <div><dt>Licença do aplicativo</dt><dd>Não informada no repositório</dd></div>
    </dl>
    <div className="settings-about-actions">
      <button type="button" className="primary" disabled={checking || !desktop} onClick={() => void checkUpdate()}>
        <Icon name="refresh" size={16}/>{checking ? "Verificando…" : "Verificar atualizações"}
      </button>
      <button type="button" className="secondary" onClick={() => void openReleaseNotes()}>Notas da versão</button>
    </div>
    {status && <p className="settings-update-status" role="status">{status}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

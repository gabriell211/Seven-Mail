import { useMemo, type MouseEvent } from "react";
import type { AppSettings, MailMessage } from "../types";

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLocaleLowerCase("pt-BR");
  } catch {
    return "";
  }
}

function looksLikeIp(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
}

function visibleHost(text: string): string {
  const match = text.trim().match(/(?:https?:\/\/)?([\w.-]+\.[a-z]{2,})(?:[/:]|$)/i);
  return match?.[1]?.toLocaleLowerCase("pt-BR") ?? "";
}

function suspiciousLink(anchor: HTMLAnchorElement): boolean {
  const href = anchor.href;
  if (!/^https?:/i.test(href)) return true;
  const url = new URL(href);
  const host = url.hostname.toLocaleLowerCase("pt-BR");
  if (url.protocol !== "https:" || host.startsWith("xn--") || host.includes(".xn--") || looksLikeIp(host)) return true;
  const shown = visibleHost(anchor.textContent ?? "");
  return Boolean(shown && shown !== host && !host.endsWith(`.${shown}`) && !shown.endsWith(`.${host}`));
}

function sanitizeMessageHtml(raw: string, allowRemote: boolean): { html: string; blockedRemote: number; trackers: number } {
  const document = new DOMParser().parseFromString(raw, "text/html");
  document.querySelectorAll("script,iframe,object,embed,form,base,meta[http-equiv]").forEach((node) => node.remove());

  let blockedRemote = 0;
  let trackers = 0;

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase("en-US");
      if (name.startsWith("on") || name === "srcdoc") element.removeAttribute(attribute.name);
    }
  }

  for (const image of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
    const rawWidth = Number(image.getAttribute("width") ?? image.width ?? 0);
    const rawHeight = Number(image.getAttribute("height") ?? image.height ?? 0);
    const src = image.getAttribute("src") ?? "";
    const trackingHint = /(pixel|track|open|beacon|analytics|receipt)/i.test(src);
    const tiny = (rawWidth > 0 && rawWidth <= 2) || (rawHeight > 0 && rawHeight <= 2);

    if (trackingHint || tiny) {
      image.remove();
      trackers += 1;
      continue;
    }

    if (/^https?:\/\//i.test(src) && !allowRemote) {
      image.removeAttribute("src");
      image.setAttribute("data-seven-blocked-src", src);
      image.setAttribute("alt", image.getAttribute("alt") || "Imagem remota bloqueada");
      image.classList.add("remote-image-blocked");
      blockedRemote += 1;
    }
  }

  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("rel", "noopener noreferrer nofollow");
    anchor.setAttribute("target", "_blank");
  }

  return { html: document.body.innerHTML, blockedRemote, trackers };
}

export function SafeMessageBody({
  message,
  accountEmail,
  settings,
  onAllowRemote,
}: {
  message: MailMessage;
  accountEmail?: string;
  settings: AppSettings;
  onAllowRemote: (sender: string) => void;
}) {
  const sender = message.from.email.toLocaleLowerCase("pt-BR");
  const trusted = new Set([
    ...(settings.trustedSenders ?? []),
    ...(settings.remoteContentAllowedSenders ?? []),
  ].map((value) => value.toLocaleLowerCase("pt-BR")));
  const allowRemote = settings.blockRemoteContent === false || trusted.has(sender);

  const sanitized = useMemo(
    () => message.bodyHtml?.trim() ? sanitizeMessageHtml(message.bodyHtml, allowRemote) : null,
    [message.bodyHtml, allowRemote],
  );

  const accountDomain = accountEmail?.split("@")[1]?.toLocaleLowerCase("pt-BR") ?? "";
  const senderDomain = sender.split("@")[1] ?? "";
  const external = Boolean(settings.externalSenderWarning && accountDomain && senderDomain && accountDomain !== senderDomain);

  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a") as HTMLAnchorElement | null;
    if (!anchor?.href) return;

    const unsafe = suspiciousLink(anchor);
    if (settings.warnSuspiciousLinks !== false && unsafe) {
      const host = hostOf(anchor.href) || anchor.href;
      if (!window.confirm(`Este link merece atenção:\n\n${host}\n\nAbrir mesmo assim?`)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  return (
    <div className="safe-message-wrap">
      {external && <div className="external-sender-warning">Remetente externo à sua organização</div>}
      {sanitized && (sanitized.blockedRemote > 0 || sanitized.trackers > 0) && (
        <div className="remote-content-banner">
          <span>
            {sanitized.blockedRemote > 0 ? `${sanitized.blockedRemote} imagem(ns) remota(s) bloqueada(s).` : ""}
            {sanitized.trackers > 0 ? ` ${sanitized.trackers} rastreador(es) removido(s).` : ""}
          </span>
          {sanitized.blockedRemote > 0 && !allowRemote && (
            <button className="secondary" onClick={() => onAllowRemote(message.from.email)}>Carregar imagens deste remetente</button>
          )}
        </div>
      )}
      {sanitized
        ? <article className="mail-body safe-html" onClick={handleClick} dangerouslySetInnerHTML={{ __html: sanitized.html }} />
        : <article className="mail-body">{message.bodyText || message.preview}</article>}
    </div>
  );
}

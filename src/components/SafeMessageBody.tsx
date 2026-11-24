import { useMemo, type MouseEvent } from "react";
import type { AppSettings, MailMessage } from "../types";
import { htmlElementPolicy, safeMailLink, safeMailImage, safeTableSpan } from "../lib/mail-html-policy";

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

export function sanitizeMessageHtml(raw: string, allowRemote: boolean): { html: string; blockedRemote: number; trackers: number } {
  // Template content is inert; remote assets are not inserted into the live
  // document until a completely new allowlisted tree has been constructed.
  const template = document.createElement("template");
  template.innerHTML = raw;
  const output = document.createElement("template");
  let blockedRemote = 0;
  let trackers = 0;

  function appendSafe(node: Node, parent: Node, depth: number): void {
    if (depth > 100) return;
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const source = node as Element;
    const tag = source.localName;
    const policy = htmlElementPolicy(tag, source.namespaceURI);
    if (policy === "drop") return;
    if (policy === "unwrap") {
      for (const child of Array.from(source.childNodes)) appendSafe(child, parent, depth + 1);
      return;
    }

    // Never clone attributes, CSS, event handlers, namespaces, IDs or classes
    // from a message. Only the small set below can cross this boundary.
    const safe = output.content.ownerDocument.createElement(tag);
    if (tag === "a") {
      const href = safeMailLink(source.getAttribute("href") ?? "");
      if (href) {
        safe.setAttribute("href", href);
        safe.setAttribute("rel", "noopener noreferrer nofollow");
        safe.setAttribute("target", "_blank");
        safe.setAttribute("referrerpolicy", "no-referrer");
      }
    } else if (tag === "img") {
      const src = source.getAttribute("src") ?? "";
      const width = Number(source.getAttribute("width") ?? 0);
      const height = Number(source.getAttribute("height") ?? 0);
      if (/(pixel|track|open|beacon|analytics|receipt)/i.test(src) ||
          (width > 0 && width <= 2) || (height > 0 && height <= 2)) {
        trackers += 1;
        return;
      }
      const image = safeMailImage(src, allowRemote);
      if (image.kind === "drop") return;
      safe.setAttribute("alt", source.getAttribute("alt") ?? "");
      if (image.kind === "blocked") {
        blockedRemote += 1;
        safe.setAttribute("alt", source.getAttribute("alt") || "Imagem remota bloqueada");
        safe.className = "remote-image-blocked";
      } else {
        // Set src in the inert document only after the source was validated.
        safe.setAttribute("referrerpolicy", "no-referrer");
        safe.setAttribute("loading", "lazy");
        safe.setAttribute("src", image.src);
      }
    } else if (tag === "td" || tag === "th") {
      for (const name of ["colspan", "rowspan"]) {
        const value = safeTableSpan(source.getAttribute(name) ?? "");
        if (value) safe.setAttribute(name, value);
      }
    }
    for (const child of Array.from(source.childNodes)) appendSafe(child, safe, depth + 1);
    parent.appendChild(safe);
  }

  for (const node of Array.from(template.content.childNodes)) appendSafe(node, output.content, 0);
  return { html: output.innerHTML, blockedRemote, trackers };
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

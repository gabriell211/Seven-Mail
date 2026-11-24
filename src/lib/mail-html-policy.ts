// HTML email is untrusted input, not part of the application's own markup.
const SAFE_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "col", "colgroup",
  "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "ins", "li", "ol", "p", "pre", "s", "small", "span", "strong",
  "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

const DROP_SUBTREE = new Set([
  "applet", "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset",
  "iframe", "input", "link", "math", "meta", "noscript", "object", "option", "script",
  "select", "source", "style", "svg", "template", "textarea", "title", "video",
]);

export function htmlElementPolicy(tag: string, namespace: string | null): "allow" | "unwrap" | "drop" {
  if (namespace !== "http://www.w3.org/1999/xhtml" || DROP_SUBTREE.has(tag)) return "drop";
  return SAFE_TAGS.has(tag) ? "allow" : "unwrap";
}

function absoluteUrl(value: string): URL | null {
  if (!value || /[\u0000-\u001f\u007f]/.test(value) || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

export function safeMailLink(value: string): string | null {
  const url = absoluteUrl(value);
  if (!url) return null;
  if (url.protocol === "mailto:") return url.href;
  if (/^https?:\/\//i.test(value) && (url.protocol === "https:" || url.protocol === "http:") && url.hostname) return url.href;
  return null;
}

export type ImagePolicy = { kind: "allow"; src: string } | { kind: "blocked" } | { kind: "drop" };

export function safeMailImage(value: string, allowRemote: boolean): ImagePolicy {
  // Explicitly allow only raster data URLs; no SVG, file, blob or relative paths.
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value) && value.length <= 8_000_000) {
    return { kind: "allow", src: value };
  }
  const url = absoluteUrl(value);
  if (!url || !/^https?:\/\//i.test(value) || !url.hostname) return { kind: "drop" };
  if (url.protocol !== "https:") return { kind: "drop" };
  return allowRemote ? { kind: "allow", src: url.href } : { kind: "blocked" };
}

export function safeTableSpan(value: string): string | null {
  if (!/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= 100 ? String(number) : null;
}

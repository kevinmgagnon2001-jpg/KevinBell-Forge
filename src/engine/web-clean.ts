/** Strip a page down to markdown. Scripts, styles, and tags do not survive. */

const BLOCKED_HOST = /^(localhost|.*\.localhost|.*\.local)$/i;

function ipv4(host: string): [number, number, number, number] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return null;
  return parts as [number, number, number, number];
}

/** True for loopback, private, link-local, and metadata addresses. */
export function isBlockedHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!name || BLOCKED_HOST.test(name) || name === "0.0.0.0" || name === "::" || name === "::1") return true;
  if (name.includes(":")) {
    if (name === "::1" || name.startsWith("fe80:") || name.startsWith("fc") || name.startsWith("fd")) return true;
    const mapped = name.match(/:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      const v4 = ipv4(mapped[1]);
      if (!v4) return true;
      const [a, b] = v4;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
    }
    return false;
  }
  if (/^\d+$/.test(name) || /^0x[0-9a-f]+$/i.test(name)) return true;
  const v4 = ipv4(name);
  if (!v4) return false;
  const [a, b] = v4;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Public http(s) URL, or null. Rejects credentials, local hosts, and non-http schemes. */
export function publicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isBlockedHost(url.hostname)) return null;
  return url;
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/"/gi, '"')
    .replace(/&#39;|'/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return value > 31 && value < 127 ? String.fromCharCode(value) : " ";
    });
}

function visible(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Headings, links, and list items kept. Everything else becomes plain text. */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => `\n${"#".repeat(Number(level))} ${visible(body)}\n`);
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    const label = visible(String(body));
    try {
      const url = new URL(String(href).slice(0, 240));
      if ((url.protocol !== "http:" && url.protocol !== "https:") || isBlockedHost(url.hostname)) return label;
      return label ? `[${label}](${url.href})` : url.href;
    } catch {
      return label;
    }
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `\n- ${visible(body)}`);
  text = text.replace(/<\/(p|div|section|article|tr|h[1-6]|blockquote)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decode(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, 6000);
}

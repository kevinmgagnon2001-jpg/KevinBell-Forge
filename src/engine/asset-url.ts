const HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

/** Wikimedia image hosts only. The page proxy refuses every other host. */
export function allowedAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && HOSTS.has(parsed.hostname) && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

/** Lab textures painted in the page. They are not remote URLs. */
export const TEXTURE_PACKS = ["marble", "circuit", "clay", "paper", "steel", "brick", "grain", "night"] as const;

export type TexturePack = (typeof TEXTURE_PACKS)[number];

export function localTexture(src: string): TexturePack | null {
  const match = new RegExp(`^tex:(${TEXTURE_PACKS.join("|")})$`).exec(src.trim());
  return (match?.[1] as TexturePack | undefined) ?? null;
}

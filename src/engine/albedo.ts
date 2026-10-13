import { SRGBColorSpace, Texture, TextureLoader } from "three";
import { fetchAsset } from "./research-call";

const cache = new Map<string, Promise<Texture | null>>();

export function loadAlbedo(url: string): Promise<Texture | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const pending = fetchAsset({ data: { url } })
    .then((result) => {
      if (!result.ok) return null;
      return new Promise<Texture | null>((resolve) => {
        new TextureLoader().load(
          result.dataUrl,
          (texture) => {
            texture.colorSpace = SRGBColorSpace;
            texture.needsUpdate = true;
            resolve(texture);
          },
          undefined,
          () => resolve(null),
        );
      });
    })
    .catch(() => null);
  cache.set(url, pending);
  return pending;
}

/**
 * "Forge vX is ready": the apps look for a newer Release on GitHub when they start (and every few
 * hours) and offer it (UpdateBanner.tsx). Releases come from .github/workflows/release.yml or a
 * hand-made v1.2.3 tag.
 *
 * Installing stays in the person's hands: Android only installs an app downloaded outside the Play
 * Store after a tap, and the desktop installers are not signed for silent updates yet. So the
 * notice opens the right download for this device (or the release page) in the browser.
 *
 * The web version is always the latest and never shows the notice.
 */
const REPO = "kevinmgagnon2001-jpg/KevinBell-Forge";
export const RELEASES_URL = `https://github.com/${REPO}/releases/`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export type Platform = { os: string; arch: string };
export type Asset = { name: string; browser_download_url: string };
export type Update = { version: string; page: string; download: string | null; notes: string };

/** 1 if a is newer than b, -1 if older, 0 if the same. "v" prefixes and anything after x.y.z are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** The file on a Release that this device should download, if it is there yet. */
export function pickDownload(assets: Asset[], platform: Platform): string | null {
  const find = (test: (name: string) => boolean) => assets.find((a) => test(a.name))?.browser_download_url ?? null;
  const arm = /aarch64|arm64/.test(platform.arch);
  switch (platform.os) {
    case "android":
      return find((n) => n.endsWith("-android.apk"));
    case "windows":
      return find((n) => n.endsWith("-setup.exe")) ?? find((n) => n.endsWith(".msi"));
    case "macos":
      return find((n) => n.endsWith(".dmg"));
    case "linux":
      return find((n) => n.endsWith(".AppImage") && (arm ? /aarch64|arm64/.test(n) : /amd64|x86_64/.test(n)));
    default:
      return null;
  }
}

/** Only links to Forge's own releases are ever opened (the hosts check this too). */
export function isReleaseLink(url: string): boolean {
  return url.startsWith(RELEASES_URL) && url.length < 300 && /^[A-Za-z0-9/:._\-+%~]+$/.test(url);
}

/** What a Release from the GitHub API means for a device on `current`. null when there is nothing newer. */
export function updateFrom(release: { tag_name?: string; html_url?: string; body?: string | null; assets?: Asset[] }, current: string, platform: Platform): Update | null {
  const tag = release.tag_name ?? "";
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || compareVersions(tag, current) <= 0) return null;
  const page = release.html_url && isReleaseLink(release.html_url) ? release.html_url : `${RELEASES_URL}tag/${tag}`;
  const download = pickDownload(Array.isArray(release.assets) ? release.assets : [], platform);
  return { version: tag.slice(1), page, download: download && isReleaseLink(download) ? download : null, notes: (release.body ?? "").slice(0, 400) };
}

// ---------- in the app ----------

type AndroidBridge = { openReleaseLink?: (url: string) => boolean };
type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const g = globalThis as { ForgeAndroid?: AndroidBridge; __TAURI_INTERNALS__?: TauriInternals; location?: Location };
const tauri = () => (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === "function" ? g.__TAURI_INTERNALS__ : null);

/** This app's version and platform, or null in a browser tab (the web version is always current). */
export async function whoAmI(): Promise<{ version: string; platform: Platform } | null> {
  if (new URLSearchParams(g.location?.search ?? "").get("update") === "demo") return { version: "0.0.1", platform: { os: "linux", arch: "x86_64" } };
  const host = tauri();
  if (!host) return null;
  try {
    const version = String(await host.invoke("plugin:app|version"));
    const [os, arch] = (await host.invoke("host_info")) as [string, string];
    return { version, platform: { os, arch } };
  } catch {
    return null;
  }
}

/** Is there a newer Forge for this device? Quietly null when offline or when the check fails. */
export async function checkForUpdate(fetcher: typeof fetch = fetch): Promise<Update | null> {
  const me = await whoAmI();
  if (!me) return null;
  if (new URLSearchParams(g.location?.search ?? "").get("update") === "demo") {
    return { version: "9.9.9", page: `${RELEASES_URL}tag/v9.9.9`, download: null, notes: "A pretend update, to try the notice." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetcher(LATEST_API, { headers: { accept: "application/vnd.github+json" }, signal: controller.signal });
    if (!res.ok) return null;
    return updateFrom(await res.json(), me.version, me.platform);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Open the download (or the release page) in the system's browser. Returns why not, or null. */
export async function openUpdate(update: Update): Promise<string | null> {
  const url = update.download ?? update.page;
  if (!isReleaseLink(url)) return "That is not a Forge release link.";
  if (new URLSearchParams(g.location?.search ?? "").get("update") === "demo") return null;
  if (g.ForgeAndroid?.openReleaseLink) return g.ForgeAndroid.openReleaseLink(url) ? null : "Android would not open the link.";
  const host = tauri();
  if (host) {
    try {
      await host.invoke("open_release_link", { url });
      return null;
    } catch (error) {
      return String(error);
    }
  }
  return "Open the release page in your browser to download it.";
}

/**
 * "Forge vX is ready": the apps look for a newer Release on GitHub when they start (and every few
 * hours) and offer it (UpdateBanner.tsx). Releases come from .github/workflows/release.yml or a
 * hand-made v1.2.3 tag.
 *
 * On Android, Forge can update itself once the person allows it ("Install unknown apps" for Forge,
 * suggested once by UpdateBanner.tsx): it downloads the new APK, checks it, and installs it through
 * Android's installer (MainActivity.kt). Android asks the first time; from then on (Android 12+) it
 * installs without a tap, and Forge does it when you leave Forge. Google Play Protect may still scan
 * it: that is Android's own check, and an app cannot (and should not) switch it off.
 *
 * Elsewhere (and on Android without the permission) the notice opens the right download for this
 * device, or the release page, in the browser; the desktop installers are not signed for silent
 * updates yet.
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
  const demo = new URLSearchParams(g.location?.search ?? "").get("update");
  if (demo === "demo") return { version: "0.0.1", platform: { os: "linux", arch: "x86_64" } };
  if (demo === "demo-android") return { version: "0.0.1", platform: { os: "android", arch: "aarch64" } };
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
  const demo = new URLSearchParams(g.location?.search ?? "").get("update");
  if (demo === "demo") return { version: "9.9.9", page: `${RELEASES_URL}tag/v9.9.9`, download: null, notes: "A pretend update, to try the notice." };
  if (demo === "demo-android") return { version: "9.9.9", page: `${RELEASES_URL}tag/v9.9.9`, download: `${RELEASES_URL}download/v9.9.9/Forge-9.9.9-android.apk`, notes: "A pretend update, to try updating in place." };
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

// ---------- Android: Forge updates itself ----------

export type SelfUpdate = { allowed: boolean; silent: boolean; ready: string };
export type UpdateStage = "idle" | "downloading" | "ready" | "installing" | "confirm" | "done" | "failed";
export type UpdateProgress = { stage: UpdateStage; percent?: number; message?: string };

type Updater = { updateState(): string; allowUpdates(): void; downloadUpdate(url: string): boolean; installUpdate(): boolean };
const w = globalThis as { ForgeAndroid?: Partial<Updater>; __forgeUpdate?: (p: UpdateProgress) => void };

/** ?update=demo-android: a pretend phone that can update itself, to try the flow in a browser. */
function demoUpdater(): Updater | null {
  if (new URLSearchParams(g.location?.search ?? "").get("update") !== "demo-android") return null;
  const self = demoUpdater as unknown as { state?: SelfUpdate };
  self.state ??= { allowed: false, silent: false, ready: "" };
  const state = self.state;
  const tell = (p: UpdateProgress) => w.__forgeUpdate?.(p);
  return {
    updateState: () => JSON.stringify(state),
    allowUpdates: () => {
      state.allowed = true;
    },
    downloadUpdate: () => {
      [20, 45, 70, 95].forEach((percent, i) => setTimeout(() => tell({ stage: "downloading", percent }), 300 * (i + 1)));
      setTimeout(() => {
        state.ready = "9.9.9";
        tell({ stage: "ready" });
      }, 1500);
      return true;
    },
    installUpdate: () => {
      tell({ stage: state.silent ? "installing" : "confirm" });
      setTimeout(() => {
        state.ready = "";
        state.silent = true;
        tell({ stage: "done" });
      }, 1200);
      return true;
    },
  };
}

function updater(): Updater | null {
  const a = w.ForgeAndroid;
  if (a && typeof a.updateState === "function" && typeof a.downloadUpdate === "function" && typeof a.installUpdate === "function" && typeof a.allowUpdates === "function") return a as Updater;
  return demoUpdater();
}

/** Can this app update itself (Android with the bridge)? What it may do now. null elsewhere. */
export function selfUpdate(): SelfUpdate | null {
  const u = updater();
  if (!u) return null;
  try {
    const s = JSON.parse(u.updateState()) as Partial<SelfUpdate>;
    return { allowed: !!s.allowed, silent: !!s.silent, ready: typeof s.ready === "string" ? s.ready : "" };
  } catch {
    return null;
  }
}

/** Open Android's "Install unknown apps" switch for Forge. */
export function allowSelfUpdate() {
  updater()?.allowUpdates();
}

export function startDownload(update: Update): boolean {
  if (!update.download || !isReleaseLink(update.download) || !update.download.endsWith(".apk")) return false;
  return updater()?.downloadUpdate(update.download) ?? false;
}

export function startInstall(): boolean {
  return updater()?.installUpdate() ?? false;
}

/** Hear how a download or install is going. Returns a function that stops listening. */
export function onUpdateProgress(listener: (p: UpdateProgress) => void): () => void {
  w.__forgeUpdate = listener;
  return () => {
    if (w.__forgeUpdate === listener) delete w.__forgeUpdate;
  };
}

export type AutoUpdate = "on" | "off" | "ask";

/**
 * What to do next about updating, from what we know. Pure, so it is tested
 * (src/engine/updates.test.ts).
 *   suggest   offer to let Forge update itself (it may not yet, and the person has not said no)
 *   download  fetch the new version now
 *   install   install the downloaded version now (only when Android needs no tap: when you leave Forge)
 *   wait      nothing to do
 */
export function nextUpdateStep(input: { self: SelfUpdate | null; auto: AutoUpdate; update: Update | null; stage: UpdateStage; away: boolean }): "suggest" | "download" | "install" | "wait" {
  const { self, auto, update, stage, away } = input;
  if (!self) return "wait";
  if (!self.allowed) return auto === "off" ? "wait" : "suggest";
  if (auto === "off" || !update) return "wait";
  const ready = self.ready === update.version || stage === "ready";
  // After a failure, wait for the person to try again rather than downloading over and over.
  if (!ready) return update.download && stage === "idle" ? "download" : "wait";
  return away && self.silent && stage !== "installing" && stage !== "done" ? "install" : "wait";
}

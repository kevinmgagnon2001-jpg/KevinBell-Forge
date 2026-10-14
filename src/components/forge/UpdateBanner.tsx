/**
 * "Forge vX is ready": shown when a newer Release exists for this device (updates.ts).
 *
 * On Android, Forge first suggests (once) letting it update itself. With that allowed, a new version
 * downloads on its own and installs when you leave Forge (or right away, with Update now); Android
 * asks the first time only. Without it, and elsewhere, Download opens the right file in the browser.
 * Later hides the notice until the next version.
 */
import { useCallback, useEffect, useState } from "react";
import {
  allowSelfUpdate,
  checkForUpdate,
  nextUpdateStep,
  onUpdateProgress,
  openUpdate,
  selfUpdate,
  startDownload,
  startInstall,
  type AutoUpdate,
  type SelfUpdate,
  type Update,
  type UpdateProgress,
} from "@/engine/updates";

const DISMISSED = "forge-update-dismissed";
const AUTO = "forge-auto-update";
const FIRST_CHECK_MS = 5_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

function read(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* asked again next launch */
  }
}

const autoPref = (): AutoUpdate => {
  const v = read(AUTO);
  return v === "on" || v === "off" ? v : "ask";
};

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState("");
  // Read after the first render: the server's page knows nothing of the device or its settings.
  const [self, setSelf] = useState<SelfUpdate | null>(null);
  const [auto, setAuto] = useState<AutoUpdate>("ask");
  const [progress, setProgress] = useState<UpdateProgress>({ stage: "idle" });
  const [away, setAway] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    const look = () =>
      void checkForUpdate().then((found) => {
        if (live && found) setUpdate(found);
      });
    const first = window.setTimeout(look, FIRST_CHECK_MS);
    const again = window.setInterval(look, EVERY_MS);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  // Coming back from Android's settings (or from anywhere): look again at what Forge may do.
  useEffect(() => {
    setSelf(selfUpdate());
    setAuto(autoPref());
    const again = () => {
      setSelf(selfUpdate());
      setAway(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);

  useEffect(
    () =>
      onUpdateProgress((p) => {
        setProgress(p);
        if (p.stage === "failed") setError(`The update did not go through: ${p.message ?? "unknown reason"}.`);
        if (p.stage === "ready" || p.stage === "done") setSelf(selfUpdate());
      }),
    [],
  );

  const step = nextUpdateStep({ self, auto, update, stage: progress.stage, away });

  useEffect(() => {
    if (step === "download" && update) {
      setError("");
      if (startDownload(update)) setProgress({ stage: "downloading", percent: 0 });
    } else if (step === "install") {
      if (startInstall()) setProgress({ stage: "installing" });
    }
  }, [step, update]);

  const allow = useCallback(() => {
    write(AUTO, "on");
    setAuto("on");
    allowSelfUpdate();
    // The demo has no settings screen to come back from.
    window.setTimeout(() => setSelf(selfUpdate()), 300);
  }, []);

  if (step === "suggest" && !hidden) {
    return (
      <div className="update-banner" role="status">
        <span>
          <strong>Let Forge update itself?</strong> Allow it once in Android's settings and new versions download and install on their own: no browser, no file to find.
        </span>
        <span className="row-actions">
          <button type="button" className="btn btn-primary" onClick={allow}>
            Allow updates
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              write(AUTO, "off");
              setAuto("off");
              setHidden(true);
            }}
          >
            Not now
          </button>
        </span>
      </div>
    );
  }

  if (!update || hidden || (update.version === read(DISMISSED) && progress.stage === "idle")) return null;

  const later = (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => {
        write(DISMISSED, update.version);
        setHidden(true);
      }}
    >
      Later
    </button>
  );
  const ready = progress.stage === "ready" || (!!self && self.ready === update.version);
  const inPlace = !!self?.allowed && auto !== "off";

  let text: string;
  let action: { label: string; run: () => void } | null = null;
  if (progress.stage === "downloading") text = `Downloading Forge ${update.version}… ${progress.percent ?? 0}%`;
  else if (progress.stage === "confirm") text = `Tap Update in Android's dialog to install Forge ${update.version}. After this once, updates need no tap.`;
  else if (progress.stage === "installing") text = `Installing Forge ${update.version}. Forge closes for a moment; open it again and you are where you were.`;
  else if (progress.stage === "done") text = `Forge ${update.version} is installed.`;
  else if (inPlace && ready) {
    text = self?.silent ? `Forge ${update.version} is downloaded. It installs when you leave Forge, or now:` : `Forge ${update.version} is downloaded and ready to install. Your world is kept.`;
    action = { label: "Update now", run: () => (startInstall() ? setProgress({ stage: "installing" }) : setError("Android would not start the install.")) };
  } else {
    text = update.download ? "Download it and install it over this one; your world is kept." : "Its files are still being built; the release page has them shortly.";
    text = `Forge ${update.version} is ready. ${text}`;
    action = { label: update.download ? "Download" : "Release page", run: () => void openUpdate(update).then((why) => setError(why ?? "")) };
  }
  if (progress.stage === "failed" && inPlace && update.download) {
    action = {
      label: "Try again",
      run: () => {
        setError("");
        if (startDownload(update)) setProgress({ stage: "downloading", percent: 0 });
      },
    };
  }

  return (
    <div className="update-banner" role="status">
      <span>{progress.stage === "idle" || progress.stage === "failed" ? <strong>{text}</strong> : text}</span>
      {error ? <span className="form-error">{error}</span> : null}
      <span className="row-actions">
        {action ? (
          <button type="button" className="btn btn-primary" onClick={action.run}>
            {action.label}
          </button>
        ) : null}
        {progress.stage === "failed" && inPlace ? (
          <button type="button" className="btn btn-ghost" onClick={() => void openUpdate(update).then((why) => setError(why ?? ""))}>
            Download instead
          </button>
        ) : null}
        {self && !self.allowed && auto === "off" ? (
          <button type="button" className="btn btn-ghost" onClick={allow}>
            Allow updates
          </button>
        ) : null}
        {progress.stage === "idle" || progress.stage === "failed" || ready ? later : null}
      </span>
    </div>
  );
}

/**
 * "Forge vX is ready": shown when a newer Release exists for this device (updates.ts). Download
 * opens the right file for this phone or computer; Later hides it until the next version.
 */
import { useEffect, useState } from "react";
import { checkForUpdate, openUpdate, type Update } from "@/engine/updates";

const DISMISSED = "forge-update-dismissed";
const FIRST_CHECK_MS = 5_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

function dismissed(): string {
  try {
    return globalThis.localStorage?.getItem(DISMISSED) ?? "";
  } catch {
    return "";
  }
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const look = () =>
      void checkForUpdate().then((found) => {
        if (live && found && found.version !== dismissed()) setUpdate(found);
      });
    const first = window.setTimeout(look, FIRST_CHECK_MS);
    const again = window.setInterval(look, EVERY_MS);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  if (!update) return null;
  return (
    <div className="update-banner" role="status">
      <span>
        <strong>Forge {update.version} is ready.</strong> {update.download ? "Download it and install it over this one; your world is kept." : "Its files are still being built; the release page has them shortly."}
      </span>
      {error ? <span className="form-error">{error}</span> : null}
      <span className="row-actions">
        <button type="button" className="btn btn-primary" onClick={() => void openUpdate(update).then((why) => setError(why ?? ""))}>
          {update.download ? "Download" : "Release page"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            try {
              globalThis.localStorage?.setItem(DISMISSED, update.version);
            } catch {
              /* it shows again next launch */
            }
            setUpdate(null);
          }}
        >
          Later
        </button>
      </span>
    </div>
  );
}

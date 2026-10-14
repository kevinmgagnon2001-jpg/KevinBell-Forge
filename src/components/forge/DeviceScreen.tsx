/**
 * The screen in the world that opens onto this phone or computer (device-apps.ts). Walk up to it
 * (or tap it) and your real apps are on it; open one and Forge steps aside. Come back to Forge any
 * time and you are where you were.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countApps, deviceKind, ensureScreen, homeState, listApps, openApp, OPEN_DEVICE_EVENT, SCREEN_REACH, SCREEN_TAG, setHome, type DeviceApp, type DeviceKind, type HomeState } from "@/engine/device-apps";
import { useForge } from "@/engine/store";

const say = (body: string) => useForge.getState().note([{ tone: "engine", title: "Device", body }]);

function tileColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 38%)`;
}

function HomeRow() {
  const [state, setState] = useState<HomeState | null>(() => homeState());
  useEffect(() => {
    const again = () => setState(homeState());
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);
  if (state === null) return null;
  return (
    <div className="device-home">
      <p>
        {state === "home"
          ? "Forge is your home screen: unlock or press Home and you are back here."
          : state === "offered"
            ? "Forge is offered as a home screen. Choose it in the setting that opened, or stop offering it."
            : "Make Forge your home screen, so unlocking your phone or pressing Home brings you back here."}
      </p>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setHome(state === "off");
          setState(homeState());
        }}
      >
        {state === "off" ? "Use Forge as home screen" : "Stop using Forge as home screen"}
      </button>
    </div>
  );
}

function AppsSheet({ kind, onClose }: { kind: DeviceKind; onClose: () => void }) {
  const [apps, setApps] = useState<DeviceApp[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    listApps()
      .then((list) => live && setApps(list))
      .catch((e) => live && setError(`Could not read the apps on this ${kind}: ${String(e)}`));
    if (kind === "computer") search.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [kind, onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [apps, query]);

  const open = async (app: DeviceApp) => {
    setOpening(app.id);
    setError("");
    const why = await openApp(app);
    setOpening("");
    if (why) {
      setError(why);
      return;
    }
    say(`Opened ${app.name}. Forge is waiting right here: open it again to carry on.`);
    onClose();
  };

  return (
    <div className="device-veil" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`device-sheet is-${kind}`} role="dialog" aria-modal="true" aria-label={kind === "phone" ? "Your phone" : "Your computer"}>
        <header className="device-head">
          <div>
            <h2>{kind === "phone" ? "Your phone" : "Your computer"}</h2>
            <p>Open an app and Forge steps aside. Come back to Forge any time; you will be right here.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <input
          ref={search}
          className="field"
          value={query}
          placeholder={apps ? `Search ${apps.length} apps` : "Search"}
          aria-label="Search apps"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) void open(shown[0]);
          }}
        />
        {error ? <p className="form-error">{error}</p> : null}
        {apps === null && !error ? <p className="panel-lead">Reading your apps…</p> : null}
        {apps && !shown.length ? <p className="panel-lead">{apps.length ? "Nothing matches." : "No apps found."}</p> : null}
        <ul className="device-grid">
          {shown.map((app) => (
            <li key={app.id}>
              <button type="button" className="device-app" disabled={!!opening} onClick={() => void open(app)} title={app.name}>
                {app.icon ? (
                  <img src={app.icon} alt="" width={48} height={48} />
                ) : (
                  <span className="device-tile" style={{ background: tileColor(app.name) }} aria-hidden="true">
                    {app.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="device-name">{opening === app.id ? "Opening…" : app.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {kind === "phone" ? <HomeRow /> : null}
      </section>
    </div>
  );
}

export function DeviceScreen() {
  const [kind, setKind] = useState<DeviceKind | null>(null);
  const [near, setNear] = useState(false);
  const [open, setOpen] = useState(false);
  const selectedId = useForge((s) => s.selectedId);
  const selectedIsScreen = useForge((s) => (s.selectedId == null ? false : !!s.entities[s.selectedId]?.tags.includes(SCREEN_TAG)));

  // Put this device's screen in the world, once we know what device this is.
  useEffect(() => {
    const found = deviceKind();
    setKind(found);
    if (!found) return;
    useForge.setState((s) => ensureScreen(s, found));
    const count = countApps();
    if (count !== null) console.info(`[forge] apps on this device: ${count}`);
  }, []);

  // Keep it in the world: Reset, the lab tour, undo or a delete can rebuild the room without it.
  useEffect(() => {
    if (!kind) return;
    return useForge.subscribe((s) => {
      if (!Object.values(s.entities).some((e) => e.tags.includes(SCREEN_TAG))) useForge.setState((now) => ensureScreen(now, kind));
    });
  }, [kind]);

  // The Phone / Computer button by the move keys opens it from anywhere.
  useEffect(() => {
    if (!kind) return;
    const show = () => setOpen(true);
    window.addEventListener(OPEN_DEVICE_EVENT, show);
    return () => window.removeEventListener(OPEN_DEVICE_EVENT, show);
  }, [kind]);

  // Close enough to use it?
  useEffect(() => {
    if (!kind) return;
    const timer = window.setInterval(() => {
      const s = useForge.getState();
      const all = Object.values(s.entities);
      const me = all.find((e) => e.tags.includes("architect"));
      const screen = all.find((e) => e.tags.includes(SCREEN_TAG));
      if (!me || !screen) return setNear(false);
      const a = me.transform.position;
      const b = screen.transform.position;
      setNear(Math.hypot(a.x - b.x, a.z - b.z) < SCREEN_REACH);
    }, 250);
    return () => window.clearInterval(timer);
  }, [kind]);

  // Tapping the screen opens it.
  useEffect(() => {
    if (selectedIsScreen) setOpen(true);
  }, [selectedIsScreen, selectedId]);

  // E opens it when you are near.
  useEffect(() => {
    if (!kind || !near) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.code !== "KeyE" || open) return;
      // Keep the E itself out of the search box that opens with the screen.
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, near, open]);

  const close = useCallback(() => {
    setOpen(false);
    const s = useForge.getState();
    if (s.selectedId != null && s.entities[s.selectedId]?.tags.includes(SCREEN_TAG)) s.select(null);
  }, []);

  if (!kind) return null;
  return (
    <>
      {near && !open ? (
        <button type="button" className="device-prompt" onClick={() => setOpen(true)}>
          Use your {kind} <kbd>E</kbd>
        </button>
      ) : null}
      {open ? <AppsSheet kind={kind} onClose={close} /> : null}
    </>
  );
}

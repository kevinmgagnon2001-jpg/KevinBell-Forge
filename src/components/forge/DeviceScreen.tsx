/**
 * Your phone (or computer) as a thing you carry in the world (device-apps.ts). Walk up to it and
 * pick it up; pull it out and your real apps are on it; open one and Forge steps aside. Drop it
 * anywhere, and summon it back to your hand when it is lost.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { carryOf, countApps, deviceDistance, deviceKind, deviceOf, drop, ensureScreen, FLIGHT_MS, homeState, listApps, openApp, OPEN_DEVICE_EVENT, pickUp, pullOut, putAway, SCREEN_REACH, SCREEN_TAG, setHome, summonStep, type Carry, type DeviceApp, type DeviceKind, type HomeState } from "@/engine/device-apps";
import { INTERACT_EVENT } from "./look";
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

function AppsSheet({ kind, onClose, onDrop }: { kind: DeviceKind; onClose: () => void; onDrop: () => void }) {
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
          <div className="device-head-actions">
            <button type="button" className="btn btn-ghost" onClick={onDrop}>
              Drop
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Put away
            </button>
          </div>
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

let flying = false;

/** Fly the device back to your hand from wherever it is (device-apps.ts summonStep). */
function summon(kind: DeviceKind) {
  const device = deviceOf(useForge.getState());
  if (!device || flying) return;
  if (carryOf(device) !== "lying") return;
  flying = true;
  const from = { ...device.transform.position };
  const start = performance.now();
  const step = (now: number) => {
    const t = (now - start) / FLIGHT_MS;
    useForge.setState((s) => summonStep(s, from, t));
    if (t < 1) requestAnimationFrame(step);
    else {
      flying = false;
      say(`Your ${kind} flew back to your hand.`);
    }
  };
  requestAnimationFrame(step);
}

/** The one thing to do with the device right now: pick it up, pull it out, put it away, or summon it. */
function interact(kind: DeviceKind, near: boolean) {
  const s = useForge.getState();
  const carry = carryOf(deviceOf(s));
  if (carry === "out") useForge.setState(putAway);
  else if (carry === "pocket") useForge.setState(pullOut);
  else if (near) useForge.setState((now) => pullOut(pickUp(now)));
  else summon(kind);
}

type DeviceStatus = { kind: DeviceKind; carry: Carry; near: boolean } | null;

const statusListeners = new Set<() => void>();
let status: DeviceStatus = null;
function setStatus(next: DeviceStatus) {
  if (status?.kind === next?.kind && status?.carry === next?.carry && status?.near === next?.near) return;
  status = next;
  statusListeners.forEach((notify) => notify());
}
function useDeviceStatus(): DeviceStatus {
  return useSyncExternalStore(
    (notify) => {
      statusListeners.add(notify);
      return () => statusListeners.delete(notify);
    },
    () => status,
    () => null,
  );
}

/**
 * The phone's button on the on-screen controller: Phone (pull it out), Put away, Pick up when you
 * are next to it, or Summon phone when it is somewhere else.
 */
export function DeviceButton({ className }: { className?: string }) {
  const now = useDeviceStatus();
  if (!now) return null;
  const name = now.kind === "phone" ? "phone" : "computer";
  const label = now.carry === "out" ? "Put away" : now.carry === "pocket" ? (now.kind === "phone" ? "Phone" : "Computer") : now.near ? `Pick up ${name}` : `Summon ${name}`;
  return (
    <button type="button" className={`${className ?? ""} ${now.carry === "lying" && !now.near ? "is-summon" : ""}`} onClick={() => interact(now.kind, now.near)}>
      {label}
    </button>
  );
}

export function DeviceScreen() {
  const [kind, setKind] = useState<DeviceKind | null>(null);
  const carry = useForge((s) => carryOf(deviceOf(s)));
  const near = useForge((s) => deviceDistance(s) < SCREEN_REACH);
  const selectedIsScreen = useForge((s) => (s.selectedId == null ? false : !!s.entities[s.selectedId]?.tags.includes(SCREEN_TAG)));

  // Put this device in the world, once we know what device this is.
  useEffect(() => {
    const found = deviceKind();
    setKind(found);
    if (!found) return;
    useForge.setState((s) => ensureScreen(s, found));
    const count = countApps();
    if (count !== null) console.info(`[forge] apps on this device: ${count}`);
  }, []);

  // Keep it in the world: Reset, the lab tour, undo or a delete can rebuild the room without it.
  // Then it is back on its stand.
  useEffect(() => {
    if (!kind) return;
    return useForge.subscribe((s) => {
      if (!deviceOf(s)) useForge.setState((now) => ensureScreen(now, kind));
    });
  }, [kind]);

  useEffect(() => {
    setStatus(kind ? { kind, carry, near } : null);
  }, [kind, carry, near]);
  useEffect(() => () => setStatus(null), []);

  // The old Phone button, and anything else that asks for the device: bring it out, whatever it takes.
  useEffect(() => {
    if (!kind) return;
    const show = () => {
      const c = carryOf(deviceOf(useForge.getState()));
      if (c !== "out") interact(kind, deviceDistance(useForge.getState()) < SCREEN_REACH);
    };
    const use = () => interact(kind, deviceDistance(useForge.getState()) < SCREEN_REACH);
    window.addEventListener(OPEN_DEVICE_EVENT, show);
    window.addEventListener(INTERACT_EVENT, use);
    return () => {
      window.removeEventListener(OPEN_DEVICE_EVENT, show);
      window.removeEventListener(INTERACT_EVENT, use);
    };
  }, [kind]);

  // Tapping it: pick it up and use it when you are next to it; otherwise say how to get it.
  useEffect(() => {
    if (!kind || !selectedIsScreen) return;
    const s = useForge.getState();
    s.select(null);
    if (carryOf(deviceOf(s)) !== "lying") return;
    if (deviceDistance(s) < SCREEN_REACH) interact(kind, true);
    else say(`Your ${kind} is over there. Walk up to it to pick it up, or press Summon ${kind}.`);
  }, [kind, selectedIsScreen]);

  // E: pick it up, pull it out, put it away (P too, from anywhere).
  useEffect(() => {
    if (!kind) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.repeat) return;
      const c = carryOf(deviceOf(useForge.getState()));
      const close = deviceDistance(useForge.getState()) < SCREEN_REACH;
      if (event.code === "KeyP" || (event.code === "KeyE" && (c !== "lying" || close))) {
        // Keep the key itself out of the search box that opens with the apps.
        event.preventDefault();
        interact(kind, close);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind]);

  const close = useCallback(() => useForge.setState(putAway), []);
  const leave = useCallback(() => {
    useForge.setState(drop);
    say("Left it here. Summon it back any time.");
  }, []);

  if (!kind) return null;
  return (
    <>
      {near && carry === "lying" ? (
        <button type="button" className="device-prompt" onClick={() => interact(kind, true)}>
          Pick up your {kind} <kbd>E</kbd>
        </button>
      ) : null}
      {carry === "out" ? <AppsSheet kind={kind} onClose={close} onDrop={leave} /> : null}
    </>
  );
}

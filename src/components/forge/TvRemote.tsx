/**
 * The TV's remote (tv.ts): near the TV, turn it on (or press T), change channel, watch it big, or
 * add your own channel from a Twitch or YouTube link. The picture itself plays on the TV's screen in
 * the world (TvMesh in Viewport.tsx).
 *
 * In the Android app the player cannot be embedded in Forge's page (Twitch answers "blocked by
 * response": it only plays inside https pages, and the app's page is http://tauri.localhost). There
 * Android shows the player in its own layer over a box on the big screen (MainActivity.kt, tvShow),
 * and the TV in the world offers "Tap to watch".
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { channelsWith, embedUrl, ensureTv, parseChannel, setTvOn, switchChannel, tvChannel, tvDistance, tvIsOn, tvOf, TV_REACH, watchUrl, type Channel } from "@/engine/tv";
import { useForge } from "@/engine/store";

const CUSTOM = "forge-tv-channels";

// ---------- the person's own channels, and whether the big screen is open (shared with the 3D view) ----------

type View = { custom: Channel[]; big: boolean };
let view: View = { custom: [], big: false };
const listeners = new Set<() => void>();
function setView(next: Partial<View>) {
  view = { ...view, ...next };
  listeners.forEach((notify) => notify());
}
function loadCustom() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(CUSTOM) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return;
    // Re-parse each saved link, so nothing but real channels comes back.
    const custom = raw.flatMap((c) => {
      const back = c && typeof c === "object" && typeof (c as Channel).ref === "string" ? parseChannel(watchUrl(c as Channel)) : null;
      return back ? [{ ...back, name: typeof (c as Channel).name === "string" ? (c as Channel).name.slice(0, 60) : back.name }] : [];
    });
    setView({ custom });
  } catch {
    /* no saved channels */
  }
}
function saveCustom(custom: Channel[]) {
  setView({ custom });
  try {
    globalThis.localStorage?.setItem(CUSTOM, JSON.stringify(custom));
  } catch {
    /* kept for this session */
  }
}

export function useTvView(): View {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => view,
    () => view,
  );
}

/** The channel the TV is on, if it is on. Used by the screen in the world. */
export function useTvPicture(): { channel: Channel; src: string } | null {
  const { custom } = useTvView();
  const on = useForge((s) => tvIsOn(tvOf(s)));
  const index = useForge((s) => Number(tvOf(s)?.customData.channel) || 0);
  if (!on) return null;
  const all = channelsWith(custom);
  const channel = all[((index % all.length) + all.length) % all.length];
  return { channel, src: embedUrl(channel, globalThis.location?.hostname ?? "localhost") };
}

/** Open a channel's own page outside Forge (Android: the system browser, through the bridge). */
function openOutside(channel: Channel) {
  const url = watchUrl(channel);
  const android = (globalThis as { ForgeAndroid?: { openLink?: (u: string) => boolean } }).ForgeAndroid;
  if (android?.openLink) {
    android.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

type NativeTv = { tvShow: (kind: string, ref: string, left: number, top: number, width: number, height: number) => boolean; tvHide: () => void };

/** The Android app's own player layer, when there is one. */
export function nativeTv(): NativeTv | null {
  const android = (globalThis as { ForgeAndroid?: Partial<NativeTv> }).ForgeAndroid;
  return android && typeof android.tvShow === "function" && typeof android.tvHide === "function" ? (android as NativeTv) : null;
}

/** A black box on the page with Android's player laid exactly over it, kept in place as the page moves. */
function NativePlayer({ channel, tv }: { channel: Channel; tv: NativeTv }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (r) tv.tvShow(channel.kind, channel.ref, r.left, r.top, r.width, r.height);
    };
    place();
    const watch = new ResizeObserver(place);
    if (box.current) watch.observe(box.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const away = () => {
      if (document.visibilityState === "hidden") setView({ big: false });
    };
    document.addEventListener("visibilitychange", away);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("visibilitychange", away);
      tv.tvHide();
    };
  }, [channel.kind, channel.ref, tv]);
  return <div ref={box} className="tv-frame tv-native" aria-label={`${channel.name}, playing`} />;
}

/** Open the big screen (the TV in the world uses this for "Tap to watch"). */
export function watchBig() {
  setView({ big: true });
}

const say = (body: string) => useForge.getState().note([{ tone: "engine", title: "TV", body }]);

function Player({ src, title }: { src: string; title: string }) {
  return <iframe className="tv-frame" src={src} title={title} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
}

export function TvRemote() {
  const { custom, big } = useTvView();
  const near = useForge((s) => tvDistance(s) < TV_REACH);
  const on = useForge((s) => tvIsOn(tvOf(s)));
  const index = useForge((s) => Number(tvOf(s)?.customData.channel) || 0);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const all = channelsWith(custom);
  const current = all[((index % all.length) + all.length) % all.length];
  const native = nativeTv();

  useEffect(() => {
    loadCustom();
    useForge.setState((s) => ensureTv(s));
    // Reset or the lab tour can rebuild the room without it.
    return useForge.subscribe((s) => {
      if (!tvOf(s)) useForge.setState((now) => ensureTv(now));
    });
  }, []);

  const power = useCallback(() => {
    const isOn = tvIsOn(tvOf(useForge.getState()));
    useForge.setState((s) => setTvOn(s, !isOn));
    if (isOn) setView({ big: false });
  }, []);
  const step = useCallback((by: number) => useForge.setState((s) => switchChannel(s, channelsWith(view.custom).length, by)), []);

  // T: the TV on or off, when you are near it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.repeat || event.code !== "KeyT") return;
      if (tvDistance(useForge.getState()) >= TV_REACH && !view.big) return;
      event.preventDefault();
      power();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [power]);

  const add = () => {
    const found = parseChannel(link);
    if (!found) {
      setError("That is not a Twitch channel or a YouTube video link.");
      return;
    }
    const mine = custom.some((c) => c.id === found.id) ? custom : [...custom, found];
    saveCustom(mine);
    const at = channelsWith(mine).findIndex((c) => c.id === found.id);
    useForge.setState((s) => switchChannel(s, channelsWith(mine).length, 0, at));
    say(`Added ${found.name}.`);
    setLink("");
    setError("");
    setAdding(false);
  };

  const remove = () => {
    if (!current.custom) return;
    saveCustom(custom.filter((c) => c.id !== current.id));
    useForge.setState((s) => switchChannel(s, channelsWith(view.custom).length, 0, 0));
  };

  const controls = (
    <div className="tv-remote-row">
      <button type="button" className="btn btn-ghost" onClick={() => step(-1)} aria-label="Previous channel">
        ◀
      </button>
      <span className="tv-channel" title={current.name}>
        {on ? current.name : "TV is off"}
      </span>
      <button type="button" className="btn btn-ghost" onClick={() => step(1)} aria-label="Next channel">
        ▶
      </button>
      <button type="button" className="btn btn-ghost" onClick={power}>
        {on ? "Off" : "On"}
      </button>
    </div>
  );

  const adder = adding ? (
    <form
      className="tv-add"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a Twitch or YouTube link" aria-label="Channel link" autoFocus />
      <button type="submit" className="btn btn-primary">
        Add
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
        Cancel
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  ) : null;

  if (big && on) {
    return (
      <div className="device-veil" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && setView({ big: false })}>
        <section className="tv-big" role="dialog" aria-modal="true" aria-label="TV">
          <div className="tv-big-screen">
            {native ? <NativePlayer channel={current} tv={native} /> : <Player src={embedUrl(current, globalThis.location?.hostname ?? "localhost")} title={current.name} />}
          </div>
          {controls}
          <div className="tv-remote-row">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}>
              Add channel
            </button>
            {current.custom ? (
              <button type="button" className="btn btn-ghost" onClick={remove}>
                Remove channel
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => openOutside(current)}>
              Open outside Forge
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setView({ big: false })}>
              Back to the world
            </button>
          </div>
          {adder}
        </section>
      </div>
    );
  }

  if (!near) return null;
  if (!on) {
    return (
      <button type="button" className="device-prompt tv-prompt" onClick={power}>
        Turn on the TV <kbd>T</kbd>
      </button>
    );
  }
  return (
    <div className="tv-remote" role="group" aria-label="TV remote">
      {controls}
      <div className="tv-remote-row">
        <button type="button" className="btn btn-ghost" onClick={() => setView({ big: true })}>
          Big screen
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}>
          Add channel
        </button>
      </div>
      {adder}
    </div>
  );
}

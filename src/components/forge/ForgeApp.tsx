import { Component, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Compass, Maximize2, Minimize2, Moon, Pause, Play, RotateCcw, ScrollText, SkipForward, Sun, Undo2 } from "lucide-react";
import { setTheme, startTheme, useTheme } from "./theme";
import { HyperBackdrop, HyperMark } from "./HyperBackdrop";
import { ENGINE_SCRIPT, LAB_TOUR, TOOLS } from "@/engine/os";
import { NAMED_COLORS } from "@/engine/color";
import { RESIDENT_MODELS, residentById } from "@/engine/resident-catalog";
import { meteredConnection, residentCached } from "@/engine/resident";
import { startPersist, useForge } from "@/engine/store";
import { CATALOG, completions } from "@/engine/catalog";
import { EXAMPLES } from "@/engine/planner";
import { DropRunner, PortalWatcher } from "./Bridge";
import { DevicesCard } from "./Devices";
import { MechanicsCard } from "./Mechanics";
import { DeviceScreen } from "./DeviceScreen";
import { TvRemote } from "./TvRemote";
import { UpdateBanner } from "./UpdateBanner";
import { startMechanics } from "@/engine/carry-browser";
import { resumeLink } from "@/engine/link-browser";
import type { Entity, ToolSchema } from "@/engine/types";
import { FlatStage } from "./FlatStage";
import { LookProvider, useLook } from "./look";
import { listen, useCanListen } from "./speech";

const CHIPS: { label: string; intent: string }[] = [
  { label: "Row of cubes", intent: "a row of five rainbow cubes in front of me" },
  { label: "Tower", intent: "stack 6 crates on the bench" },
  { label: "Paint it", intent: "paint it violet" },
  { label: "Throw it", intent: "throw it" },
  { label: "Campfire", intent: "light a campfire" },
  { label: "What's here?", intent: "what's here?" },
];

const PAST_KEY = "forge-intent-history";

function readPast(): string[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PAST_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((line): line is string => typeof line === "string").slice(-40) : [];
  } catch {
    return [];
  }
}

function writePast(lines: string[]) {
  try {
    globalThis.localStorage?.setItem(PAST_KEY, JSON.stringify(lines.slice(-40)));
  } catch {
    /* private mode: history lasts the visit */
  }
}

function fmt(n: number) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}

function SceneSlot() {
  const [View, setView] = useState<ComponentType | null>(null);
  const [fault, setFault] = useState("");
  const mode = useLook().mode;
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void import("./Viewport")
        .then((mod) => {
          if (live) setView(() => mod.Viewport);
        })
        .catch((error: unknown) => {
          if (!live) return;
          setFault(error instanceof Error ? error.message : "3D view stayed on the flat manifold");
        });
    }, 1200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="view-slot">
      {View && !fault ? (
        <ViewBoundary onFault={setFault}>
          <View />
        </ViewBoundary>
      ) : (
        <FlatStage />
      )}
      {mode === "bench" || !View ? <ManifoldBanner opening={!View && !fault} fault={fault} /> : null}
    </div>
  );
}

class ViewBoundary extends Component<{ children: ReactNode; onFault: (fault: string) => void }, { fault: string }> {
  state = { fault: "" };

  static getDerivedStateFromError(error: unknown) {
    return { fault: error instanceof Error ? error.message : "The 3D view crashed" };
  }

  componentDidCatch() {
    if (this.state.fault) this.props.onFault(this.state.fault);
  }

  render() {
    if (this.state.fault) return null;
    return this.props.children;
  }
}

function ManifoldBanner({ opening, fault }: { opening: boolean; fault: string }) {
  const count = useForge((s) => Object.keys(s.entities).length);
  const tick = useForge((s) => s.tick);
  const power = useForge((s) => s.residentPower);
  const status = useForge((s) => s.residentStatus);
  const progress = useForge((s) => s.residentProgress);
  const loaded = useForge((s) => s.residentLoaded);
  const total = useForge((s) => s.residentTotal);
  const detail = useForge((s) => s.residentDetail);
  const criticPower = useForge((s) => s.criticPower);
  const criticStatus = useForge((s) => s.criticStatus);
  const criticProgress = useForge((s) => s.criticProgress);
  const criticDetail = useForge((s) => s.criticDetail);
  const spec = residentById(useForge((s) => s.residentId));
  const loading = power && (status === "loading" || status === "off");
  const quiet = !fault && !(criticPower && criticStatus === "loading" && status === "ready");
  const width = status === "ready" ? 100 : Math.max(progress, loading ? 4 : 0);
  const amount =
    total > 0 ? `${megabytes(loaded)} of ${megabytes(total)}` : `about ${spec.size}`;

  return (
    <aside className={quiet ? "manifold-banner is-quiet" : "manifold-banner"}>
      <div className="panel-head">
        <h2>Manifold</h2>
        <span className={(status === "ready" || !power) && !fault ? "live-pill is-on" : "live-pill"}>
          {fault ? "3D off" : !power || status === "ready" ? "Live" : status === "error" ? "Model failed" : `Model ${Math.round(progress)}%`}
        </span>
      </div>
      <p className="panel-lead">
        {count} {count === 1 ? "body" : "bodies"} · tick {String(tick).padStart(4, "0")}
      </p>
      {opening ? <p className="panel-lead">Opening the 3D manifold.</p> : null}
      {fault ? <p className="form-error">{fault}</p> : null}
      {power ? (
        <>
          <p className="mono-line">
            {spec.label} · {status === "ready" ? "in this page" : status === "error" ? "failed" : amount}
          </p>
          <div className={loading && progress < 1 ? "weight-bar is-busy" : "weight-bar"} aria-hidden="true">
            <span style={loading && progress < 1 ? undefined : { width: `${width}%` }} />
          </div>
          <p className={status === "error" ? "form-error" : "panel-lead"}>
            {status === "ready" ? "Weights are in this page." : `${Math.round(progress)}% · ${detail}`}
          </p>
        </>
      ) : (
        <p className="panel-lead">The model is off. The manifold is still here.</p>
      )}
      {criticPower && criticStatus !== "ready" ? (
        <p className="mono-line">
          Critic {Math.round(criticProgress)}% · {criticDetail}
        </p>
      ) : null}
    </aside>
  );
}

function megabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1048576;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function SimClock() {
  const running = useForge((s) => s.running);
  const mode = useLook().mode;
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 4) {
        acc -= 1 / 60;
        steps += 1;
      }
      if (steps) useForge.getState().stepSim(steps);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [running]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || mode !== "bench") return;
      const move =
        event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : event.key === "ArrowUp" ? "rotate" : event.key === "ArrowDown" ? "drop" : "";
      if (!move) return;
      if (!Object.values(useForge.getState().entities).some((entity) => entity.customData.play === "tetris")) return;
      event.preventDefault();
      useForge.getState().dispatchManual("play_move", { move });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);
  return null;
}

function ResidentBay() {
  const power = useForge((s) => s.residentPower);
  const id = useForge((s) => s.residentId);
  const status = useForge((s) => s.residentStatus);
  const progress = useForge((s) => s.residentProgress);
  const spec = residentById(id);
  const statusLine = !power
    ? "Off · own planner"
    : status === "ready"
      ? "In this page"
      : status === "error"
        ? "Failed"
        : `Loading ${Math.round(progress)}%`;

  return (
    <div className="resident-bay">
      <button
        type="button"
        className={power ? "power is-on" : "power"}
        aria-pressed={power}
        aria-label={power ? `Turn ${spec.short} off` : `Turn ${spec.short} on`}
        onClick={() => useForge.getState().setResidentPower(!power)}
      >
        <span className="power-knob" aria-hidden="true" />
        {power ? "ON" : "OFF"}
      </button>
      <div className="resident-readout">
        <strong>{spec.short}</strong>
        <span>{statusLine}</span>
        {power && status !== "ready" ? (
          <span className={progress < 1 && status !== "error" ? "bay-bar is-busy" : "bay-bar"} aria-hidden="true">
            <span style={progress < 1 ? undefined : { width: `${Math.max(4, progress)}%` }} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
function ThemeButton() {
  const theme = useTheme();
  useEffect(() => startTheme(), []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="btn btn-ghost bubble-icon" aria-label={`${next === "light" ? "Light" : "Dark"} theme`} title={`Switch to the ${next} theme`} onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}

function Header({
  onScript,
  onDemo,
  scripting,
}: {
  onScript: () => void;
  onDemo: () => void;
  scripting: boolean;
}) {
  const tick = useForge((s) => s.tick);
  const osTicks = useForge((s) => s.osTicks);
  const count = useForge((s) => Object.keys(s.entities).length);
  const events = useForge((s) => s.events.length);
  const running = useForge((s) => s.running);
  const memory = useForge((s) => s.memoryBudgetMb);
  const { immersive, setImmersive } = useLook();

  return (
    <header className="topbar">
      <div className="brand">
        <HyperMark />
        <div>
          <p className="brand-kicker">Harness · v0.1.0</p>
          <h1>AetherForge</h1>
        </div>
      </div>
      <dl className="stats">
        <div>
          <dt>Tick</dt>
          <dd>{String(tick).padStart(4, "0")}</dd>
        </div>
        <div>
          <dt>Entities</dt>
          <dd>{count}</dd>
        </div>
        <div>
          <dt>OS</dt>
          <dd>{osTicks}</dd>
        </div>
        <div>
          <dt>Events</dt>
          <dd>{events}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{memory} MB</dd>
        </div>
      </dl>
      <ResidentBay />
      <div className="top-actions">
        <span className={running ? "live-dot is-on" : "live-dot"} aria-hidden="true" />
        <button type="button" className="btn btn-ghost bubble-icon" aria-label="Step" title="Step one tick" onClick={() => useForge.getState().stepSim(1)}>
          <SkipForward aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-primary bubble-icon" aria-label={running ? "Pause" : "Run"} title={running ? "Pause the world" : "Run the world"} onClick={() => useForge.getState().setRunning(!running)}>
          {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button type="button" className="btn btn-ghost bubble-icon" aria-label="Run script" title="Run the script" onClick={onScript} disabled={scripting}>
          <ScrollText aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-ghost bubble-icon" aria-label="Tour the lab" title="Tour the lab" onClick={onDemo} disabled={scripting}>
          <Compass aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-ghost bubble-icon" aria-label="Undo" title="Undo the last change" onClick={() => useForge.getState().dispatchManual("undo", {})}>
          <Undo2 aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-ghost bubble-icon" aria-label={immersive ? "Window" : "Fill view"} title={immersive ? "Back to the window" : "Fill the screen with the view"} onClick={() => setImmersive(!immersive)}>
          {immersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
        <ThemeButton />
        <button type="button" className="btn btn-ghost bubble-icon" aria-label="Reset" title="Reset the lab" onClick={() => useForge.getState().reset()}>
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function IntentDock() {
  const [intent, setIntent] = useState("");
  const busy = useForge((s) => s.busy);
  const power = useForge((s) => s.residentPower);
  const status = useForge((s) => s.residentStatus);
  const ticks = useForge((s) => s.ticksPerIntent);
  const modelId = useForge((s) => s.residentId);
  const spec = residentById(modelId);

  const phrases = useForge((s) => s.phrases);
  // Up and Down walk back through what you sent (kept on this device).
  const [past, setPast] = useState<string[]>(() => readPast());
  const [back, setBack] = useState(-1);
  // As you type: your phrases, the catalog and examples that start with your words (Tab takes the first).
  const pool = useMemo(() => [...(phrases ?? []).map((p) => p.say), ...past.slice().reverse(), ...CATALOG.map((item) => item.intent), ...EXAMPLES], [phrases, past]);
  const offers = useMemo(() => completions(intent, pool), [intent, pool]);

  const submit = (value: string) => {
    const next = value.trim();
    if (!next || busy) return;
    void useForge.getState().submitIntent(next);
    const kept = [...past.filter((line) => line !== next), next].slice(-40);
    setPast(kept);
    writePast(kept);
    setBack(-1);
    setIntent("");
  };

  const forgeLabel = busy ? "Working…" : "Forge";
  const [listening, setListening] = useState(false);
  const speech = useCanListen();
  // Say it instead of typing (speech.ts): the words land in the box and go straight to the forge.
  const speak = async () => {
    setListening(true);
    const heard = await listen();
    setListening(false);
    if ("text" in heard) {
      // Typed commands that need no model (moves, gauges, addresses) still run with it off.
      void useForge.getState().submitIntent(heard.text);
    }
  };

  return (
    <form
      className="dock"
      onSubmit={(event) => {
        event.preventDefault();
        submit(intent);
      }}
    >
      <label htmlFor="intent">Architect intent</label>
      <div className="dock-row">
        <input
          id="intent"
          className="field"
          value={intent}
          maxLength={400}
          placeholder={power && status === "ready" ? `Ask ${spec.short} anything, or: a row of five red cubes` : "a row of five red cubes · paint it blue · throw it · help"}
          onChange={(event) => {
            setIntent(event.target.value);
            setBack(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && offers.length && !event.shiftKey) {
              event.preventDefault();
              setIntent(offers[0]);
            } else if (event.key === "ArrowUp" && past.length) {
              event.preventDefault();
              const at = back < 0 ? past.length - 1 : Math.max(0, back - 1);
              setBack(at);
              setIntent(past[at]);
            } else if (event.key === "ArrowDown" && back >= 0) {
              event.preventDefault();
              const at = back + 1;
              setBack(at >= past.length ? -1 : at);
              setIntent(at >= past.length ? "" : past[at]);
            }
          }}
          autoComplete="off"
          aria-describedby={offers.length ? "intent-offers" : undefined}
        />
        {speech ? (
          <button type="button" className="btn dock-mic" aria-label={listening ? "Listening" : "Speak an intent"} onClick={() => void speak()} disabled={listening}>
            {listening ? "…" : "🎙"}
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!intent.trim() || (!/forge:\/\/\S+/i.test(intent) && busy)}>
          {busy && power && status === "ready" ? "Writing…" : forgeLabel}
        </button>
      </div>
      <div className="chips" id="intent-offers" aria-live="polite">
        {offers.length
          ? offers.map((line) => (
              <button
                key={line}
                type="button"
                className="chip chip-offer"
                disabled={busy}
                title="Tap to send (Tab fills it in)"
                onClick={() => submit(line)}
              >
                {line}
              </button>
            ))
          : CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => void useForge.getState().submitIntent(chip.intent)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <label className="ticks">
        Ticks per intent
        <input
          className="field"
          inputMode="numeric"
          value={String(ticks)}
          onChange={(event) => useForge.getState().setTicks(Number(event.target.value))}
        />
      </label>
      <p className="dock-note">Click a body and change it from the computer. Splats only when you ask. Arrows move a Tetris piece.</p>
    </form>
  );
}

function ModelCard() {
  const id = useForge((s) => s.residentId);
  const power = useForge((s) => s.residentPower);
  const status = useForge((s) => s.residentStatus);
  const progress = useForge((s) => s.residentProgress);
  const detail = useForge((s) => s.residentDetail);
  const busy = useForge((s) => s.busy);
  const spec = residentById(id);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Resident model</h2>
        <span className={power && status === "ready" ? "live-pill is-on" : "live-pill"}>
          {power ? (status === "ready" ? "Live" : status === "error" ? "Error" : "Powered") : "Off"}
        </span>
      </div>
      <p className="panel-lead">
        {spec.blurb} {power ? "Power is on." : "Power is off, so Forge will not invent a call."}
      </p>
      <div className="model-pick" role="radiogroup" aria-label="Resident model">
        {RESIDENT_MODELS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={id === item.id}
            className={id === item.id ? "model-option is-on" : "model-option"}
            disabled={busy}
            onClick={() => useForge.getState().setResidentModel(item.id)}
          >
            <span>
              <strong>{item.label}</strong>
              {item.outOfTheBox ? <em>Out of the box</em> : null}
            </span>
            <span>
              {item.size} · {item.place}
            </span>
          </button>
        ))}
      </div>
      <div className="weight-bar" aria-hidden="true">
        <span style={{ width: `${power && status !== "off" ? Math.max(status === "ready" ? 100 : progress, status === "loading" ? 4 : 0) : 0}%` }} />
      </div>
      <p className="mono-line">
        {spec.repo}/{spec.file}
      </p>
      <p className={status === "error" ? "form-error" : "panel-lead"}>{detail}</p>
      <CriticRow />
      <SkillList />
    </section>
  );
}

function CriticRow() {
  const power = useForge((s) => s.criticPower);
  const status = useForge((s) => s.criticStatus);
  const progress = useForge((s) => s.criticProgress);
  const detail = useForge((s) => s.criticDetail);
  const line =
    !power ? "Off" : status === "ready" ? "In this page" : status === "loading" ? `Loading ${Math.round(progress)}%` : status === "error" ? "Failed" : "Starting";
  return (
    <div className="critic-row">
      <button
        type="button"
        className={power ? "power is-on" : "power"}
        aria-pressed={power}
        aria-label={power ? "Turn the second model off" : "Turn the second model on"}
        onClick={() => useForge.getState().setCriticPower(!power)}
      >
        <span className="power-knob" aria-hidden="true" />
        {power ? "ON" : "OFF"}
      </button>
      <div>
        <strong>Second model</strong>
        <p className="panel-lead">
          Critic · {line}. {detail}
        </p>
      </div>
    </div>
  );
}

function SkillList() {
  const skills = useForge((s) => s.skills ?? []);
  if (!skills.length) return null;
  return (
    <p className="mono-line">
      Learned {skills.map((skill) => skill.name).join(", ")}
    </p>
  );
}

function defaultsFor(tool: string, selected: Entity | undefined): Record<string, string> {
  if (tool === "spawn_entity") return { name: "Cube", x: "2", y: "0", z: "0", asset: "cube" };
  if (tool === "set_color") return { id: selected ? String(selected.id) : "", color: "blue" };
  if (tool === "edit_entity") return { id: selected ? String(selected.id) : "", color: "blue" };
  if (tool === "delete_entity") return { id: selected ? String(selected.id) : "" };
  if (tool === "undo") return {};
  if (tool === "define_skill") return { name: "edit_color", tool: "set_color", args: "id=$id,color=$color", job: "edit" };
  if (!selected) return {};
  if (tool === "set_transform") {
    return {
      id: String(selected.id),
      x: fmt(selected.transform.position.x),
      y: fmt(selected.transform.position.y),
      z: fmt(selected.transform.position.z),
    };
  }
  if (tool === "apply_velocity") {
    return { id: String(selected.id), vx: "1.4", vy: "0.15", vz: "0.35" };
  }
  return {};
}

function ToolForm({ tool }: { tool: ToolSchema }) {
  const names = Object.keys(tool.parameters);
  const selected = useForge((s) => (s.selectedId == null ? undefined : s.entities[s.selectedId]));
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(defaultsFor(tool.name, selected));
  }, [tool.name, selected?.id]);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        const args: Record<string, string> = {};
        for (const name of names) {
          const value = (values[name] ?? "").trim();
          if (value) args[name] = value;
        }
        useForge.getState().dispatchManual(tool.name, args);
      }}
    >
      {names.map((name) => (
        <label key={name} className="arg">
          <span>
            {name}
            <span className="arg-type">{tool.parameters[name]}</span>
          </span>
          <input
            className="field"
            value={values[name] ?? ""}
            onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
          />
        </label>
      ))}
      <button type="submit" className="btn btn-ghost">
        Dispatch
      </button>
    </form>
  );
}

function ToolCard() {
  const [active, setActive] = useState(TOOLS[0]?.name ?? "spawn_entity");
  const tool = TOOLS.find((item) => item.name === active) ?? TOOLS[0];

  return (
    <section className="panel">
      <h2>Tools</h2>
      <div className="tool-list" role="tablist" aria-label="Tool registry">
        {TOOLS.map((item) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            aria-selected={item.name === tool.name}
            className={item.name === tool.name ? "tool is-on" : "tool"}
            onClick={() => setActive(item.name)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="panel-lead">{tool.description}</p>
      <ToolForm tool={tool} />
    </section>
  );
}

function entityList(entities: Record<number, Entity>) {
  return Object.values(entities).sort((a, b) => a.id - b.id);
}

function LibraryCard() {
  const library = useForge((s) => s.library ?? []);
  return (
    <section className="panel">
      <h2>Library</h2>
      <p className="panel-lead">Neural splats. A recipe is a few hundred bytes. The viewport draws the points.</p>
      {library.length === 0 ? <p className="panel-lead">Empty. Ask for a material or an object the meshes do not have.</p> : null}
      <ul className="entity-list">
        {library.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              className="entity"
              onClick={() =>
                useForge.getState().dispatchManual("place_neural", {
                  title: asset.name,
                  palette: asset.palette,
                  seed: String(asset.seed),
                  count: String(asset.count),
                  shape: asset.shape,
                  source: asset.source,
                })
              }
            >
              <span className="entity-id">{asset.bytes}B</span>
              <span>
                <span className="entity-name">{asset.name}</span>
                <span className="entity-tags">
                  splat · {asset.shape}
                  {asset.source ? ` · ${asset.source.replace(/^https?:\/\//, "")}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ManifoldCard() {
  const entities = useForge((s) => s.entities);
  const selectedId = useForge((s) => s.selectedId);
  const list = entityList(entities);
  const selected = selectedId == null ? undefined : entities[selectedId];
  const [pos, setPos] = useState({ x: "", y: "", z: "" });
  const [vel, setVel] = useState({ vx: "", vy: "", vz: "" });
  const architect = selected?.tags.includes("architect") ?? false;
  const helm = selected?.tags.includes("helm") ?? false;

  useEffect(() => {
    const current = useForge.getState().entities[selectedId ?? -1];
    if (!current) return;
    setPos({
      x: fmt(current.transform.position.x),
      y: fmt(current.transform.position.y),
      z: fmt(current.transform.position.z),
    });
    const velocity = current.physics?.velocity;
    setVel({
      vx: fmt(velocity?.x ?? 0),
      vy: fmt(velocity?.y ?? 0),
      vz: fmt(velocity?.z ?? 0),
    });
  }, [selectedId]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Manifold</h2>
        <span className="live-pill is-on">
          {list.length} {list.length === 1 ? "body" : "bodies"}
        </span>
      </div>
      {list.length === 0 ? <p className="panel-lead">The manifold is empty.</p> : null}
      <ul className="entity-list">
        {list.map((entity) => (
          <li key={entity.id}>
            <button
              type="button"
              className={entity.id === selectedId ? "entity is-on" : "entity"}
              onClick={() => useForge.getState().select(entity.id)}
              aria-pressed={entity.id === selectedId}
            >
              <span className="entity-id">{entity.id}</span>
              <span>
                <span className="entity-name">{entity.tags.includes("architect") ? "Architect" : entity.name}</span>
                <span className="entity-tags">
                  {entity.tags.includes("architect")
                    ? "you · body"
                    : entity.tags.includes("helm")
                      ? "you · helm"
                      : entity.tags.includes("agent")
                        ? entity.customData.role || "agent"
                        : entity.tags.join(" · ")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="inspector">
          <p className="mono-line">
            {selected.tags.includes("architect")
              ? "Your body. Walk it, turn it, recolor it. It stays."
              : selected.tags.includes("helm")
                ? "The helm you wear. It is the computer for this world."
                : selected.representation.kind === "mesh"
                ? `mesh ${selected.representation.assetId}`
                : selected.representation.kind === "gaussian"
                  ? `gaussian ${selected.representation.particleCount}`
                  : `agent ${selected.customData.role || "builder"}`}
            {selected.customData.asset ? ` · ${selected.customData.asset}` : ""}
          </p>
          <p className="live-pos">
            {fmt(selected.transform.position.x)} · {fmt(selected.transform.position.y)} ·{" "}
            {fmt(selected.transform.position.z)}
            {selected.customData.color ? `   ${selected.customData.color}` : ""}
            {selected.physics
              ? `   v ${fmt(selected.physics.velocity.x)} ${fmt(selected.physics.velocity.y)} ${fmt(selected.physics.velocity.z)}`
              : ""}
          </p>
          <div className="pad" role="group" aria-label="Move the selection">
            {(
              [
                ["Forward", "forward"],
                ["Back", "back"],
                ["Left", "left"],
                ["Right", "right"],
                ["Turn left", "turn-left"],
                ["Turn right", "turn-right"],
              ] as const
            ).map(([label, move]) => (
              <button
                key={move}
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  useForge.getState().dispatchManual("control_avatar", { id: String(selected.id), move })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="swatches" role="group" aria-label="Color">
            {NAMED_COLORS.map((swatch) => (
              <button
                key={swatch.name}
                type="button"
                className={selected.customData.color === swatch.hex ? "swatch is-on" : "swatch"}
                style={{ background: swatch.hex }}
                aria-label={swatch.name}
                aria-pressed={selected.customData.color === swatch.hex}
                onClick={() => useForge.getState().dispatchManual("set_color", { id: String(selected.id), color: swatch.name })}
              />
            ))}
          </div>
          <form
            className="xyz"
            onSubmit={(event) => {
              event.preventDefault();
              useForge.getState().dispatchManual("set_transform", {
                id: String(selected.id),
                x: pos.x,
                y: pos.y,
                z: pos.z,
              });
            }}
          >
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis}>
                {axis}
                <input
                  className="field"
                  value={pos[axis]}
                  onChange={(event) => setPos((prev) => ({ ...prev, [axis]: event.target.value }))}
                />
              </label>
            ))}
            <button type="submit" className="btn btn-ghost">
              Set position
            </button>
          </form>
          <form
            className="xyz"
            onSubmit={(event) => {
              event.preventDefault();
              useForge.getState().dispatchManual("apply_velocity", {
                id: String(selected.id),
                vx: vel.vx,
                vy: vel.vy,
                vz: vel.vz,
              });
            }}
          >
            {(["vx", "vy", "vz"] as const).map((axis) => (
              <label key={axis}>
                {axis}
                <input
                  className="field"
                  value={vel[axis]}
                  onChange={(event) => setVel((prev) => ({ ...prev, [axis]: event.target.value }))}
                />
              </label>
            ))}
            <button type="submit" className="btn btn-ghost">
              Set velocity
            </button>
          </form>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={architect || helm}
            onClick={() => useForge.getState().despawn(selected.id)}
          >
            {architect ? "Avatar stays" : helm ? "Helm stays" : "Despawn"}
          </button>
        </div>
      ) : (
        <p className="panel-lead">Select an entity to inspect it.</p>
      )}
    </section>
  );
}

function LogCard() {
  const history = useForge((s) => s.history);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [history.length]);

  return (
    <section className="panel log-panel">
      <h2>Log</h2>
      <div className="log-body" ref={bodyRef} onScroll={onScroll}>
        {history.map((entry) => (
          <article key={entry.id} className={`log-line tone-${entry.tone}`}>
            <h3>{entry.title}</h3>
            <p>{entry.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ForgeShell() {
  const look = useLook();
  const [scripting, setScripting] = useState(false);
  const lock = useRef(false);
  const ticks = useForge((s) => s.ticksPerIntent);

  const onDemo = () => {
    if (lock.current) return;
    lock.current = true;
    setScripting(true);
    useForge.getState().setRunning(false);
    useForge.getState().reset();
    const step = useForge.getState().ticksPerIntent;
    void (async () => {
      try {
        for (const line of LAB_TOUR) {
          useForge.getState().stepSim(step);
          await useForge.getState().submitScript(line);
          await new Promise((resolve) => window.setTimeout(resolve, 280));
        }
        useForge.getState().setRunning(true);
      } finally {
        lock.current = false;
        setScripting(false);
      }
    })();
  };

  useEffect(() => {
    startPersist();
    void resumeLink();
    startMechanics();
    const boot = window.setTimeout(() => {
      void (async () => {
        const forge = useForge.getState();
        if (!forge.residentPower) return;
        // On mobile data, do not start a download of hundreds of MB without being asked.
        if (meteredConnection() && !(await residentCached(forge.residentId))) {
          forge.holdResident("On mobile data. Turn on to download the weights now, or wait for Wi-Fi.");
          return;
        }
        void useForge.getState().bootResident();
      })();
      if (useForge.getState().criticPower) void useForge.getState().bootCritic();
    }, 600);
    return () => window.clearTimeout(boot);
  }, []);

  const onScript = () => {
    if (lock.current) return;
    lock.current = true;
    setScripting(true);
    useForge.getState().setRunning(false);
    void (async () => {
      for (const line of ENGINE_SCRIPT) {
        useForge.getState().stepSim(ticks);
        await useForge.getState().submitScript(line);
        await new Promise((resolve) => window.setTimeout(resolve, 280));
      }
      lock.current = false;
      setScripting(false);
    })();
  };

  return (
    <div className={look.immersive ? "app is-immersive" : "app"}>
      <HyperBackdrop />
      <SimClock />
      <DropRunner />
      <PortalWatcher />
      <DeviceScreen />
      <TvRemote />
      <UpdateBanner />
      <Header onScript={onScript} onDemo={onDemo} scripting={scripting} />
      <SceneSlot />
      <IntentDock />
      <aside className="side">
        <div className="side-scroll">
          <ManifoldCard />
          <ModelCard />
          <MechanicsCard />
          <DevicesCard />
          <LibraryCard />
          <ToolCard />
        </div>
        <LogCard />
      </aside>
    </div>
  );
}

export function ForgeApp() {
  return (
    <LookProvider>
      <ForgeShell />
    </LookProvider>
  );
}

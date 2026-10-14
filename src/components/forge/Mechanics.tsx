/**
 * Mechanics: how you move (walking, a car, a plane, or one you made or kept), carried with you through
 * portals. Others' mechanics on the islands you visit can be kept, with their author credited.
 */
import { useState } from "react";
import { compileRecipe, packMechanic, readRecipe, type MechanicPackage } from "@/engine/mechanic";
import { BUILT_IN_RECIPES, packBuiltIn, prepare, refusedWhy } from "@/engine/movers";
import { keepMechanic, useNearby } from "@/engine/carry-browser";
import { useForge } from "@/engine/store";
import { visitorIdentity } from "@/engine/visitor";

const STARTER = `Name: Bouncy car
Look: car
Vars: hop
speed = clamp(speed + (forward * 10 - speed * 0.4) * dt, -6, 26)
yaw = yaw + steer * speed * 0.12 * dt
hop = hop + dt * 9
x = x + sin(yaw) * speed * dt
z = z + cos(yaw) * speed * dt
y = 0.45 + abs(sin(hop)) * min(abs(speed), 10) * 0.05`;

function Maker() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(STARTER);
  const [author, setAuthor] = useState("Me");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Make your own
      </button>
    );
  }
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            const recipe = readRecipe(text);
            compileRecipe(recipe);
            const me = await visitorIdentity();
            const pkg = await packMechanic(recipe, me.identity, author.trim() || "Me");
            useForge.getState().keepMechanic(pkg);
            if (await prepare(pkg)) useForge.getState().setMover(pkg.hash);
            useForge.getState().note([{ tone: "engine", title: "Mechanics", body: `Made ${pkg.name}, signed as ${pkg.author.name}. You move with it now, and it travels with you through portals.` }]);
            setOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <p className="panel-lead">
        One line per number. Inputs: forward, strafe, turn, steer, lift, dt, action. State: x, y, z, yaw, pitch, speed, vx, vy, vz and up to seven of your own (Vars). Functions: sin cos sqrt abs min max clamp floor ceil sign if(c, a, b).
      </p>
      <textarea className="field recipe-field" rows={10} value={text} spellCheck={false} onChange={(e) => {
          setText(e.target.value);
          setError("");
        }} aria-label="Mechanic recipe" />
      <label className="arg">
        <span>Signed as</span>
        <input className="field" value={author} maxLength={40} onChange={(e) => setAuthor(e.target.value)} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="row-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Build and move with it"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </form>
  );
}

function Option({ on, title, detail, onPick, onRemove }: { on: boolean; title: string; detail: string; onPick: () => void; onRemove?: () => void }) {
  return (
    <li>
      <button type="button" role="radio" aria-checked={on} className={on ? "model-option is-on" : "model-option"} onClick={onPick}>
        <span>
          <strong>{title}</strong>
        </span>
        <span>{detail}</span>
      </button>
      {onRemove ? (
        <button type="button" className="btn btn-ghost" aria-label={`Remove ${title}`} onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </li>
  );
}

export function MechanicsCard() {
  const mechanics = useForge((s) => s.mechanics);
  const moverHash = useForge((s) => s.moverHash);
  const nearby = useNearby((s) => s.items);
  const carried = useNearby((s) => s.carried);
  const [error, setError] = useState("");
  const current = mechanics.find((m) => m.hash === moverHash);
  const builtInNames = new Set(BUILT_IN_RECIPES.map((r) => r.name));
  const mine = mechanics.filter((m) => !(builtInNames.has(m.name) && m.author.name === "Forge (built in)"));

  const pick = async (pkg: MechanicPackage) => {
    setError("");
    if (!(await prepare(pkg))) {
      setError(`${pkg.name} did not pass this device's checks: ${refusedWhy(pkg.hash) ?? "unknown reason"}`);
      return;
    }
    useForge.getState().setMover(pkg.hash);
  };
  const pickBuiltIn = async (name: string) => {
    const have = mechanics.find((m) => m.name === name && m.author.name === "Forge (built in)");
    if (have) return pick(have);
    const recipe = BUILT_IN_RECIPES.find((r) => r.name === name);
    if (!recipe) return;
    const pkg = await packBuiltIn(recipe);
    useForge.getState().keepMechanic(pkg);
    await pick(pkg);
  };
  const others = nearby.filter((n) => !mechanics.some((m) => m.hash === n.pkg.hash));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Mechanics</h2>
        <span className={current ? "live-pill is-on" : "live-pill"}>{current ? current.name : "Walking"}</span>
      </div>
      <p className="panel-lead">How you move. It travels with you through portals: islands that allow it run your mechanic for your visit, so you move there exactly as you do here.</p>
      <ul className="mechanic-list" role="radiogroup" aria-label="Move with">
        <Option on={!moverHash} title="Walk" detail="The engine's own walking" onPick={() => useForge.getState().setMover("")} />
        {BUILT_IN_RECIPES.filter((r) => r.name !== "Walk").map((r) => (
          <Option key={r.name} on={current?.name === r.name && current.author.name === "Forge (built in)"} title={r.name} detail={r.summary ?? ""} onPick={() => void pickBuiltIn(r.name)} />
        ))}
        {mine.map((m) => (
          <Option
            key={m.hash}
            on={m.hash === moverHash}
            title={m.name}
            detail={`by ${m.author.name || "someone"} · ${m.look}`}
            onPick={() => void pick(m)}
            onRemove={() => useForge.getState().dropMechanic(m.hash)}
          />
        ))}
      </ul>
      {error ? <p className="form-error">{error}</p> : null}
      {Object.entries(carried).filter(([, name]) => name).map(([island, name]) => (
        <p key={island} className="mono-line">
          Carrying {name} on {island}
        </p>
      ))}
      {others.length ? (
        <div className="stack">
          <h3 className="sub-head">In use where you are</h3>
          <ul className="device-list">
            {others.map((n) => (
              <li key={n.pkg.hash}>
                <span>
                  <strong>{n.pkg.name}</strong>
                  <em>
                    by {n.pkg.author.name || "someone"} · {n.pkg.look} · on {n.island}
                  </em>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void keepMechanic(n.pkg).then((why) => {
                      if (why) setError(`Could not keep ${n.pkg.name}: ${why}`);
                    })
                  }
                >
                  Keep
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Maker />
    </section>
  );
}

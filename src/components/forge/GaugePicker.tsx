/**
 * The engine room's picker, in the Stats panel: what the machines are made of (skin swatches) and
 * what they are (mesh). It changes the selected gauge when one is selected, else every gauge, through
 * the same style_gauge tool the instant commands and the model use, so Undo works as usual.
 */
import { useMemo, useState } from "react";
import { GAUGE_TAG, MESHES, SKINS } from "@/engine/gauges";
import { useForge } from "@/engine/store";

export function GaugePicker() {
  const entities = useForge((s) => s.entities);
  const selectedId = useForge((s) => s.selectedId);
  const dispatch = useForge((s) => s.dispatchManual);
  const all = useMemo(() => Object.values(entities).filter((e) => e.tags.includes(GAUGE_TAG)).sort((a, b) => a.id - b.id), [entities]);
  const [everyOne, setEveryOne] = useState(false);
  if (!all.length) {
    return (
      <div className="gauge-pick">
        <span className="gauge-pick-label">Machines</span>
        <button type="button" className="perf-chip" onClick={() => dispatch("build_gauge_rig", { rig: "engine-room" })}>
          Build the engine room
        </button>
      </div>
    );
  }
  const picked = all.find((g) => g.id === selectedId);
  const one = everyOne ? undefined : picked;
  const targets = one ? [one] : all;
  const id = one ? String(one.id) : "*";
  const same = (key: "skin" | "mesh") => (targets.every((g) => g.customData[key] === targets[0].customData[key]) ? targets[0].customData[key] : "");
  const skin = same("skin");
  const mesh = same("mesh");
  return (
    <div className="gauge-pick" aria-label="Engine room machines">
      {picked ? (
        <div className="perf-row">
          <button type="button" className={`perf-chip ${one ? "is-on" : ""}`} aria-pressed={!!one} onClick={() => setEveryOne(false)}>
            {picked.name}
          </button>
          <button type="button" className={`perf-chip ${one ? "" : "is-on"}`} aria-pressed={!one} onClick={() => setEveryOne(true)}>
            All {all.length}
          </button>
        </div>
      ) : (
        <span className="gauge-pick-label">All {all.length} machines</span>
      )}
      <div className="perf-row">
        {SKINS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`perf-chip gauge-swatch ${skin === s.id ? "is-on" : ""}`}
            title={s.label}
            aria-label={`${s.label} skin`}
            aria-pressed={skin === s.id}
            onClick={() => dispatch("style_gauge", { id, skin: s.id })}
          >
            <span className="gauge-swatch-dot" style={{ background: s.body, borderColor: s.glow }} />
            {s.label}
          </button>
        ))}
      </div>
      <select className="gauge-mesh" value={mesh} aria-label="Machine" onChange={(e) => e.target.value && dispatch("style_gauge", { id, mesh: e.target.value })}>
        {mesh ? null : <option value="">Mixed machines</option>}
        {MESHES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}

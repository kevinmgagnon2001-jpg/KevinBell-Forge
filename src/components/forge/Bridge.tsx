/**
 * Two quiet bridges between the 3D forge and the engine layers underneath. Neither touches the
 * camera or the pilot (the pilot stays the only writer of the camera).
 *
 *   DropRunner     drop any file on the window: it is identified, then routed. A static Linux program
 *                  (x86-64 or ARM) runs in the Linux layer; a script is gated, then run in an isolated
 *                  worker that can only log, query and spawn through messages (export default fn(forge));
 *                  a WebAssembly module is validated and its exports listed. Results go to the log.
 *   PortalWatcher  when the avatar steps into a portal, walk through it: handshake, download the
 *                  island's world, check it against the signed hash, and place it beside ours.
 */
import { useEffect, useRef, useState } from "react";
import { ingest } from "@/engine/ingest";
import { placeVisited, portalAt } from "@/engine/island-content";
import { LiveVisit, liveVisits } from "@/engine/live-visit";
import { enterIsland, syncIsland } from "@/engine/portal-client";
import { useForge } from "@/engine/store";
import { visitorIdentity } from "@/engine/visitor";
import { startCarrying, stopCarrying } from "@/engine/carry-browser";

const say = (tone: "engine" | "warn", title: string, body: string) => useForge.getState().note([{ tone, title, body: body.slice(0, 1200) }]);

async function routeFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const report = ingest(bytes, file.name);
  if (report.kind === "native") {
    if (!report.ready) {
      say("warn", "Ingest", `${file.name}: ${report.detail}`);
      return;
    }
    say("engine", "Linux", `${file.name}: ${report.detail} Running…`);
    const { runLinuxProgram } = await import("@/engine/guest/linux-client");
    const ran = await runLinuxProgram(bytes, { fuel: 400_000_000, argv: [file.name] });
    const out = ran.stdout.trim() ? `\n${ran.stdout.trimEnd().slice(0, 900)}` : "";
    const gaps = ran.gaps.length ? `\n${ran.gaps.length} undecoded spot(s) seen while lifting (often data after code); none were executed.` : "";
    say(ran.ok ? "engine" : "warn", `Linux · ${ran.arch ?? "?"}`, `${file.name}: ${ran.detail}.${out}${gaps}`);
    return;
  }
  if (report.kind === "script") {
    // Gate, then run in an isolated worker. The script reaches the world only through these calls.
    const { runGatedScript } = await import("@/engine/script-runtime");
    const text = new TextDecoder().decode(bytes);
    const run = await runGatedScript(text, file.name, {
      log: (line: unknown) => say("engine", `Script · ${file.name}`, String(line).slice(0, 400)),
      query: (tag: unknown) =>
        Object.values(useForge.getState().entities)
          .filter((e) => e.tags.includes(String(tag)))
          .map((e) => ({ id: e.id, name: e.name, position: e.transform.position })),
      spawn: (name: unknown, asset: unknown) => {
        const before = useForge.getState().nextId;
        useForge.getState().dispatchManual("spawn_entity", { name: String(name).slice(0, 40), asset: String(asset ?? "gem"), x: "2.2", y: "0", z: "1.3" });
        return before;
      },
    }, { grants: ["render", "input"], timeoutMs: 3000 });
    if (run.ok) say("engine", "Script", `${file.name} ran in its own worker (${run.calls} host calls). Result: ${JSON.stringify(run.value).slice(0, 300)}`);
    else if (run.stage === "gate") say("warn", "Script gate", `${file.name} was refused:\n${run.issues.slice(0, 6).map((i) => `line ${i.line}: ${i.message}`).join("\n")}`);
    else say("warn", "Script", `${file.name} stopped: ${run.error}`);
    return;
  }
  if (report.kind === "wasm" && report.wasm) {
    say(report.ready ? "engine" : "warn", "Ingest", `${file.name}: ${report.detail} Exports: ${report.wasm.exports.join(", ") || "none"}. Imports: ${report.wasm.imports.join(", ") || "none"}.`);
    return;
  }
  say(report.ready ? "engine" : "warn", "Ingest", `${file.name} (${report.kind}, ${report.bytes} bytes): ${report.detail}`);
}

export function DropRunner() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      for (const file of Array.from(event.dataTransfer?.files ?? []).slice(0, 4)) {
        void routeFile(file).catch((error) => say("warn", "Ingest", `${file.name}: ${String(error)}`));
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="drop-veil" aria-hidden="true">
      <p>Drop to ingest. Linux programs (x86-64 or ARM) run here; scripts are checked first; nothing unknown runs.</p>
    </div>
  );
}

/** How often a visited island is synced (ms). */
const VISIT_ROUND_MS = 150;

/**
 * Keeps a visited island in step with its host (work item 9): reports where the architect stands and
 * looks, folds in the host's changes and other visitors, and takes the island away when the host stops.
 */
function keepLive(link: LiveVisit, name: string, alive: { current: boolean }) {
  liveVisits.add(link);
  link.measure(useForge.getState());
  const round = async () => {
    if (!alive.current) {
      liveVisits.delete(link);
      stopCarrying(link);
      return;
    }
    const avatar = Object.values(useForge.getState().entities).find((e) => e.tags.includes("architect"));
    if (avatar) {
      const yaw = Number(avatar.customData.yaw) || 0;
      const p = avatar.transform.position;
      const result = await link.round({ position: { x: p.x, y: p.y + 1.6, z: p.z }, forward: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, budget: 200_000 });
      if (!alive.current) {
        liveVisits.delete(link);
        return;
      }
      const now = useForge.getState();
      if (result.status === "gone") {
        liveVisits.delete(link);
        stopCarrying(link);
        now.adopt(result.apply(now), [{ tone: "warn", title: "Portal", body: `${name} left: ${result.reason}. Its half of the world is gone.` }]);
        return;
      }
      now.adopt(result.apply(now), []);
      link.measure(useForge.getState());
    }
    window.setTimeout(round, VISIT_ROUND_MS);
  };
  void round();
}

export function PortalWatcher() {
  const inside = useRef<number | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => {
      const state = useForge.getState();
      const avatar = Object.values(state.entities).find((e) => e.tags.includes("architect"));
      if (!avatar) return;
      const hit = portalAt(state, avatar.transform.position);
      if (!hit) {
        inside.current = null;
        return;
      }
      if (inside.current === hit.id || busy.current) return;
      inside.current = hit.id;
      busy.current = true;
      say("engine", "Portal", `Opening ${hit.address}…`);
      void (async () => {
        try {
          const me = await visitorIdentity();
          const secure = window.location.protocol === "https:";
          // With a mechanic of your own, ask to bring it. An island too old to know "carry" refuses the
          // whole hello, so ask again without it.
          const carrying = !!useForge.getState().moverHash;
          let visit = await enterIsland(me.signed, me.identity, hit.address, carrying ? ["render", "input", "carry"] : ["render", "input"], { secure });
          if (carrying && visit.status === "refused" && /malformed/.test(visit.reason)) visit = await enterIsland(me.signed, me.identity, hit.address, ["render", "input"], { secure });
          if (visit.status !== "inside") {
            say("warn", "Portal", `${hit.address} is ${visit.status}: ${visit.reason}`);
            return;
          }
          const now = useForge.getState();
          const already = Object.values(now.entities).some((e) => e.customData.island === visit.host.manifest.id);
          if (already) {
            say("engine", "Portal", `${visit.host.manifest.name} is already beside you.`);
            return;
          }
          const p = now.entities[hit.id]?.transform.position ?? avatar.transform.position;
          const offset = { x: p.x + 14, y: 0, z: p.z };
          const world = placeVisited(now, visit.entry, visit.host.manifest.id, offset);
          useForge.getState().adopt(world, [
            {
              tone: "engine",
              title: "Portal",
              body: `Inside ${visit.host.manifest.name} (${visit.entry.entities.length} entities, hash checked against its signed manifest). Granted: ${visit.grant.join(", ") || "nothing"}. It sits read-only beside your island and stays live while its host runs.`,
            },
          ]);
          const link = new LiveVisit(visit.host.manifest.id, offset, (view, inputs) => syncIsland(visit.base, visit.session, view, 4000, inputs));
          await startCarrying(link, { base: visit.base, session: visit.session, name: visit.host.manifest.name, grant: visit.grant });
          keepLive(link, visit.host.manifest.name, alive);
        } catch (error) {
          say("warn", "Portal", String(error));
        } finally {
          busy.current = false;
        }
      })();
    }, 250);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, []);
  return null;
}

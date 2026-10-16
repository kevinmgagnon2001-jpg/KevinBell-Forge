/**
 * Plays the world's sounds (sounds.ts, synth.ts) through Web Audio, placed in 3D: each sounding body
 * is a panner at its position and the listener rides the camera. Loops play while you are within
 * earshot; one-shots play when you walk up to the body or select it. The scene's score plays
 * everywhere, quietly; rain, wind and thunder follow the weather.
 *
 * Browsers start audio only after a tap or a key, so nothing plays before the first one. Hidden
 * pages are suspended. Buffers are rendered once per recipe and kept.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { useForge } from "@/engine/store";
import { recipeOf, soundRecipe, type Recipe } from "@/engine/sounds";
import { RATE, render } from "@/engine/synth";
import { weatherOf } from "@/engine/weather";
import { lightning } from "./body-state";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();

function audio(): AudioContext | null {
  if (ctx || typeof window === "undefined") return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  return ctx;
}

function bufferFor(r: Recipe): AudioBuffer | null {
  const c = audio();
  if (!c) return null;
  const key = JSON.stringify(r);
  let buf = buffers.get(key);
  if (!buf) {
    const samples = render(r);
    buf = c.createBuffer(1, samples.length, RATE);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    buffers.set(key, buf);
    if (buffers.size > 48) buffers.delete(buffers.keys().next().value!);
  }
  return buf;
}

type Voice = { key: string; panner: PannerNode | null; gain: GainNode; loop: AudioBufferSourceNode | null; near: boolean; last: number };

function makeVoice(c: AudioContext, positional: boolean, key: string): Voice {
  const gain = c.createGain();
  gain.gain.value = 0;
  let panner: PannerNode | null = null;
  if (positional) {
    panner = c.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1.5;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.4;
    gain.connect(panner);
    panner.connect(master!);
  } else gain.connect(master!);
  return { key, panner, gain, loop: null, near: false, last: -Infinity };
}

function startLoop(c: AudioContext, v: Voice, r: Recipe) {
  if (v.loop) return;
  const buf = bufferFor(r);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(v.gain);
  src.start(c.currentTime, (r.seed % 97) / 97 * buf.duration);
  v.loop = src;
}

function stopLoop(v: Voice) {
  try {
    v.loop?.stop();
  } catch {
    /* already stopped */
  }
  v.loop?.disconnect();
  v.loop = null;
}

function oneShot(c: AudioContext, v: Voice, r: Recipe, delay = 0) {
  const buf = bufferFor(r);
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(v.gain);
  src.start(c.currentTime + delay);
  src.onended = () => src.disconnect();
}

function drop(v: Voice) {
  stopLoop(v);
  v.gain.disconnect();
  v.panner?.disconnect();
}

const ear = new Vector3();
const fwd = new Vector3();
const up = new Vector3();

export function SoundStage() {
  const camera = useThree((s) => s.camera);
  const voices = useRef(new Map<string, Voice>());
  const ready = useRef(false);
  const tick = useRef(0);
  const thunderAt = useRef(0);
  const picked = useRef<number | null>(null);

  useEffect(() => {
    const wake = () => {
      const c = audio();
      if (!c) return;
      void c.resume();
      ready.current = true;
    };
    const vis = () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else if (ready.current) void ctx.resume();
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    document.addEventListener("visibilitychange", vis);
    const live = voices.current;
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      document.removeEventListener("visibilitychange", vis);
      for (const v of live.values()) drop(v);
      live.clear();
    };
  }, []);

  useFrame((_, delta) => {
    const c = ctx;
    if (!ready.current || !c || c.state !== "running") return;
    // The listener rides the camera every frame; the rest is checked ten times a second.
    camera.getWorldPosition(ear);
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const l = c.listener;
    if (l.positionX) {
      const t = c.currentTime;
      l.positionX.setTargetAtTime(ear.x, t, 0.02);
      l.positionY.setTargetAtTime(ear.y, t, 0.02);
      l.positionZ.setTargetAtTime(ear.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    }
    tick.current += delta;
    if (tick.current < 0.1) return;
    tick.current = 0;

    const state = useForge.getState();
    const me = Object.values(state.entities).find((e) => e.tags.includes("architect"));
    const here = me?.transform.position ?? { x: ear.x, y: ear.y, z: ear.z };
    const seen = new Set<string>();
    const now = c.currentTime;

    // Bodies with sounds.
    for (const e of Object.values(state.entities)) {
      const r = recipeOf(e);
      if (!r) continue;
      const key = `e${e.id}:${e.customData.sound}:${e.customData.soundSeed}`;
      seen.add(key);
      let v = voices.current.get(key);
      if (!v) {
        v = makeVoice(c, true, key);
        voices.current.set(key, v);
        v.gain.gain.value = 1;
      }
      const p = e.transform.position;
      v.panner?.positionX.setTargetAtTime(p.x, now, 0.05);
      v.panner?.positionY.setTargetAtTime(p.y, now, 0.05);
      v.panner?.positionZ.setTargetAtTime(p.z, now, 0.05);
      const d = Math.hypot(p.x - here.x, p.z - here.z);
      if (r.loop) {
        if (d < 26) startLoop(c, v, r);
        else if (d > 32) stopLoop(v);
      } else {
        const near = d < 2.6;
        const tapped = state.selectedId === e.id && picked.current !== e.id;
        if (((near && !v.near) || tapped) && now - v.last > 1.5) {
          oneShot(c, v, r);
          v.last = now;
        }
        v.near = near;
      }
    }

    picked.current = state.selectedId;

    // The score, and the weather's own sounds.
    const w = weatherOf(state);
    const beds: [string, Recipe | null, number][] = [
      [`score:${state.score ?? ""}`, state.score ? soundRecipe(/\b(music|song|tune|melody|score|soundtrack|lullaby)\b/i.test(state.score) ? state.score : `music ${state.score}`) : null, 0.3],
      ["rain", w.rain > 0.02 ? soundRecipe("rain") : null, Math.min(0.6, w.rain * 0.55)],
      ["wind", w.wind > 0.5 || w.storm > 0.2 ? soundRecipe("wind") : null, Math.min(0.5, (w.wind - 0.4) * 0.6 + w.storm * 0.2)],
    ];
    for (const [key, r, level] of beds) {
      if (!r) continue;
      seen.add(key);
      let v = voices.current.get(key);
      if (!v) {
        v = makeVoice(c, false, key);
        voices.current.set(key, v);
      }
      startLoop(c, v, { ...r, loop: true });
      v.gain.gain.setTargetAtTime(level, now, 0.8);
    }

    // Thunder follows the flash, later the further the strike.
    if (lightning.at > thunderAt.current) {
      thunderAt.current = lightning.at;
      let v = voices.current.get("thunder");
      if (!v) {
        v = makeVoice(c, false, "thunder");
        v.gain.gain.value = 0.7;
        voices.current.set("thunder", v);
      }
      const r = soundRecipe("thunder", Math.floor(lightning.at) % 1000);
      if (r) oneShot(c, v, r, 0.3 + Math.random() * 1.8);
    }
    seen.add("thunder");

    for (const [key, v] of voices.current) {
      if (seen.has(key)) continue;
      // Fade out, then let go.
      v.gain.gain.setTargetAtTime(0, now, 0.3);
      voices.current.delete(key);
      window.setTimeout(() => drop(v), 1500);
    }
  });
  return null;
}

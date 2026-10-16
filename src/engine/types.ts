import type { Move } from "./motion.ts";
import type { Weather } from "./weather.ts";
import type { RecentCall } from "./skillbook.ts";
import type { Town } from "./town.ts";
export type Vec3 = { x: number; y: number; z: number };

export type Quat = { x: number; y: number; z: number; w: number };

export type Transform = {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
};

export type Representation =
  | { kind: "mesh"; assetId: string }
  | { kind: "gaussian"; proxyId: string; particleCount: number }
  | { kind: "hybrid"; meshId: string; gsId: string };

export type PhysicsBody = {
  mass: number;
  velocity: Vec3;
  angularVelocity: Vec3;
  isKinematic: boolean;
  solver: string;
};

export type Entity = {
  id: number;
  name: string;
  transform: Transform;
  representation: Representation;
  physics: PhysicsBody | null;
  tags: string[];
  customData: Record<string, string>;
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, string>;
  optional?: string[];
};

export type ProposedAction = {
  kind: "tool_call" | "message";
  toolName?: string;
  arguments: Record<string, string>;
  message?: string;
};

export type LogTone = "user" | "model" | "engine" | "warn";

export type LogEntry = {
  id: number;
  tone: LogTone;
  title: string;
  body: string;
};

export type PluginKind = "demo" | "bonded" | "grok";

export type BondedModel = {
  name: string;
  path: string;
  loaded: boolean;
  /** True only after the GGUF magic header checks out. */
  validated: boolean;
};

export type Skill = {
  name: string;
  description: string;
  job: string;
  steps: { tool: string; arguments: Record<string, string> }[];
};

export type Snapshot = {
  entities: Record<number, Entity>;
  nextId: number;
  skills: Skill[];
  weather?: Weather;
  score?: string;
};

export type HarnessEvent = {
  tick: number;
  tool: string;
  ok: boolean;
  detail: string;
};

export type World = {
  entities: Record<number, Entity>;
  nextId: number;
  tick: number;
  gravity: number;
  deltaTime: number;
  eventLog: string[];
  events: HarnessEvent[];
  /** Previous manifolds, newest last. Undo pops one. */
  undo: Snapshot[];
  /** Skills the harness taught itself when a builtin was the wrong call. */
  skills: Skill[];
  /** Opcodes the local map earned after a flagship fixture passed. */
  compat?: string[];
  /** Moves made in this world (motion.ts): saved, and shared with your other devices. */
  moves?: Move[];
  /** Weather, time of day and mood (weather.ts); none means the lab's clear afternoon. */
  weather?: Weather;
  /** The last few changes that worked, for "do that again" and saving skills (skillbook.ts). */
  recent?: RecentCall[];
  /** The scene's music, as words (sounds.ts); none means quiet. */
  score?: string;
  /** Townsfolk's minds and the town clock (town.ts). */
  town?: Town;
};

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export const V3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const ENGINE_VERSION = "0.1.0";

export const GROK_MODEL = "grok-4.5";

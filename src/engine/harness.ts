import { colorName, normalizeColor } from "./color.ts";
import { deckCommand } from "./deck-bridge.ts";
import { compatCommand } from "./isa.ts";
import { placePortal } from "./portal-tool.ts";
import { buildRig, makeGauge, MESHES, rigById, RIGS, SKINS, skinById, statById, STATS, styleGauges, meshById } from "./gauges.ts";
import { buildBlocks, buildBreakout, buildMarble, buildTetris, createAgent, makeSpawned, playTetris, queryByTag, recordEvent, restyle, seatOffCenter, steer } from "./manifold.ts";
import { clusterDag } from "./cluster-lod.ts";
import { composeMove, keepMove, moveFromKeys, moveLength, movesOf, PRIMITIVES, slug, type Move } from "./motion.ts";
import { toolByName } from "./os.ts";
import { applyWeatherArgs } from "./weather.ts";
import { setSound } from "./sounds.ts";
import { askTown, fillTown, sendTownsfolk } from "./town.ts";
import { placeHyper, wield } from "./hyper.ts";
import { hangRope } from "./rope.ts";
import { listSkills, MAX_SKILLS, noteCall, repeatTool, runSteps, saveSkill } from "./skillbook.ts";
import { allowedAssetUrl, localTexture } from "./asset-url.ts";
import type { Entity, HarnessEvent, PhysicsBody, ProposedAction, Skill, Snapshot, World } from "./types.ts";
import { V3 } from "./types.ts";

export type ToolOutcome = {
  ok: boolean;
  /** Raw success text, or the raw error (not the "Tool failed" wrapper). */
  detail: string;
  world: World;
};

function parseU64(value: string | undefined): number | null {
  if (value == null || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseIdList(value: string | undefined): number[] | null {
  const text = value?.trim() ?? "";
  if (!text || text === "*") return null;
  const ids: number[] = [];
  for (const part of text.split(/[\s,]+/)) {
    if (!part) continue;
    const id = parseU64(part);
    if (id == null) return null;
    ids.push(id);
  }
  return ids.length ? ids : null;
}

function live(world: World): Entity[] {
  return Object.values(world.entities)
    .filter((entity) => !entity.tags.includes("architect"))
    .sort((a, b) => a.id - b.id);
}

function remember(world: World): World {
  const snap: Snapshot = {
    entities: world.entities,
    nextId: world.nextId,
    skills: world.skills ?? [],
    ...(world.weather ? { weather: world.weather } : {}),
    ...(world.score ? { score: world.score } : {}),
  };
  return { ...world, undo: [...(world.undo ?? []), snap].slice(-16) };
}

function fillArgs(template: Record<string, string>, args: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    const next = value.replace(/\$([a-z]+)/gi, (_, name: string) => args[name] ?? args[name.toLowerCase()] ?? "");
    if (next.trim()) out[key] = next;
  }
  return out;
}

export function registerSkill(world: World, skill: Skill): World {
  const name = skill.name.trim();
  if (!name) return world;
  const skills = world.skills ?? [];
  if (skills.some((item) => item.name === name)) return world;
  return { ...world, skills: [...skills, skill].slice(-MAX_SKILLS) };
}

function parseF32(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(world: World, tool: string, ok: boolean, detail: string): World {
  const event: HarnessEvent = {
    tick: world.tick,
    tool,
    ok,
    detail: detail.slice(0, 200),
  };
  const events = [...world.events, event];
  if (events.length > 512) events.splice(0, 128);
  return recordEvent({ ...world, events }, detail);
}

export function dispatchTool(world: World, name: string, args: Record<string, string>): ToolOutcome {
  const skill = (world.skills ?? []).find((item) => item.name === name);
  if (skill) return runSkill(world, skill, args);
  const schema = toolByName(name);
  if (!schema) {
    return { ok: false, detail: `tool '${name}' is not registered`, world };
  }
  const optional = new Set(schema.optional ?? []);
  const missing = Object.keys(schema.parameters).filter((key) => !optional.has(key) && !(key in args));
  if (missing.length) {
    return {
      ok: false,
      detail: `missing required argument(s): ${missing.join(", ")}`,
      world,
    };
  }

  if (name === "sandbox_list" || name === "sandbox_read" || name === "sandbox_write" || name === "search_web_clean") {
    return {
      ok: false,
      detail: "The sandbox loopback runs in a server child process, not in the page, and it does not execute notes.",
      world,
    };
  }

  if (name === "deck_bridge") return deckCommand(world, args);
  if (name === "compat_map") return compatCommand(world, args);
  if (name === "place_portal") return placePortal(world, args);

  if (name === "make_move") {
    const label = (args.name ?? "").trim();
    let move: Move | null;
    if (args.keys?.trim()) {
      const made = moveFromKeys(label || "my move", args.keys, parseF32(args.length) ?? 1.5, args.loop === "true");
      if ("error" in made) return { ok: false, detail: made.error, world };
      move = made.move;
    } else {
      move = composeMove(args.words ?? label, label || undefined);
      if (!move) return { ok: false, detail: `say it with these: ${PRIMITIVES.map((p) => p.id).join(", ")} (or give keys)`, world };
      if (args.loop === "true") move = { ...move, loop: true };
    }
    const seconds = moveLength(move).toFixed(1);
    return { ok: true, detail: `Made the move '${move.name}' (${move.segments.length} step${move.segments.length === 1 ? "" : "s"}, ${seconds} s${move.loop ? ", loops" : ""}). Say "${move.name}" or pick it in Moves.`, world: keepMove(world, move) };
  }

  if (name === "do_move") {
    const who = args.id ? parseU64(args.id) : null;
    const figure = who != null ? world.entities[who] : Object.values(world.entities).find((e) => e.tags.includes("architect"));
    if (!figure || figure.representation.kind !== "hybrid") return { ok: false, detail: "that is not a figure that can move", world };
    const asked = (args.move ?? "").trim();
    if (/^(stop|none|stand|rest)$/i.test(asked)) {
      const { move: _m, moveSeq: _s, ...rest } = figure.customData;
      return { ok: true, detail: `${figure.name} stops.`, world: { ...world, entities: { ...world.entities, [figure.id]: { ...figure, customData: rest } } } };
    }
    let next = world;
    const all = movesOf(world);
    // A kept or built-in move by its name; otherwise build one from the words (filling in what was
    // not said) and keep it, unless it is just a built-in one.
    let move = all.find((m) => m.id === slug(asked) || m.name.toLowerCase() === asked.toLowerCase());
    if (!move) {
      const built = composeMove(asked);
      const plain = built && all.find((m) => m.id === built.id && m.from === "built in");
      move = plain ?? built ?? undefined;
      if (built && !plain) next = keepMove(world, built);
    }
    if (!move) return { ok: false, detail: `no move called '${asked}'; try ${PRIMITIVES.slice(0, 6).map((p) => p.id).join(", ")}, or make_move`, world };
    const seq = String((Number(figure.customData.moveSeq) || 0) + 1);
    const entities = { ...next.entities, [figure.id]: { ...figure, customData: { ...figure.customData, move: move.id, moveSeq: seq } } };
    return { ok: true, detail: `${figure.tags.includes("architect") ? "You" : figure.name}: ${move.name}${move.loop ? " (until you say stop)" : ""}.`, world: { ...next, entities } };
  }

  if (name === "repeat") {
    const run = repeatTool(world, args, dispatchTool);
    return { ok: run.ok, detail: run.detail, world: run.world };
  }
  if (name === "save_skill") return saveSkill(world, args);
  if (name === "list_skills") return { ok: true, detail: listSkills(world), world };

  if (name === "set_sound") return setSound(world, args);
  if (name === "fill_town") return fillTown(world, args);
  if (name === "place_hyper") return placeHyper(world, args);
  if (name === "hang_rope") return hangRope(world, args);
  if (name === "wield") return wield(world, args);
  if (name === "ask_town") return askTown(world, args);
  if (name === "send_npc") return sendTownsfolk(world, args);

  if (name === "set_weather") {
    const made = applyWeatherArgs(world, args);
    if ("error" in made) return { ok: false, detail: made.error, world };
    return { ok: true, detail: `The sky turns: ${made.weather.label}.`, world: { ...world, weather: made.weather } };
  }

  if (name === "place_gauge") {
    const stat = statById(args.stat);
    if (!stat) return { ok: false, detail: `stat must be ${STATS.map((s) => s.id).join(", ")}`, world };
    if (args.mesh && !meshById(args.mesh)) return { ok: false, detail: `mesh must be ${MESHES.map((m) => m.id).join(", ")}`, world };
    if (args.skin && !skinById(args.skin)) return { ok: false, detail: `skin must be ${SKINS.map((s) => s.id).join(", ")}`, world };
    const x = parseF32(args.x);
    const z = parseF32(args.z);
    const id = world.nextId;
    const gauge = makeGauge(id, { stat: stat.id, mesh: args.mesh, skin: args.skin, name: args.name, ...(x != null && z != null ? { x, z } : {}) }, world);
    return {
      ok: true,
      detail: `Placed ${gauge.name} (${skinById(gauge.customData.skin)?.label}) as entity ${id}. It reads ${stat.label.toLowerCase()} live.`,
      world: { ...world, entities: { ...world.entities, [id]: gauge }, nextId: id + 1 },
    };
  }

  if (name === "style_gauge") {
    const raw = (args.id ?? "*").trim();
    const ids = raw === "*" || raw === "" ? "all" : parseIdList(raw);
    if (!ids) return { ok: false, detail: "argument 'id' is not a valid id list", world };
    const styled = styleGauges(world, ids, { mesh: args.mesh, skin: args.skin, stat: args.stat });
    if (styled.error) return { ok: false, detail: styled.error, world };
    const what = [args.mesh && meshById(args.mesh)?.label, args.skin && skinById(args.skin)?.label, args.stat && statById(args.stat)?.label].filter(Boolean).join(", ");
    return { ok: true, detail: `Restyled ${styled.count} gauge${styled.count === 1 ? "" : "s"}: ${what}`, world: styled.world };
  }

  if (name === "build_gauge_rig") {
    const rig = rigById(args.rig);
    if (!rig) return { ok: false, detail: `rig must be ${RIGS.map((r) => r.id).join(", ")}`, world };
    if (args.skin && !skinById(args.skin)) return { ok: false, detail: `skin must be ${SKINS.map((s) => s.id).join(", ")}`, world };
    const built = buildRig(world, rig, args.skin);
    return { ok: true, detail: `${rig.label}: ${built.placed} placed, ${built.restyled} restyled. The machines read this device live.`, world: built.world };
  }

  if (name === "spawn_entity") {
    const id = world.nextId;
    const drafted = makeSpawned(id, args);
    const entity = seatOffCenter(world, drafted, args);
    const entities = { ...world.entities, [id]: entity };
    const shifted =
      Math.hypot(
        entity.transform.position.x - drafted.transform.position.x,
        entity.transform.position.z - drafted.transform.position.z,
      ) > 0.2;
    const tint = colorName(entity.customData.color);
    return {
      ok: true,
      detail: `Spawned '${entity.name}' as entity ${id}${tint !== "none" ? ` (${tint})` : ""}${shifted ? " off the platform center" : ""}`,
      world: { ...world, entities, nextId: id + 1 },
    };
  }

  if (name === "set_color") {
    const color = normalizeColor(args.color);
    if (!color) return { ok: false, detail: "argument 'color' must be a name such as red, blue, or teal", world };
    if (args.id?.trim() === "*") {
      let count = 0;
      const entities = { ...world.entities };
      for (const entity of Object.values(entities)) {
        if (entity.tags.includes("architect")) continue;
        entities[entity.id] = { ...entity, customData: { ...entity.customData, color } };
        count += 1;
      }
      if (!count) return { ok: false, detail: "no entities to color", world };
      return {
        ok: true,
        detail: `Colored ${count} entities ${colorName(color)}`,
        world: { ...world, entities },
      };
    }
    const ids = parseIdList(args.id);
    if (!ids) return { ok: false, detail: "argument 'id' is not a valid u64", world };
    let entities = world.entities;
    const names: string[] = [];
    for (const id of ids) {
      const entity = entities[id];
      if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
      entities = { ...entities, [id]: { ...entity, customData: { ...entity.customData, color } } };
      names.push(entity.name);
    }
    return {
      ok: true,
      detail: `Colored ${names.join(", ")} ${colorName(color)}`,
      world: { ...world, entities },
    };
  }

  if (name === "set_transform") {
    const ids = parseIdList(args.id);
    if (!ids) return { ok: false, detail: "argument 'id' is not a valid u64", world };
    const x = parseF32(args.x);
    const y = parseF32(args.y);
    const z = parseF32(args.z);
    if (x == null || y == null || z == null) {
      return { ok: false, detail: "x, y, z must all be valid f32", world };
    }
    let entities = world.entities;
    if (args.delta === "1" || ids.length > 1) {
      for (const id of ids) {
        const entity = entities[id];
        if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
        const p = entity.transform.position;
        entities = {
          ...entities,
          [id]: {
            ...entity,
            transform: { ...entity.transform, position: { x: p.x + x, y: p.y + y, z: p.z + z } },
          },
        };
      }
      return { ok: true, detail: `Nudged ${ids.length} entities`, world: { ...world, entities } };
    }
    const id = ids[0];
    const entity = entities[id];
    if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
    const next: Entity = {
      ...entity,
      transform: { ...entity.transform, position: { x, y, z } },
    };
    return {
      ok: true,
      detail: `Entity ${id} moved to (${x}, ${y}, ${z})`,
      world: { ...world, entities: { ...world.entities, [id]: next } },
    };
  }

  if (name === "apply_velocity") {
    const id = parseU64(args.id);
    if (id == null) return { ok: false, detail: "argument 'id' is not a valid u64", world };
    const vx = parseF32(args.vx);
    const vy = parseF32(args.vy);
    const vz = parseF32(args.vz);
    if (vx == null) return { ok: false, detail: "argument 'vx' is not a valid f32", world };
    if (vy == null) return { ok: false, detail: "argument 'vy' is not a valid f32", world };
    if (vz == null) return { ok: false, detail: "argument 'vz' is not a valid f32", world };
    const entity = world.entities[id];
    if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
    if (entity.physics?.isKinematic) return { ok: false, detail: `entity ${id} is kinematic`, world };
    const body: PhysicsBody = entity.physics
      ? { ...entity.physics, velocity: { x: vx, y: vy, z: vz }, isKinematic: false }
      : {
          mass: 1,
          velocity: { x: vx, y: vy, z: vz },
          angularVelocity: V3(),
          isKinematic: false,
          solver: "rigid",
        };
    const next: Entity = { ...entity, physics: body };
    return {
      ok: true,
      detail: `Entity ${id} velocity set to (${vx}, ${vy}, ${vz})`,
      world: { ...world, entities: { ...world.entities, [id]: next } },
    };
  }

  if (name === "build_play") {
    const kind = (args.kind ?? "").trim().toLowerCase();
    if (kind === "tetris") {
      return { ok: true, detail: "Tetris is on the right. Run lets the piece fall. Left, right, rotate, and drop from the computer.", world: buildTetris(world) };
    }
    if (kind === "marble") {
      return { ok: true, detail: "Marble run is on the left. Run and the ball rides the ramps into the catch.", world: buildMarble(world) };
    }
    if (kind === "blocks") {
      return { ok: true, detail: "A Blocks cabinet is by the bench. Walk up to it and press Play.", world: buildBlocks(world) };
    }
    if (kind === "breakout") {
      return { ok: true, detail: "A Hyper Breakout cabinet glows across from Blocks. Walk up to it and press Play.", world: buildBreakout(world) };
    }
    return { ok: false, detail: "kind must be tetris, marble, blocks or breakout", world };
  }

  if (name === "play_move") {
    const move = (args.move ?? "drop").trim().toLowerCase();
    return { ok: true, detail: `Tetris ${move}`, world: playTetris(world, move) };
  }

  if (name === "query_scene") {
    const tag = args.tag ?? "";
    const found = queryByTag(world.entities, tag);
    const names = found.map((entity) => `${entity.name}#${entity.id}`);
    return {
      ok: true,
      detail: `Found ${found.length} entities with tag '${tag}': [${names.join(", ")}]`,
      world,
    };
  }

  if (name === "edit_entity") {
    return editEntities(world, args);
  }

  if (name === "delete_entity") {
    return deleteEntities(world, args.id);
  }

  if (name === "undo") {
    const stack = world.undo ?? [];
    const snap = stack[stack.length - 1];
    if (!snap) return { ok: false, detail: "nothing to undo", world };
    return {
      ok: true,
      detail: "Undid the last change",
      world: {
        ...world,
        entities: snap.entities,
        nextId: snap.nextId,
        skills: snap.skills ?? [],
        weather: snap.weather,
        score: snap.score,
        undo: stack.slice(0, -1),
      },
    };
  }

  if (name === "define_skill") {
    const skillName = (args.name ?? "").trim();
    const tool = (args.tool ?? "").trim();
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(skillName)) {
      return { ok: false, detail: "skill name must be a short identifier", world };
    }
    if (!tool || tool === "define_skill" || tool === skillName) {
      return { ok: false, detail: "skill needs an existing tool", world };
    }
    if (!toolByName(tool) && !(world.skills ?? []).some((skill) => skill.name === tool)) {
      return { ok: false, detail: `tool '${tool}' is not registered`, world };
    }
    const skill: Skill = {
      name: skillName,
      description: (args.description ?? skillName).slice(0, 160),
      job: (args.job ?? "edit").slice(0, 24),
      steps: [{ tool, arguments: parsePairs(args.args) }],
    };
    const next = registerSkill(world, skill);
    const known = next.skills.some((item) => item.name === skillName);
    return {
      ok: known,
      detail: known ? `Skill '${skillName}' is available` : `could not save skill '${skillName}'`,
      world: next,
    };
  }

  if (name === "control_avatar") {
    const move = (args.move ?? "").trim();
    const known = ["forward", "back", "left", "right", "up", "down", "turn-left", "turn-right"];
    if (!known.includes(move)) return { ok: false, detail: `move '${move || "?"}' is not a step or a turn`, world };
    const id =
      parseU64(args.id) ?? Object.values(world.entities).find((entity) => entity.tags.includes("architect"))?.id ?? null;
    if (id == null) return { ok: false, detail: "no body to control", world };
    const entity = world.entities[id];
    if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
    const next = steer(entity, move);
    return {
      ok: true,
      detail: `${entity.name} ${move}`,
      world: { ...world, entities: { ...world.entities, [id]: next } },
    };
  }

  if (name === "spawn_agent") {
    const role = (args.role ?? "builder").trim().toLowerCase();
    if (role !== "builder" && role !== "critic" && role !== "scout") {
      return { ok: false, detail: "role must be builder, critic, or scout", world };
    }
    const given = (args.name ?? "").trim() || (role === "critic" ? "Critic" : role === "scout" ? "Scout" : "Builder");
    const slot = Object.values(world.entities).filter((entity) => entity.tags.includes("agent")).length;
    const agent = createAgent(world.nextId, given, role, slot);
    return {
      ok: true,
      detail: `Agent ${agent.name}#${agent.id} (${role}) is in the scene`,
      world: { ...world, nextId: world.nextId + 1, entities: { ...world.entities, [agent.id]: agent } },
    };
  }

  if (name === "set_asset") {
    const ids = parseIdList(args.id);
    if (!ids) return { ok: false, detail: "argument 'id' is not a valid u64", world };
    const src = (args.src ?? "").trim();
    const local = localTexture(src);
    if (!local && !allowedAssetUrl(src)) return { ok: false, detail: "asset url must be a Wikimedia image or a lab texture", world };
    const title = (args.title ?? (local || "reference")).slice(0, 80);
    let entities = world.entities;
    const names: string[] = [];
    for (const id of ids) {
      const entity = entities[id];
      if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
      entities = {
        ...entities,
        [id]: { ...entity, customData: { ...entity.customData, src, asset: title, page: args.page ?? entity.customData.page ?? "" } },
      };
      names.push(entity.name);
    }
    return {
      ok: true,
      detail: `Pulled '${title}' onto ${names.join(", ")}`,
      world: { ...world, entities },
    };
  }

  if (name === "apply_method") {
    const which = (args.name ?? "gsplat").trim().toLowerCase();
    if (which === "xpbd" || which === "gpbd") {
      return {
        ok: true,
        detail:
          "The marble run projects positions with Gauss-Seidel, a local stand-in for arXiv:2511.23131 (Towards Generalized Position-Based Dynamics). The paper's code is not downloaded or run.",
        world: buildMarble(world),
      };
    }
    if (which === "nanite" || which === "meshlet" || which === "cluster") {
      const dag = clusterDag();
      const existing = Object.values(world.entities).find((entity) => entity.customData.method === "nanite");
      const note = `Cluster LOD is on the floor (${dag.leafTriangles} fine triangles, ${dag.nodes.length} clusters, one root). Walk up and the cut refines; back away and it stays coarse. Screen-space error is the one in Karis, Nanite: A Deep Dive (SIGGRAPH 2021) and zeux/meshoptimizer demo/nanite.cpp. The mesh is an indexed triangle list, the shape Blender exports. This is not Epic's Nanite, not Vulkan, and not nanite-webgpu.`;
      if (existing) return { ok: true, detail: note, world };
      const spawned = seatOffCenter(
        world,
        makeSpawned(world.nextId, { name: "Cluster", asset: "gem", x: "3.1", y: "0.9", z: "-1.4", color: "teal" }),
        { x: "3.1", y: "0.9", z: "-1.4" },
      );
      spawned.customData = { ...spawned.customData, method: "nanite", page: "https://advances.realtimerendering.com/s2021/index.html" };
      return {
        ok: true,
        detail: note,
        world: { ...world, entities: { ...world.entities, [spawned.id]: spawned }, nextId: world.nextId + 1 },
      };
    }
    const entities = { ...world.entities };
    const neural =
      Object.values(entities).find((entity) => entity.customData.neural === "splat") ??
      Object.values(entities).find((entity) => entity.representation.kind === "gaussian");
    if (neural) {
      const count = Math.min(320, (Number(neural.customData.count) || 180) + 64);
      entities[neural.id] = {
        ...neural,
        customData: {
          ...neural.customData,
          neural: "splat",
          count: String(count),
          palette: neural.customData.palette || "#d5e7f7,#7eb6e8,#4c8df5,#1d4e89",
          shape: neural.customData.shape || "column",
          page: "https://arxiv.org/abs/2610.04351",
        },
      };
    }
    const anchor = seatOffCenter(
      { ...world, entities },
      makeSpawned(world.nextId, { name: "LoCo", asset: "gem", x: "2.4", y: "0.6", z: "-1.6", color: "blue" }),
      { x: "2.4", y: "0.6", z: "-1.6" },
    );
    entities[anchor.id] = anchor;
    return {
      ok: true,
      detail:
        "Densified the splat from its local neighborhood and marked the anchor with a gem. This is the in-engine stand-in for LoCoSplat (arXiv:2610.04351). Remote paper code is not executed.",
      world: { ...world, entities, nextId: world.nextId + 1 },
    };
  }

  if (name === "place_neural") {
    const palette = (args.palette ?? "").trim();
    if (!palette.includes("#")) return { ok: false, detail: "neural asset needs a palette", world };
    const shape = (args.shape ?? "blob").trim();
    const safeShape = shape === "column" || shape === "ring" || shape === "slab" ? shape : "blob";
    const title = (args.title ?? "Asset").trim().slice(0, 42) || "Asset";
    let id = parseU64(args.id);
    const entities = { ...world.entities };
    let nextId = world.nextId;
    if (id == null || !entities[id]) {
      const spawned = seatOffCenter(
        world,
        makeSpawned(nextId, { name: title, asset: "gaussian", x: "1.8", y: "1.2", z: "1.4" }),
        { x: "1.8", y: "1.2", z: "1.4" },
      );
      id = spawned.id;
      entities[id] = spawned;
      nextId += 1;
    }
    const entity = entities[id];
    entities[id] = {
      ...entity,
      customData: {
        ...entity.customData,
        neural: "splat",
        palette,
        seed: String(parseF32(args.seed) ?? entity.id),
        count: String(Math.max(80, Math.min(320, parseF32(args.count) ?? 220))),
        shape: safeShape,
        asset: title,
        page: (args.source ?? "").slice(0, 180),
      },
    };
    return {
      ok: true,
      detail: `Placed neural splat ${title} on ${entity.name}`,
      world: { ...world, entities, nextId },
    };
  }

  return { ok: false, detail: `tool '${name}' is registered but not implemented`, world };
}

function parsePairs(value: string | undefined): Record<string, string> {
  const args: Record<string, string> = {};
  if (!value) return args;
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const item = part.slice(eq + 1).trim();
    if (key) args[key] = item;
  }
  return args;
}

function patchEntity(entity: Entity, args: Record<string, string>): { entity: Entity; changed: boolean } {
  let next = entity;
  let changed = false;
  const color = args.color ? normalizeColor(args.color) : null;
  if (color && color !== entity.customData.color) {
    next = { ...next, customData: { ...next.customData, color } };
    changed = true;
  }
  if (args.name && args.name !== entity.name) {
    next = { ...next, name: args.name };
    changed = true;
  }
  if (args.asset) {
    const asset = args.asset.trim();
    const current =
      entity.representation.kind === "mesh"
        ? entity.representation.assetId
        : entity.representation.kind === "gaussian"
          ? "gaussian"
          : "";
    if (asset && asset !== current) {
      next = restyle(next, asset);
      changed = true;
    }
  }
  const factor = args.scale != null && args.scale.trim() !== "" ? Number(args.scale) : null;
  if (factor != null && Number.isFinite(factor) && factor > 0 && factor !== 1) {
    const clamped = Math.min(4, Math.max(0.25, factor));
    const scale = next.transform.scale;
    next = {
      ...next,
      transform: {
        ...next.transform,
        scale: { x: scale.x * clamped, y: scale.y * clamped, z: scale.z * clamped },
      },
    };
    changed = true;
  }
  const finish = args.finish?.trim().toLowerCase();
  if (finish === "glint" || finish === "plain") {
    const has = next.customData.finish === "glint";
    if ((finish === "glint") !== has) {
      const { finish: _f, ...rest } = next.customData;
      next = { ...next, customData: finish === "glint" ? { ...rest, finish: "glint" } : rest };
      changed = true;
    }
  }
  const axes = [parseF32(args.sx), parseF32(args.sy), parseF32(args.sz)].map((v) => (v != null && v > 0 ? Math.min(4, Math.max(0.25, v)) : 1));
  if (axes.some((v) => v !== 1)) {
    const scale = next.transform.scale;
    const grown = { x: scale.x * axes[0], y: scale.y * axes[1], z: scale.z * axes[2] };
    // Stretched from the ground up: the bottom stays put.
    const p = next.transform.position;
    next = { ...next, transform: { ...next.transform, scale: grown, position: { ...p, y: p.y + (grown.y - scale.y) / 2 } } };
    changed = true;
  }
  const x = parseF32(args.x);
  const y = parseF32(args.y);
  const z = parseF32(args.z);
  if (x != null && y != null && z != null) {
    const p = next.transform.position;
    if (p.x !== x || p.y !== y || p.z !== z) {
      next = { ...next, transform: { ...next.transform, position: { x, y, z } } };
      changed = true;
    }
  }
  return { entity: next, changed };
}

function editEntities(world: World, args: Record<string, string>): ToolOutcome {
  const ids =
    args.id?.trim() === "*"
      ? live(world).map((entity) => entity.id)
      : parseIdList(args.id);
  if (!ids?.length) return { ok: false, detail: "argument 'id' is not a valid u64", world };
  let entities = world.entities;
  let changed = 0;
  for (const id of ids) {
    const entity = entities[id];
    if (!entity) return { ok: false, detail: `entity ${id} not found`, world };
    const patched = patchEntity(entity, args);
    if (!patched.changed) continue;
    entities = { ...entities, [id]: patched.entity };
    changed += 1;
  }
  if (!changed) return { ok: false, detail: "edit changed nothing", world };
  const tint = args.color ? colorName(normalizeColor(args.color) ?? "") : "";
  return {
    ok: true,
    detail: `Edited ${changed} ${changed === 1 ? "entity" : "entities"}${tint && tint !== "none" ? ` (${tint})` : ""}`,
    world: { ...world, entities },
  };
}

function deleteEntities(world: World, rawId: string | undefined): ToolOutcome {
  const targets =
    rawId?.trim() === "*"
      ? live(world)
      : (() => {
          const ids = parseIdList(rawId);
          if (!ids) return null;
          const found = ids.map((id) => world.entities[id]).filter((entity): entity is Entity => Boolean(entity));
          return found.length === ids.length ? found : [];
        })();
  if (targets == null) return { ok: false, detail: "argument 'id' is not a valid u64", world };
  if (!targets.length) return { ok: false, detail: "nothing to delete", world };
  const blocked = targets.find((entity) => entity.tags.includes("architect"));
  if (blocked) return { ok: false, detail: "ArchitectAvatar is your body and stays. Move, turn, or recolor it.", world };
  const doomed = targets.filter((entity) => !entity.tags.includes("helm") && !entity.tags.includes("worn"));
  if (!doomed.length) {
    return { ok: false, detail: "The helm stays on. It is the computer you wear.", world };
  }
  const entities = { ...world.entities };
  for (const entity of doomed) delete entities[entity.id];
  const names = doomed.map((entity) => `${entity.name}#${entity.id}`).join(", ");
  return {
    ok: true,
    detail: `Deleted ${doomed.length}: ${names}`,
    world: { ...world, entities },
  };
}

function runSkill(world: World, skill: Skill, args: Record<string, string>): ToolOutcome {
  if (skill.steps.some((step) => step.tool === skill.name || step.tool === "define_skill" || step.tool === "save_skill")) {
    return { ok: false, detail: `skill '${skill.name}' cannot call itself`, world };
  }
  // $name placeholders take the call's arguments; saved literal arguments the call names are overridden.
  const steps = skill.steps.map((step) => ({ tool: step.tool, arguments: fillArgs(step.arguments, args) }));
  const run = runSteps(world, steps, dispatchTool, args);
  return { ok: run.ok, detail: run.ok ? `Skill '${skill.name}': ${run.detail || "ok"}` : run.detail, world: run.ok ? run.world : world };
}

export function executeProposal(
  world: World,
  proposal: ProposedAction,
): { world: World; result: string; ok: boolean } {
  if (proposal.kind !== "tool_call") {
    const result = proposal.message ?? "No action";
    return { world: recordEvent(world, result), result, ok: true };
  }
  const name = proposal.toolName;
  if (!name) {
    const result = "Tool call missing name";
    return { world: recordEvent(world, result), result, ok: false };
  }
  const quiet = name === "undo" || name === "query_scene" || name === "list_skills" || name === "ask_town";
  const base = quiet ? world : remember(world);
  const outcome = dispatchTool(base, name, proposal.arguments);
  const settled = outcome.ok ? noteCall(base, outcome.world, name, proposal.arguments) : { ...outcome.world, undo: world.undo ?? [] };
  const result = outcome.ok ? outcome.detail : `Tool '${name}' failed: ${outcome.detail}`;
  return { world: record(settled, name, outcome.ok, outcome.detail), result, ok: outcome.ok };
}

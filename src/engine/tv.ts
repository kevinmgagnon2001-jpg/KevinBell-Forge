/**
 * The TV in the lab: interdimensional cable. Turn it on and a live channel plays on its screen in
 * the world (TvRemote.tsx, the TV mesh in Viewport.tsx). The first channel is Nothing, Forever, the
 * endless AI-made show on Twitch; add any Twitch channel or YouTube video or stream by its link.
 *
 *   customData.on        "1" when it is on
 *   customData.channel   which channel (an index into channelsWith(custom))
 *
 * Players are embedded from Twitch and YouTube themselves; nothing is downloaded or re-hosted.
 */
import type { Entity, World } from "./types.ts";

export const TV_TAG = "tv";
/** Close enough to use the remote (metres from the avatar). */
export const TV_REACH = 5;
/** The screen, in metres; the player is 16:9 and fills it. */
export const TV_SCREEN = { width: 1.6, height: 0.9, y: 1.35 };

export type Channel = { id: string; name: string; kind: "twitch" | "youtube"; ref: string; custom?: boolean };

export const BUILT_IN: Channel[] = [{ id: "twitch:watchmeforever", name: "Nothing, Forever", kind: "twitch", ref: "watchmeforever" }];

const TWITCH_NAME = /^[A-Za-z0-9_]{3,25}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_RESERVED = new Set(["videos", "directory", "settings", "downloads", "p", "search", "subscriptions", "inventory", "wallet", "drops"]);

/** A Twitch channel or a YouTube video/stream from a link someone pasted. null when it is neither. */
export function parseChannel(input: string): Channel | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "twitch.tv") {
    const name = parts[0] ?? "";
    if (parts.length !== 1 || !TWITCH_NAME.test(name) || TWITCH_RESERVED.has(name.toLowerCase())) return null;
    return { id: `twitch:${name.toLowerCase()}`, name: `${name} (Twitch)`, kind: "twitch", ref: name.toLowerCase() };
  }
  let id = "";
  if (host === "youtu.be") id = parts[0] ?? "";
  else if (host === "youtube.com") {
    if (parts[0] === "watch") id = url.searchParams.get("v") ?? "";
    else if ((parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts") && parts[1]) id = parts[1];
  }
  if (!YOUTUBE_ID.test(id)) return null;
  return { id: `youtube:${id}`, name: "YouTube", kind: "youtube", ref: id };
}

/** The player to embed for a channel. Twitch wants the embedding page's host name. */
export function embedUrl(channel: Channel, host: string): string {
  if (channel.kind === "twitch") {
    const parent = encodeURIComponent(host || "localhost");
    return `https://player.twitch.tv/?channel=${encodeURIComponent(channel.ref)}&parent=${parent}&autoplay=true&muted=false`;
  }
  return `https://www.youtube.com/embed/${encodeURIComponent(channel.ref)}?autoplay=1&playsinline=1`;
}

/** The channel's own page, to watch it outside Forge. */
export function watchUrl(channel: Channel): string {
  return channel.kind === "twitch" ? `https://www.twitch.tv/${channel.ref}` : `https://www.youtube.com/watch?v=${channel.ref}`;
}

/** Every channel: the built-in ones first, then the person's own (no duplicates). */
export function channelsWith(custom: Channel[]): Channel[] {
  const seen = new Set(BUILT_IN.map((c) => c.id));
  return [...BUILT_IN, ...custom.filter((c) => !seen.has(c.id) && seen.add(c.id)).map((c) => ({ ...c, custom: true }))];
}

/** Where the TV stands in the lab: to the left of where you start, facing you. */
const AT = { x: -3, z: 1.6 };
const START = { x: 0.15, z: -2.2 };

export function makeTv(id: number): Entity {
  return {
    id,
    name: "TV",
    transform: { position: { x: AT.x, y: 0, z: AT.z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
    representation: { kind: "mesh", assetId: TV_TAG },
    physics: null,
    tags: [TV_TAG, "fixture"],
    customData: {
      role: "tv",
      on: "0",
      channel: "0",
      yaw: String(Math.round(Math.atan2(START.x - AT.x, START.z - AT.z) * 1000) / 1000),
      note: "Interdimensional cable. Turn it on; change channel; add your own.",
    },
  };
}

export function tvOf(world: Pick<World, "entities">): Entity | undefined {
  return Object.values(world.entities).find((e) => e.tags.includes(TV_TAG));
}

/** Put the TV in the lab, once. */
export function ensureTv<W extends Pick<World, "entities" | "nextId">>(world: W): W {
  if (tvOf(world)) return world;
  const tv = makeTv(world.nextId);
  return { ...world, entities: { ...world.entities, [tv.id]: tv }, nextId: world.nextId + 1 };
}

function withTv<W extends Pick<World, "entities">>(world: W, change: (tv: Entity) => Record<string, string>): W {
  const tv = tvOf(world);
  if (!tv) return world;
  return { ...world, entities: { ...world.entities, [tv.id]: { ...tv, customData: { ...tv.customData, ...change(tv) } } } };
}

export const tvIsOn = (tv: Entity | undefined) => tv?.customData.on === "1";
export const tvChannel = (tv: Entity | undefined, count: number) => {
  const n = Number(tv?.customData.channel) || 0;
  return count > 0 ? ((n % count) + count) % count : 0;
};

export function setTvOn<W extends Pick<World, "entities">>(world: W, on: boolean): W {
  return withTv(world, () => ({ on: on ? "1" : "0" }));
}

/** Change channel by `step` (wraps around), or jump to `index` when given. */
export function switchChannel<W extends Pick<World, "entities">>(world: W, count: number, step: number, index?: number): W {
  return withTv(world, (tv) => ({ channel: String(index ?? tvChannel(tv, count) + step), on: "1" }));
}

/** Metres from the avatar to the TV, along the ground. Infinity when either is missing. */
export function tvDistance(world: Pick<World, "entities">): number {
  const tv = tvOf(world);
  const me = Object.values(world.entities).find((e) => e.tags.includes("architect"));
  if (!tv || !me) return Infinity;
  return Math.hypot(tv.transform.position.x - me.transform.position.x, tv.transform.position.z - me.transform.position.z);
}

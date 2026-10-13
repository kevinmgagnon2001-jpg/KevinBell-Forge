import { i as __toESM } from "../_runtime.mjs";
import { a as isLearning, c as wantsAsset, i as fieldQuery, l as wantsWeb, n as allowedAssetUrl, o as isRefusal, r as codeFromText, s as localTexture } from "./research-pk8zIg5V.mjs";
import { _ as require_jsx_runtime, v as require_react } from "../_libs/@react-three/drei+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { t as create } from "../_libs/zustand.mjs";
import { a as Pause, i as Play, n as SkipForward, r as RotateCcw } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CZadCkxY.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
function v(x, y, z) {
	const len = Math.hypot(x, y, z) || 1;
	return {
		x: x / len,
		y: y / len,
		z: z / len
	};
}
function mid(a, b) {
	return v(a.x + b.x, a.y + b.y, a.z + b.z);
}
function icosahedron() {
	const t = (1 + Math.sqrt(5)) / 2;
	const verts = [
		v(-1, t, 0),
		v(1, t, 0),
		v(-1, -t, 0),
		v(1, -t, 0),
		v(0, -1, t),
		v(0, 1, t),
		v(0, -1, -t),
		v(0, 1, -t),
		v(t, 0, -1),
		v(t, 0, 1),
		v(-t, 0, -1),
		v(-t, 0, 1)
	];
	return [
		[
			0,
			11,
			5
		],
		[
			0,
			5,
			1
		],
		[
			0,
			1,
			7
		],
		[
			0,
			7,
			10
		],
		[
			0,
			10,
			11
		],
		[
			1,
			5,
			9
		],
		[
			5,
			11,
			4
		],
		[
			11,
			10,
			2
		],
		[
			10,
			7,
			6
		],
		[
			7,
			1,
			8
		],
		[
			3,
			9,
			4
		],
		[
			3,
			4,
			2
		],
		[
			3,
			2,
			6
		],
		[
			3,
			6,
			8
		],
		[
			3,
			8,
			9
		],
		[
			4,
			9,
			5
		],
		[
			2,
			4,
			11
		],
		[
			6,
			2,
			10
		],
		[
			8,
			6,
			7
		],
		[
			9,
			8,
			1
		]
	].map(([a, b, c]) => [
		verts[a],
		verts[b],
		verts[c]
	]);
}
function octahedron() {
	const p = [
		v(1, 0, 0),
		v(-1, 0, 0),
		v(0, 1, 0),
		v(0, -1, 0),
		v(0, 0, 1),
		v(0, 0, -1)
	];
	return [
		[
			0,
			2,
			4
		],
		[
			4,
			2,
			1
		],
		[
			1,
			2,
			5
		],
		[
			5,
			2,
			0
		],
		[
			0,
			4,
			3
		],
		[
			4,
			1,
			3
		],
		[
			1,
			5,
			3
		],
		[
			5,
			0,
			3
		]
	].map(([a, b, c]) => [
		p[a],
		p[b],
		p[c]
	]);
}
/** Four children per face, in parent order, so a group of four tiles that face. */
function subdivide(tris) {
	const cache = /* @__PURE__ */ new Map();
	const point = (a, b) => {
		const ka = `${a.x.toFixed(5)},${a.y.toFixed(5)},${a.z.toFixed(5)}`;
		const kb = `${b.x.toFixed(5)},${b.y.toFixed(5)},${b.z.toFixed(5)}`;
		const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
		const hit = cache.get(key);
		if (hit) return hit;
		const next = mid(a, b);
		cache.set(key, next);
		return next;
	};
	const out = [];
	for (const [a, b, c] of tris) {
		const ab = point(a, b);
		const bc = point(b, c);
		const ca = point(c, a);
		out.push([
			a,
			ab,
			ca
		], [
			b,
			bc,
			ab
		], [
			c,
			ca,
			bc
		], [
			ab,
			bc,
			ca
		]);
	}
	return out;
}
function triArray(tri) {
	const [a, b, c] = tri;
	return Float32Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}
function bounds(tris) {
	let x = 0;
	let y = 0;
	let z = 0;
	let n = 0;
	for (const tri of tris) for (let i = 0; i < 9; i += 3) {
		x += tri[i];
		y += tri[i + 1];
		z += tri[i + 2];
		n += 1;
	}
	const center = {
		x: x / n,
		y: y / n,
		z: z / n
	};
	let radius = 0;
	for (const tri of tris) for (let i = 0; i < 9; i += 3) radius = Math.max(radius, Math.hypot(tri[i] - center.x, tri[i + 1] - center.y, tri[i + 2] - center.z));
	return {
		center,
		radius
	};
}
function pack(tris) {
	const out = new Float32Array(tris.length * 9);
	tris.forEach((tri, index) => out.set(tri, index * 9));
	return out;
}
function nodeFrom(id, tris, children, error, depth) {
	const box = bounds(tris);
	return {
		id,
		children,
		center: box.center,
		radius: box.radius,
		error,
		depth,
		triangles: pack(tris)
	};
}
/**
* One root. Leaves are the subdiv-2 icosphere (320 tris) in clusters of 4.
* The next cut is those parent faces (80), then the icosahedron (20), then an octahedron.
*/
function buildClusterDag() {
	const coarse = icosahedron();
	const mid = subdivide(coarse);
	const fine = subdivide(mid);
	const nodes = [];
	for (let i = 0; i < mid.length; i += 1) nodes.push(nodeFrom(i, fine.slice(i * 4, i * 4 + 4).map(triArray), [], 0, 0));
	const midStart = nodes.length;
	for (let i = 0; i < mid.length; i += 1) nodes.push(nodeFrom(nodes.length, [triArray(mid[i])], [i], .0022, 1));
	const coarseStart = nodes.length;
	for (let i = 0; i < coarse.length; i += 1) {
		const children = [
			0,
			1,
			2,
			3
		].map((k) => midStart + i * 4 + k);
		nodes.push(nodeFrom(nodes.length, [triArray(coarse[i])], children, .0055, 2));
	}
	const root = nodes.length;
	nodes.push(nodeFrom(root, octahedron().map(triArray), coarse.map((_, i) => coarseStart + i), .02, 3));
	return {
		nodes,
		root,
		leafTriangles: fine.length
	};
}
/** pixels of geometric error. meshoptimizer's perspective projection, height in pixels. */
function projectError(worldError, distance, radius, fovY, screenHeight) {
	const dist = Math.max(distance - radius, .05);
	const tan = Math.tan(fovY * Math.PI / 360);
	return screenHeight * worldError / (dist * 2 * tan);
}
var DEPTH_COLOR = [
	[
		.49,
		.88,
		.78
	],
	[
		.42,
		.68,
		.9
	],
	[
		.83,
		.64,
		.29
	],
	[
		.88,
		.45,
		.32
	]
];
function faceNormal(tri, offset) {
	const ax = tri[offset + 3] - tri[offset];
	const ay = tri[offset + 4] - tri[offset + 1];
	const az = tri[offset + 5] - tri[offset + 2];
	const bx = tri[offset + 6] - tri[offset];
	const by = tri[offset + 7] - tri[offset + 1];
	const bz = tri[offset + 8] - tri[offset + 2];
	const nx = ay * bz - az * by;
	const ny = az * bx - ax * bz;
	const nz = ax * by - ay * bx;
	const len = Math.hypot(nx, ny, nz) || 1;
	return [
		nx / len,
		ny / len,
		nz / len
	];
}
function selectCut(dag, camera, fovY, screenHeight, thresholdPx = 1) {
	const chosen = [];
	const visit = (id) => {
		const node = dag.nodes[id];
		const distance = Math.hypot(camera.x - node.center.x, camera.y - node.center.y, camera.z - node.center.z);
		const pixels = projectError(node.error, distance, node.radius, fovY, screenHeight);
		if (!node.children.length || pixels <= thresholdPx) {
			chosen.push(id);
			return;
		}
		for (const child of node.children) visit(child);
	};
	visit(dag.root);
	let triangles = 0;
	for (const id of chosen) triangles += dag.nodes[id].triangles.length / 9;
	const positions = new Float32Array(triangles * 9);
	const normals = new Float32Array(triangles * 9);
	const colors = new Float32Array(triangles * 9);
	let cursor = 0;
	for (const id of chosen) {
		const node = dag.nodes[id];
		const tint = DEPTH_COLOR[Math.min(DEPTH_COLOR.length - 1, node.depth)];
		positions.set(node.triangles, cursor);
		for (let i = 0; i < node.triangles.length; i += 9) {
			const [nx, ny, nz] = faceNormal(node.triangles, i);
			for (let k = 0; k < 3; k += 1) {
				normals[cursor + i + k * 3] = nx;
				normals[cursor + i + k * 3 + 1] = ny;
				normals[cursor + i + k * 3 + 2] = nz;
				colors[cursor + i + k * 3] = tint[0];
				colors[cursor + i + k * 3 + 1] = tint[1];
				colors[cursor + i + k * 3 + 2] = tint[2];
			}
		}
		cursor += node.triangles.length;
	}
	return {
		key: chosen.join("."),
		triangles,
		positions,
		normals,
		colors
	};
}
var cached$1 = null;
function clusterDag() {
	cached$1 ??= buildClusterDag();
	return cached$1;
}
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var researchTask = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("bad input");
	const raw = input;
	const query = typeof raw.query === "string" ? raw.query.trim().slice(0, 400) : "";
	if (!query) throw new Error("query required");
	return {
		query,
		failure: typeof raw.failure === "string" ? raw.failure.trim().slice(0, 400) : ""
	};
}).handler(createSsrRpc("2b00fd7dca651977a83da2bc1f00ed207038cc02f725231a47cd03b14b473166"));
var fetchAsset = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("bad input");
	const url = typeof input.url === "string" ? input.url.trim() : "";
	if (!allowedAssetUrl(url)) throw new Error("url not allowed");
	return { url };
}).handler(createSsrRpc("178dddf1976314abd569e78348a53987a33a8fa85ff528baf6ff780d3ce87a94"));
var NAMED_COLORS = [
	{
		name: "red",
		hex: "#e15a4a"
	},
	{
		name: "orange",
		hex: "#e0863a"
	},
	{
		name: "amber",
		hex: "#e2b340"
	},
	{
		name: "yellow",
		hex: "#e6d15c"
	},
	{
		name: "green",
		hex: "#3cba6f"
	},
	{
		name: "teal",
		hex: "#2fbfc2"
	},
	{
		name: "blue",
		hex: "#4c8df5"
	},
	{
		name: "indigo",
		hex: "#6d6ef5"
	},
	{
		name: "violet",
		hex: "#a06bf0"
	},
	{
		name: "pink",
		hex: "#e36aa8"
	},
	{
		name: "white",
		hex: "#f2f3f5"
	},
	{
		name: "black",
		hex: "#2a2c31"
	},
	{
		name: "gray",
		hex: "#9aa3af"
	},
	{
		name: "stone",
		hex: "#8a8178"
	},
	{
		name: "gold",
		hex: "#d4a24a"
	}
];
var BY_NAME = new Map(NAMED_COLORS.map((color) => [color.name, color.hex]));
function normalizeColor(value) {
	if (!value) return null;
	const text = value.trim().toLowerCase();
	if (!text) return null;
	if (text === "grey") return BY_NAME.get("gray") ?? null;
	if (text === "purple") return BY_NAME.get("violet") ?? null;
	const named = BY_NAME.get(text);
	if (named) return named;
	const hex = text.startsWith("#") ? text : "";
	if (/^#[0-9a-f]{3}$/.test(hex) || /^#[0-9a-f]{6}$/.test(hex)) return hex;
	return null;
}
function colorName(hex) {
	if (!hex) return "none";
	return NAMED_COLORS.find((color) => color.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;
}
function hexRgb(hex) {
	let body = hex.trim().replace(/^#/, "");
	if (body.length === 3) body = body.split("").map((char) => char + char).join("");
	if (!/^[0-9a-f]{6}$/i.test(body)) return null;
	return [
		Number.parseInt(body.slice(0, 2), 16),
		Number.parseInt(body.slice(2, 4), 16),
		Number.parseInt(body.slice(4, 6), 16)
	];
}
/** Closest palette name, so a Tetris yellow that is not an exact swatch still has a name. */
function nearestColorName(hex) {
	const exact = colorName(hex);
	if (exact !== "none" && !exact.startsWith("#")) return exact;
	const rgb = hexRgb(hex ?? "");
	if (!rgb) return "none";
	let best = "none";
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const color of NAMED_COLORS) {
		const other = hexRgb(color.hex);
		if (!other) continue;
		const distance = (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = color.name;
		}
	}
	return best;
}
function huesMatch(hex, word) {
	return (HUE[canonicalColor(word)] ?? [canonicalColor(word)]).includes(nearestColorName(hex));
}
var COLOR_RE = /\b(red|orange|amber|yellow|green|teal|blue|indigo|violet|purple|pink|white|black|gray|grey|gold)\b/gi;
/** Words a person treats as the same color. Tetris amber still answers to yellow or gold. */
var HUE = {
	red: ["red"],
	orange: ["orange", "amber"],
	amber: [
		"amber",
		"gold",
		"yellow",
		"orange"
	],
	yellow: [
		"yellow",
		"gold",
		"amber"
	],
	gold: [
		"gold",
		"yellow",
		"amber"
	],
	green: ["green"],
	teal: ["teal"],
	blue: ["blue", "indigo"],
	indigo: [
		"indigo",
		"blue",
		"violet"
	],
	violet: [
		"violet",
		"indigo",
		"pink"
	],
	pink: [
		"pink",
		"violet",
		"red"
	],
	white: ["white"],
	black: ["black"],
	gray: ["gray", "stone"],
	stone: ["stone", "gray"]
};
function canonicalColor(word) {
	const lower = word.toLowerCase();
	if (lower === "grey") return "gray";
	if (lower === "purple") return "violet";
	return lower;
}
function colorMentions(intent) {
	COLOR_RE.lastIndex = 0;
	return [...intent.matchAll(COLOR_RE)].map((match) => canonicalColor(match[1]));
}
function colorWord(intent) {
	const matches = colorMentions(intent);
	if (!matches.length) return null;
	return normalizeColor(/\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent) ? matches[matches.length - 1] : matches[0]);
}
function autoColor(id, asset) {
	if (asset === "platform") return "#8a8178";
	const vivid = NAMED_COLORS.filter((color) => ![
		"black",
		"gray",
		"white",
		"stone"
	].includes(color.name));
	return vivid[Math.abs(id) % vivid.length]?.hex ?? "#4c8df5";
}
var IDENTITY = {
	x: 0,
	y: 0,
	z: 0,
	w: 1
};
var V3 = (x = 0, y = 0, z = 0) => ({
	x,
	y,
	z
});
var ENGINE_VERSION = "0.1.0";
var GROK_MODEL = "grok-4.5";
var GRAVITY = -9.81;
var DELTA_TIME = 1 / 60;
function createAvatar() {
	return {
		id: 1,
		name: "ArchitectAvatar",
		transform: {
			position: V3(0, 1, 0),
			rotation: { ...IDENTITY },
			scale: V3(1, 1, 1)
		},
		representation: {
			kind: "hybrid",
			meshId: "avatar_body",
			gsId: "avatar_detail"
		},
		physics: null,
		tags: ["avatar", "architect"],
		customData: {
			color: "#d7b899",
			role: "you",
			yaw: "0"
		}
	};
}
function emptyWorld() {
	return {
		entities: {},
		nextId: 1,
		tick: 0,
		gravity: GRAVITY,
		deltaTime: DELTA_TIME,
		eventLog: [],
		events: [],
		undo: [],
		skills: [],
		compat: []
	};
}
function bootWorld() {
	const avatar = createAvatar();
	return {
		...emptyWorld(),
		entities: { [avatar.id]: avatar },
		nextId: avatar.id + 1
	};
}
function sized(entity, x, y, z, sx, sy, sz) {
	return {
		...entity,
		transform: {
			...entity.transform,
			position: V3(x, y, z),
			scale: V3(sx, sy, sz)
		}
	};
}
function withYaw(entity, yaw) {
	return {
		...entity,
		customData: {
			...entity.customData,
			yaw: String(yaw)
		}
	};
}
/**
* The opening room. Every prop is a real entity, so the forge can edit it.
* One neural sample is the splat exhibit. Everything else is solid.
*/
function labWorld() {
	const avatar = withYaw({
		...createAvatar(),
		tags: [
			"avatar",
			"architect",
			"lab"
		],
		transform: {
			...createAvatar().transform,
			position: V3(.15, .78, -2.2)
		}
	}, 0);
	const make = (id, args, x, y, z, sx, sy, sz) => sized(makeSpawned(id, args), x, y, z, sx, sy, sz);
	const deck = make(2, {
		name: "LabDeck",
		asset: "platform",
		color: "#2c313a",
		tags: "lab,fixture,floor",
		kinematic: "true",
		physics: "true"
	}, 0, .08, .4, 12, .16, 9);
	const bench = make(3, {
		name: "Bench",
		asset: "platform",
		color: "#1c2128",
		tags: "lab,fixture,desk",
		kinematic: "true",
		physics: "true"
	}, .15, .36, 4.15, 2.8, .56, 1.15);
	const terminal = make(4, {
		name: "ForgeTerminal",
		asset: "card",
		color: "#10141a",
		tags: "lab,terminal,fixture"
	}, .15, 1.18, 3.72, 1.25, .86, .08);
	terminal.customData = {
		...terminal.customData,
		role: "terminal",
		note: "This screen is the live manifold."
	};
	const clay = make(5, {
		name: "Clay",
		asset: "cube",
		color: "#c46a4a",
		tags: "lab,exhibit,material",
		kinematic: "true",
		physics: "true"
	}, -4.7, .52, -1.7, .72, .72, .72);
	const steel = make(6, {
		name: "Steel",
		asset: "cube",
		color: "#d5d8de",
		tags: "lab,exhibit,material",
		kinematic: "true",
		physics: "true"
	}, -4.7, .52, .15, .72, .72, .72);
	const gold = make(7, {
		name: "Gold",
		asset: "cube",
		color: "#d4a24a",
		tags: "lab,exhibit,material",
		kinematic: "true",
		physics: "true"
	}, -4.7, .52, 2.05, .72, .72, .72);
	const column = make(8, {
		name: "Column",
		asset: "pillar",
		color: "#9aa3af",
		tags: "lab,exhibit,shape",
		kinematic: "true",
		physics: "true"
	}, 4.55, 1.28, -2.15, .42, 2.4, .42);
	const sample = make(9, {
		name: "Sample",
		asset: "sphere",
		color: "#6ea2e0",
		tags: "lab,exhibit,shape",
		kinematic: "true",
		physics: "true"
	}, 4.9, .56, .35, .78, .78, .78);
	const halo = make(10, {
		name: "Halo",
		asset: "ring",
		color: "#e7e2da",
		tags: "lab,exhibit,shape",
		kinematic: "true",
		physics: "true"
	}, 4.35, 1.15, 2.55, 1.05, 1.05, 1.05);
	const pad = make(11, {
		name: "DropPad",
		asset: "platform",
		color: "#3a3f48",
		tags: "lab,exhibit,physics",
		kinematic: "true",
		physics: "true"
	}, -1.55, .14, -2.35, 1.6, .12, 1.6);
	const orb = make(12, {
		name: "DropOrb",
		asset: "sphere",
		color: "#f0d48a",
		tags: "lab,exhibit,physics",
		physics: "true"
	}, -1.55, 2.35, -2.35, .7, .7, .7);
	const neural = make(13, {
		name: "NeuralBay",
		asset: "gaussian",
		color: "#9fd4d6",
		tags: "lab,exhibit,neural"
	}, 1.7, 1.25, -2.7, 1, 1, 1);
	neural.customData = {
		...neural.customData,
		neural: "splat",
		palette: "#d5e7f7,#7eb6e8,#4c8df5,#1d4e89",
		seed: "11",
		count: "220",
		shape: "column"
	};
	const entities = [
		avatar,
		deck,
		bench,
		terminal,
		clay,
		steel,
		gold,
		column,
		sample,
		halo,
		pad,
		orb,
		neural,
		makeHelm(14, avatar)
	];
	return {
		...emptyWorld(),
		entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
		nextId: 15
	};
}
/** The wearable computer. It stays on the architect's head. */
function makeHelm(id, anchor) {
	const yaw = Number(anchor?.customData.yaw) || 0;
	const p = anchor?.transform.position ?? {
		x: .15,
		y: .78,
		z: -2.2
	};
	const faceX = Math.sin(yaw);
	const faceZ = Math.cos(yaw);
	const helm = sized(makeSpawned(id, {
		name: "Helm",
		asset: "helm",
		color: "#d4a24a",
		tags: "lab,helm,terminal,worn"
	}), p.x + faceX * .16, p.y + .62, p.z + faceZ * .16, 1, 1, 1);
	helm.customData = {
		...helm.customData,
		role: "terminal",
		note: "Visor. The helm is the computer worn by the architect.",
		yaw: String(yaw)
	};
	return helm;
}
function ensureHelm(world) {
	if (Object.values(world.entities).some((entity) => entity.tags.includes("helm"))) return seatArchitect(world);
	const avatar = Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
	const helm = makeHelm(world.nextId, avatar);
	return seatArchitect({
		...world,
		nextId: world.nextId + 1,
		entities: {
			...world.entities,
			[helm.id]: helm
		}
	});
}
function finite$1(value) {
	return Number.isFinite(value);
}
/**
* The body must always exist and sit at a real position. A saved world can lose it,
* or carry NaN from a bad frame. Without a body the pilot has nothing to follow, so
* third person shows no avatar and first person never gets a camera.
*/
function ensureAvatar(world) {
	const existing = Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
	if (!existing) {
		const seed = Object.values(labWorld().entities).find((entity) => entity.tags.includes("architect"));
		if (!seed) return world;
		const id = world.nextId;
		return {
			...world,
			nextId: id + 1,
			entities: {
				...world.entities,
				[id]: {
					...seed,
					id
				}
			}
		};
	}
	const p = existing.transform.position;
	if (finite$1(p.x) && finite$1(p.y) && finite$1(p.z)) return world;
	return {
		...world,
		entities: {
			...world.entities,
			[existing.id]: withYaw({
				...existing,
				transform: {
					...existing.transform,
					position: V3(.15, .78, -2.2)
				}
			}, 0)
		}
	};
}
/** Put the body on the deck, facing the exhibits, and bring back any opening prop that was lost. */
function restoreLab(input) {
	const world = ensureHelm(ensureAvatar(input));
	const fresh = labWorld();
	const names = new Set(Object.values(world.entities).map((entity) => entity.name));
	let nextId = world.nextId;
	const entities = { ...world.entities };
	for (const entity of Object.values(fresh.entities)) {
		if (entity.tags.includes("architect") || names.has(entity.name)) continue;
		entities[nextId] = {
			...entity,
			id: nextId
		};
		nextId += 1;
	}
	const avatar = Object.values(entities).find((entity) => entity.tags.includes("architect"));
	if (avatar) entities[avatar.id] = withYaw({
		...avatar,
		transform: {
			...avatar.transform,
			position: V3(.15, .78, -2.2)
		}
	}, 0);
	const helm = Object.values(entities).find((entity) => entity.tags.includes("helm"));
	if (helm) entities[helm.id] = {
		...helm,
		transform: {
			...helm.transform,
			position: V3(.15, 1.4, -2.04)
		},
		customData: {
			...helm.customData,
			yaw: "0"
		}
	};
	return {
		...world,
		entities,
		nextId
	};
}
function seatArchitect(world) {
	const avatar = Object.values(world.entities).find((entity) => entity.tags.includes("architect"));
	if (!avatar) return world;
	const p = avatar.transform.position;
	const yaw = Number(avatar.customData.yaw) || 0;
	const oldRim = Math.hypot(p.x + 2.2, p.z - 2.05) < 1.2 && Math.abs(yaw - .35) < .4;
	const offDeck = Math.abs(p.x) > 5.6 || p.z < -4.2 || p.z > 4.6 || p.y > 4.5 || p.y < .3;
	if (!oldRim && !offDeck) return world;
	const next = withYaw({
		...avatar,
		transform: {
			...avatar.transform,
			position: V3(.15, .78, -2.2)
		}
	}, 0);
	const entities = {
		...world.entities,
		[avatar.id]: next
	};
	const helm = Object.values(entities).find((entity) => entity.tags.includes("helm"));
	if (helm) entities[helm.id] = {
		...helm,
		transform: {
			...helm.transform,
			position: V3(.15, 1.4, -2.04)
		},
		customData: {
			...helm.customData,
			yaw: "0"
		}
	};
	return {
		...world,
		entities
	};
}
function num(value, fallback) {
	if (value == null || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
function defaultScale(asset) {
	switch (asset) {
		case "platform": return V3(3.2, .16, 3.2);
		case "pillar": return V3(.42, 2.4, .42);
		case "sphere": return V3(.8, .8, .8);
		case "ring": return V3(1.15, 1.15, 1.15);
		case "gaussian": return V3(1, 1, 1);
		case "card": return V3(1.15, 1.35, .08);
		case "gem":
		case "crystal": return V3(.85, .85, .85);
		case "knot": return V3(.9, .9, .9);
		case "vase": return V3(.9, 1.15, .9);
		default: return V3(1, 1, 1);
	}
}
function defaultName(asset) {
	switch (asset) {
		case "platform": return "Platform";
		case "gaussian": return "Splat";
		case "pillar": return "Pillar";
		case "sphere": return "Sphere";
		case "ring": return "Ring";
		case "card": return "Card";
		case "helm": return "Helm";
		case "gem": return "Gem";
		case "knot": return "Knot";
		case "vase": return "Vase";
		case "crystal": return "Crystal";
		default: return "Cube";
	}
}
/** Sit a y=0 spawn on the grid instead of burying its center. */
function presentY(asset, scale, y) {
	if (Math.abs(y) > 1e-6) return y;
	if (asset === "gaussian") return 1.2;
	if (asset === "ring") return .85;
	if (asset === "card") return .78;
	if (asset === "vase") return .7;
	return scale.y / 2;
}
function representationFor(asset, name) {
	if (asset === "gaussian") return {
		kind: "gaussian",
		proxyId: name.toLowerCase(),
		particleCount: 280
	};
	return {
		kind: "mesh",
		assetId: asset
	};
}
function restyle(entity, asset) {
	return {
		...entity,
		representation: representationFor(asset, entity.name),
		transform: {
			...entity.transform,
			scale: defaultScale(asset)
		}
	};
}
var STEP = .7;
/** Walk or turn a body. Forward follows its yaw, so left and right stay consistent. */
function steer(entity, move) {
	let yaw = Number(entity.customData.yaw) || 0;
	if (move === "turn-left") yaw += .45;
	if (move === "turn-right") yaw -= .45;
	const fx = Math.sin(yaw);
	const fz = Math.cos(yaw);
	const p = entity.transform.position;
	let x = p.x;
	let y = p.y;
	let z = p.z;
	if (move === "forward") {
		x += fx * STEP;
		z += fz * STEP;
	} else if (move === "back") {
		x -= fx * STEP;
		z -= fz * STEP;
	} else if (move === "left") {
		x -= fz * STEP;
		z += fx * STEP;
	} else if (move === "right") {
		x += fz * STEP;
		z -= fx * STEP;
	} else if (move === "up") y += .45;
	else if (move === "down") y = Math.max(.4, y - .45);
	return {
		...entity,
		transform: {
			...entity.transform,
			position: {
				x,
				y,
				z
			}
		},
		customData: {
			...entity.customData,
			yaw: String(Math.round(yaw * 1e3) / 1e3)
		}
	};
}
function createAgent(id, name, role, slot) {
	const angle = -.4 + slot * .7;
	const tint = role === "critic" ? "#c4b5fd" : role === "scout" ? "#86efac" : "#93c5fd";
	return {
		id,
		name,
		transform: {
			position: V3(Math.cos(angle) * 1.8 - .4, .78, Math.sin(angle) * 1.4 + 1.4),
			rotation: { ...IDENTITY },
			scale: V3(.92, .92, .92)
		},
		representation: {
			kind: "hybrid",
			meshId: "agent_body",
			gsId: "agent_detail"
		},
		physics: null,
		tags: ["agent", role],
		customData: {
			color: tint,
			role,
			yaw: "0"
		}
	};
}
function makeSpawned(id, args) {
	const asset = (args.asset || "cube").trim() || "cube";
	const name = (args.name || "").trim() || defaultName(asset);
	const scale = defaultScale(asset);
	const requestedY = num(args.y, 0);
	const physicsOn = args.physics === "true";
	const tags = args.tags ? args.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : ["spawned", asset];
	const physics = physicsOn ? {
		mass: num(args.mass, 1),
		velocity: V3(num(args.vx, 0), num(args.vy, 0), num(args.vz, 0)),
		angularVelocity: V3(),
		isKinematic: args.kinematic === "true",
		solver: (args.solver || "rigid").trim() || "rigid"
	} : null;
	const color = normalizeColor(args.color) ?? autoColor(id, asset);
	return {
		id,
		name,
		transform: {
			position: V3(num(args.x, 0), presentY(asset, scale, requestedY), num(args.z, 0)),
			rotation: { ...IDENTITY },
			scale
		},
		representation: representationFor(asset, name),
		physics,
		tags: tags.length ? tags : ["spawned"],
		customData: { color }
	};
}
function assetKind(entity) {
	if (entity.representation.kind === "mesh") return entity.representation.assetId;
	if (entity.representation.kind === "gaussian") return "gaussian";
	return entity.representation.kind;
}
/** Default 0,0,0 and 0,1,0 spawns stack in the middle of a platform. */
function piledOnCenter(args) {
	const x = num(args.x, 0);
	const y = num(args.y, 0);
	const z = num(args.z, 0);
	if (Math.hypot(x, z) > .2) return false;
	return Math.abs(y) < .2 || Math.abs(y - 1) < .2;
}
function seatOffCenter(world, entity, args) {
	if (assetKind(entity) === "platform" || entity.tags.includes("architect")) return entity;
	if (!piledOnCenter(args)) return entity;
	const host = Object.values(world.entities).filter((item) => assetKind(item) === "platform")[0];
	if (!host) return entity;
	const taken = Object.values(world.entities).filter((item) => !item.tags.includes("architect") && assetKind(item) !== "platform");
	const half = Math.min(host.transform.scale.x, host.transform.scale.z) / 2;
	const radius = Math.max(.75, half * .62);
	const angle = taken.length * 2.399963;
	const deck = host.transform.position.y + host.transform.scale.y / 2;
	return {
		...entity,
		transform: {
			...entity.transform,
			position: {
				x: host.transform.position.x + Math.cos(angle) * radius,
				y: Math.max(entity.transform.position.y, deck + entity.transform.scale.y / 2),
				z: host.transform.position.z + Math.sin(angle) * radius
			}
		}
	};
}
function deckUnder(entity, others) {
	const p = entity.transform.position;
	let best = null;
	for (const other of others) {
		if (other.id === entity.id) continue;
		if (assetKind(other) !== "platform") continue;
		const op = other.transform.position;
		const os = other.transform.scale;
		const top = op.y + os.y / 2;
		if (Math.abs(p.x - op.x) > os.x / 2 + .35) continue;
		if (Math.abs(p.z - op.z) > os.z / 2 + .35) continue;
		if (p.y + .35 < top) continue;
		if (!best || top > best.top) best = {
			top,
			slide: other.customData.slide || ""
		};
	}
	return best;
}
function floorY(entity) {
	return Math.max(.02, entity.transform.scale.y / 2);
}
function integrate(entity, dt, gravity, others = []) {
	const phys = entity.physics;
	if (!phys || phys.isKinematic) return entity;
	const deck = deckUnder(entity, others);
	const velocity = {
		x: phys.velocity.x,
		y: phys.velocity.y + gravity * dt,
		z: phys.velocity.z
	};
	if (deck?.slide) {
		const [sx, sz] = deck.slide.split(",").map((part) => Number(part.trim()));
		if (Number.isFinite(sx)) velocity.x = sx;
		if (Number.isFinite(sz)) velocity.z = sz;
	}
	const p = entity.transform.position;
	let y = p.y + velocity.y * dt;
	const floor = Math.max(floorY(entity), deck ? deck.top + entity.transform.scale.y / 2 : 0);
	if (y < floor) {
		y = floor;
		if (velocity.y < 0) velocity.y = 0;
	}
	return {
		...entity,
		physics: {
			...phys,
			velocity
		},
		transform: {
			...entity.transform,
			position: {
				x: p.x + velocity.x * dt,
				y,
				z: p.z + velocity.z * dt
			}
		}
	};
}
function stepWorld(world, count = 1) {
	const steps = Math.max(0, Math.min(240, count));
	let current = world;
	for (let i = 0; i < steps; i += 1) {
		const bodies = Object.values(current.entities);
		const next = {};
		for (const entity of bodies) next[entity.id] = integrate(entity, current.deltaTime, current.gravity, bodies);
		current = {
			...current,
			entities: next,
			tick: current.tick + 1
		};
		if (current.tick % 28 === 0) current = playTetris(current, "down");
	}
	return current;
}
function queryByTag(entities, tag) {
	return Object.values(entities).filter((entity) => entity.tags.some((item) => item === tag)).sort((a, b) => a.id - b.id);
}
function recordEvent(world, msg) {
	const eventLog = [...world.eventLog, msg];
	if (eventLog.length > 256) eventLog.splice(0, 64);
	return {
		...world,
		eventLog
	};
}
var CELL = .36;
var COLS = 10;
var PIECES = [
	"I",
	"O",
	"T",
	"S",
	"Z",
	"J",
	"L"
];
var SHAPE = {
	O: [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1]
	],
	I: [
		[0, 0],
		[1, 0],
		[2, 0],
		[3, 0]
	],
	T: [
		[0, 0],
		[1, 0],
		[2, 0],
		[1, 1]
	],
	S: [
		[1, 0],
		[2, 0],
		[0, 1],
		[1, 1]
	],
	Z: [
		[0, 0],
		[1, 0],
		[1, 1],
		[2, 1]
	],
	J: [
		[1, 0],
		[1, 1],
		[1, 2],
		[0, 2]
	],
	L: [
		[0, 0],
		[0, 1],
		[0, 2],
		[1, 2]
	]
};
var PIECE_COLOR = {
	O: "#e2c14a",
	I: "#6ec8e0",
	T: "#b07ad6",
	S: "#6fbf73",
	Z: "#d65b5b",
	J: "#5b7fd6",
	L: "#e08a3c"
};
function isPiece(value) {
	return PIECES.includes(value);
}
function gridPos(originX, originZ, gx, gy) {
	return V3(originX + gx * CELL, .28 + gy * CELL, originZ);
}
function boardOf(world) {
	return Object.values(world.entities).find((entity) => entity.customData.play === "tetris");
}
function rngNext(state) {
	const x = state + 1831565813 >>> 0;
	let t = Math.imul(x ^ x >>> 15, x | 1);
	t ^= t + Math.imul(t ^ t >>> 7, t | 61);
	return {
		roll: ((t ^ t >>> 14) >>> 0) / 4294967296,
		state: x
	};
}
function takePiece(bag, seed) {
	let rest = bag.split("").filter(isPiece);
	let nextSeed = seed;
	if (!rest.length) {
		rest = [...PIECES];
		for (let i = rest.length - 1; i > 0; i -= 1) {
			const rolled = rngNext(nextSeed);
			nextSeed = rolled.state;
			const j = Math.floor(rolled.roll * (i + 1));
			const swap = rest[i];
			rest[i] = rest[j];
			rest[j] = swap;
		}
	}
	return {
		piece: rest[0] ?? "O",
		bag: rest.slice(1).join(""),
		seed: nextSeed
	};
}
function occupied(entities, gx, gy) {
	if (gx < 0 || gx >= COLS || gy < 0) return true;
	return Object.values(entities).some((entity) => {
		if (!entity.tags.includes("locked")) return false;
		return Number(entity.customData.gx) === gx && Number(entity.customData.gy) === gy;
	});
}
function placeLive(entity, originX, originZ, gx, gy) {
	return {
		...entity,
		customData: {
			...entity.customData,
			gx: String(gx),
			gy: String(gy)
		},
		transform: {
			...entity.transform,
			position: gridPos(originX, originZ, gx, gy)
		}
	};
}
function spawnPiece(entities, nextId, originX, originZ, piece) {
	const cells = SHAPE[piece].map(([dx, dy]) => [3 + dx, 12 + dy]);
	if (cells.some(([gx, gy]) => occupied(entities, gx, gy))) return {
		nextId,
		ok: false
	};
	let id = nextId;
	for (const [gx, gy] of cells) {
		const cube = makeSpawned(id, {
			name: "Piece",
			asset: "cube",
			color: PIECE_COLOR[piece],
			tags: "tetris,live"
		});
		entities[id] = {
			...cube,
			transform: {
				...cube.transform,
				position: gridPos(originX, originZ, gx, gy),
				scale: V3(CELL * .92, CELL * .92, CELL * .92)
			},
			customData: {
				...cube.customData,
				gx: String(gx),
				gy: String(gy),
				piece
			}
		};
		id += 1;
	}
	return {
		nextId: id,
		ok: true
	};
}
function liveCells(entities) {
	return Object.values(entities).filter((entity) => entity.tags.includes("live")).map((entity) => ({
		id: entity.id,
		gx: Number(entity.customData.gx),
		gy: Number(entity.customData.gy)
	}));
}
function fits(entities, cells) {
	return cells.every((cell) => !occupied(entities, cell.gx, cell.gy));
}
function writeCells(entities, cells, originX, originZ) {
	for (const cell of cells) {
		const entity = entities[cell.id];
		if (entity) entities[cell.id] = placeLive(entity, originX, originZ, cell.gx, cell.gy);
	}
}
function lockCells(entities, cells, originX, originZ) {
	for (const cell of cells) {
		const entity = entities[cell.id];
		if (!entity) continue;
		entities[cell.id] = {
			...placeLive(entity, originX, originZ, cell.gx, cell.gy),
			name: "Block",
			tags: entity.tags.filter((tag) => tag !== "live").concat("locked")
		};
	}
	let cleared = 0;
	for (let gy = 0; gy < 18; gy += 1) {
		const row = Object.values(entities).filter((entity) => entity.tags.includes("locked") && Number(entity.customData.gy) === gy);
		if (row.length < COLS) continue;
		cleared += 1;
		const gone = new Set(row.map((entity) => entity.id));
		for (const id of gone) delete entities[id];
		for (const entity of Object.values(entities)) {
			if (!entity.tags.includes("locked")) continue;
			const above = Number(entity.customData.gy);
			if (above > gy) entities[entity.id] = placeLive(entity, originX, originZ, Number(entity.customData.gx), above - 1);
		}
		gy -= 1;
	}
	return cleared;
}
function rotated(cells) {
	const cx = cells.reduce((sum, cell) => sum + cell.gx, 0) / cells.length;
	const cy = cells.reduce((sum, cell) => sum + cell.gy, 0) / cells.length;
	return cells.map((cell) => ({
		id: cell.id,
		gx: Math.round(cx - (cell.gy - cy)),
		gy: Math.round(cy + (cell.gx - cx))
	}));
}
function playTetris(world, move) {
	const board = boardOf(world);
	if (!board || board.customData.over === "1") return world;
	const originX = Number(board.customData.originX) || 5.55;
	const originZ = Number(board.customData.originZ) || 1.35;
	const entities = { ...world.entities };
	const nextId = world.nextId;
	const live = liveCells(entities);
	if (!live.length) {
		const drawn = takePiece(board.customData.bag || "", Number(board.customData.seed) || 1);
		const spawned = spawnPiece(entities, nextId, originX, originZ, drawn.piece);
		entities[board.id] = {
			...board,
			customData: {
				...board.customData,
				bag: drawn.bag,
				seed: String(drawn.seed),
				over: spawned.ok ? "" : "1"
			}
		};
		return {
			...world,
			entities,
			nextId: spawned.nextId
		};
	}
	const shift = (cells, dx, dy) => cells.map((cell) => ({
		...cell,
		gx: cell.gx + dx,
		gy: cell.gy + dy
	}));
	let next = live;
	if (move === "left") next = shift(live, -1, 0);
	if (move === "right") next = shift(live, 1, 0);
	if (move === "down" || move === "drop") next = shift(live, 0, -1);
	if (move === "rotate") {
		const spun = rotated(live);
		const kicked = [
			[0, 0],
			[-1, 0],
			[1, 0],
			[-2, 0],
			[2, 0],
			[0, 1]
		].map(([dx, dy]) => spun.map((cell) => ({
			...cell,
			gx: cell.gx + dx,
			gy: cell.gy + dy
		}))).find((cells) => fits(entities, cells));
		if (!kicked) return world;
		next = kicked;
	}
	if (move === "drop") {
		let falling = live;
		let guard = 0;
		while (guard < 24 && fits(entities, shift(falling, 0, -1))) {
			falling = shift(falling, 0, -1);
			guard += 1;
		}
		const lines = lockCells(entities, falling, originX, originZ);
		const drawn = takePiece(entities[board.id]?.customData.bag || board.customData.bag || "", Number(entities[board.id]?.customData.seed || board.customData.seed) || 1);
		const spawned = spawnPiece(entities, nextId, originX, originZ, drawn.piece);
		const fresh = entities[board.id] ?? board;
		const linesNow = Number(fresh.customData.lines) || 0;
		entities[board.id] = {
			...fresh,
			customData: {
				...fresh.customData,
				bag: drawn.bag,
				seed: String(drawn.seed),
				lines: String(linesNow + lines),
				over: spawned.ok ? "" : "1"
			}
		};
		return {
			...world,
			entities,
			nextId: spawned.nextId
		};
	}
	if (!fits(entities, next)) {
		if (move !== "down") return world;
		const lines = lockCells(entities, live, originX, originZ);
		const drawn = takePiece(board.customData.bag || "", Number(board.customData.seed) || 1);
		const spawned = spawnPiece(entities, nextId, originX, originZ, drawn.piece);
		const linesNow = Number(board.customData.lines) || 0;
		entities[board.id] = {
			...board,
			customData: {
				...board.customData,
				bag: drawn.bag,
				seed: String(drawn.seed),
				lines: String(linesNow + lines),
				over: spawned.ok ? "" : "1"
			}
		};
		return {
			...world,
			entities,
			nextId: spawned.nextId
		};
	}
	writeCells(entities, next, originX, originZ);
	return {
		...world,
		entities,
		nextId
	};
}
function withoutTag(world, tag) {
	const entities = {};
	for (const entity of Object.values(world.entities)) if (!entity.tags.includes(tag)) entities[entity.id] = entity;
	return {
		entities,
		nextId: world.nextId
	};
}
function buildTetris(world) {
	const fresh = withoutTag(world, "tetris");
	const entities = { ...fresh.entities };
	let id = fresh.nextId;
	const originX = 5.55;
	const originZ = 1.35;
	const board = sized(makeSpawned(id, {
		name: "Tetris",
		asset: "platform",
		color: "#1c2430",
		tags: "tetris,play,fixture",
		physics: "true",
		kinematic: "true"
	}), 7.17, .1, originZ, 3.9999999999999996, .16, .9);
	board.customData = {
		...board.customData,
		play: "tetris",
		originX: String(originX),
		originZ: String(originZ),
		bag: "OITSZJL",
		seed: "11",
		lines: "0"
	};
	entities[id] = board;
	id += 1;
	const wall = (name, x) => {
		const entity = sized(makeSpawned(id, {
			name,
			asset: "pillar",
			color: "#2a3342",
			tags: "tetris,fixture",
			physics: "true",
			kinematic: "true"
		}), x, 2.15, originZ, .16, 4.1, .7);
		entities[id] = entity;
		id += 1;
	};
	wall("WellLeft", originX - CELL * .85);
	wall("WellRight", 9.149999999999999 - CELL * .15);
	const spawned = spawnPiece(entities, id, originX, originZ, "O");
	return {
		...world,
		entities,
		nextId: spawned.nextId
	};
}
function buildMarble(world) {
	const fresh = withoutTag(world, "marble");
	const entities = { ...fresh.entities };
	let id = fresh.nextId;
	for (const pad of [
		{
			name: "StartRamp",
			x: -5.6,
			y: 2.05,
			z: 2.55,
			sx: 1.35,
			sz: 2.4,
			slide: "0,-1.7",
			color: "#3a4658"
		},
		{
			name: "MidRamp",
			x: -5.6,
			y: 1.32,
			z: .4,
			sx: 1.35,
			sz: 2.55,
			slide: "0,-1.7",
			color: "#334155"
		},
		{
			name: "LowRamp",
			x: -4.5,
			y: .62,
			z: -1.45,
			sx: 2.7,
			sz: 1.85,
			slide: "1.65,0",
			color: "#2c3a4a"
		},
		{
			name: "Catch",
			x: -2.05,
			y: .3,
			z: -1.45,
			sx: 2.15,
			sz: 1.85,
			slide: "0,0",
			color: "#243044"
		}
	]) {
		const entity = sized(makeSpawned(id, {
			name: pad.name,
			asset: "platform",
			color: pad.color,
			tags: "marble,play,fixture",
			physics: "true",
			kinematic: "true"
		}), pad.x, pad.y, pad.z, pad.sx, .12, pad.sz);
		entity.customData = {
			...entity.customData,
			slide: pad.slide
		};
		entities[id] = entity;
		id += 1;
	}
	const marble = sized(makeSpawned(id, {
		name: "Marble",
		asset: "sphere",
		color: "#f4f1ec",
		tags: "marble,play",
		physics: "true"
	}), -5.6, 2.62, 3.5, .42, .42, .42);
	marble.customData = {
		...marble.customData,
		solver: "xpbd"
	};
	entities[id] = marble;
	return {
		...world,
		entities,
		nextId: id + 1
	};
}
function nums(text) {
	const out = [];
	for (const tok of text.split(/[^0-9.+-]+/)) {
		if (!tok || tok === "+" || tok === "-" || tok === ".") continue;
		const n = Number(tok);
		if (Number.isFinite(n)) out.push(n);
	}
	return out;
}
function resolveEntity(intent, scene) {
	const tagged = intent.matchAll(/\b(?:entity|id)\s*#?\s*(\d+)\b|#(\d+)\b/gi);
	for (const match of tagged) {
		const id = Number(match[1] ?? match[2]);
		if (scene.some((entity) => entity.id === id)) return id;
	}
	let best = null;
	const lower = intent.toLowerCase();
	for (const entity of scene) if (entity.name.length >= 2 && lower.includes(entity.name.toLowerCase())) {
		if (!best || entity.name.length > best.name.length) best = entity;
	}
	if (best) return best.id;
	for (const kind of [
		"platform",
		"pillar",
		"sphere",
		"ring",
		"gaussian",
		"cube"
	]) {
		if (!lower.includes(kind)) continue;
		const matches = scene.filter((entity) => entity.asset === kind);
		if (matches.length === 1) return matches[0].id;
	}
	return null;
}
function assetFrom(lower) {
	if (lower.includes("splat") || lower.includes("gaussian")) return "gaussian";
	if (lower.includes("sphere") || lower.includes("orb") || lower.includes("ball")) return "sphere";
	if (lower.includes("pillar") || lower.includes("column")) return "pillar";
	if (lower.includes("ring") || lower.includes("torus")) return "ring";
	if (lower.includes("platform") || lower.includes("slab") || lower.includes("deck")) return "platform";
	return "cube";
}
function nameFrom(intent, asset) {
	const named = intent.match(/\bnamed\s+["']?([A-Za-z][\w-]*)/i);
	if (named) return named[1];
	switch (asset) {
		case "platform": return "Platform";
		case "sphere": return "Sphere";
		case "pillar": return "Pillar";
		case "ring": return "Ring";
		case "gaussian": return "Beacon";
		default: return "Unnamed";
	}
}
function stripId(values, id) {
	if (id == null) return values;
	const index = values.findIndex((value) => value === id);
	if (index < 0) return values;
	const next = values.slice();
	next.splice(index, 1);
	return next;
}
function modelNote(model, detail) {
	return `[Bonded:${model.name} @ ${model.path}] ${detail}`;
}
/**
* Heuristic driver that mirrors a tool-calling GGUF.
* Query is matched before spawn so "tagged spawned" does not forge a new body.
*/
function propose(model, intent, scene, toolNames) {
	if (!model.loaded) return {
		kind: "message",
		arguments: {},
		message: "Model not loaded"
	};
	const lower = intent.toLowerCase();
	if ([
		"query",
		"find",
		"list",
		"count",
		"how many"
	].some((word) => lower.includes(word)) && toolNames.includes("query_scene")) return {
		kind: "tool_call",
		toolName: "query_scene",
		arguments: { tag: intent.match(/\btagged\s+["']?([A-Za-z][\w-]*)/i)?.[1] ?? "spawned" },
		message: modelNote(model, "proposing query_scene")
	};
	if ([
		"velocity",
		"push",
		"impulse",
		"shove",
		"throw"
	].some((word) => lower.includes(word)) && toolNames.includes("apply_velocity")) {
		const id = resolveEntity(intent, scene);
		if (id == null) return {
			kind: "message",
			arguments: {},
			message: modelNote(model, "no entity matched for apply_velocity")
		};
		const values = stripId(nums(intent), id);
		const [vx, vy, vz] = values.length >= 3 ? values : [
			1.4,
			.15,
			.35
		];
		return {
			kind: "tool_call",
			toolName: "apply_velocity",
			arguments: {
				id: String(id),
				vx: String(vx),
				vy: String(vy),
				vz: String(vz)
			},
			message: modelNote(model, "proposing apply_velocity")
		};
	}
	const looksLikeMove = [
		"move",
		"reposition",
		"translate",
		"relocate",
		"set position"
	].some((word) => lower.includes(word));
	const editing = [
		"edit",
		"change",
		"recolor",
		"recolour",
		"paint",
		"colour",
		"color",
		"dye",
		"tint",
		"update",
		"modify"
	].some((word) => lower.includes(word));
	const makingNew = [
		"create",
		"spawn",
		"add",
		"forge",
		"another",
		"new"
	].some((word) => lower.includes(word));
	const tint = colorWord(intent);
	const namedId = resolveEntity(intent, scene);
	if (namedId != null && tint && toolNames.includes("set_color") && (editing || !makingNew)) return {
		kind: "tool_call",
		toolName: "set_color",
		arguments: {
			id: String(namedId),
			color: tint
		},
		message: modelNote(model, "proposing set_color")
	};
	if ((looksLikeMove || editing && namedId != null && stripId(nums(intent), namedId).length >= 3) && toolNames.includes("set_transform")) {
		const id = resolveEntity(intent, scene);
		if (id == null) return {
			kind: "message",
			arguments: {},
			message: modelNote(model, "no entity matched for set_transform")
		};
		const values = stripId(nums(intent), id);
		if (values.length < 3) return {
			kind: "message",
			arguments: {},
			message: modelNote(model, "set_transform needs three coordinates")
		};
		const [x, y, z] = values;
		return {
			kind: "tool_call",
			toolName: "set_transform",
			arguments: {
				id: String(id),
				x: String(x),
				y: String(y),
				z: String(z)
			},
			message: modelNote(model, "proposing set_transform")
		};
	}
	if (editing && namedId != null && !makingNew) return {
		kind: "message",
		arguments: {},
		message: modelNote(model, "that object is already in the scene; say a color or a position to edit it")
	};
	if ([
		"create",
		"spawn",
		"make",
		"forge",
		"add",
		"drop",
		"build"
	].some((word) => lower.includes(word)) && toolNames.includes("spawn_entity")) {
		const asset = assetFrom(lower);
		const name = nameFrom(intent, asset);
		const values = nums(intent);
		const [x, y, z] = values.length >= 3 ? values : [
			0,
			0,
			0
		];
		const arguments_ = {
			name,
			x: String(x),
			y: String(y),
			z: String(z),
			asset
		};
		if (tint) arguments_.color = tint;
		return {
			kind: "tool_call",
			toolName: "spawn_entity",
			arguments: arguments_,
			message: modelNote(model, "proposing spawn_entity")
		};
	}
	return {
		kind: "message",
		arguments: {},
		message: modelNote(model, `intent acknowledged: ${intent}`)
	};
}
function sceneRefs(entities) {
	return Object.values(entities).map((entity) => ({
		id: entity.id,
		name: entity.name,
		asset: entity.representation.kind === "mesh" ? entity.representation.assetId : entity.representation.kind === "gaussian" ? "gaussian" : entity.representation.kind
	}));
}
/**
* Command shape from DroidDeck's agent bridge (docs/agent-control.md, schema 2).
* Droid-Deck/DroidDeck, GPL-3.0. This file is not their code.
* Their session is proot plus gamescope plus Proton. This one only drives the forge.
* run, guest, cdp, env, override, and prefs stay off, the same split as their
* debugging-tools toggle. Those would execute a guest or evaluate script.
*/
var PLAYER = /* @__PURE__ */ new Set([
	"state",
	"start",
	"stop",
	"resume",
	"focus",
	"input"
]);
var DEBUG = /* @__PURE__ */ new Set([
	"run",
	"guest",
	"cdp",
	"env",
	"override",
	"prefs"
]);
var KEYS = {
	left: "left",
	right: "right",
	up: "rotate",
	down: "down",
	confirm: "drop",
	back: "back"
};
function deckOf(world) {
	return Object.values(world.entities).find((entity) => entity.customData.method === "deck");
}
function report(world) {
	const deck = deckOf(world);
	const body = {
		schema: 2,
		runtime: "forge-session",
		phase: deck?.customData.phase || "IDLE",
		focus: deck?.customData.focus || null,
		seq: Number(deck?.customData.seq) || 0,
		agent: {
			guest: false,
			commands: [...PLAYER]
		}
	};
	return `Deck bridge schema 2. Command shape from DroidDeck's agent bridge. Not proot, gamescope, Proton, or Steam.\n${JSON.stringify(body)}`;
}
function put(world, entity, patch) {
	const next = {
		...entity,
		customData: {
			...entity.customData,
			...patch
		}
	};
	return {
		world: {
			...world,
			entities: {
				...world.entities,
				[next.id]: next
			}
		},
		entity: next
	};
}
function deckProposal(intent) {
	const lower = intent.toLowerCase();
	const named = /\b(droid\s*deck|deck session|deck bridge)\b/.test(lower);
	const verb = /\bdeck\b/.test(lower) && /\b(start|stop|resume|state|status|focus|input|session)\b/.test(lower);
	if (!named && !verb) return null;
	const message = "deck bridge";
	if (/\b(stop|end|quit)\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "deck_bridge",
		arguments: { command: "stop" },
		message
	};
	if (/\bresume\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "deck_bridge",
		arguments: { command: "resume" },
		message
	};
	if (/\b(state|status)\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "deck_bridge",
		arguments: { command: "state" },
		message
	};
	const key = lower.match(/\binput\s+(left|right|up|down|confirm|back)\b/);
	if (key) return {
		kind: "tool_call",
		toolName: "deck_bridge",
		arguments: {
			command: "input",
			key: key[1]
		},
		message
	};
	if (/\bfocus\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "deck_bridge",
		arguments: {
			command: "focus",
			id: lower.match(/\bfocus\s+(\d+)\b/)?.[1] ?? ""
		},
		message
	};
	return {
		kind: "tool_call",
		toolName: "deck_bridge",
		arguments: { command: "start" },
		message
	};
}
function deckCommand(world, args) {
	const command = (args.command ?? "").trim().toLowerCase();
	if (JSON.stringify(args).length > 4096) return {
		ok: false,
		code: 2,
		detail: "request too large",
		world
	};
	if (DEBUG.has(command)) return {
		ok: false,
		code: 7,
		detail: `'${command}' is a DroidDeck debugging command. It stays off, so the bridge cannot run a guest or evaluate script.`,
		world
	};
	if (!PLAYER.has(command)) return {
		ok: false,
		code: 2,
		detail: `unknown deck command '${command}'`,
		world
	};
	if (command === "state") return {
		ok: true,
		code: 0,
		detail: report(world),
		world
	};
	if (command === "stop") {
		const deck = deckOf(world);
		if (!deck) return {
			ok: true,
			code: 0,
			detail: report(world),
			world
		};
		const next = put(world, deck, {
			phase: "IDLE",
			focus: "",
			seq: String((Number(deck.customData.seq) || 0) + 1)
		});
		return {
			ok: true,
			code: 0,
			detail: report(next.world),
			world: next.world
		};
	}
	if (command === "focus") {
		const deck = deckOf(world);
		if (!deck || deck.customData.phase !== "READY") return {
			ok: false,
			code: 4,
			detail: "deck session is not ready",
			world
		};
		const id = Number(args.id);
		if (!world.entities[id]) return {
			ok: false,
			code: 2,
			detail: "focus needs an entity id",
			world
		};
		const next = put(world, deck, {
			focus: String(id),
			seq: String((Number(deck.customData.seq) || 0) + 1)
		});
		return {
			ok: true,
			code: 0,
			detail: report(next.world),
			world: next.world
		};
	}
	if (command === "input") {
		const deck = deckOf(world);
		if (!deck || deck.customData.phase !== "READY") return {
			ok: false,
			code: 4,
			detail: "deck session is not ready",
			world
		};
		const move = KEYS[(args.key ?? "").trim().toLowerCase()];
		if (!move) return {
			ok: false,
			code: 2,
			detail: "input key is left, right, up, down, confirm, or back",
			world
		};
		const played = move === "back" ? world : playTetris(world, move);
		const live = deckOf(played) ?? deck;
		const next = put(played, live, {
			lastKey: args.key,
			seq: String((Number(live.customData.seq) || 0) + 1)
		});
		return {
			ok: true,
			code: 0,
			detail: `${report(next.world)}\ninput ${args.key}`,
			world: next.world
		};
	}
	const existing = deckOf(world);
	if (existing) {
		const next = put(world, existing, {
			phase: "READY",
			seq: String((Number(existing.customData.seq) || 0) + 1)
		});
		return {
			ok: true,
			code: 0,
			detail: report(next.world),
			world: next.world
		};
	}
	const spawned = seatOffCenter(world, makeSpawned(world.nextId, {
		name: "Deck",
		asset: "card",
		x: "-2.6",
		y: "1.1",
		z: "1.2",
		color: "teal"
	}), {
		x: "-2.6",
		y: "1.1",
		z: "1.2"
	});
	spawned.customData = {
		...spawned.customData,
		method: "deck",
		phase: "READY",
		focus: "",
		seq: "1",
		page: "https://github.com/Droid-Deck/DroidDeck/blob/main/docs/agent-control.md"
	};
	const ready = {
		...world,
		entities: {
			...world.entities,
			[spawned.id]: spawned
		},
		nextId: world.nextId + 1
	};
	return {
		ok: true,
		code: 0,
		detail: report(ready),
		world: ready
	};
}
var REGS = [
	"x0",
	"x1",
	"x2",
	"x3"
];
var LOCAL = /* @__PURE__ */ new Set([
	"mov",
	"add",
	"ret"
]);
var FIXTURE = {
	op: "sub",
	rd: "x0",
	rn: "x0",
	imm: 4,
	before: 9,
	after: 5
};
function u32(word) {
	return [
		word & 255,
		word >> 8 & 255,
		word >> 16 & 255,
		word >> 24 & 255
	];
}
function wordOf(bytes, offset) {
	return ((bytes[offset] ?? 0) | (bytes[offset + 1] ?? 0) << 8 | (bytes[offset + 2] ?? 0) << 16 | (bytes[offset + 3] ?? 0) << 24) >>> 0;
}
function imm32(value) {
	const n = value | 0;
	return [
		n & 255,
		n >> 8 & 255,
		n >> 16 & 255,
		n >> 24 & 255
	];
}
function reg(index) {
	return REGS[index] ?? null;
}
function encode(op, arch) {
	if (op.op === "ret") return arch === "x86_64" ? [195] : u32(3596551104);
	const rd = REGS.indexOf(op.op === "mov" ? op.rd : op.rd);
	if (rd < 0) return null;
	if (op.op === "mov") {
		if (op.imm < 0 || op.imm > 65535) return null;
		if (arch === "x86_64") return [
			72,
			184 + rd,
			...imm32(op.imm)
		];
		return u32(3531603968 | (op.imm & 65535) << 5 | rd);
	}
	if (op.imm < 0 || op.imm > 255) return null;
	const rn = REGS.indexOf(op.rn);
	if (arch === "x86_64") {
		if (rn !== rd) return null;
		return [
			72,
			131,
			(op.op === "add" ? 192 : 232) + rd,
			op.imm & 255
		];
	}
	if (rn < 0 || op.imm > 4095) return null;
	return u32((op.op === "add" ? 2432696320 : 3506438144) | (op.imm & 4095) << 10 | rn << 5 | rd);
}
function decodeX86(bytes, allowed) {
	const ops = [];
	const gaps = [];
	let i = 0;
	while (i < bytes.length) {
		const at = i;
		if (bytes[i] === 195) {
			if (!allowed.has("ret")) gaps.push({
				offset: at,
				bytes: "c3",
				reason: "ret is not in the local map"
			});
			else ops.push({ op: "ret" });
			i += 1;
			continue;
		}
		if (bytes[i] === 72 && bytes[i + 1] >= 184 && bytes[i + 1] <= 187 && i + 6 <= bytes.length) {
			const rd = reg(bytes[i + 1] - 184);
			const imm = wordOf(bytes, i + 2);
			i += 6;
			if (!rd || !allowed.has("mov")) gaps.push({
				offset: at,
				bytes: hex(bytes.slice(at, i)),
				reason: "mov is not in the local map"
			});
			else ops.push({
				op: "mov",
				rd,
				imm
			});
			continue;
		}
		if (bytes[i] === 72 && bytes[i + 1] === 131 && i + 4 <= bytes.length) {
			const ext = bytes[i + 2] ?? 0;
			const add = ext >= 192 && ext <= 195;
			if (add || ext >= 232 && ext <= 235) {
				const name = add ? "add" : "sub";
				const rd = reg(ext - (add ? 192 : 232));
				const imm = bytes[i + 3] ?? 0;
				i += 4;
				if (!rd || !allowed.has(name)) gaps.push({
					offset: at,
					bytes: hex(bytes.slice(at, i)),
					reason: `${name} is not in the local map`
				});
				else if (rd) ops.push({
					op: name,
					rd,
					rn: rd,
					imm
				});
				continue;
			}
		}
		gaps.push({
			offset: at,
			bytes: hex([bytes[i] ?? 0]),
			reason: "no x86 lowering"
		});
		i += 1;
	}
	return {
		arch: "x86_64",
		ops,
		gaps
	};
}
function decodeArm(bytes, allowed) {
	const ops = [];
	const gaps = [];
	if (bytes.length % 4 !== 0) return {
		arch: "aarch64",
		ops,
		gaps: [{
			offset: 0,
			bytes: hex(bytes),
			reason: "arm instructions are 4 bytes"
		}]
	};
	for (let i = 0; i < bytes.length; i += 4) {
		const word = wordOf(bytes, i);
		const raw = hex(bytes.slice(i, i + 4));
		if (word === 3596551104) {
			if (!allowed.has("ret")) gaps.push({
				offset: i,
				bytes: raw,
				reason: "ret is not in the local map"
			});
			else ops.push({ op: "ret" });
			continue;
		}
		const rd = reg(word & 31);
		const rn = reg(word >>> 5 & 31);
		if ((word & 4292870144) >>> 0 === 3531603968) {
			const imm = word >>> 5 & 65535;
			if (!rd || !allowed.has("mov")) gaps.push({
				offset: i,
				bytes: raw,
				reason: "mov is not in the local map"
			});
			else ops.push({
				op: "mov",
				rd,
				imm
			});
			continue;
		}
		const add = (word & 4290772992) >>> 0 === 2432696320;
		const sub = (word & 4290772992) >>> 0 === 3506438144;
		if (add || sub) {
			const name = add ? "add" : "sub";
			const imm = word >>> 10 & 4095;
			if (!rd || !rn || !allowed.has(name)) gaps.push({
				offset: i,
				bytes: raw,
				reason: `${name} is not in the local map`
			});
			else ops.push({
				op: name,
				rd,
				rn,
				imm
			});
			continue;
		}
		gaps.push({
			offset: i,
			bytes: raw,
			reason: "no arm lowering"
		});
	}
	return {
		arch: "aarch64",
		ops,
		gaps
	};
}
function hex(bytes) {
	return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}
function parseHex(text) {
	const parts = text.trim().split(/[\s,]+/).filter(Boolean);
	if (!parts.length) return null;
	const bytes = [];
	for (const part of parts) {
		if (!/^[0-9a-f]{2}$/i.test(part)) return null;
		bytes.push(Number.parseInt(part, 16));
	}
	return bytes;
}
function allowed(world) {
	return /* @__PURE__ */ new Set([...LOCAL, ...world.compat ?? []]);
}
function readProgram(bytes, world, prefer) {
	const set = allowed(world);
	if (prefer === "aarch64") return decodeArm(bytes, set);
	if (prefer === "x86_64") return decodeX86(bytes, set);
	const x86 = decodeX86(bytes, set);
	const arm = decodeArm(bytes, set);
	if (x86.gaps.length === 0) return x86;
	if (arm.gaps.length === 0) return arm;
	return x86.gaps.length <= arm.gaps.length ? x86 : arm;
}
function step(ops, seed = 0) {
	const regs = {
		x0: seed,
		x1: 0,
		x2: 0,
		x3: 0
	};
	for (const op of ops) {
		if (op.op === "ret") return {
			ok: true,
			x0: regs.x0 | 0
		};
		if (op.op === "mov") regs[op.rd] = op.imm | 0;
		else regs[op.rd] = (op.op === "add" ? regs[op.rn] + op.imm : regs[op.rn] - op.imm) | 0;
	}
	return {
		ok: true,
		x0: regs.x0 | 0
	};
}
function same(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
/** Flagship row. The local map cannot see it until the fixture passes. */
function flagshipFixture() {
	const op = {
		op: FIXTURE.op,
		rd: FIXTURE.rd,
		rn: FIXTURE.rn,
		imm: FIXTURE.imm
	};
	const x86 = encode(op, "x86_64");
	const arm = encode(op, "aarch64");
	if (!x86 || !arm) return null;
	return {
		x86,
		arm
	};
}
function acceptLowering(world, proposal) {
	if (proposal.op !== FIXTURE.op) return {
		ok: false,
		world,
		detail: "the flagship map has no sealed fixture for that opcode"
	};
	const full = {
		...world,
		compat: [...LOCAL, FIXTURE.op]
	};
	const fromX86 = readProgram(proposal.x86, full, "x86_64");
	const fromArm = readProgram(proposal.arm, full, "aarch64");
	const expect = {
		op: "sub",
		rd: FIXTURE.rd,
		rn: FIXTURE.rn,
		imm: FIXTURE.imm
	};
	if (fromX86.gaps.length || fromArm.gaps.length || !fromX86.ops[0] || !fromArm.ops[0] || !same(fromX86.ops[0], expect) || !same(fromArm.ops[0], expect)) return {
		ok: false,
		world,
		detail: "rejected. The bytes do not lower to sub on both architectures."
	};
	const ran = step([
		{
			op: "mov",
			rd: "x0",
			imm: FIXTURE.before
		},
		expect,
		{ op: "ret" }
	]);
	if (!ran.ok || ran.x0 !== FIXTURE.after) return {
		ok: false,
		world,
		detail: "rejected. The fixture did not yield 5."
	};
	if ((world.compat ?? []).includes("sub")) return {
		ok: true,
		world,
		detail: "sub is already in the local map. The agent can lower it without the flagship."
	};
	return {
		ok: true,
		world: {
			...world,
			compat: [...world.compat ?? [], "sub"]
		},
		detail: "Flagship lowering for sub passed the fixture (9 - 4 = 5) on both encodings. The local map can use it next time."
	};
}
var SAMPLE = [
	{
		op: "mov",
		rd: "x0",
		imm: 9
	},
	{
		op: "add",
		rd: "x0",
		rn: "x0",
		imm: 2
	},
	{ op: "ret" }
];
function graph(evidence) {
	const ops = evidence.ops.map((op) => op.op === "ret" ? "ret" : op.op === "mov" ? `mov ${op.rd}, ${op.imm}` : `${op.op} ${op.rd}, ${op.rn}, ${op.imm}`);
	const gaps = evidence.gaps.map((gap) => `@${gap.offset} ${gap.bytes} ${gap.reason}`);
	return [
		`arch ${evidence.arch}`,
		`ir ${ops.join(" | ") || "(none)"}`,
		`gaps ${gaps.join(" | ") || "none"}`
	].join("\n");
}
function seat(world, note) {
	const existing = Object.values(world.entities).find((entity) => entity.customData.method === "compat");
	if (existing) return {
		...world,
		entities: {
			...world.entities,
			[existing.id]: {
				...existing,
				customData: {
					...existing.customData,
					note: note.slice(0, 240)
				}
			}
		}
	};
	const spawned = seatOffCenter(world, makeSpawned(world.nextId, {
		name: "Compat",
		asset: "card",
		x: "1.6",
		y: "1.05",
		z: "1.8",
		color: "indigo"
	}), {
		x: "1.6",
		y: "1.05",
		z: "1.8"
	});
	spawned.customData = {
		...spawned.customData,
		method: "compat",
		note: note.slice(0, 240),
		page: "https://github.com/FEX-Emu/FEX"
	};
	return {
		...world,
		entities: {
			...world.entities,
			[spawned.id]: spawned
		},
		nextId: world.nextId + 1
	};
}
function compatProposal(intent) {
	const lower = intent.toLowerCase();
	if (!(/\b(x86|aarch64|firmware|compat map|isa map|flagship map)\b/.test(lower) || /\btranslate\b/.test(lower) && /\b(arm|x86)\b/.test(lower) || /\blearn\b/.test(lower) && /\b(opcode|opcodes|mapping|instruction|sub)\b/.test(lower))) return null;
	const message = "compat map";
	if (/\blearn\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "compat_map",
		arguments: { command: "learn" },
		message
	};
	if (/\btranslate\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "compat_map",
		arguments: {
			command: "translate",
			hex: lower.match(/\b(?:[0-9a-f]{2}\s+){1,24}[0-9a-f]{2}\b/)?.[0] ?? "",
			arch: /\b(from arm|aarch64)\b/.test(lower) && !/\bx86\b/.test(lower) ? "aarch64" : "x86_64"
		},
		message
	};
	return {
		kind: "tool_call",
		toolName: "compat_map",
		arguments: { command: "gaps" },
		message
	};
}
function compatCommand(world, args) {
	const command = (args.command ?? "translate").trim().toLowerCase();
	if (command === "learn") {
		const row = flagshipFixture();
		if (!row) return {
			ok: false,
			detail: "flagship row missing",
			world
		};
		const accepted = acceptLowering(world, {
			op: "sub",
			...row
		});
		const note = accepted.ok ? "sub learned" : "sub rejected";
		return {
			ok: accepted.ok,
			detail: accepted.detail,
			world: accepted.ok ? seat(accepted.world, note) : world
		};
	}
	if (command === "gaps") {
		const pending = (world.compat ?? []).includes("sub") ? "none" : "sub";
		return {
			ok: true,
			detail: `Local map: ${[...allowed(world)].join(", ")}.\nWaiting on the flagship: ${pending}.\nUnknown bytes stay a gap and are not run.`,
			world
		};
	}
	if (command !== "translate") return {
		ok: false,
		detail: "command is translate, gaps, or learn",
		world
	};
	const prefer = args.arch === "aarch64" ? "aarch64" : "x86_64";
	const sample = SAMPLE.flatMap((op) => encode(op, prefer) ?? []);
	const parsed = args.hex ? parseHex(args.hex) : null;
	if (args.hex && !parsed) return {
		ok: false,
		detail: "hex must be byte pairs",
		world
	};
	const evidence = readProgram(parsed ?? sample, world, prefer);
	const other = evidence.arch === "aarch64" ? "x86_64" : "aarch64";
	const lowered = evidence.gaps.length ? null : evidence.ops.flatMap((op) => encode(op, other) ?? []);
	const back = lowered ? readProgram(lowered, world, other) : null;
	const ran = evidence.gaps.length || !evidence.ops.length ? null : step(evidence.ops);
	const lines = [
		"FEX-style map. x86 and ARM lower to one IR. Unknown bytes are an evidence gap, not code to run.",
		graph(evidence),
		lowered ? `${other} ${hex(lowered)}` : "no lowering. The local map does not own every opcode yet.",
		back && back.gaps.length === 0 ? "round-trip held" : "round-trip blocked",
		ran?.ok ? `x0 = ${ran.x0}` : "not executed"
	];
	const note = ran?.ok ? `x0=${ran.x0}` : "gap";
	return {
		ok: evidence.ops.length > 0,
		detail: lines.join("\n"),
		world: seat(world, note)
	};
}
/**
* Islands. One app, one self-hosted node, one signed identity.
*
* Address   forge://host[:port]/slug          (same idea as OpenSim's host:port/Region)
* Identity  Ed25519 key pair. The node id is the hash of the public key, so nobody can claim an id
*           without holding the key.
* Portal    A two-message handshake. The visitor says who it is and what it wants. The host checks
*           the signature, intersects the request with its own policy, and answers with what it grants,
*           signed so the visitor knows it reached the real host.
*
* Nothing here opens a socket. It is the protocol logic only, so any transport can carry it
* (HTTP, WebSocket, WebRTC, a native host). Uses WebCrypto; Ed25519 needs a current browser or Node 20+.
*/
var CAPABILITIES = [
	"render",
	"input",
	"audio",
	"storage",
	"portal",
	"fetch",
	"compute"
];
var HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
var SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
function parseAddress(text) {
	const match = /^forge:\/\/([^/:?#\s]+)(?::(\d{1,5}))?\/([^/?#\s]+)$/.exec(text.trim());
	if (!match) return null;
	const [, host, portText, slug] = match;
	if (!HOST.test(host) || !SLUG.test(slug)) return null;
	const port = portText === void 0 ? null : Number(portText);
	if (port !== null && (port < 1 || port > 65535)) return null;
	return {
		host: host.toLowerCase(),
		port,
		slug
	};
}
function formatAddress(address) {
	return `forge://${address.host}${address.port === null ? "" : `:${address.port}`}/${address.slug}`;
}
/** Same address, same string, whatever the host's case. */
function normalizeAddress(text) {
	const parsed = parseAddress(text);
	return parsed ? formatAddress(parsed) : null;
}
var subtle = () => {
	const api = globalThis.crypto?.subtle;
	if (!api) throw new Error("WebCrypto is not available here");
	return api;
};
function b64url(bytes) {
	let text = "";
	for (const byte of bytes) text += String.fromCharCode(byte);
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(text) {
	if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
	try {
		const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
		const raw = atob(padded);
		return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
	} catch {
		return null;
	}
}
var enc$1 = new TextEncoder();
async function sha256(bytes) {
	return b64url(new Uint8Array(await subtle().digest("SHA-256", bytes)));
}
/** Stable JSON: keys sorted, so the same manifest always signs to the same bytes. */
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	return JSON.stringify(value);
}
async function generateIdentity() {
	const pair = await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
	const publicKey = b64url(new Uint8Array(await subtle().exportKey("raw", pair.publicKey)));
	return {
		publicKey,
		id: await idOf(publicKey),
		privateKey: pair.privateKey
	};
}
async function idOf(publicKey) {
	const raw = fromB64url(publicKey);
	if (!raw) throw new Error("bad public key");
	return (await sha256(raw)).slice(0, 22);
}
async function importPublic(publicKey) {
	const raw = fromB64url(publicKey);
	if (!raw || raw.length !== 32) return null;
	try {
		return await subtle().importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
	} catch {
		return null;
	}
}
async function sign(key, text) {
	return b64url(new Uint8Array(await subtle().sign({ name: "Ed25519" }, key, enc$1.encode(text))));
}
async function verify(publicKey, text, signature) {
	const key = await importPublic(publicKey);
	const sig = fromB64url(signature);
	if (!key || !sig) return false;
	try {
		return await subtle().verify({ name: "Ed25519" }, key, sig, enc$1.encode(text));
	} catch {
		return false;
	}
}
var isCap = (value) => typeof value === "string" && CAPABILITIES.includes(value);
function validateManifest(value) {
	if (!value || typeof value !== "object") return false;
	const m = value;
	return m.forge === "island" && m.version === 1 && typeof m.id === "string" && typeof m.name === "string" && m.name.length > 0 && m.name.length <= 80 && typeof m.address === "string" && parseAddress(m.address) !== null && typeof m.publicKey === "string" && !!m.entry && (m.entry.kind === "wasm" || m.entry.kind === "world") && typeof m.entry.sha256 === "string" && Number.isInteger(m.entry.bytes) && m.entry.bytes >= 0 && Array.isArray(m.wants) && m.wants.every(isCap) && Array.isArray(m.portals) && m.portals.every((item) => typeof item === "string" && parseAddress(item) !== null);
}
async function signManifest(manifest, identity) {
	if (manifest.publicKey !== identity.publicKey || manifest.id !== identity.id) throw new Error("manifest does not match the identity");
	return {
		manifest,
		signature: await sign(identity.privateKey, `manifest|${canonical(manifest)}`)
	};
}
async function verifyManifest(signed) {
	if (!signed || !validateManifest(signed.manifest)) return {
		ok: false,
		reason: "manifest is malformed"
	};
	const m = signed.manifest;
	if (await idOf(m.publicKey).catch(() => "") !== m.id) return {
		ok: false,
		reason: "id does not match the public key"
	};
	if (!await verify(m.publicKey, `manifest|${canonical(m)}`, signed.signature)) return {
		ok: false,
		reason: "manifest signature is invalid"
	};
	return { ok: true };
}
function randomNonce() {
	return b64url(globalThis.crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16)));
}
var helloText = (h) => `hello|${h.nonce}|${h.to}|${h.from.manifest.id}|${[...h.wants].sort().join(",")}`;
var welcomeText = (nonce, visitorId, hostId, grant) => `welcome|${nonce}|${visitorId}|${hostId}|${[...grant].sort().join(",")}`;
async function makeHello(from, identity, to, wants) {
	const target = normalizeAddress(to);
	if (!target) throw new Error("bad destination address");
	const base = {
		from,
		to: target,
		wants: [...new Set(wants)],
		nonce: randomNonce()
	};
	return {
		type: "hello",
		...base,
		signature: await sign(identity.privateKey, helloText(base))
	};
}
/** The visitor confirms it reached the real host and learns what it was actually granted. */
async function checkWelcome(hello, welcome) {
	if (!welcome || welcome.type !== "welcome" || !Array.isArray(welcome.grant)) return {
		ok: false,
		reason: "welcome is malformed"
	};
	const seen = await verifyManifest(welcome.host);
	if (!seen.ok) return {
		ok: false,
		reason: `host rejected: ${seen.reason}`
	};
	if (normalizeAddress(welcome.host.manifest.address) !== normalizeAddress(hello.to)) return {
		ok: false,
		reason: "answered by a different island than the one asked"
	};
	if (welcome.nonce !== hello.nonce) return {
		ok: false,
		reason: "nonce mismatch (replayed or stale)"
	};
	if (!welcome.grant.every(isCap) || !welcome.grant.every((cap) => hello.wants.includes(cap))) return {
		ok: false,
		reason: "host granted more than was asked"
	};
	const text = welcomeText(welcome.nonce, hello.from.manifest.id, welcome.host.manifest.id, welcome.grant);
	if (!await verify(welcome.host.manifest.publicKey, text, welcome.signature)) return {
		ok: false,
		reason: "welcome signature is invalid"
	};
	return {
		ok: true,
		grant: welcome.grant
	};
}
async function buildManifest(identity, fields) {
	const address = normalizeAddress(fields.address);
	if (!address) throw new Error("bad island address");
	const portals = (fields.portals ?? []).map((item) => normalizeAddress(item));
	if (portals.some((item) => item === null)) throw new Error("bad portal address");
	return {
		forge: "island",
		version: 1,
		id: identity.id,
		name: fields.name,
		address,
		publicKey: identity.publicKey,
		entry: fields.entry,
		wants: [...new Set(fields.wants ?? [])],
		portals
	};
}
new TextEncoder();
var dec = new TextDecoder();
var finite = (v) => typeof v === "number" && Number.isFinite(v);
var vec = (v) => !!v && typeof v === "object" && finite(v.x) && finite(v.y) && finite(v.z);
/** Structural check on an entity that came from someone else's machine. */
function validEntity(value) {
	if (!value || typeof value !== "object") return false;
	const e = value;
	if (!Number.isInteger(e.id) || e.id < 0 || typeof e.name !== "string" || e.name.length > 120) return false;
	if (!e.transform || !vec(e.transform.position) || !vec(e.transform.scale)) return false;
	const r = e.transform.rotation;
	if (!r || !finite(r.x) || !finite(r.y) || !finite(r.z) || !finite(r.w)) return false;
	if (!e.representation || typeof e.representation.kind !== "string") return false;
	if (!Array.isArray(e.tags) || e.tags.length > 32 || !e.tags.every((t) => typeof t === "string" && t.length <= 40)) return false;
	if (!e.customData || typeof e.customData !== "object") return false;
	const data = Object.entries(e.customData);
	if (data.length > 32 || !data.every(([k, v]) => typeof k === "string" && typeof v === "string" && k.length <= 40 && v.length <= 2e3)) return false;
	return true;
}
async function verifyEntry(manifest, bytes) {
	if (manifest.entry.kind !== "world") return {
		ok: false,
		reason: "entry is not a world"
	};
	if (bytes.length !== manifest.entry.bytes) return {
		ok: false,
		reason: "entry size does not match the manifest"
	};
	if (await sha256(bytes) !== manifest.entry.sha256) return {
		ok: false,
		reason: "entry hash does not match the manifest"
	};
	let parsed;
	try {
		parsed = JSON.parse(dec.decode(bytes));
	} catch {
		return {
			ok: false,
			reason: "entry is not JSON"
		};
	}
	const entry = parsed;
	if (entry?.forge !== "island-world" || entry.version !== 1 || !Array.isArray(entry.entities)) return {
		ok: false,
		reason: "entry is not an island world"
	};
	if (entry.entities.length > 5e3 || !entry.entities.every(validEntity)) return {
		ok: false,
		reason: "entry holds a malformed entity"
	};
	return {
		ok: true,
		entry
	};
}
/** Put a visited island's entities into a local world, offset so they sit beside the visitor's own. Read-only by tag. */
function placeVisited(world, entry, hostId, offset) {
	const entities = { ...world.entities };
	let nextId = world.nextId;
	for (const remote of entry.entities) {
		const id = nextId++;
		const p = remote.transform.position;
		entities[id] = {
			...remote,
			id,
			transform: {
				...remote.transform,
				position: {
					x: p.x + offset.x,
					y: p.y + offset.y,
					z: p.z + offset.z
				}
			},
			physics: null,
			tags: [
				...remote.tags.filter((t) => t !== "avatar"),
				"visited",
				"read-only"
			],
			customData: {
				...remote.customData,
				island: hostId,
				remoteId: String(remote.id)
			}
		};
	}
	return {
		...world,
		entities,
		nextId
	};
}
function makePortal(world, address, at, label) {
	const normalized = normalizeAddress(address);
	if (!normalized) throw new Error("bad portal address");
	const id = world.nextId;
	const portal = {
		id,
		name: label ?? `Portal to ${normalized.replace(/^forge:\/\//, "")}`,
		transform: {
			position: { ...at },
			rotation: {
				x: 0,
				y: 0,
				z: 0,
				w: 1
			},
			scale: {
				x: 1,
				y: 1,
				z: 1
			}
		},
		representation: {
			kind: "mesh",
			assetId: "portal"
		},
		physics: null,
		tags: ["portal"],
		customData: {
			portal: normalized,
			color: "#7c5cff",
			asset: "portal"
		}
	};
	return {
		...world,
		entities: {
			...world.entities,
			[id]: portal
		},
		nextId: id + 1
	};
}
/** The portal the avatar is standing in, if any. */
function portalAt(world, position, reach = 1.1) {
	for (const e of Object.values(world.entities)) {
		if (!e.tags.includes("portal") || !e.customData.portal) continue;
		const p = e.transform.position;
		const dx = p.x - position.x;
		const dz = p.z - position.z;
		if (Math.hypot(dx, dz) <= reach && Math.abs(p.y - position.y) < 3) return {
			id: e.id,
			address: e.customData.portal
		};
	}
	return null;
}
/**
* The "place a portal" command. Deterministic, like compat_map: no model needed to recognise a
* forge:// address. The portal appears a few steps in front of the avatar.
*/
var ADDRESS = /forge:\/\/[^\s"'<>]+/i;
function portalProposal(intent) {
	const address = ADDRESS.exec(intent)?.[0];
	if (!address || !/\b(portal|island|door|gate|link|visit|open)\b/i.test(intent)) return null;
	return {
		kind: "tool_call",
		toolName: "place_portal",
		arguments: { address: address.replace(/[.,;:!?)]+$/, "") },
		message: "portal"
	};
}
function placePortal(world, args) {
	const address = normalizeAddress(args.address ?? "");
	if (!address) return {
		ok: false,
		detail: "That is not a forge:// address (forge://host[:port]/slug).",
		world
	};
	const existing = Object.values(world.entities).find((e) => e.tags.includes("portal") && e.customData.portal === address);
	if (existing) return {
		ok: true,
		detail: `A portal to ${address} is already here (entity ${existing.id}).`,
		world
	};
	const avatar = Object.values(world.entities).find((e) => e.tags.includes("avatar"));
	const yaw = Number(avatar?.customData.yaw ?? 0) || 0;
	const from = avatar?.transform.position ?? {
		x: 0,
		y: 0,
		z: 0
	};
	const next = makePortal(world, address, {
		x: from.x + Math.sin(yaw) * 2.6,
		y: 0,
		z: from.z + Math.cos(yaw) * 2.6
	});
	return {
		ok: true,
		detail: `Portal to ${address} placed as entity ${world.nextId}. Walk into it to visit; if the island is offline it says so.`,
		world: next
	};
}
/** Builtin tools registered by AetherOS, in registration order. */
var TOOLS$1 = [
	{
		name: "spawn_entity",
		description: "Spawn a new object. Not for editing one that already exists. Place it off the platform center.",
		parameters: {
			name: "string",
			x: "f32",
			y: "f32",
			z: "f32",
			asset: "string",
			color: "string"
		},
		optional: ["color"]
	},
	{
		name: "set_transform",
		description: "Move an existing entity. Use this to edit a position, not to create a new object.",
		parameters: {
			id: "u64",
			x: "f32",
			y: "f32",
			z: "f32"
		}
	},
	{
		name: "set_color",
		description: "Recolor an existing entity. Use this instead of spawning when the command edits a color.",
		parameters: {
			id: "u64",
			color: "string"
		}
	},
	{
		name: "edit_entity",
		description: "Change an existing entity. Use this instead of spawn when the command edits, recolors, moves, resizes, or renames.",
		parameters: {
			id: "u64",
			name: "string",
			color: "string",
			x: "f32",
			y: "f32",
			z: "f32",
			asset: "string",
			scale: "f32"
		},
		optional: [
			"name",
			"color",
			"x",
			"y",
			"z",
			"asset",
			"scale"
		]
	},
	{
		name: "delete_entity",
		description: "Remove an existing entity. id * removes every entity except the avatar.",
		parameters: { id: "u64" }
	},
	{
		name: "undo",
		description: "Revert the last change to the scene.",
		parameters: {}
	},
	{
		name: "define_skill",
		description: "Teach the harness a named skill that runs one existing tool. The engine also saves a skill when a call had to be corrected.",
		parameters: {
			name: "string",
			tool: "string",
			description: "string",
			args: "string",
			job: "string"
		},
		optional: [
			"description",
			"args",
			"job"
		]
	},
	{
		name: "control_avatar",
		description: "Step or turn a body. move is forward, back, left, right, up, down, turn-left, or turn-right. Omit id to move your avatar.",
		parameters: {
			id: "u64",
			move: "string"
		},
		optional: ["id"]
	},
	{
		name: "spawn_agent",
		description: "Spawn another agent in the scene. role is builder, critic, or scout. A critic is the second opinion.",
		parameters: {
			name: "string",
			role: "string"
		}
	},
	{
		name: "set_asset",
		description: "Attach a Wikimedia image or a lab texture (tex:marble, tex:circuit, tex:clay, tex:paper, tex:steel, tex:brick, tex:grain, tex:night) to an existing id.",
		parameters: {
			id: "u64",
			src: "string",
			title: "string",
			page: "string"
		},
		optional: ["title", "page"]
	},
	{
		name: "place_neural",
		description: "Place a compact neural splat from the asset library. Tiny recipe, splat render.",
		parameters: {
			id: "u64",
			title: "string",
			palette: "string",
			seed: "f32",
			count: "f32",
			shape: "string",
			source: "string"
		},
		optional: [
			"id",
			"seed",
			"count",
			"shape",
			"source"
		]
	},
	{
		name: "build_play",
		description: "Build a playable Tetris well or a marble run from real objects. kind is tetris or marble.",
		parameters: { kind: "string" }
	},
	{
		name: "play_move",
		description: "Move the live Tetris piece. move is left, right, rotate, down, or drop.",
		parameters: { move: "string" }
	},
	{
		name: "apply_method",
		description: "Run a local stand-in for a research method. name is gsplat (LoCoSplat-style densify), xpbd (position projection), or nanite (cluster LOD cut). Never executes remote code.",
		parameters: { name: "string" }
	},
	{
		name: "query_scene",
		description: "Query entities by tag",
		parameters: { tag: "string" }
	},
	{
		name: "apply_velocity",
		description: "Set velocity on a physics-enabled entity",
		parameters: {
			id: "u64",
			vx: "f32",
			vy: "f32",
			vz: "f32"
		}
	},
	{
		name: "sandbox_list",
		description: "List note files in the jailed sandbox. Does not run them or leave the directory.",
		parameters: { path: "string" },
		optional: ["path"]
	},
	{
		name: "sandbox_read",
		description: "Read one .md, .txt, or .json note from the sandbox. Does not execute it.",
		parameters: { path: "string" }
	},
	{
		name: "sandbox_write",
		description: "Write one text note into the sandbox. Cannot leave the sandbox or run a shell.",
		parameters: {
			path: "string",
			text: "string"
		}
	},
	{
		name: "search_web_clean",
		description: "Fetch a public page in a child process and file the markdown. Does not execute the page.",
		parameters: { query: "string" }
	},
	{
		name: "deck_bridge",
		description: "Drive the forge session. command is state, start, stop, resume, focus, or input. Guest commands run, guest, and cdp stay off.",
		parameters: {
			command: "string",
			key: "string",
			id: "string"
		},
		optional: ["key", "id"]
	},
	{
		name: "compat_map",
		description: "Translate a closed x86/ARM program through one IR, list gaps, or learn sub after the flagship fixture passes. Does not run unknown bytes.",
		parameters: {
			command: "string",
			hex: "string",
			arch: "string"
		},
		optional: ["hex", "arch"]
	},
	{
		name: "place_portal",
		description: "Place a portal to another island (a forge://host:port/slug address) in front of the avatar. Walking into it visits that island.",
		parameters: { address: "string" }
	}
];
var TOOL_NAMES = TOOLS$1.map((tool) => tool.name);
var MEMORY_BUDGET_MB = 4096;
/** Default GGUF path kept for the scripted driver. Live intents use the in-page Gemma resident. */
var DEFAULT_MODEL_PATH = "models/gemma-4-E2B_q4_0-it.gguf";
var ENGINE_SCRIPT = ["Create a small platform near the origin", "Query anything tagged spawned"];
/** A short pass through the lab. Does not replace solids with splats. */
var LAB_TOUR = [
	"Paint the cube named Clay teal",
	"Walk the avatar forward",
	"Spawn a critic agent named Critic",
	"Push DropOrb upward"
];
function toolByName(name) {
	return TOOLS$1.find((tool) => tool.name === name);
}
function parseU64(value) {
	if (value == null || !/^\d+$/.test(value.trim())) return null;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
	return parsed;
}
function parseIdList(value) {
	const text = value?.trim() ?? "";
	if (!text || text === "*") return null;
	const ids = [];
	for (const part of text.split(/[\s,]+/)) {
		if (!part) continue;
		const id = parseU64(part);
		if (id == null) return null;
		ids.push(id);
	}
	return ids.length ? ids : null;
}
function live$1(world) {
	return Object.values(world.entities).filter((entity) => !entity.tags.includes("architect")).sort((a, b) => a.id - b.id);
}
function remember(world) {
	const snap = {
		entities: world.entities,
		nextId: world.nextId,
		skills: world.skills ?? []
	};
	return {
		...world,
		undo: [...world.undo ?? [], snap].slice(-16)
	};
}
function fillArgs(template, args) {
	const out = {};
	for (const [key, value] of Object.entries(template)) {
		const next = value.replace(/\$([a-z]+)/gi, (_, name) => args[name] ?? args[name.toLowerCase()] ?? "");
		if (next.trim()) out[key] = next;
	}
	return out;
}
function registerSkill(world, skill) {
	const name = skill.name.trim();
	if (!name) return world;
	const skills = world.skills ?? [];
	if (skills.some((item) => item.name === name)) return world;
	return {
		...world,
		skills: [...skills, skill].slice(-12)
	};
}
function parseF32(value) {
	if (value == null || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
function record(world, tool, ok, detail) {
	const event = {
		tick: world.tick,
		tool,
		ok,
		detail: detail.slice(0, 200)
	};
	const events = [...world.events, event];
	if (events.length > 512) events.splice(0, 128);
	return recordEvent({
		...world,
		events
	}, detail);
}
function dispatchTool(world, name, args) {
	const skill = (world.skills ?? []).find((item) => item.name === name);
	if (skill) return runSkill(world, skill, args);
	const schema = toolByName(name);
	if (!schema) return {
		ok: false,
		detail: `tool '${name}' is not registered`,
		world
	};
	const optional = new Set(schema.optional ?? []);
	const missing = Object.keys(schema.parameters).filter((key) => !optional.has(key) && !(key in args));
	if (missing.length) return {
		ok: false,
		detail: `missing required argument(s): ${missing.join(", ")}`,
		world
	};
	if (name === "sandbox_list" || name === "sandbox_read" || name === "sandbox_write" || name === "search_web_clean") return {
		ok: false,
		detail: "The sandbox loopback runs in a server child process, not in the page, and it does not execute notes.",
		world
	};
	if (name === "deck_bridge") return deckCommand(world, args);
	if (name === "compat_map") return compatCommand(world, args);
	if (name === "place_portal") return placePortal(world, args);
	if (name === "spawn_entity") {
		const id = world.nextId;
		const drafted = makeSpawned(id, args);
		const entity = seatOffCenter(world, drafted, args);
		const entities = {
			...world.entities,
			[id]: entity
		};
		const shifted = Math.hypot(entity.transform.position.x - drafted.transform.position.x, entity.transform.position.z - drafted.transform.position.z) > .2;
		const tint = colorName(entity.customData.color);
		return {
			ok: true,
			detail: `Spawned '${entity.name}' as entity ${id}${tint !== "none" ? ` (${tint})` : ""}${shifted ? " off the platform center" : ""}`,
			world: {
				...world,
				entities,
				nextId: id + 1
			}
		};
	}
	if (name === "set_color") {
		const color = normalizeColor(args.color);
		if (!color) return {
			ok: false,
			detail: "argument 'color' must be a name such as red, blue, or teal",
			world
		};
		if (args.id?.trim() === "*") {
			let count = 0;
			const entities = { ...world.entities };
			for (const entity of Object.values(entities)) {
				if (entity.tags.includes("architect")) continue;
				entities[entity.id] = {
					...entity,
					customData: {
						...entity.customData,
						color
					}
				};
				count += 1;
			}
			if (!count) return {
				ok: false,
				detail: "no entities to color",
				world
			};
			return {
				ok: true,
				detail: `Colored ${count} entities ${colorName(color)}`,
				world: {
					...world,
					entities
				}
			};
		}
		const ids = parseIdList(args.id);
		if (!ids) return {
			ok: false,
			detail: "argument 'id' is not a valid u64",
			world
		};
		let entities = world.entities;
		const names = [];
		for (const id of ids) {
			const entity = entities[id];
			if (!entity) return {
				ok: false,
				detail: `entity ${id} not found`,
				world
			};
			entities = {
				...entities,
				[id]: {
					...entity,
					customData: {
						...entity.customData,
						color
					}
				}
			};
			names.push(entity.name);
		}
		return {
			ok: true,
			detail: `Colored ${names.join(", ")} ${colorName(color)}`,
			world: {
				...world,
				entities
			}
		};
	}
	if (name === "set_transform") {
		const ids = parseIdList(args.id);
		if (!ids) return {
			ok: false,
			detail: "argument 'id' is not a valid u64",
			world
		};
		const x = parseF32(args.x);
		const y = parseF32(args.y);
		const z = parseF32(args.z);
		if (x == null || y == null || z == null) return {
			ok: false,
			detail: "x, y, z must all be valid f32",
			world
		};
		let entities = world.entities;
		if (args.delta === "1" || ids.length > 1) {
			for (const id of ids) {
				const entity = entities[id];
				if (!entity) return {
					ok: false,
					detail: `entity ${id} not found`,
					world
				};
				const p = entity.transform.position;
				entities = {
					...entities,
					[id]: {
						...entity,
						transform: {
							...entity.transform,
							position: {
								x: p.x + x,
								y: p.y + y,
								z: p.z + z
							}
						}
					}
				};
			}
			return {
				ok: true,
				detail: `Nudged ${ids.length} entities`,
				world: {
					...world,
					entities
				}
			};
		}
		const id = ids[0];
		const entity = entities[id];
		if (!entity) return {
			ok: false,
			detail: `entity ${id} not found`,
			world
		};
		const next = {
			...entity,
			transform: {
				...entity.transform,
				position: {
					x,
					y,
					z
				}
			}
		};
		return {
			ok: true,
			detail: `Entity ${id} moved to (${x}, ${y}, ${z})`,
			world: {
				...world,
				entities: {
					...world.entities,
					[id]: next
				}
			}
		};
	}
	if (name === "apply_velocity") {
		const id = parseU64(args.id);
		if (id == null) return {
			ok: false,
			detail: "argument 'id' is not a valid u64",
			world
		};
		const vx = parseF32(args.vx);
		const vy = parseF32(args.vy);
		const vz = parseF32(args.vz);
		if (vx == null) return {
			ok: false,
			detail: "argument 'vx' is not a valid f32",
			world
		};
		if (vy == null) return {
			ok: false,
			detail: "argument 'vy' is not a valid f32",
			world
		};
		if (vz == null) return {
			ok: false,
			detail: "argument 'vz' is not a valid f32",
			world
		};
		const entity = world.entities[id];
		if (!entity) return {
			ok: false,
			detail: `entity ${id} not found`,
			world
		};
		if (entity.physics?.isKinematic) return {
			ok: false,
			detail: `entity ${id} is kinematic`,
			world
		};
		const body = entity.physics ? {
			...entity.physics,
			velocity: {
				x: vx,
				y: vy,
				z: vz
			},
			isKinematic: false
		} : {
			mass: 1,
			velocity: {
				x: vx,
				y: vy,
				z: vz
			},
			angularVelocity: V3(),
			isKinematic: false,
			solver: "rigid"
		};
		const next = {
			...entity,
			physics: body
		};
		return {
			ok: true,
			detail: `Entity ${id} velocity set to (${vx}, ${vy}, ${vz})`,
			world: {
				...world,
				entities: {
					...world.entities,
					[id]: next
				}
			}
		};
	}
	if (name === "build_play") {
		const kind = (args.kind ?? "").trim().toLowerCase();
		if (kind === "tetris") return {
			ok: true,
			detail: "Tetris is on the right. Run lets the piece fall. Left, right, rotate, and drop from the computer.",
			world: buildTetris(world)
		};
		if (kind === "marble") return {
			ok: true,
			detail: "Marble run is on the left. Run and the ball rides the ramps into the catch.",
			world: buildMarble(world)
		};
		return {
			ok: false,
			detail: "kind must be tetris or marble",
			world
		};
	}
	if (name === "play_move") {
		const move = (args.move ?? "drop").trim().toLowerCase();
		return {
			ok: true,
			detail: `Tetris ${move}`,
			world: playTetris(world, move)
		};
	}
	if (name === "query_scene") {
		const tag = args.tag ?? "";
		const found = queryByTag(world.entities, tag);
		const names = found.map((entity) => `${entity.name}#${entity.id}`);
		return {
			ok: true,
			detail: `Found ${found.length} entities with tag '${tag}': [${names.join(", ")}]`,
			world
		};
	}
	if (name === "edit_entity") return editEntities(world, args);
	if (name === "delete_entity") return deleteEntities(world, args.id);
	if (name === "undo") {
		const stack = world.undo ?? [];
		const snap = stack[stack.length - 1];
		if (!snap) return {
			ok: false,
			detail: "nothing to undo",
			world
		};
		return {
			ok: true,
			detail: "Undid the last change",
			world: {
				...world,
				entities: snap.entities,
				nextId: snap.nextId,
				skills: snap.skills ?? [],
				undo: stack.slice(0, -1)
			}
		};
	}
	if (name === "define_skill") {
		const skillName = (args.name ?? "").trim();
		const tool = (args.tool ?? "").trim();
		if (!/^[a-z][a-z0-9_]{1,40}$/.test(skillName)) return {
			ok: false,
			detail: "skill name must be a short identifier",
			world
		};
		if (!tool || tool === "define_skill" || tool === skillName) return {
			ok: false,
			detail: "skill needs an existing tool",
			world
		};
		if (!toolByName(tool) && !(world.skills ?? []).some((skill) => skill.name === tool)) return {
			ok: false,
			detail: `tool '${tool}' is not registered`,
			world
		};
		const next = registerSkill(world, {
			name: skillName,
			description: (args.description ?? skillName).slice(0, 160),
			job: (args.job ?? "edit").slice(0, 24),
			steps: [{
				tool,
				arguments: parsePairs(args.args)
			}]
		});
		const known = next.skills.some((item) => item.name === skillName);
		return {
			ok: known,
			detail: known ? `Skill '${skillName}' is available` : `could not save skill '${skillName}'`,
			world: next
		};
	}
	if (name === "control_avatar") {
		const move = (args.move ?? "").trim();
		if (![
			"forward",
			"back",
			"left",
			"right",
			"up",
			"down",
			"turn-left",
			"turn-right"
		].includes(move)) return {
			ok: false,
			detail: `move '${move || "?"}' is not a step or a turn`,
			world
		};
		const id = parseU64(args.id) ?? Object.values(world.entities).find((entity) => entity.tags.includes("architect"))?.id ?? null;
		if (id == null) return {
			ok: false,
			detail: "no body to control",
			world
		};
		const entity = world.entities[id];
		if (!entity) return {
			ok: false,
			detail: `entity ${id} not found`,
			world
		};
		const next = steer(entity, move);
		return {
			ok: true,
			detail: `${entity.name} ${move}`,
			world: {
				...world,
				entities: {
					...world.entities,
					[id]: next
				}
			}
		};
	}
	if (name === "spawn_agent") {
		const role = (args.role ?? "builder").trim().toLowerCase();
		if (role !== "builder" && role !== "critic" && role !== "scout") return {
			ok: false,
			detail: "role must be builder, critic, or scout",
			world
		};
		const given = (args.name ?? "").trim() || (role === "critic" ? "Critic" : role === "scout" ? "Scout" : "Builder");
		const slot = Object.values(world.entities).filter((entity) => entity.tags.includes("agent")).length;
		const agent = createAgent(world.nextId, given, role, slot);
		return {
			ok: true,
			detail: `Agent ${agent.name}#${agent.id} (${role}) is in the scene`,
			world: {
				...world,
				nextId: world.nextId + 1,
				entities: {
					...world.entities,
					[agent.id]: agent
				}
			}
		};
	}
	if (name === "set_asset") {
		const ids = parseIdList(args.id);
		if (!ids) return {
			ok: false,
			detail: "argument 'id' is not a valid u64",
			world
		};
		const src = (args.src ?? "").trim();
		const local = localTexture(src);
		if (!local && !allowedAssetUrl(src)) return {
			ok: false,
			detail: "asset url must be a Wikimedia image or a lab texture",
			world
		};
		const title = (args.title ?? (local || "reference")).slice(0, 80);
		let entities = world.entities;
		const names = [];
		for (const id of ids) {
			const entity = entities[id];
			if (!entity) return {
				ok: false,
				detail: `entity ${id} not found`,
				world
			};
			entities = {
				...entities,
				[id]: {
					...entity,
					customData: {
						...entity.customData,
						src,
						asset: title,
						page: args.page ?? entity.customData.page ?? ""
					}
				}
			};
			names.push(entity.name);
		}
		return {
			ok: true,
			detail: `Pulled '${title}' onto ${names.join(", ")}`,
			world: {
				...world,
				entities
			}
		};
	}
	if (name === "apply_method") {
		const which = (args.name ?? "gsplat").trim().toLowerCase();
		if (which === "xpbd" || which === "gpbd") return {
			ok: true,
			detail: "The marble run projects positions with Gauss-Seidel, a local stand-in for arXiv:2511.23131 (Towards Generalized Position-Based Dynamics). The paper's code is not downloaded or run.",
			world: buildMarble(world)
		};
		if (which === "nanite" || which === "meshlet" || which === "cluster") {
			const dag = clusterDag();
			const existing = Object.values(world.entities).find((entity) => entity.customData.method === "nanite");
			const note = `Cluster LOD is on the floor (${dag.leafTriangles} fine triangles, ${dag.nodes.length} clusters, one root). Walk up and the cut refines; back away and it stays coarse. Screen-space error is the one in Karis, Nanite: A Deep Dive (SIGGRAPH 2021) and zeux/meshoptimizer demo/nanite.cpp. The mesh is an indexed triangle list, the shape Blender exports. This is not Epic's Nanite, not Vulkan, and not nanite-webgpu.`;
			if (existing) return {
				ok: true,
				detail: note,
				world
			};
			const spawned = seatOffCenter(world, makeSpawned(world.nextId, {
				name: "Cluster",
				asset: "gem",
				x: "3.1",
				y: "0.9",
				z: "-1.4",
				color: "teal"
			}), {
				x: "3.1",
				y: "0.9",
				z: "-1.4"
			});
			spawned.customData = {
				...spawned.customData,
				method: "nanite",
				page: "https://advances.realtimerendering.com/s2021/index.html"
			};
			return {
				ok: true,
				detail: note,
				world: {
					...world,
					entities: {
						...world.entities,
						[spawned.id]: spawned
					},
					nextId: world.nextId + 1
				}
			};
		}
		const entities = { ...world.entities };
		const neural = Object.values(entities).find((entity) => entity.customData.neural === "splat") ?? Object.values(entities).find((entity) => entity.representation.kind === "gaussian");
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
					page: "https://arxiv.org/abs/2610.04351"
				}
			};
		}
		const anchor = seatOffCenter({
			...world,
			entities
		}, makeSpawned(world.nextId, {
			name: "LoCo",
			asset: "gem",
			x: "2.4",
			y: "0.6",
			z: "-1.6",
			color: "blue"
		}), {
			x: "2.4",
			y: "0.6",
			z: "-1.6"
		});
		entities[anchor.id] = anchor;
		return {
			ok: true,
			detail: "Densified the splat from its local neighborhood and marked the anchor with a gem. This is the in-engine stand-in for LoCoSplat (arXiv:2610.04351). Remote paper code is not executed.",
			world: {
				...world,
				entities,
				nextId: world.nextId + 1
			}
		};
	}
	if (name === "place_neural") {
		const palette = (args.palette ?? "").trim();
		if (!palette.includes("#")) return {
			ok: false,
			detail: "neural asset needs a palette",
			world
		};
		const shape = (args.shape ?? "blob").trim();
		const safeShape = shape === "column" || shape === "ring" || shape === "slab" ? shape : "blob";
		const title = (args.title ?? "Asset").trim().slice(0, 42) || "Asset";
		let id = parseU64(args.id);
		const entities = { ...world.entities };
		let nextId = world.nextId;
		if (id == null || !entities[id]) {
			const spawned = seatOffCenter(world, makeSpawned(nextId, {
				name: title,
				asset: "gaussian",
				x: "1.8",
				y: "1.2",
				z: "1.4"
			}), {
				x: "1.8",
				y: "1.2",
				z: "1.4"
			});
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
				page: (args.source ?? "").slice(0, 180)
			}
		};
		return {
			ok: true,
			detail: `Placed neural splat ${title} on ${entity.name}`,
			world: {
				...world,
				entities,
				nextId
			}
		};
	}
	return {
		ok: false,
		detail: `tool '${name}' is registered but not implemented`,
		world
	};
}
function parsePairs(value) {
	const args = {};
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
function patchEntity(entity, args) {
	let next = entity;
	let changed = false;
	const color = args.color ? normalizeColor(args.color) : null;
	if (color && color !== entity.customData.color) {
		next = {
			...next,
			customData: {
				...next.customData,
				color
			}
		};
		changed = true;
	}
	if (args.name && args.name !== entity.name) {
		next = {
			...next,
			name: args.name
		};
		changed = true;
	}
	if (args.asset) {
		const asset = args.asset.trim();
		const current = entity.representation.kind === "mesh" ? entity.representation.assetId : entity.representation.kind === "gaussian" ? "gaussian" : "";
		if (asset && asset !== current) {
			next = restyle(next, asset);
			changed = true;
		}
	}
	const factor = args.scale != null && args.scale.trim() !== "" ? Number(args.scale) : null;
	if (factor != null && Number.isFinite(factor) && factor > 0 && factor !== 1) {
		const clamped = Math.min(4, Math.max(.25, factor));
		const scale = next.transform.scale;
		next = {
			...next,
			transform: {
				...next.transform,
				scale: {
					x: scale.x * clamped,
					y: scale.y * clamped,
					z: scale.z * clamped
				}
			}
		};
		changed = true;
	}
	const x = parseF32(args.x);
	const y = parseF32(args.y);
	const z = parseF32(args.z);
	if (x != null && y != null && z != null) {
		const p = next.transform.position;
		if (p.x !== x || p.y !== y || p.z !== z) {
			next = {
				...next,
				transform: {
					...next.transform,
					position: {
						x,
						y,
						z
					}
				}
			};
			changed = true;
		}
	}
	return {
		entity: next,
		changed
	};
}
function editEntities(world, args) {
	const ids = args.id?.trim() === "*" ? live$1(world).map((entity) => entity.id) : parseIdList(args.id);
	if (!ids?.length) return {
		ok: false,
		detail: "argument 'id' is not a valid u64",
		world
	};
	let entities = world.entities;
	let changed = 0;
	for (const id of ids) {
		const entity = entities[id];
		if (!entity) return {
			ok: false,
			detail: `entity ${id} not found`,
			world
		};
		const patched = patchEntity(entity, args);
		if (!patched.changed) continue;
		entities = {
			...entities,
			[id]: patched.entity
		};
		changed += 1;
	}
	if (!changed) return {
		ok: false,
		detail: "edit changed nothing",
		world
	};
	const tint = args.color ? colorName(normalizeColor(args.color) ?? "") : "";
	return {
		ok: true,
		detail: `Edited ${changed} ${changed === 1 ? "entity" : "entities"}${tint && tint !== "none" ? ` (${tint})` : ""}`,
		world: {
			...world,
			entities
		}
	};
}
function deleteEntities(world, rawId) {
	const targets = rawId?.trim() === "*" ? live$1(world) : (() => {
		const ids = parseIdList(rawId);
		if (!ids) return null;
		const found = ids.map((id) => world.entities[id]).filter((entity) => Boolean(entity));
		return found.length === ids.length ? found : [];
	})();
	if (targets == null) return {
		ok: false,
		detail: "argument 'id' is not a valid u64",
		world
	};
	if (!targets.length) return {
		ok: false,
		detail: "nothing to delete",
		world
	};
	if (targets.find((entity) => entity.tags.includes("architect"))) return {
		ok: false,
		detail: "ArchitectAvatar is your body and stays. Move, turn, or recolor it.",
		world
	};
	const doomed = targets.filter((entity) => !entity.tags.includes("helm") && !entity.tags.includes("worn"));
	if (!doomed.length) return {
		ok: false,
		detail: "The helm stays on. It is the computer you wear.",
		world
	};
	const entities = { ...world.entities };
	for (const entity of doomed) delete entities[entity.id];
	const names = doomed.map((entity) => `${entity.name}#${entity.id}`).join(", ");
	return {
		ok: true,
		detail: `Deleted ${doomed.length}: ${names}`,
		world: {
			...world,
			entities
		}
	};
}
function runSkill(world, skill, args) {
	let current = world;
	const notes = [];
	for (const step of skill.steps) {
		if (step.tool === skill.name || step.tool === "define_skill") return {
			ok: false,
			detail: `skill '${skill.name}' cannot call itself`,
			world: current
		};
		const outcome = dispatchTool(current, step.tool, fillArgs(step.arguments, args));
		if (!outcome.ok) return {
			ok: false,
			detail: outcome.detail,
			world: current
		};
		current = outcome.world;
		notes.push(outcome.detail);
	}
	return {
		ok: true,
		detail: `Skill '${skill.name}': ${notes.join("; ") || "ok"}`,
		world: current
	};
}
function executeProposal(world, proposal) {
	if (proposal.kind !== "tool_call") {
		const result = proposal.message ?? "No action";
		return {
			world: recordEvent(world, result),
			result,
			ok: true
		};
	}
	const name = proposal.toolName;
	if (!name) {
		const result = "Tool call missing name";
		return {
			world: recordEvent(world, result),
			result,
			ok: false
		};
	}
	const outcome = dispatchTool(name === "undo" || name === "query_scene" ? world : remember(world), name, proposal.arguments);
	const settled = outcome.ok ? outcome.world : {
		...outcome.world,
		undo: world.undo ?? []
	};
	const result = outcome.ok ? outcome.detail : `Tool '${name}' failed: ${outcome.detail}`;
	return {
		world: record(settled, name, outcome.ok, outcome.detail),
		result,
		ok: outcome.ok
	};
}
var RESIDENT_MODELS = [
	{
		id: "gemma-3-270m",
		label: "Gemma 3 270M",
		short: "Gemma",
		family: "Gemma",
		repo: "unsloth/gemma-3-270m-it-GGUF",
		file: "gemma-3-270m-it-Q4_0.gguf",
		place: "in situ",
		size: "242 MB",
		blurb: "Google Gemma, running in this page.",
		outOfTheBox: true
	},
	{
		id: "gemma-4-e2b",
		label: "Gemma 4 E2B",
		short: "Gemma 4",
		family: "Gemma",
		repo: "unsloth/gemma-4-E2B-it-GGUF",
		file: "gemma-4-E2B-it-Q4_0.gguf",
		place: "in situ",
		size: "3.0 GB",
		blurb: "Larger Gemma. The weights download into this page.",
		outOfTheBox: false
	},
	{
		id: "qwen-0.5b",
		label: "Qwen 2.5 0.5B",
		short: "Qwen",
		family: "Qwen",
		repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
		file: "qwen2.5-0.5b-instruct-q4_0.gguf",
		place: "in situ",
		size: "429 MB",
		blurb: "A different model, same tools, still in this page.",
		outOfTheBox: false
	},
	{
		id: "spark-x2.5-4b",
		label: "Spark-X2.5-4B",
		short: "Spark",
		family: "Spark",
		repo: "PollardWeights/Spark-X2.5-4B-Pollard",
		file: "Spark-X2.5-4B-Pollard-IQ3_S.gguf",
		place: "in situ",
		size: "1.9 GB",
		blurb: "Spark-X2.5 4B. The 2.6 GB file downloads but never starts here, so this is the build this page can open.",
		outOfTheBox: false
	}
];
var DEFAULT_RESIDENT_ID = "gemma-3-270m";
function residentById(id) {
	return RESIDENT_MODELS.find((model) => model.id === id) ?? RESIDENT_MODELS[0];
}
function isResidentId(id) {
	return RESIDENT_MODELS.some((model) => model.id === id);
}
var wllama_default = "/assets/wllama-DrYkKwf9.wasm";
var STOP$1 = [
	"<end_of_turn>",
	"<start_of_turn>",
	"<|im_end|>",
	"<|eot_id|>",
	"<|im_start|>"
];
var ticket$1 = 0;
var engine$1 = null;
var ready$1 = false;
var inflight$1 = null;
var abort$1 = null;
function criticReady() {
	return ready$1 && engine$1 != null;
}
function releaseCritic() {
	ticket$1 += 1;
	inflight$1 = null;
	ready$1 = false;
	abort$1?.abort();
	abort$1 = null;
	const current = engine$1;
	engine$1 = null;
	if (current) current.exit().catch(() => void 0);
}
/** Second resident copy of Gemma, so a critic can sit beside the actor. */
function ensureCritic(onProgress) {
	if (typeof window === "undefined") return Promise.reject(/* @__PURE__ */ new Error("The critic runs in this page"));
	if (criticReady()) return Promise.resolve();
	if (inflight$1) return inflight$1;
	const mine = ++ticket$1;
	const spec = residentById(DEFAULT_RESIDENT_ID);
	const controller = new AbortController();
	abort$1 = controller;
	inflight$1 = (async () => {
		onProgress(0, "Loading the critic runtime");
		const { Wllama } = await import("./wllama-DkIxyDuf.mjs");
		if (mine !== ticket$1) return;
		onProgress(0, "Asking Hugging Face for the critic");
		const next = new Wllama({ default: wllama_default });
		engine$1 = next;
		let full = false;
		const stall = window.setTimeout(() => {
			if (full && mine === ticket$1 && !ready$1) controller.abort();
		}, 12e3);
		try {
			await next.loadModelFromHF({
				repo: spec.repo,
				file: spec.file
			}, {
				n_ctx: 768,
				n_threads: 1,
				n_batch: 64,
				signal: controller.signal,
				progressCallback: ({ loaded, total }) => {
					if (mine !== ticket$1) return;
					const progress = total > 0 ? Math.max(0, Math.min(100, loaded / total * 100)) : 0;
					if (progress >= 100) full = true;
					onProgress(progress, progress >= 100 ? "compiling critic" : spec.file);
				}
			});
		} finally {
			window.clearTimeout(stall);
		}
		if (mine !== ticket$1) {
			await next.exit().catch(() => void 0);
			return;
		}
		ready$1 = true;
	})().finally(() => {
		if (mine === ticket$1) inflight$1 = null;
	});
	return inflight$1;
}
async function completeCritic(prompt) {
	if (!engine$1 || !ready$1) throw new Error("critic is not loaded");
	return { text: (await engine$1.createChatCompletion({
		messages: [{
			role: "user",
			content: prompt
		}],
		max_tokens: 80,
		temperature: .2,
		top_k: 40,
		top_p: .9,
		chat_template_kwargs: { enable_thinking: false },
		stop: STOP$1
	})).choices?.[0]?.message?.content?.trim() ?? "" };
}
var FILE = String.raw`(?:inbox\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(?:md|txt|json)`;
var FILE_RE = new RegExp(`\\b(${FILE})\\b`, "i");
function clip(text, max) {
	return text.replace(/\s+/g, " ").trim().slice(0, max);
}
function filePath(intent) {
	const found = intent.match(new RegExp(`\\b(?:named|called|file)\\s+(${FILE})\\b`, "i"))?.[1] ?? intent.match(FILE_RE)?.[1];
	return found ? found.replace(/^inbox\//i, "inbox/") : null;
}
function noteBody(intent) {
	const colon = intent.match(/:\s*([\s\S]+)$/);
	if (colon?.[1].trim()) return clip(colon[1], 4e3);
	const says = intent.match(/\b(?:says|saying|reading)\s+([\s\S]+)$/i);
	return says?.[1] ? clip(says[1], 4e3) : "";
}
/**
* Module D, as a tool call. Notes and public pages only.
* A normal forge command, including "look up", stays on the existing path.
*/
function moduleDProposal(intent) {
	const lower = intent.toLowerCase();
	const sandbox = /\b(sandbox|loopback)\b/.test(lower);
	const url = intent.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, "") ?? "";
	if (sandbox && /\b(list|files|contents)\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "sandbox_list",
		arguments: { path: /\binbox\b/.test(lower) ? "inbox" : "." },
		message: "list sandbox notes"
	};
	if (sandbox && /\b(read|open|show|cat)\b/.test(lower)) {
		const path = filePath(intent);
		if (!path) return {
			kind: "tool_call",
			toolName: "sandbox_list",
			arguments: { path: "." },
			message: "list sandbox notes"
		};
		return {
			kind: "tool_call",
			toolName: "sandbox_read",
			arguments: { path },
			message: "read sandbox note"
		};
	}
	if (sandbox && /\b(write|save|file|note|put)\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "sandbox_write",
		arguments: {
			path: filePath(intent) ?? "note.md",
			text: noteBody(intent)
		},
		message: "write sandbox note"
	};
	if (url && /\b(fetch|ingest|browse|clean|file|save)\b/.test(lower)) return {
		kind: "tool_call",
		toolName: "search_web_clean",
		arguments: { query: url },
		message: "fetch a public page"
	};
	if (/\b(file|save)\b/.test(lower) && /\b(web page|webpage|article)\b/.test(lower)) {
		const query = clip(url || intent.replace(/\b(please|file|save|the|a|an|web page|webpage|article|about|into|the|sandbox)\b/gi, " "), 300);
		if (!query) return null;
		return {
			kind: "tool_call",
			toolName: "search_web_clean",
			arguments: { query },
			message: "file a public page"
		};
	}
	return null;
}
var EDIT_TOOLS = /* @__PURE__ */ new Set([
	"edit_entity",
	"set_color",
	"set_transform",
	"control_avatar"
]);
function roster(world) {
	return Object.values(world.entities).sort((a, b) => a.id - b.id);
}
function live(world) {
	return Object.values(world.entities).filter((entity) => !entity.tags.includes("architect")).sort((a, b) => a.id - b.id);
}
function assetOf(entity) {
	if (entity.representation.kind === "mesh") return entity.representation.assetId;
	if (entity.representation.kind === "gaussian") return "gaussian";
	return entity.representation.kind;
}
function fingerprint(entity) {
	const p = entity.transform.position;
	const s = entity.transform.scale;
	return [
		entity.name,
		assetOf(entity),
		entity.customData.color ?? "",
		p.x.toFixed(3),
		p.y.toFixed(3),
		p.z.toFixed(3),
		s.x.toFixed(3),
		s.y.toFixed(3),
		s.z.toFixed(3),
		entity.customData.yaw ?? "",
		entity.customData.src ?? ""
	].join("|");
}
function avatarOf(world) {
	return roster(world).find((entity) => entity.tags.includes("architect"));
}
function mentionsAvatar(intent) {
	return /\b(avatar|architect|yourself|myself|my body)\b/i.test(intent) || /\b(you|me)\b/i.test(intent);
}
function gesture(intent) {
	const lower = intent.toLowerCase();
	if (/\b(turn|look|face) left\b/.test(lower)) return "turn-left";
	if (/\b(turn|look|face) right\b/.test(lower)) return "turn-right";
	if (/\b(walk|step)\b/.test(lower) && /\b(back|backward)\b/.test(lower)) return "back";
	if (/\bforward\b/.test(lower) && /\b(walk|step|go|avatar|you|me)\b/.test(lower)) return "forward";
	if (/\bwalk\b/.test(lower) && !/\bback\b/.test(lower)) return "forward";
	if (/\b(strafe|step) left\b/.test(lower)) return "left";
	if (/\b(strafe|step) right\b/.test(lower)) return "right";
	if (/\b(jump|rise|go up)\b/.test(lower)) return "up";
	if (/\b(crouch|go down)\b/.test(lower)) return "down";
	return null;
}
var NUDGE = .85;
/** A named object sliding, not the avatar walking. */
function nudgeOf(intent) {
	const lower = intent.toLowerCase();
	if (/\b(turn|look|face|walk)\b/.test(lower)) return null;
	if (!/\b(move|nudge|shift|slide|reposition|put|place)\b/.test(lower)) return null;
	if (/\bleft\b/.test(lower)) return {
		x: -.85,
		y: 0,
		z: 0
	};
	if (/\bright\b/.test(lower)) return {
		x: NUDGE,
		y: 0,
		z: 0
	};
	if (/\b(forward|ahead)\b/.test(lower)) return {
		x: 0,
		y: 0,
		z: NUDGE
	};
	if (/\b(back|backward)\b/.test(lower)) return {
		x: 0,
		y: 0,
		z: -.85
	};
	if (/\bup\b/.test(lower)) return {
		x: 0,
		y: NUDGE,
		z: 0
	};
	if (/\bdown\b/.test(lower)) return {
		x: 0,
		y: -.85,
		z: 0
	};
	return null;
}
function agentRequest(intent) {
	if (!/\bagents?\b/i.test(intent)) return null;
	if (/\b(delete|remove|despawn|erase)\b/i.test(intent)) return null;
	const role = /critic/i.test(intent) ? "critic" : /scout/i.test(intent) ? "scout" : "builder";
	return {
		name: intent.match(/\bnamed\s+([A-Za-z][A-Za-z0-9_-]{0,24})/)?.[1] ?? (role === "critic" ? "Critic" : role === "scout" ? "Scout" : "Builder"),
		role
	};
}
function wantsSecondModel(intent) {
	return /\b(second model|critic model|another (lm|model)|load the critic)\b/i.test(intent) || /\bcritic\b/i.test(intent) && /\b(spawn|summon|create|add|ask|review|iterate)\b/i.test(intent);
}
var DIRECTION = /* @__PURE__ */ new Set([
	"left",
	"right",
	"forward",
	"back",
	"backward",
	"ahead",
	"up",
	"down"
]);
function jobOf(intent, world, selected, gaze) {
	const lower = intent.toLowerCase();
	if (moduleDProposal(intent)) return "field";
	if (deckProposal(intent)) return "field";
	if (compatProposal(intent)) return "field";
	if (portalProposal(intent)) return "field";
	if (/\b(undo|revert|rollback)\b/.test(lower) || /\bgo back\b/.test(lower)) return "undo";
	if (/\b(delete|remove|despawn|destroy|erase|clear)\b/.test(lower)) return "delete";
	if (/\b(nanite|meshlets?|virtual geometry|virtualized geometry|cluster lod)\b/.test(lower)) return "create";
	if (/\b(query|find|list|count|how many)\b/.test(lower)) return "query";
	if (/\b(push|velocity|impulse|shove|throw)\b/.test(lower)) return "push";
	if (meshKind(intent) && /\b(import|load|mesh)\b/.test(lower) && !/\b(onto|selected)\b/.test(lower)) return "create";
	const playing = /\b(piece|tetris|block)\b/.test(lower);
	const wantsNew = /\b(create|spawn|add|forge|summon)\b/.test(lower) || /\banother\b/.test(lower) || /\bmake (a|an|another|new)\b/.test(lower) || /\bdrop\b/.test(lower) && !playing;
	const editVerb = /\b(edit|change|recolor|recolour|paint|dye|tint|update|modify|move|resize|scale|rename|bigger|smaller|taller|shorter|turn|walk|step|wrap|import)\b/.test(lower);
	const pronoun = /\b(it|them|those|this|that|these|current|existing|already|selected)\b/.test(lower);
	const present = roster(world).length > 0;
	if (gesture(intent) && !wantsNew && present) return "edit";
	if ((editVerb || pronoun || focusId(world, intent, selected, gaze) != null || colorWord(intent) || mentionsAvatar(intent)) && !wantsNew && present) return "edit";
	if (wantsNew) return "create";
	if (live(world).length && (colorWord(intent) || editVerb)) return "edit";
	return "create";
}
function solidId(world, id, intent) {
	if (id == null || !Number.isFinite(id)) return null;
	const entity = world.entities[id];
	if (!entity || entity.tags.includes("floor") || entity.tags.includes("helm")) return null;
	if (entity.tags.includes("architect") && !mentionsAvatar(intent)) return null;
	return String(entity.id);
}
var GENERIC_NAME = /* @__PURE__ */ new Set([
	"piece",
	"block",
	"cube",
	"sphere",
	"platform",
	"pillar",
	"ring",
	"cell"
]);
function descriptorColors(intent) {
	const colors = colorMentions(intent);
	if (!colors.length) return [];
	const painting = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent);
	const identifies = (word) => new RegExp(`\\b${word}\\s+(block|blocks|piece|pieces|cube|cubes|sphere|spheres|orb|orbs|ball|balls|one|ones|cell|cells|brick|bricks|pillar|column|ring)\\b|\\b(?:the|a|an)\\s+${word}\\b`, "i").test(intent);
	if (!painting) return colors.filter(identifies);
	if (colors.length > 1) return colors.slice(0, -1).filter(identifies);
	return identifies(colors[0]) ? [colors[0]] : [];
}
function shapeWords(intent) {
	const lower = intent.toLowerCase();
	const shapes = [];
	if (/\b(blocks?|cells?|bricks?)\b/.test(lower)) shapes.push("block");
	if (/\bpieces?\b/.test(lower)) shapes.push("piece");
	if (/\bcubes?\b/.test(lower)) shapes.push("cube");
	if (/\b(spheres?|balls?|orbs?)\b/.test(lower)) shapes.push("sphere");
	if (/\b(pillars?|columns?)\b/.test(lower)) shapes.push("pillar");
	if (/\brings?\b/.test(lower)) shapes.push("ring");
	if (/\b(platforms?|slabs?)\b/.test(lower)) shapes.push("platform");
	return shapes;
}
function shapeOk(entity, shapes) {
	const asset = assetOf(entity);
	const cell = entity.tags.includes("live") || entity.tags.includes("locked");
	return shapes.some((shape) => {
		if (shape === "block" || shape === "piece") return cell;
		if (shape === "cube") return asset === "cube" && !cell;
		if (shape === "sphere") return asset === "sphere";
		if (shape === "pillar") return asset === "pillar";
		if (shape === "ring") return asset === "ring";
		if (shape === "platform") return asset === "platform";
		return asset === shape;
	});
}
function pieceLetter(intent) {
	const match = intent.toLowerCase().match(/\b([iotzsjl])(?:-|\s+)(?:piece|block|cell)s?\b|\b(?:piece|block)\s+([iotzsjl])\b|\bthe\s+([otszjl])\b/);
	const letter = match?.[1] || match?.[2] || match?.[3] || "";
	return letter ? letter.toUpperCase() : null;
}
/** A place in the sentence, not the direction of a nudge. "move left" is not "the left block". */
function spatialOf(intent) {
	const lower = intent.toLowerCase();
	if (/\b(leftmost|on the left|the left (?:block|piece|cube|cell|one|sphere|brick))\b/.test(lower)) return "left";
	if (/\b(rightmost|on the right|the right (?:block|piece|cube|cell|one|sphere|brick))\b/.test(lower)) return "right";
	if (/\b(topmost|highest|upper|the top|on top)\b/.test(lower)) return "top";
	if (/\b(bottommost|lowest|the bottom|the lower)\b/.test(lower)) return "bottom";
	if (/\b(nearest|closest|frontmost)\b/.test(lower)) return "front";
	if (/\b(farthest|furthest|backmost)\b/.test(lower)) return "back";
	return null;
}
function extreme(list, which, avatar) {
	const key = (entity) => {
		const p = entity.transform.position;
		if (which === "left") return p.x;
		if (which === "right") return -p.x;
		if (which === "top") return -p.y;
		if (which === "bottom") return p.y;
		if (which === "back") return -frontScore(entity, avatar);
		return frontScore(entity, avatar);
	};
	let best = Number.POSITIVE_INFINITY;
	for (const entity of list) best = Math.min(best, key(entity));
	return list.filter((entity) => key(entity) <= best + .05);
}
function frontScore(entity, avatar) {
	const yaw = Number(avatar?.customData.yaw) || 0;
	const fx = Math.sin(yaw);
	const fz = Math.cos(yaw);
	const origin = avatar?.transform.position ?? {
		x: 0,
		y: 0,
		z: 0
	};
	const dx = entity.transform.position.x - origin.x;
	const dz = entity.transform.position.z - origin.z;
	return -(dx * fx + dz * fz);
}
/**
* Objects named by a loose description: color, shape, tetris letter, or place.
* Returns one id, a comma list, or null when the sentence is not describing a thing.
*/
function describeTargets(world, intent, selected, gaze) {
	const avatar = avatarOf(world);
	let matches = live(world).filter((entity) => !entity.tags.includes("floor") && !entity.tags.includes("helm") && !entity.tags.includes("architect"));
	let used = false;
	const colors = descriptorColors(intent);
	if (colors.length) {
		used = true;
		matches = matches.filter((entity) => colors.some((color) => huesMatch(entity.customData.color, color)));
	}
	const shapes = shapeWords(intent);
	if (shapes.length) {
		used = true;
		matches = matches.filter((entity) => shapeOk(entity, shapes));
	}
	const letter = pieceLetter(intent);
	if (letter) {
		used = true;
		matches = matches.filter((entity) => (entity.customData.piece || "").toUpperCase() === letter);
	}
	const lower = intent.toLowerCase();
	if (/\b(falling|live)\b/.test(lower) || /\bthe piece\b/.test(lower) && !letter) {
		const falling = matches.filter((entity) => entity.tags.includes("live"));
		if (falling.length) {
			used = true;
			matches = falling;
		}
	}
	if (/\b(locked|stacked|settled|landed)\b/.test(lower)) {
		used = true;
		matches = matches.filter((entity) => entity.tags.includes("locked"));
	}
	const beside = lower.match(/\b(?:next to|beside|near)\s+(?:the\s+)?([a-z][\w-]*)/);
	if (beside && !DIRECTION.has(beside[1]) && !colorMentions(beside[1]).length) {
		const anchor = matches.find((entity) => entity.name.toLowerCase() === beside[1]) ?? live(world).find((entity) => entity.name.toLowerCase() === beside[1]);
		if (anchor) {
			used = true;
			const others = matches.filter((entity) => entity.id !== anchor.id);
			others.sort((a, b) => distance(a, anchor) - distance(b, anchor));
			matches = others.slice(0, 1);
		}
	}
	if (!used || !matches.length) return null;
	const spatial = spatialOf(intent);
	if (spatial) matches = extreme(matches, spatial, avatar);
	if (!matches.length) return null;
	if (matches.length === 1) return String(matches[0].id);
	if (/\b(it|this|that|selected|looking|looked|crosshair|cursor)\b/.test(lower)) {
		const seen = matches.find((entity) => entity.id === gaze) ?? matches.find((entity) => entity.id === selected);
		if (seen) return String(seen.id);
	}
	return matches.map((entity) => entity.id).join(",");
}
function distance(a, b) {
	const p = a.transform.position;
	const q = b.transform.position;
	return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}
/** id, "*", a comma list, or null. A color word is not a name. "Piece" is not a unique name. */
function focusId(world, intent, selected, gaze) {
	const props = live(world);
	const lower = intent.toLowerCase();
	const avatar = avatarOf(world);
	const moved = intent.match(/\b(?:move|reposition|shift|nudge|put|place)\s+(?:the\s+)?([A-Za-z][\w-]*)/i);
	if (moved && !DIRECTION.has(moved[1].toLowerCase())) {
		const named = props.find((entity) => entity.name.toLowerCase() === moved[1].toLowerCase());
		if (named) return String(named.id);
	}
	if (avatar && mentionsAvatar(intent) && !/\bagents?\b/i.test(lower)) return String(avatar.id);
	const material = texturePack(intent) ?? (/\b(paint|color|colour|recolor|recolour|dye|tint)\b/.test(lower) ? colorToken(intent) : null);
	let best = null;
	for (const entity of props) {
		const name = entity.name.toLowerCase();
		if (name.length < 2 || !lower.includes(name) || GENERIC_NAME.has(name)) continue;
		if (material && name === material && !new RegExp(`\\bthe\\s+${name}\\b`, "i").test(intent)) continue;
		if (colorMentions(name).length && new RegExp(`\\b${name}\\s+(block|blocks|piece|pieces|cell|cells|brick|bricks)\\b`, "i").test(intent)) continue;
		if (!best || entity.name.length > best.name.length) best = entity;
	}
	if (best) return String(best.id);
	const described = describeTargets(world, intent, selected, gaze);
	if (described) return described;
	for (const kind of [
		"platform",
		"pillar",
		"sphere",
		"ring",
		"gaussian",
		"cube",
		"gem",
		"knot",
		"vase",
		"crystal"
	]) {
		if (!lower.includes(kind)) continue;
		const matches = props.filter((entity) => assetOf(entity) === kind && !entity.tags.includes("floor") && !entity.tags.includes("helm"));
		if (matches.length === 1) return String(matches[0].id);
	}
	if (/\b(all|every|everything|current objects|them|those|these)\b/.test(lower) && props.length) return "*";
	if (/\b(it|this|that|selected|current|looking|looked|focused|focus|crosshair|cursor)\b/.test(lower) || nudgeOf(intent) != null || colorWord(intent) != null || texturePack(intent) != null) {
		const seen = solidId(world, gaze, intent) ?? solidId(world, selected, intent);
		if (seen) return seen;
	}
	const picked = selected != null ? world.entities[selected] : void 0;
	if (picked && !picked.tags.includes("floor") && (nudgeOf(intent) || /\b(it|this|that|selected|current)\b/.test(lower))) return String(picked.id);
	if (/\b(it|this|that|current)\b/.test(lower) && props.length) return String(props[props.length - 1].id);
	if (/\b(it|this|that|me|you)\b/.test(lower) && avatar) return String(avatar.id);
	if (gesture(intent) && avatar) return String(avatar.id);
	if (/\b(clear|scene)\b/.test(lower) && /\b(delete|remove|despawn|destroy|erase|clear)\b/.test(lower) && props.length) return "*";
	return null;
}
function colorToken(intent) {
	const colors = colorMentions(intent);
	return colors.length ? colors[colors.length - 1] : null;
}
function assetChange(intent) {
	return intent.match(/\b(?:into|make it a|make it an|turn it into|turn into)\s+(?:a\s+|an\s+)?(cube|sphere|platform|pillar|ring|gaussian)\b/i)?.[1]?.toLowerCase() ?? null;
}
function renameTo(intent) {
	return intent.match(/\b(?:rename(?:\s+\w+)?\s+to|call it|named)\s+([A-Za-z][A-Za-z0-9_-]{0,31})/i)?.[1] ?? null;
}
function scaleOf(intent) {
	if (/\b(bigger|larger|taller|grow)\b/i.test(intent)) return "1.45";
	if (/\b(smaller|shorter|shrink)\b/i.test(intent)) return "0.7";
	return intent.match(/\bscale\s+([0-9]+(?:\.[0-9]+)?)/i)?.[1] ?? null;
}
function coordsOf(intent, proposal) {
	if (!/\b(move|put|place|shift|position|to)\b/i.test(intent) && proposal.toolName !== "set_transform") return null;
	const fromArgs = [
		proposal.arguments.x,
		proposal.arguments.y,
		proposal.arguments.z
	];
	if (fromArgs.every((value) => value != null && value.trim() !== "" && Number.isFinite(Number(value)))) return {
		x: fromArgs[0],
		y: fromArgs[1],
		z: fromArgs[2]
	};
	const nums = [...intent.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value));
	if (nums.length < 3) return null;
	const [x, y, z] = nums.slice(-3);
	return {
		x: String(x),
		y: String(y),
		z: String(z)
	};
}
function editProposal(world, intent, proposal, selected, gaze) {
	const id = focusId(world, intent, selected, gaze) ?? (proposal.arguments.id?.trim() || null);
	if (!id) return {
		kind: "message",
		arguments: {},
		message: "Nothing matched. Say it loosely, like the yellow blocks, the left piece, or the blue sphere. Or look straight at it."
	};
	const painting = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent);
	const described = descriptorColors(intent);
	const asset = assetChange(intent);
	const name = renameTo(intent);
	const scale = scaleOf(intent);
	const coords = coordsOf(intent, proposal);
	const tint = colorWord(intent);
	const color = Boolean(tint) && (painting || described.length === 0 || !scale && !asset && !coords) ? tint : null;
	if (color && !asset && !name && !scale && !coords) return {
		kind: "tool_call",
		toolName: "set_color",
		arguments: {
			id,
			color
		},
		message: proposal.message
	};
	const args = { id };
	if (color) args.color = color;
	if (asset) args.asset = asset;
	if (name) args.name = name;
	if (scale) args.scale = scale;
	if (coords) Object.assign(args, coords);
	const beside = intent.match(/\b(?:next to|beside)\s+(?:the\s+)?([A-Za-z][\w-]*)/i);
	if (beside && !coords && !id.includes(",")) {
		const other = Object.values(world.entities).find((entity) => entity.name.toLowerCase() === beside[1].toLowerCase());
		const self = world.entities[Number(id)];
		if (other && self && other.id !== self.id) {
			args.x = String(Math.round((other.transform.position.x + 1.15) * 100) / 100);
			args.y = String(self.transform.position.y);
			args.z = String(other.transform.position.z);
		}
	}
	if (Object.keys(args).length === 1) return {
		kind: "message",
		arguments: {},
		message: "Name a color, position, size, or shape to edit the existing object."
	};
	return {
		kind: "tool_call",
		toolName: "edit_entity",
		arguments: args,
		message: proposal.message
	};
}
function deleteProposal(world, intent, selected, gaze) {
	const id = focusId(world, intent, selected, gaze);
	if (!id) return {
		kind: "message",
		arguments: {},
		message: "Name the object to delete, or say everything."
	};
	return {
		kind: "tool_call",
		toolName: "delete_entity",
		arguments: { id },
		message: "delete"
	};
}
function meshKind(intent) {
	const lower = intent.toLowerCase();
	if (/\b(gem|diamond|icosahedron)\b/.test(lower)) return "gem";
	if (/\b(knot|torus)\b/.test(lower)) return "knot";
	if (/\bvase\b/.test(lower)) return "vase";
	if (/\bcrystal\b/.test(lower)) return "crystal";
	if (/\bmesh\b/.test(lower)) return "gem";
	return null;
}
/** A texture pack named in the sentence. A bare color is not a pack, and "the clay red" stays a recolor. */
function texturePack(intent) {
	const lower = intent.toLowerCase();
	const named = lower.match(/\b(marble|circuit|chip|clay|ceramic|paper|steel|brick|grain|night)\b/);
	const wrapping = /\b(texture|wrap|albedo|coat|skin)\b/.test(lower);
	const painting = /\bpaint\b/.test(lower);
	if (!wrapping && !painting) return null;
	if (!named) return wrapping ? "marble" : null;
	const pack = named[1] === "chip" ? "circuit" : named[1] === "ceramic" ? "clay" : named[1];
	if (!wrapping && new RegExp(`\\bthe\\s+${pack}\\b`).test(lower)) return null;
	if ([...lower.matchAll(/\b(red|orange|amber|yellow|green|teal|blue|indigo|violet|pink|white|black|gray|grey|gold)\b/g)].map((match) => match[1]).some((color) => color !== pack)) return null;
	return pack;
}
function playMove(intent) {
	const lower = intent.toLowerCase();
	if (/\b(rotate|spin|turn the piece)\b/.test(lower)) return "rotate";
	if (/\b(hard drop|drop)\b/.test(lower)) return "drop";
	if (/\bleft\b/.test(lower)) return "left";
	if (/\bright\b/.test(lower)) return "right";
	return null;
}
function alignToJob(world, intent, proposal, selected, gaze) {
	const field = moduleDProposal(intent) ?? deckProposal(intent) ?? compatProposal(intent) ?? portalProposal(intent);
	if (field) return field;
	const coloring = /\b(paint|color|colour|recolor|recolour|dye|tint|wrap|texture)\b/i.test(intent);
	const board = Object.values(world.entities).some((entity) => entity.customData.play === "tetris");
	if (!coloring && board && (/\b(piece|block)\b/i.test(intent) || /\btetris\b/i.test(intent) && /\b(left|right|rotate|spin|drop)\b/i.test(intent) && !/\b(build|make|new|start)\b/i.test(intent))) return {
		kind: "tool_call",
		toolName: "play_move",
		arguments: { move: playMove(intent) ?? "drop" },
		message: proposal.message
	};
	if (!coloring && /\btetris\b/i.test(intent)) return {
		kind: "tool_call",
		toolName: "build_play",
		arguments: { kind: "tetris" },
		message: proposal.message
	};
	if (/\bmarble\b/i.test(intent) && /\b(run|game|track|course)\b/i.test(intent) && !/\btexture\b/i.test(intent)) return {
		kind: "tool_call",
		toolName: "build_play",
		arguments: { kind: "marble" },
		message: proposal.message
	};
	if (/\b(nanite|meshlets?|virtual geometry|virtualized geometry|cluster lod)\b/i.test(intent)) return {
		kind: "tool_call",
		toolName: "apply_method",
		arguments: { name: "nanite" },
		message: proposal.message
	};
	if (/\b(paper|arxiv|locosplat|gpbd|xpbd)\b/i.test(intent) || /\blatest\b/i.test(intent) && /\b(paper|research|code|method)\b/i.test(intent)) return {
		kind: "tool_call",
		toolName: "apply_method",
		arguments: { name: /\b(marble|physics|xpbd|pbd|position-based|position based)\b/i.test(intent) ? "xpbd" : "gsplat" },
		message: proposal.message
	};
	const tex = texturePack(intent);
	if (tex) {
		const id = focusId(world, intent, selected, gaze);
		if (!id || id === "*") return {
			kind: "message",
			arguments: {},
			message: "Look at a solid, or name it, before wrapping a texture."
		};
		return {
			kind: "tool_call",
			toolName: "set_asset",
			arguments: {
				id,
				src: `tex:${tex}`,
				title: tex
			},
			message: proposal.message
		};
	}
	const mesh = meshKind(intent);
	if (mesh && /\b(import|load|mesh|spawn|make|add)\b/i.test(intent)) {
		const id = focusId(world, intent, selected, gaze);
		if (/\b(onto|on|selected|retexture|restyle)\b/i.test(intent) && id && id !== "*") return {
			kind: "tool_call",
			toolName: "edit_entity",
			arguments: {
				id,
				asset: mesh
			},
			message: proposal.message
		};
		if (!/\b(onto|on the)\b/i.test(intent)) return {
			kind: "tool_call",
			toolName: "spawn_entity",
			arguments: {
				name: mesh[0].toUpperCase() + mesh.slice(1),
				asset: mesh,
				x: "2.2",
				y: "0",
				z: "1.3"
			},
			message: proposal.message
		};
	}
	const summoned = agentRequest(intent);
	if (summoned) return {
		kind: "tool_call",
		toolName: "spawn_agent",
		arguments: {
			name: summoned.name,
			role: summoned.role
		},
		message: proposal.message
	};
	const nudge = nudgeOf(intent);
	if (nudge && !mentionsAvatar(intent)) {
		const id = focusId(world, intent, selected, gaze);
		if (id && id !== "*") {
			const ids = id.split(",").filter((part) => {
				const entity = world.entities[Number(part)];
				return entity && !entity.tags.includes("architect") && !entity.tags.includes("floor");
			});
			if (ids.length > 1) return {
				kind: "tool_call",
				toolName: "set_transform",
				arguments: {
					id: ids.join(","),
					x: String(nudge.x),
					y: String(nudge.y),
					z: String(nudge.z),
					delta: "1"
				},
				message: proposal.message
			};
			const entity = ids.length === 1 ? world.entities[Number(ids[0])] : void 0;
			if (entity) {
				const p = entity.transform.position;
				return {
					kind: "tool_call",
					toolName: "set_transform",
					arguments: {
						id: String(entity.id),
						x: String(Math.round((p.x + nudge.x) * 100) / 100),
						y: String(Math.round((p.y + nudge.y) * 100) / 100),
						z: String(Math.round((p.z + nudge.z) * 100) / 100)
					},
					message: proposal.message
				};
			}
		}
	}
	const move = gesture(intent);
	if (move) {
		const id = focusId(world, intent, selected, gaze);
		if (!id || id === "*") return {
			kind: "message",
			arguments: {},
			message: "There is no body to move."
		};
		return {
			kind: "tool_call",
			toolName: "control_avatar",
			arguments: {
				id,
				move
			},
			message: proposal.message
		};
	}
	const job = jobOf(intent, world, selected, gaze);
	if (job === "delete" && mentionsAvatar(intent) && !/\bagents?\b/i.test(intent)) return {
		kind: "message",
		arguments: {},
		message: "ArchitectAvatar is your body and stays. Move, turn, or recolor it."
	};
	if (job === "undo") return {
		kind: "tool_call",
		toolName: "undo",
		arguments: {},
		message: proposal.message
	};
	if (job === "delete") {
		const resolved = focusId(world, intent, selected, gaze);
		if (resolved) return {
			kind: "tool_call",
			toolName: "delete_entity",
			arguments: { id: resolved },
			message: proposal.message
		};
		if (proposal.kind === "tool_call" && proposal.toolName === "delete_entity" && proposal.arguments.id) return proposal;
		return deleteProposal(world, intent, selected, gaze);
	}
	if (job === "edit") {
		if (focusId(world, intent, selected, gaze) || colorWord(intent)) return editProposal(world, intent, proposal, selected, gaze);
		if (proposal.kind === "tool_call" && EDIT_TOOLS.has(proposal.toolName ?? "") && proposal.arguments.id && (proposal.arguments.id === "*" || world.entities[Number(proposal.arguments.id)])) return proposal;
		const learned = (world.skills ?? []).find((skill) => skill.job === "edit" && skillMatches(skill, intent));
		if (learned) {
			const id = focusId(world, intent, selected, gaze);
			if (id) return {
				kind: "tool_call",
				toolName: learned.name,
				arguments: bindings(intent, proposal, id),
				message: `skill ${learned.name}`
			};
		}
		return editProposal(world, intent, proposal, selected, gaze);
	}
	if (job === "create" && proposal.kind === "tool_call" && proposal.toolName === "spawn_entity") return proposal;
	if (job === "query" && proposal.kind === "tool_call" && proposal.toolName === "query_scene") return proposal;
	if (job === "push") {
		const resolved = focusId(world, intent, selected, gaze);
		if (proposal.kind === "tool_call" && proposal.toolName === "apply_velocity" && resolved && resolved !== "*" && !resolved.includes(",")) return {
			...proposal,
			arguments: {
				...proposal.arguments,
				id: resolved
			}
		};
		if (proposal.kind === "tool_call" && proposal.toolName === "apply_velocity") return proposal;
	}
	return proposal;
}
function skillMatches(skill, intent) {
	const blob = JSON.stringify(skill.steps);
	if (blob.includes("$color")) return colorWord(intent) != null;
	if (blob.includes("$scale")) return scaleOf(intent) != null;
	if (blob.includes("$x")) return /\b(move|put|place|shift)\b/i.test(intent);
	return false;
}
function bindings(intent, proposal, id) {
	const args = { id };
	const color = colorWord(intent) ?? normalizeColor(proposal.arguments.color);
	if (color) args.color = color;
	const scale = scaleOf(intent);
	if (scale) args.scale = scale;
	const coords = coordsOf(intent, proposal);
	if (coords) Object.assign(args, coords);
	return args;
}
function verifyJob(job, before, after, intent, tool) {
	const beforeIds = new Set(live(before).map((entity) => entity.id));
	const afterIds = new Set(live(after).map((entity) => entity.id));
	const added = [...afterIds].filter((id) => !beforeIds.has(id));
	const removed = [...beforeIds].filter((id) => !afterIds.has(id));
	if (job === "edit") {
		if (added.length) return {
			ok: false,
			reason: "edit spawned a new object instead of changing one"
		};
		if (!roster(after).some((entity) => {
			const prior = before.entities[entity.id];
			return prior && fingerprint(prior) !== fingerprint(entity);
		})) return {
			ok: false,
			reason: "edit did not change an existing object"
		};
		const color = /\b(paint|color|colour|recolor|recolour|dye|tint)\b/i.test(intent) ? colorWord(intent) : null;
		if (color && !roster(after).some((entity) => entity.customData.color === color)) return {
			ok: false,
			reason: "the color did not land on an existing object"
		};
		return {
			ok: true,
			reason: "existing object updated"
		};
	}
	if (job === "delete") {
		if (!removed.length) return {
			ok: false,
			reason: "nothing was deleted"
		};
		if (added.length) return {
			ok: false,
			reason: "delete also spawned an object"
		};
		return {
			ok: true,
			reason: "object removed"
		};
	}
	if (job === "create") {
		if (!added.length) return {
			ok: false,
			reason: "nothing new was created"
		};
		return {
			ok: true,
			reason: "object created"
		};
	}
	if (job === "undo") {
		if (tool !== "undo") return {
			ok: false,
			reason: "undo did not run"
		};
		return {
			ok: true,
			reason: "reverted"
		};
	}
	if (job === "field") {
		const ok = tool === "sandbox_list" || tool === "sandbox_read" || tool === "sandbox_write" || tool === "search_web_clean" || tool === "deck_bridge" || tool === "compat_map" || tool === "place_portal";
		return {
			ok,
			reason: ok ? "sandbox loopback finished" : "not a sandbox tool"
		};
	}
	if (job === "query") return {
		ok: tool === "query_scene",
		reason: tool === "query_scene" ? "listed" : "not a query"
	};
	if (job === "push") return live(after).some((entity) => {
		const prior = before.entities[entity.id];
		const next = entity.physics?.velocity;
		const prev = prior?.physics?.velocity;
		return next && (next.x !== prev?.x || next.y !== prev?.y || next.z !== prev?.z);
	}) ? {
		ok: true,
		reason: "velocity set"
	} : {
		ok: false,
		reason: "nothing was pushed"
	};
	return {
		ok: false,
		reason: "unverified"
	};
}
function skillFrom(intent, job, proposal) {
	if (proposal.kind !== "tool_call" || !proposal.toolName) return null;
	const args = {};
	for (const [key, value] of Object.entries(proposal.arguments)) if (key === "id") args.id = "$id";
	else if (key === "color") args.color = "$color";
	else if (key === "scale") args.scale = "$scale";
	else if (key === "x" || key === "y" || key === "z") args[key] = `$${key}`;
	else args[key] = value;
	return {
		name: `${job}_${Object.keys(args).filter((key) => key !== "id").sort().join("_") || "act"}`.replace(/[^a-z0-9_]/g, ""),
		description: intent.slice(0, 120),
		job,
		steps: [{
			tool: proposal.toolName,
			arguments: args
		}]
	};
}
/**
* Run one architect command on the manifold.
* A call that does the wrong job is rolled back, repaired, and checked again.
* A repair that had to teach a new tool is saved as a skill.
*/
function runHarness(world, intent, proposal, selected, gaze) {
	const job = jobOf(intent, world, selected, gaze);
	const attempts = [];
	const first = alignToJob(world, intent, proposal, selected, gaze);
	if (first.kind !== "tool_call" || !first.toolName) {
		const detail = first.message ?? "No action";
		return {
			proposal: first,
			world,
			result: detail,
			ok: false,
			attempts: [{
				tool: "message",
				ok: false,
				detail
			}]
		};
	}
	const ran = executeProposal(world, first);
	const check = verifyJob(job, world, ran.world, intent, first.toolName);
	const passed = ran.ok && check.ok;
	attempts.push({
		tool: first.toolName ?? first.kind,
		ok: passed,
		detail: passed ? check.reason : ran.ok ? check.reason : ran.result
	});
	if (passed) {
		if (!(proposal.toolName && proposal.toolName !== first.toolName)) return {
			proposal: first,
			world: ran.world,
			result: ran.result,
			ok: true,
			attempts
		};
		const skill = skillFrom(intent, job, first);
		const taught = skill ? registerSkill(ran.world, skill) : ran.world;
		return {
			proposal: first,
			world: taught,
			result: Boolean(skill && taught.skills.some((item) => item.name === skill.name) && !(world.skills ?? []).some((item) => item.name === skill.name)) ? `${ran.result}\nSkill '${skill?.name}' saved. The harness can use it next time.` : ran.result,
			ok: true,
			attempts
		};
	}
	const repaired = alignToJob(world, intent, {
		kind: "message",
		arguments: {},
		message: check.reason
	}, selected, gaze);
	if (repaired.kind !== "tool_call" || repaired.toolName === first.toolName) return {
		proposal: first,
		world,
		result: ran.ok ? check.reason : ran.result,
		ok: false,
		attempts
	};
	const again = executeProposal(world, repaired);
	const second = verifyJob(job, world, again.world, intent, repaired.toolName);
	attempts.push({
		tool: repaired.toolName ?? "repair",
		ok: again.ok && second.ok,
		detail: again.ok && second.ok ? again.result : second.reason
	});
	if (!(again.ok && second.ok)) return {
		proposal: repaired,
		world,
		result: second.reason,
		ok: false,
		attempts
	};
	const skill = skillFrom(intent, job, repaired);
	const taught = skill ? registerSkill(again.world, skill) : again.world;
	return {
		proposal: repaired,
		world: taught,
		result: skill && taught.skills.some((item) => item.name === skill.name) && !(world.skills ?? []).some((item) => item.name === skill.name) ? `${again.result}\nSkill '${skill?.name}' saved for the next time.` : again.result,
		ok: true,
		attempts
	};
}
var MATERIALS = [
	{
		test: /\bmarble\b/i,
		palette: "#f4f1ec,#d9d3cb,#b7b1a8,#8e8880"
	},
	{
		test: /\b(gold|gilded|brass)\b/i,
		palette: "#f0d48a,#d4a24a,#a9782e,#6e4e1e"
	},
	{
		test: /\b(wood|timber|oak)\b/i,
		palette: "#e6d2b0,#c4a574,#8d5a32,#5c3a22"
	},
	{
		test: /\b(metal|steel|iron|chrome)\b/i,
		palette: "#eef1f4,#d5d8dd,#9aa3af,#6e7681"
	},
	{
		test: /\b(leaf|leaves|foliage|tree|moss|grass)\b/i,
		palette: "#8fd19a,#3cba6f,#1f6b3a,#0e3b22",
		shape: "column"
	},
	{
		test: /\b(water|sea|ocean|ice)\b/i,
		palette: "#d5e7f7,#7eb6e8,#4c8df5,#1d4e89"
	},
	{
		test: /\b(brick|clay|terracotta)\b/i,
		palette: "#d7a08a,#c46a4a,#a84832,#6e2e22"
	},
	{
		test: /\b(glass|crystal)\b/i,
		palette: "#ffffff,#e7f6f6,#9fd4d6,#4aa7ad"
	},
	{
		test: /\b(stone|rock|concrete|granite)\b/i,
		palette: "#e7e2da,#c8c2b8,#8a8178,#5c574f"
	}
];
function hash(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function shapeOf(text) {
	if (/\b(column|pillar|tower|tree|obelisk)\b/i.test(text)) return "column";
	if (/\b(ring|torus|wheel|halo)\b/i.test(text)) return "ring";
	if (/\b(slab|floor|ground|platform|rug|plane)\b/i.test(text)) return "slab";
	return "blob";
}
function paletteOf(text) {
	for (const material of MATERIALS) if (material.test.test(text)) return material;
	return { palette: "#d7c4a3,#8a8178,#4c8df5,#2a2c31" };
}
function neuralRecipe(name, summary, source) {
	const title = (name || "Asset").replace(/\s+/g, " ").trim().slice(0, 42) || "Asset";
	const blob = `${title} ${summary}`;
	const material = paletteOf(blob);
	const shape = shapeOf(blob) === "blob" && material.shape ? material.shape : shapeOf(blob);
	const draft = {
		id: `n${hash(title + source).toString(16).slice(0, 8)}`,
		name: title,
		kind: "splat",
		seed: hash(blob) % 1e5,
		count: 220,
		palette: material.palette,
		shape,
		source: source.slice(0, 180),
		bytes: 0
	};
	draft.bytes = JSON.stringify(draft).length;
	return draft;
}
function mergeLibrary(current, filed) {
	const next = [...current];
	for (const asset of filed) {
		if (!asset?.id || next.some((item) => item.id === asset.id)) continue;
		next.push(asset);
	}
	return next.slice(-24);
}
function hostId(world, intent) {
	if (mentionsAvatar(intent) || /\b(hold|wear|onto you)\b/i.test(intent)) {
		const avatar = avatarOf(world);
		if (avatar) return String(avatar.id);
	}
	const id = focusId(world, intent);
	if (id && id !== "*") return id;
	return null;
}
function skillId(name) {
	return `place_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 28) || "asset"}`.slice(0, 40);
}
/** File a compact splat and place it. The skill is the injected code that can place it again. */
function fileNeural(world, intent, note) {
	const asset = neuralRecipe(note.title || note.query || "Asset", `${intent} ${note.summary}`, note.source);
	const host = hostId(world, intent);
	const args = {
		title: asset.name,
		palette: asset.palette,
		seed: String(asset.seed),
		count: String(asset.count),
		shape: asset.shape,
		source: asset.source
	};
	if (host) args.id = host;
	const placed = executeProposal(world, {
		kind: "tool_call",
		toolName: "place_neural",
		arguments: args
	});
	const skill = skillId(asset.name);
	const withSkill = registerSkill(placed.ok ? placed.world : world, {
		name: skill,
		description: `Neural splat ${asset.name} (${asset.bytes} B) from ${asset.source || "a local guess"}`.slice(0, 160),
		job: "create",
		steps: [{
			tool: "place_neural",
			arguments: {
				...args,
				id: ""
			}
		}]
	});
	const where = note.source ? `from ${note.source}` : "without a web page, from the words in the command";
	return {
		ok: true,
		world: withSkill,
		result: `Filed ${asset.name} as a ${asset.bytes} B neural splat ${where}. Injected skill ${skill}.`,
		proposal: {
			kind: "tool_call",
			toolName: "place_neural",
			arguments: args,
			message: "neural asset"
		},
		asset
	};
}
var TOOL_SET = new Set(TOOL_NAMES);
var ASSETS = [
	"cube",
	"sphere",
	"platform",
	"pillar",
	"ring",
	"gaussian"
];
var COLOR_NAMES = NAMED_COLORS.map((color) => color.name).filter((name) => name !== "gray" && name !== "stone");
/** Tool notes passed into the resident model in the shape llama.cpp expects. */
var FORGE_TOOLS = TOOLS$1.filter((tool) => tool.name !== "define_skill" && tool.name !== "set_asset" && tool.name !== "place_neural" && tool.name !== "sandbox_list" && tool.name !== "sandbox_read" && tool.name !== "sandbox_write" && tool.name !== "search_web_clean" && tool.name !== "deck_bridge" && tool.name !== "compat_map" && tool.name !== "place_portal").map((tool) => ({
	type: "function",
	function: {
		name: tool.name,
		description: tool.description,
		parameters: {
			type: "object",
			properties: Object.fromEntries(Object.entries(tool.parameters).map(([key, kind]) => [key, key === "asset" ? {
				type: "string",
				enum: [...ASSETS]
			} : key === "color" ? {
				type: "string",
				enum: COLOR_NAMES
			} : kind === "string" ? { type: "string" } : { type: "number" }])),
			required: Object.keys(tool.parameters).filter((key) => !tool.optional?.includes(key))
		}
	}
}));
/**
* Forces one tool-call object. Edit tools are listed before spawn so a flat
* distribution does not default to creating another object.
*/
var TOOL_GRAMMAR = `
root ::= steer | agent | undo | del | editc | editp | edits | paint | xform | vel | query | spawn | spawnc
steer ::= "{" "\\"tool\\":\\"control_avatar\\"" "," "\\"move\\":\\"" ("forward" | "back" | "left" | "right" | "up" | "down" | "turn-left" | "turn-right") "\\"" "}"
agent ::= "{" "\\"tool\\":\\"spawn_agent\\"" "," "\\"name\\":\\"" ident "\\"" "," "\\"role\\":\\"" ("builder" | "critic" | "scout") "\\"" "}"
undo ::= "{" "\\"tool\\":\\"undo\\"" "}"
del ::= "{" "\\"tool\\":\\"delete_entity\\"" "," id "}"
editc ::= "{" "\\"tool\\":\\"edit_entity\\"" "," id "," "\\"color\\":\\"" color "\\"" "}"
editp ::= "{" "\\"tool\\":\\"edit_entity\\"" "," id "," x "," y "," z "}"
edits ::= "{" "\\"tool\\":\\"edit_entity\\"" "," id "," "\\"scale\\":" num "}"
paint ::= "{" "\\"tool\\":\\"set_color\\"" "," id "," "\\"color\\":\\"" color "\\"" "}"
xform ::= "{" "\\"tool\\":\\"set_transform\\"" "," id "," x "," y "," z "}"
vel ::= "{" "\\"tool\\":\\"apply_velocity\\"" "," id "," vx "," vy "," vz "}"
query ::= "{" "\\"tool\\":\\"query_scene\\"" "," tag "}"
spawn ::= "{" "\\"tool\\":\\"spawn_entity\\"" "," name "," x "," y "," z "," asset "}"
spawnc ::= "{" "\\"tool\\":\\"spawn_entity\\"" "," name "," x "," y "," z "," asset "," "\\"color\\":\\"" color "\\"" "}"
name ::= "\\"name\\":\\"" ident "\\""
tag ::= "\\"tag\\":\\"" ident "\\""
asset ::= "\\"asset\\":\\"" ("cube" | "sphere" | "platform" | "pillar" | "ring" | "gaussian") "\\""
id ::= "\\"id\\":" num | "\\"id\\":\\"*\\""
x ::= "\\"x\\":" num
y ::= "\\"y\\":" num
z ::= "\\"z\\":" num
vx ::= "\\"vx\\":" num
vy ::= "\\"vy\\":" num
vz ::= "\\"vz\\":" num
color ::= ${COLOR_NAMES.map((name) => `"${name}"`).join(" | ")}
ident ::= [A-Za-z] [A-Za-z0-9_-]*
num ::= "-"? [0-9]+ ("." [0-9]+)?
`.trim();
function asArgs(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const args = {};
	for (const [key, item] of Object.entries(value)) {
		if (key === "tool" || key === "message" || key === "arguments") continue;
		if (item == null) continue;
		if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") args[key] = String(item);
	}
	return args;
}
function extractJsonObject(text) {
	const starts = [];
	for (let index = 0; index < text.length; index += 1) if (text[index] === "{") starts.push(index);
	for (let index = starts.length - 1; index >= 0; index -= 1) {
		const slice = text.slice(starts[index]);
		const end = slice.lastIndexOf("}");
		if (end <= 0) continue;
		try {
			const parsed = JSON.parse(slice.slice(0, end + 1));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
			const json = parsed;
			const named = typeof json.tool === "string" ? json.tool : typeof json.name === "string" ? json.name : "";
			if (TOOL_SET.has(named) || "message" in json || "tool" in json) return json;
		} catch {}
	}
	return null;
}
/** Pull one tool call out of a resident model's raw text. Never invents a call. */
function parseResidentReply(raw) {
	const text = raw.replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/gi, "").trim();
	const json = extractJsonObject(text);
	if (!json) return {
		kind: "message",
		arguments: {},
		message: text || "(empty model reply)"
	};
	const named = typeof json.tool === "string" ? json.tool : typeof json.name === "string" ? json.name : "";
	if (!named || named === "null" || !TOOL_SET.has(named)) return {
		kind: "message",
		arguments: {},
		message: typeof json.message === "string" && json.message.trim() ? json.message.trim() : text
	};
	const nested = asArgs(json.arguments);
	const flat = asArgs(json);
	return {
		kind: "tool_call",
		toolName: named,
		arguments: Object.keys(nested).length ? nested : flat,
		message: "in situ"
	};
}
function proposalFromToolCalls(calls) {
	for (const call of calls) {
		if (!call.name || !TOOL_SET.has(call.name)) continue;
		let parsed = {};
		if (call.arguments.trim()) try {
			parsed = JSON.parse(call.arguments);
		} catch {
			parsed = {};
		}
		return {
			kind: "tool_call",
			toolName: call.name,
			arguments: asArgs(parsed),
			message: "in situ"
		};
	}
	return null;
}
/**
* The model proposes a tool. The harness then checks that the tool matches the
* job, so a spawn cannot stand in for an edit, a delete, or an undo.
*/
function interpretResident(world, label, intent, raw, toolCalls, model) {
	const parsed = proposalFromToolCalls(toolCalls) ?? parseResidentReply(raw);
	const aligned = alignToJob(world, intent, parsed);
	if (aligned.kind === "tool_call" && executeProposal(world, aligned).ok) {
		const redirected = aligned.toolName !== parsed.toolName;
		return {
			...aligned,
			message: redirected ? `${label} chose ${aligned.toolName} after the harness checked the scene.` : `${label} chose ${aligned.toolName}`
		};
	}
	const read = alignToJob(world, intent, propose(model, intent, sceneRefs(world.entities), TOOL_NAMES));
	if (read.kind === "tool_call" && executeProposal(world, read).ok) return {
		...read,
		message: `${label} did not choose a tool, so the harness read the command.`
	};
	if (aligned.kind === "message" && aligned.message) return aligned;
	return {
		kind: "message",
		arguments: {},
		message: `${label} did not choose a tool.`
	};
}
function residentPrompt(scene, intent) {
	return [
		"Choose the one tool that fits the command. Reply with one JSON object and no other text.",
		"Entity 1 ArchitectAvatar is you. Move, turn, recolor, and resize that body. Never delete it.",
		"control_avatar steps you: move is forward, back, left, right, up, down, turn-left, or turn-right.",
		"spawn_agent adds another body. role is builder, critic, or scout. A critic is the second model.",
		"spawn_entity creates a NEW object only: name, x, y, z, asset, optional color.",
		"Never spawn to edit, recolor, move, resize, rename, or delete an object already listed.",
		"edit_entity changes an existing id: id plus color, x, y, z, scale, asset, or name.",
		"set_color recolors an existing id. set_transform moves an existing id. id may be one number or a comma list.",
		"You do not need an exact name. the yellow blocks, the left piece, the blue sphere, and the terminal are enough.",
		"delete_entity removes an existing id. id * removes every object except the avatar.",
		"undo reverts the last change. apply_velocity pushes an id. query_scene lists a tag.",
		"asset is cube, sphere, platform, pillar, ring, or gaussian.",
		`color is ${COLOR_NAMES.join(", ")}.`,
		"A new object sits on the platform, off its center.",
		"Scene id name asset color x,y,z:",
		scene || "(empty)",
		`Command: ${intent}`
	].join("\n");
}
var STOP = [
	"<end_of_turn>",
	"<start_of_turn>",
	"<|im_end|>",
	"<|eot_id|>",
	"<|im_start|>",
	"<｜end▁of▁sentence｜>",
	"<｜start▁of▁sentence｜>"
];
var ticket = 0;
var engine = null;
var currentId = null;
var ready = false;
var inflight = null;
var inflightId = null;
var abort = null;
function residentReady(id) {
	return ready && currentId === id && engine != null;
}
function releaseResident() {
	ticket += 1;
	inflight = null;
	inflightId = null;
	ready = false;
	currentId = null;
	abort?.abort();
	abort = null;
	const current = engine;
	engine = null;
	if (current) current.exit().catch(() => void 0);
}
function ensureResident(id, onProgress) {
	if (typeof window === "undefined") return Promise.reject(/* @__PURE__ */ new Error("In-situ models run in the page"));
	if (residentReady(id)) return Promise.resolve();
	if (inflight && inflightId === id) return inflight;
	const mine = ++ticket;
	inflightId = id;
	const spec = residentById(id);
	const controller = new AbortController();
	abort = controller;
	inflight = (async () => {
		onProgress(0, "Loading the runtime");
		const { Wllama } = await import("./wllama-DkIxyDuf.mjs");
		if (mine !== ticket) return;
		onProgress(0, "Asking Hugging Face for the weights");
		const next = new Wllama({ default: wllama_default });
		engine = next;
		currentId = id;
		const heavy = spec.id === "spark-x2.5-4b";
		let downloaded = false;
		let compileTimer;
		const load = next.loadModelFromHF({
			repo: spec.repo,
			file: spec.file
		}, {
			n_ctx: heavy ? 512 : 1024,
			n_threads: 1,
			n_batch: heavy ? 64 : 128,
			n_parallel: heavy ? 1 : void 0,
			n_gpu_layers: 0,
			flash_attn: heavy ? false : void 0,
			warmup: false,
			cache_type_k: heavy ? "q8_0" : void 0,
			cache_type_v: heavy ? "q8_0" : void 0,
			signal: controller.signal,
			progressCallback: ({ loaded, total }) => {
				if (mine !== ticket) return;
				const progress = total > 0 ? Math.max(0, Math.min(100, loaded / total * 100)) : 0;
				if (progress >= 100 && !downloaded) {
					downloaded = true;
					compileTimer = setTimeout(() => {
						if (mine !== ticket || ready) return;
						controller.abort();
					}, heavy ? 24e4 : 12e4);
				}
				onProgress(progress, progress >= 100 ? "Starting the model" : spec.file, {
					loaded,
					total
				});
			}
		});
		const hung = new Promise((_, reject) => {
			controller.signal.addEventListener("abort", () => {
				if (ready || mine !== ticket) return;
				reject(/* @__PURE__ */ new Error(downloaded ? heavy ? "Spark's weights are in this page, but the runtime did not start. This page can only open a model under 2 GB." : "The weights downloaded, but the runtime did not start." : "The download was stopped."));
			});
		});
		try {
			await Promise.race([load, hung]);
		} catch (error) {
			if (mine === ticket) {
				ready = false;
				currentId = null;
				const current = engine;
				engine = null;
				current?.exit().catch(() => void 0);
			}
			throw error;
		} finally {
			if (compileTimer) clearTimeout(compileTimer);
		}
		if (mine !== ticket) {
			await next.exit().catch(() => void 0);
			return;
		}
		ready = true;
	})().finally(() => {
		if (inflightId === id && mine === ticket) inflight = null;
	});
	return inflight;
}
function readTurn(result, label) {
	const message = result.choices?.[0]?.message;
	const toolCalls = (message?.tool_calls ?? []).map((call) => ({
		name: call.function?.name ?? "",
		arguments: call.function?.arguments ?? ""
	})).filter((call) => call.name);
	return {
		text: (message?.content?.trim() ?? "") || (toolCalls.length ? "" : `(${label} returned nothing)`),
		toolCalls
	};
}
async function completeResident(prompt) {
	if (!engine || !ready || !currentId) throw new Error("model is not loaded");
	const spec = residentById(currentId);
	const sampling = {
		max_tokens: 128,
		temperature: .3,
		top_k: 200,
		top_p: .95,
		min_p: 0,
		chat_template_kwargs: { enable_thinking: false },
		stop: STOP
	};
	const messages = [{
		role: "user",
		content: prompt
	}];
	try {
		return readTurn(await engine.createChatCompletion({
			...sampling,
			messages,
			tools: FORGE_TOOLS,
			tool_choice: "required",
			grammar: TOOL_GRAMMAR
		}), spec.label);
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (/abort/i.test(message)) throw error;
		return readTurn(await engine.createChatCompletion({
			...sampling,
			messages
		}), spec.label);
	}
}
var TOOLS = /* @__PURE__ */ new Set([
	"sandbox_list",
	"sandbox_read",
	"sandbox_write",
	"search_web_clean"
]);
var runModuleD = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("bad input");
	const raw = input;
	const tool = typeof raw.tool === "string" ? raw.tool : "";
	if (!TOOLS.has(tool)) throw new Error("tool not allowed");
	const source = raw.arguments && typeof raw.arguments === "object" ? raw.arguments : {};
	const args = {};
	for (const key of [
		"path",
		"text",
		"query"
	]) {
		const value = source[key];
		if (typeof value === "string") args[key] = value.slice(0, key === "text" ? 4e3 : 300);
	}
	return {
		tool,
		arguments: args
	};
}).handler(createSsrRpc("8beb6ce27e04aed979a6761d867897517b0c9bf8256367b942c8d11bcb83fa82"));
function parseCritic(text) {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) return {
		pass: true,
		fix: ""
	};
	try {
		const parsed = JSON.parse(match[0]);
		return {
			pass: parsed.pass !== false && parsed.pass !== "false",
			fix: typeof parsed.fix === "string" ? parsed.fix.replace(/\s+/g, " ").trim().slice(0, 240) : ""
		};
	} catch {
		return {
			pass: true,
			fix: ""
		};
	}
}
function criticPrompt(scene, intent) {
	return [
		"You are the second model, a critic sitting in the same scene.",
		"The actor is handling the command at the same time. Reply with one JSON object and no other text.",
		"{\"pass\":true} if the scene will already satisfy the command.",
		"{\"pass\":false,\"fix\":\"one short command\"} if the actor should do something else.",
		"The avatar is the actor's body. Edit it. Do not delete it.",
		"Scene:",
		scene || "(empty)",
		`Command: ${intent}`
	].join("\n");
}
function traceFrom(proposal, world, result, ok) {
	return {
		proposal,
		world,
		result,
		ok,
		attempts: [{
			tool: proposal.toolName ?? proposal.kind,
			ok,
			detail: result
		}]
	};
}
function blankNote(query) {
	return {
		ok: false,
		query,
		summary: "",
		title: query || "Asset",
		source: "",
		imageUrl: ""
	};
}
function isSceneCommand(intent) {
	return /\b(make|spawn|create|add|forge|build|paint|color|colour|move|walk|turn|edit|scale|resize|bigger|smaller|delete|remove|undo|push|nudge|platform|pillar|sphere|ring|cube|avatar|agent|tetris|marble|mesh|texture|wrap|import|paper|method|nanite|meshlet|geometry)\b/i.test(intent);
}
function askedForSplat(intent) {
	return wantsAsset(intent);
}
function filedTrace(world, intent, note) {
	const filed = fileNeural(world, intent, note);
	return {
		trace: traceFrom(filed.proposal, filed.world, filed.result, true),
		filed: [filed.asset]
	};
}
/** Run a tool call found in a page, or one the harness can write itself. Never eval raw script. */
function injectCall(world, intent, text) {
	const call = codeFromText(text);
	if (!call) return null;
	const ran = executeProposal(world, {
		kind: "tool_call",
		toolName: call.tool,
		arguments: call.arguments
	});
	const name = `web_${fieldQuery(intent).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "snippet"}`;
	const withSkill = registerSkill(ran.world, {
		name,
		description: `Injected ${call.tool} from a web snippet`.slice(0, 160),
		job: "create",
		steps: [{
			tool: call.tool,
			arguments: call.arguments
		}]
	});
	return traceFrom({
		kind: "tool_call",
		toolName: call.tool,
		arguments: call.arguments,
		message: "injected snippet"
	}, withSkill, ran.ok ? `${ran.result} Injected skill ${name}.` : ran.result, ran.ok);
}
/**
* The scene command runs first and stays a solid mesh.
* A splat is filed only when the command asks for one.
*/
async function settleIntent(opts) {
	const notes = [{
		tone: "user",
		title: "Intent",
		body: opts.intent
	}];
	const field = moduleDProposal(opts.intent);
	if (field?.kind === "tool_call" && field.toolName) {
		if (!opts.moduleD) {
			const detail = "The sandbox loopback is not connected.";
			notes.push({
				tone: "warn",
				title: "Sandbox",
				body: detail
			});
			return {
				trace: traceFrom(field, opts.world, detail, false),
				notes,
				filed: []
			};
		}
		const result = await opts.moduleD({
			tool: field.toolName,
			arguments: field.arguments
		});
		notes.push({
			tone: result.ok ? "engine" : "warn",
			title: field.toolName === "search_web_clean" ? "Ingest" : "Sandbox",
			body: result.detail
		});
		return {
			trace: traceFrom(field, opts.world, result.detail, result.ok),
			notes,
			filed: []
		};
	}
	const askedWeb = wantsWeb(opts.intent);
	const askedAsset = wantsAsset(opts.intent);
	const sceneCommand = isSceneCommand(opts.intent);
	let filed = [];
	let trace = traceFrom({
		kind: "message",
		arguments: {},
		message: "No action"
	}, opts.world, "No action", false);
	if (sceneCommand && !askedAsset || !askedWeb && !askedAsset) {
		let proposal;
		try {
			const turn = await opts.proposeTurn(residentPrompt(opts.scene, opts.intent));
			const parsed = (turn.toolCalls.length ? proposalFromToolCalls(turn.toolCalls) : null) ?? parseResidentReply(turn.text);
			proposal = parsed.kind === "tool_call" ? parsed : interpretResident(opts.world, opts.label, opts.intent, turn.text, turn.toolCalls, opts.model);
			if (proposal.toolName === "place_neural" && !askedForSplat(opts.intent)) proposal = interpretResident(opts.world, opts.label, opts.intent, "", [], opts.model);
		} catch (error) {
			const message = error instanceof Error ? error.message : "generation failed";
			proposal = interpretResident(opts.world, opts.label, opts.intent, message, [], opts.model);
		}
		trace = runHarness(opts.world, opts.intent, proposal, opts.focus, opts.gaze);
		if (!trace.ok && !isRefusal(trace.result)) {
			const local = interpretResident(opts.world, opts.label, opts.intent, trace.result, [], opts.model);
			const again = runHarness(opts.world, opts.intent, local, opts.focus, opts.gaze);
			notes.push({
				tone: again.ok ? "engine" : "warn",
				title: "Extrapolate",
				body: again.ok ? again.result : "The tools could not finish that on their own."
			});
			if (again.ok) trace = again;
		}
	}
	if ((askedWeb || askedForSplat(opts.intent) || isLearning(opts.intent)) && !compatProposal(opts.intent)) {
		notes.push({
			tone: "engine",
			title: "Web",
			body: "Searching the open web, not only Wikipedia."
		});
		try {
			const note = await opts.research(opts.intent, trace.ok ? "" : trace.result);
			notes.push({
				tone: "engine",
				title: "Web",
				body: [
					note.title,
					note.summary,
					note.source
				].filter(Boolean).join("\n") || note.error || "Nothing useful came back."
			});
			const injected = injectCall(trace.ok ? trace.world : opts.world, opts.intent, `${note.summary}\n${opts.intent}`);
			const host = focusId(trace.world, opts.intent, opts.focus, opts.gaze);
			const texture = Boolean(note.imageUrl) && !/\b(splat|neural|gaussian)\b/i.test(opts.intent);
			if (texture && host && host !== "*") {
				const painted = executeProposal(trace.ok ? trace.world : opts.world, {
					kind: "tool_call",
					toolName: "set_asset",
					arguments: {
						id: host,
						src: note.imageUrl,
						title: note.title || "Texture",
						page: note.source
					}
				});
				notes.push({
					tone: painted.ok ? "engine" : "warn",
					title: "Texture",
					body: painted.result
				});
				if (painted.ok) trace = traceFrom({
					kind: "tool_call",
					toolName: "set_asset",
					arguments: {
						id: host,
						src: note.imageUrl
					},
					message: "texture"
				}, painted.world, painted.result, true);
			} else if (injected?.ok && !texture) {
				notes.push({
					tone: "engine",
					title: "Inject",
					body: injected.result
				});
				trace = injected;
			} else if (askedForSplat(opts.intent) && filed.length === 0) {
				const pulled = filedTrace(opts.world, opts.intent, note.title || note.summary ? note : blankNote(opts.intent));
				notes.push({
					tone: "engine",
					title: "Library",
					body: pulled.trace.result
				});
				trace = pulled.trace;
				filed = pulled.filed;
			} else if (!sceneCommand && !trace.ok && (note.summary || note.source)) trace = traceFrom({
				kind: "message",
				arguments: {},
				message: note.summary || note.title
			}, opts.world, note.summary || note.error || "No page matched.", Boolean(note.summary || note.source));
		} catch (error) {
			const message = error instanceof Error ? error.message : "lookup failed";
			notes.push({
				tone: "warn",
				title: "Web",
				body: message
			});
			if (askedForSplat(opts.intent) && filed.length === 0) {
				const pulled = filedTrace(opts.world, opts.intent, blankNote(opts.intent));
				notes.push({
					tone: "engine",
					title: "Library",
					body: `${pulled.trace.result} The web missed, so this recipe is local.`
				});
				trace = pulled.trace;
				filed = pulled.filed;
			}
		}
	}
	if (opts.critiqueTurn && !isRefusal(trace.result)) try {
		const review = parseCritic((await opts.critiqueTurn(criticPrompt(opts.scene, opts.intent))).text);
		notes.push({
			tone: "model",
			title: "Critic",
			body: review.pass ? "Pass. The second model agrees." : `Change it: ${review.fix || "try a different tool"}`
		});
		if (!review.pass && review.fix) {
			const again = runHarness(trace.world, review.fix, {
				kind: "message",
				arguments: {},
				message: "critic"
			}, opts.focus, opts.gaze);
			notes.push({
				tone: again.ok ? "engine" : "warn",
				title: "Iteration",
				body: again.ok ? again.result : `${again.result} Keeping the neural asset already filed.`
			});
			if (again.ok) trace = again;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "critic failed";
		notes.push({
			tone: "warn",
			title: "Critic",
			body: message
		});
	}
	const attempts = trace.attempts.map((attempt, index) => `${index + 1}. ${attempt.ok ? "pass" : "fail"} ${attempt.tool}: ${attempt.detail}`).join("\n");
	notes.push({
		tone: "model",
		title: trace.proposal.toolName ? `${opts.label} · ${trace.proposal.toolName}` : opts.label,
		body: `${trace.proposal.message ?? "No action"}${trace.proposal.arguments && Object.keys(trace.proposal.arguments).length ? `\n${Object.entries(trace.proposal.arguments).map(([key, value]) => `${key}=${value}`).join("  ")}` : ""}`
	});
	notes.push({
		tone: trace.ok ? "engine" : "warn",
		title: trace.ok ? "Verified" : "Failed",
		body: `${trace.result}\n${attempts}`
	});
	return {
		trace,
		notes,
		filed
	};
}
/** Shared with the pilot so a click on a prop does not also swing the view. */
var pointerClaim = { entity: false };
/** Shared with the pilot and the on-screen look pad. Not persisted. */
var lookPose = {
	yaw: 0,
	pitch: -.16
};
function shiftLook(dx, dy) {
	lookPose.yaw -= dx * .006;
	lookPose.pitch = Math.max(-1.05, Math.min(1.05, lookPose.pitch - dy * .006));
}
function faceLook(yaw, pitch) {
	lookPose.yaw = yaw;
	lookPose.pitch = pitch;
}
/** Held keys. The keyboard and the visor buttons write here. Tests replace the set. */
var pilotKeys = /* @__PURE__ */ new Set();
function setPilotSpeed(speed) {}
/** Crosshair target. Not persisted, so looking around does not rewrite the saved world. */
var gazeId = null;
var gazeListeners = /* @__PURE__ */ new Set();
function currentGaze() {
	return gazeId;
}
function setGazeLock(id) {
	if (gazeId === id) return;
	gazeId = id;
	gazeListeners.forEach((notify) => notify());
}
function useGazeId() {
	return (0, import_react.useSyncExternalStore)((notify) => {
		gazeListeners.add(notify);
		return () => gazeListeners.delete(notify);
	}, () => gazeId, () => null);
}
/** Where the crosshair sits, as a percent of the view. The ray uses the same point. */
var aimSnap = {
	x: 50,
	y: 50
};
var aimLive = false;
var aimListeners = /* @__PURE__ */ new Set();
function setAimPoint(x, y, live) {
	if (aimLive === live && Math.abs(aimSnap.x - x) < .25 && Math.abs(aimSnap.y - y) < .25) return;
	aimLive = live;
	aimSnap = {
		x,
		y
	};
	aimListeners.forEach((notify) => notify());
}
var LookContext = (0, import_react.createContext)(null);
function LookProvider({ children }) {
	const [mode, setMode] = (0, import_react.useState)("third");
	const [immersive, setImmersive] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const onFull = () => {
			if (!document.fullscreenElement) setImmersive(false);
		};
		const onKey = (event) => {
			const tag = event.target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			if (event.key === "Escape") setImmersive(false);
		};
		document.addEventListener("fullscreenchange", onFull);
		window.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("fullscreenchange", onFull);
			window.removeEventListener("keydown", onKey);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const node = document.querySelector(".app");
		if (!(node instanceof HTMLElement)) return;
		if (immersive) {
			node.requestFullscreen?.().catch(() => void 0);
			return;
		}
		if (document.fullscreenElement === node) document.exitFullscreen?.().catch(() => void 0);
	}, [immersive]);
	const value = (0, import_react.useMemo)(() => ({
		mode,
		setMode,
		immersive,
		setImmersive
	}), [mode, immersive]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LookContext.Provider, {
		value,
		children
	});
}
function useLook() {
	const value = (0, import_react.useContext)(LookContext);
	if (!value) return {
		mode: "bench",
		setMode: () => void 0,
		immersive: false,
		setImmersive: () => void 0
	};
	return value;
}
var STORAGE_KEY = "aetherforge-manifold-v2";
function demoModel() {
	return {
		name: "demo-bonded",
		path: DEFAULT_MODEL_PATH,
		loaded: true,
		validated: false
	};
}
function bootHistory() {
	const history = [
		{
			id: 1,
			tone: "engine",
			title: "Boot",
			body: `AetherForge v${ENGINE_VERSION} — engine-as-harness`
		},
		{
			id: 2,
			tone: "engine",
			title: "Resident",
			body: "The lab is live. The helm on the architect is the computer you wear. ForgeTerminal on the bench is the same manifold, standing in the room."
		},
		{
			id: 3,
			tone: "engine",
			title: "Avatar",
			body: "Architect Avatar entity id: 1"
		},
		{
			id: 4,
			tone: "engine",
			title: "Tools",
			body: TOOL_NAMES.join(", ")
		}
	];
	return {
		history,
		logSeq: history.length + 1
	};
}
function freshCore() {
	const world = labWorld();
	const terminal = Object.values(world.entities).find((entity) => entity.tags.includes("terminal"));
	return {
		...world,
		osTicks: 0,
		selectedId: terminal?.id ?? 1,
		running: false,
		busy: false,
		plugin: "demo",
		model: demoModel(),
		memoryBudgetMb: MEMORY_BUDGET_MB,
		ticksPerIntent: 3,
		residentId: DEFAULT_RESIDENT_ID,
		residentPower: true,
		residentStatus: "loading",
		residentProgress: 0,
		residentLoaded: 0,
		residentTotal: 0,
		residentDetail: "Fetching Gemma into this page",
		criticPower: false,
		criticStatus: "off",
		criticProgress: 0,
		criticDetail: "Second model is off. Spawn a critic when you want another opinion.",
		library: [],
		...bootHistory()
	};
}
function megabytes$1(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
	const mb = bytes / 1048576;
	return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
function argLine(args) {
	const parts = Object.entries(args).map(([key, value]) => `${key}=${value}`);
	return parts.length ? parts.join("  ") : "—";
}
function cleanLibrary(value) {
	if (!Array.isArray(value)) return [];
	const assets = [];
	for (const row of value) {
		if (!row || typeof row !== "object") continue;
		const item = row;
		if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.palette !== "string") continue;
		assets.push(item);
	}
	return assets.slice(-24);
}
function isEntityRecord(value) {
	if (!value || typeof value !== "object") return false;
	return Object.values(value).every((entity) => {
		if (!entity || typeof entity !== "object") return false;
		const row = entity;
		return typeof row.id === "number" && typeof row.name === "string" && !!row.transform?.position && Array.isArray(row.tags);
	});
}
function sceneBrief(world) {
	const all = Object.values(world.entities).sort((a, b) => a.id - b.id);
	const cells = all.filter((entity) => entity.tags.includes("live") || entity.tags.includes("locked"));
	const cellIds = new Set(cells.map((entity) => entity.id));
	const rest = all.filter((entity) => !cellIds.has(entity.id));
	const lineOf = (entity) => {
		const position = entity.transform.position;
		const asset = entity.representation.kind === "mesh" ? entity.representation.assetId : entity.representation.kind === "gaussian" ? "gaussian" : entity.tags.includes("architect") ? "you" : "agent";
		const who = entity.tags.includes("architect") ? "you" : entity.tags.includes("agent") ? entity.customData.role || "agent" : asset;
		return `${entity.id} ${entity.name} ${who} ${nearestColorName(entity.customData.color)} ${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}`;
	};
	const lines = rest.slice(0, 16).map(lineOf);
	if (rest.length > 16) lines.push(`…${rest.length - 16} more`);
	const groups = /* @__PURE__ */ new Map();
	for (const cell of cells) {
		const key = `${(cell.customData.piece || "?").toUpperCase()}|${nearestColorName(cell.customData.color)}|${cell.tags.includes("live") ? "falling" : "stacked"}`;
		const list = groups.get(key) ?? [];
		list.push(cell);
		groups.set(key, list);
	}
	for (const [key, list] of groups) {
		const [piece, color, state] = key.split("|");
		const ids = list.map((entity) => entity.id).join(",");
		lines.push(`${ids} ${piece} ${color} ${state} tetris x${list.length}`);
	}
	return lines.concat((world.skills ?? []).slice(-4).map((skill) => `skill ${skill.name} (${skill.job})`)).join("\n");
}
var residentBoot = null;
var useForge = create((set, get) => {
	const pushLog = (entries) => {
		set((state) => {
			let seq = state.logSeq;
			const made = entries.map((entry) => ({
				...entry,
				id: seq++
			}));
			return {
				history: [...state.history, ...made].slice(-80),
				logSeq: seq
			};
		});
	};
	const commit = (world, selectedId, entries) => {
		set((state) => {
			let seq = state.logSeq;
			const made = entries.map((entry) => ({
				...entry,
				id: seq++
			}));
			return {
				...world,
				selectedId,
				history: [...state.history, ...made].slice(-80),
				logSeq: seq
			};
		});
	};
	const finish = (proposal, userTitle, userBody, modelTitle) => {
		const latest = get();
		const executed = executeProposal(latest, proposal);
		const selected = proposal.kind === "tool_call" && proposal.arguments.id ? Number(proposal.arguments.id) || latest.selectedId : latest.selectedId;
		const spawned = executed.world.nextId > latest.nextId ? executed.world.nextId - 1 : null;
		commit(executed.world, spawned ?? (selected != null && executed.world.entities[selected] ? selected : latest.selectedId), [
			{
				tone: "user",
				title: userTitle,
				body: userBody
			},
			{
				tone: "model",
				title: proposal.toolName ? `${modelTitle} · ${proposal.toolName}` : modelTitle,
				body: `${proposal.message ?? "No action"}\n${argLine(proposal.arguments)}`
			},
			{
				tone: executed.ok ? "engine" : "warn",
				title: executed.ok ? "Result" : "Failed",
				body: executed.result
			}
		]);
	};
	return {
		...freshCore(),
		stepSim: (count = 1) => {
			set((state) => {
				const world = stepWorld(state, count);
				const steps = world.tick - state.tick;
				return {
					...world,
					osTicks: state.osTicks + steps
				};
			});
		},
		setRunning: (running) => set({ running }),
		select: (id) => set({ selectedId: id }),
		submitIntent: async (intentRaw) => {
			const intent = intentRaw.trim().slice(0, 400);
			if (!intent || get().busy) return;
			const spec = residentById(get().residentId);
			if (!get().residentPower) {
				pushLog([{
					tone: "user",
					title: "Intent",
					body: intent
				}, {
					tone: "warn",
					title: "Model off",
					body: `${spec.short} is powered down. Turn it on to forge.`
				}]);
				return;
			}
			set({ busy: true });
			try {
				if (!residentReady(spec.id)) await get().bootResident();
				const live = get();
				if (!live.residentPower || live.residentId !== spec.id) return;
				if (!residentReady(spec.id)) {
					pushLog([{
						tone: "user",
						title: "Intent",
						body: intent
					}, {
						tone: "warn",
						title: spec.short,
						body: live.residentDetail || "Model is not loaded."
					}]);
					return;
				}
				if (wantsSecondModel(intent) && !get().criticPower) get().setCriticPower(true);
				const before = get();
				const critique = before.criticPower ? async (prompt) => criticReady() ? completeCritic(prompt) : completeResident(prompt) : null;
				const settled = await settleIntent({
					world: before,
					intent,
					label: spec.short,
					model: before.model,
					scene: [sceneBrief(before), ...before.library.slice(-4).map((asset) => `library ${asset.name} splat ${asset.bytes}B`)].filter(Boolean).join("\n"),
					proposeTurn: (prompt) => completeResident(prompt),
					critiqueTurn: critique,
					research: async (query, failure) => researchTask({ data: {
						query,
						failure
					} }),
					moduleD: (call) => runModuleD({ data: call }),
					focus: before.selectedId,
					gaze: currentGaze()
				});
				const trace = settled.trace;
				const idArg = Number(trace.proposal.arguments.id);
				const spawned = trace.world.nextId > before.nextId ? trace.world.nextId - 1 : null;
				const kept = Number.isFinite(idArg) && trace.world.entities[idArg] ? idArg : before.selectedId;
				const selected = spawned ?? (kept != null && trace.world.entities[kept] ? kept : Object.values(trace.world.entities)[0]?.id ?? null);
				commit(trace.world, selected, settled.notes);
				if (settled.filed.length) set((state) => ({ library: mergeLibrary(state.library ?? [], settled.filed) }));
			} catch (error) {
				const message = error instanceof Error ? error.message : "the turn failed";
				pushLog([{
					tone: "user",
					title: "Intent",
					body: intent
				}, {
					tone: "warn",
					title: "Failed",
					body: message.slice(0, 280)
				}]);
			} finally {
				set({ busy: false });
			}
		},
		submitScript: async (intentRaw) => {
			const intent = intentRaw.trim().slice(0, 400);
			if (!intent || get().busy) return;
			set({ busy: true });
			try {
				const state = get();
				const proposal = propose(state.model, intent, sceneRefs(state.entities), TOOL_NAMES);
				finish(proposal, "Script", intent, "Script");
			} finally {
				set({ busy: false });
			}
		},
		bootResident: () => {
			const id = get().residentId;
			if (!get().residentPower) return Promise.resolve();
			if (residentReady(id)) {
				set({
					residentStatus: "ready",
					residentProgress: 100,
					residentDetail: "Weights are in this page."
				});
				return Promise.resolve();
			}
			if (residentBoot && get().residentStatus === "loading") return residentBoot;
			const spec = residentById(id);
			set({
				residentStatus: "loading",
				residentProgress: 0,
				residentDetail: `Fetching ${spec.label} into this page`
			});
			let lastPaint = 0;
			let lastLabel = "";
			const task = ensureResident(id, (progress, label, bytes) => {
				if (get().residentId !== id || !get().residentPower) return;
				const now = Date.now();
				if (now - lastPaint < 80 && progress < 100 && label === lastLabel) return;
				lastPaint = now;
				lastLabel = label;
				const file = label.split("/").pop() || label;
				const loaded = bytes?.loaded ?? 0;
				const total = bytes?.total ?? 0;
				set({
					residentProgress: progress,
					residentLoaded: loaded,
					residentTotal: total,
					residentDetail: progress >= 100 ? "Weights are in. Starting the model." : total > 0 ? `${Math.round(progress)}% · ${megabytes$1(loaded)} of ${megabytes$1(total)}` : file
				});
			}).then(() => {
				if (get().residentId !== id || !get().residentPower) return;
				if (!residentReady(id)) return;
				set({
					residentStatus: "ready",
					residentProgress: 100,
					residentDetail: `${spec.short} is on.`
				});
				pushLog([{
					tone: "engine",
					title: spec.short,
					body: `${spec.label} is resident in this page (${spec.repo}).`
				}]);
			}).catch((error) => {
				if (get().residentId !== id || !get().residentPower) return;
				const message = error instanceof Error ? error.message : "could not load weights";
				set({
					residentStatus: "error",
					residentDetail: message.slice(0, 280)
				});
				pushLog([{
					tone: "warn",
					title: spec.short,
					body: message.slice(0, 280)
				}]);
			}).finally(() => {
				if (residentBoot === task) residentBoot = null;
			});
			residentBoot = task;
			return task;
		},
		setResidentPower: (power) => {
			if (get().residentPower === power) return;
			const spec = residentById(get().residentId);
			if (!power) {
				releaseResident();
				residentBoot = null;
				set({
					residentPower: false,
					residentStatus: "off",
					residentProgress: 0,
					residentDetail: "Powered down. Forge will not call a model."
				});
				pushLog([{
					tone: "engine",
					title: "Power",
					body: `${spec.short} is off.`
				}]);
				return;
			}
			set({
				residentPower: true,
				residentDetail: `Turning ${spec.short} on`
			});
			pushLog([{
				tone: "engine",
				title: "Power",
				body: `${spec.short} is on. Weights load into this page.`
			}]);
			get().bootResident();
		},
		setResidentModel: (id) => {
			if (get().residentId === id) return;
			const spec = residentById(id);
			releaseResident();
			residentBoot = null;
			set({
				residentId: id,
				residentProgress: 0,
				residentStatus: get().residentPower ? "loading" : "off",
				residentDetail: get().residentPower ? `Switching to ${spec.label}` : "Powered down. Forge will not call a model."
			});
			pushLog([{
				tone: "engine",
				title: "Model",
				body: `${spec.label} selected. ${spec.place === "in situ" ? "It runs in this page." : spec.blurb}`
			}]);
			if (get().residentPower) get().bootResident();
		},
		bootCritic: () => {
			if (!get().criticPower) return Promise.resolve();
			if (criticReady()) {
				set({
					criticStatus: "ready",
					criticProgress: 100,
					criticDetail: "A second Gemma is in this page and reviews after each command."
				});
				return Promise.resolve();
			}
			set({
				criticStatus: "ready",
				criticProgress: Math.max(get().criticProgress, 1),
				criticDetail: "Critic is live on Gemma. It reviews after each command while a second copy loads."
			});
			let lastPaint = 0;
			let lastLabel = "";
			const giveUp = () => {
				if (!get().criticPower || criticReady()) return;
				releaseCritic();
				set({
					criticStatus: "ready",
					criticProgress: 100,
					criticDetail: "Critic is live on Gemma. A second copy did not start, so the same model reviews after the actor."
				});
			};
			const timer = window.setTimeout(giveUp, 16e3);
			return ensureCritic((progress, label) => {
				if (!get().criticPower) return;
				const now = Date.now();
				if (now - lastPaint < 80 && progress < 100 && label === lastLabel) return;
				lastPaint = now;
				lastLabel = label;
				if (criticReady()) return;
				set({
					criticStatus: "ready",
					criticProgress: progress,
					criticDetail: progress >= 100 ? "Critic is live. The second copy is compiling and will take over if it starts." : `Critic is live on Gemma. Second copy ${Math.round(progress)}%.`
				});
			}).then(() => {
				window.clearTimeout(timer);
				if (!get().criticPower) return;
				if (criticReady()) {
					set({
						criticStatus: "ready",
						criticProgress: 100,
						criticDetail: "A second Gemma is in this page and reviews after each command."
					});
					pushLog([{
						tone: "engine",
						title: "Critic",
						body: "The second model is live and will review the next command."
					}]);
					return;
				}
				giveUp();
			}).catch(() => {
				window.clearTimeout(timer);
				giveUp();
			});
		},
		setCriticPower: (power) => {
			if (get().criticPower === power) return;
			if (!power) {
				releaseCritic();
				set({
					criticPower: false,
					criticStatus: "off",
					criticProgress: 0,
					criticDetail: "Second model is off."
				});
				pushLog([{
					tone: "engine",
					title: "Critic",
					body: "The second model is off."
				}]);
				return;
			}
			set({
				criticPower: true,
				criticStatus: "ready",
				criticProgress: 100,
				criticDetail: "Critic is live on Gemma."
			});
			pushLog([{
				tone: "engine",
				title: "Critic",
				body: "Second model requested. It loads beside Gemma and reviews the next commands."
			}]);
			get().bootCritic();
		},
		dispatchManual: (name, args) => {
			const state = get();
			const executed = executeProposal(state, {
				kind: "tool_call",
				toolName: name,
				arguments: args
			});
			const id = Number(args.id);
			const selected = (executed.world.nextId > state.nextId ? executed.world.nextId - 1 : null) ?? (Number.isFinite(id) && executed.world.entities[id] ? id : state.selectedId);
			commit(executed.world, selected, [{
				tone: "user",
				title: "Manual",
				body: `${name}  ${argLine(args)}`
			}, {
				tone: executed.ok ? "engine" : "warn",
				title: executed.ok ? "Result" : "Failed",
				body: executed.result
			}]);
		},
		setPlugin: (plugin) => {
			const state = get();
			if (state.plugin === plugin) return;
			set({ plugin });
			const body = plugin === "grok" ? `Remote Grok (${GROK_MODEL}). One intent sends one request. The harness still validates every tool call.` : plugin === "bonded" ? state.model.validated ? `Bonded model '${state.model.name}' is imported. The in-browser driver mirrors its tool calls.` : `Bond a .gguf to record it. Until the header checks out, the demo driver proposes calls.` : "Demo heuristic (no model file required).";
			pushLog([{
				tone: plugin === "bonded" && !state.model.validated ? "warn" : "engine",
				title: "Plugin",
				body
			}]);
		},
		setTicks: (ticks) => set({ ticksPerIntent: Math.max(1, Math.min(30, Math.round(ticks) || 3)) }),
		importGguf: (fileName, magicOk) => {
			const path = fileName.trim();
			if (!path) return "model file not found: (empty)";
			if (!path.toLowerCase().endsWith(".gguf")) return `expected a .gguf file: ${path}`;
			if (!magicOk) return `not a valid GGUF file (bad magic): ${path}`;
			const stem = path.split(/[/\\]/).pop()?.replace(/\.gguf$/i, "") || "bonded-model";
			set({
				model: {
					name: stem,
					path,
					loaded: true,
					validated: true
				},
				plugin: "bonded"
			});
			pushLog([{
				tone: "engine",
				title: "Bond",
				body: `Bonded model '${stem}' imported`
			}]);
			return null;
		},
		note: (entries) => pushLog(entries),
		adopt: (world, entries) => commit(ensureAvatar(world), get().selectedId, entries),
		reset: () => set((state) => ({
			...freshCore(),
			residentId: state.residentId,
			residentPower: state.residentPower,
			residentStatus: state.residentStatus,
			residentProgress: state.residentProgress,
			residentDetail: state.residentDetail,
			criticPower: state.criticPower,
			criticStatus: state.criticStatus,
			criticProgress: state.criticProgress,
			criticDetail: state.criticDetail,
			library: state.library
		})),
		despawn: (id) => {
			const state = get();
			const entity = state.entities[id];
			if (!entity || entity.tags.includes("architect") || entity.tags.includes("helm")) return;
			const executed = executeProposal(state, {
				kind: "tool_call",
				toolName: "delete_entity",
				arguments: { id: String(id) }
			});
			const remaining = Object.values(executed.world.entities).sort((a, b) => a.id - b.id);
			commit(executed.world, remaining.find((item) => !item.tags.includes("architect"))?.id ?? remaining[0]?.id ?? null, [{
				tone: "engine",
				title: "Despawn",
				body: executed.result
			}]);
		},
		hydrate: () => {
			if (typeof window === "undefined") return;
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (!raw) return;
				const data = JSON.parse(raw);
				if (!data.world || !isEntityRecord(data.world.entities)) return;
				if (!Object.values(data.world.entities).some((entity) => entity.tags?.includes("lab"))) {
					set({
						plugin: data.plugin === "grok" || data.plugin === "bonded" || data.plugin === "demo" ? data.plugin : "demo",
						model: data.model?.path ? {
							...demoModel(),
							...data.model
						} : demoModel(),
						ticksPerIntent: data.ticksPerIntent || 3,
						residentId: isResidentId(data.residentId) ? data.residentId : DEFAULT_RESIDENT_ID,
						residentPower: typeof data.residentPower === "boolean" ? data.residentPower : true,
						criticPower: typeof data.criticPower === "boolean" ? data.criticPower : false,
						library: cleanLibrary(data.library),
						running: false,
						busy: false
					});
					return;
				}
				const world = ensureHelm(ensureAvatar({
					...data.world,
					undo: Array.isArray(data.world.undo) ? data.world.undo.slice(-16) : [],
					skills: cleanSkills(data.world.skills),
					compat: Array.isArray(data.world.compat) ? data.world.compat.filter((item) => typeof item === "string").slice(0, 8) : [],
					gravity: bootWorld().gravity,
					deltaTime: bootWorld().deltaTime
				}));
				const ids = Object.keys(world.entities).map(Number);
				const selected = data.selectedId != null && world.entities[data.selectedId] ? data.selectedId : ids[0] ?? null;
				set({
					...world,
					osTicks: data.osTicks || 0,
					history: Array.isArray(data.history) ? data.history.slice(-80) : get().history,
					logSeq: data.logSeq || get().logSeq,
					selectedId: selected,
					plugin: data.plugin === "grok" || data.plugin === "bonded" || data.plugin === "demo" ? data.plugin : "demo",
					model: data.model?.path ? {
						...demoModel(),
						...data.model
					} : demoModel(),
					ticksPerIntent: data.ticksPerIntent || 3,
					residentId: isResidentId(data.residentId) ? data.residentId : DEFAULT_RESIDENT_ID,
					residentPower: typeof data.residentPower === "boolean" ? data.residentPower : true,
					criticPower: typeof data.criticPower === "boolean" ? data.criticPower : false,
					library: cleanLibrary(data.library),
					running: false,
					busy: false
				});
			} catch {}
		}
	};
});
function cleanSkills(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((skill) => {
		if (!skill || typeof skill !== "object") return false;
		const row = skill;
		return typeof row.name === "string" && Array.isArray(row.steps);
	}).slice(-12);
}
var persistReady = false;
function startPersist() {
	if (persistReady || typeof window === "undefined") return;
	persistReady = true;
	useForge.getState().hydrate();
	let timer = 0;
	useForge.subscribe((state) => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			const payload = {
				world: {
					entities: state.entities,
					nextId: state.nextId,
					tick: state.tick,
					gravity: state.gravity,
					deltaTime: state.deltaTime,
					eventLog: state.eventLog.slice(-64),
					events: state.events.slice(-64),
					undo: (state.undo ?? []).slice(-16),
					skills: (state.skills ?? []).slice(-12),
					compat: (state.compat ?? []).slice(0, 8)
				},
				osTicks: state.osTicks,
				history: state.history,
				logSeq: state.logSeq,
				selectedId: state.selectedId,
				plugin: state.plugin,
				model: state.model,
				ticksPerIntent: state.ticksPerIntent,
				residentId: state.residentId,
				residentPower: state.residentPower,
				criticPower: state.criticPower,
				library: (state.library ?? []).slice(-24)
			};
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
		}, 200);
	});
}
function readElf(bytes) {
	if (bytes.length < 64 || bytes[0] !== 127 || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70) return {
		ok: false,
		reason: "not an ELF file"
	};
	if (bytes[4] !== 2) return {
		ok: false,
		reason: "32-bit ELF is not supported (64-bit only)"
	};
	if (bytes[5] !== 1) return {
		ok: false,
		reason: "big-endian ELF is not supported"
	};
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const type = dv.getUint16(16, true);
	const machine = dv.getUint16(18, true);
	const arch = machine === 62 ? "x86_64" : machine === 183 ? "aarch64" : null;
	if (!arch) return {
		ok: false,
		reason: `machine ${machine} is not x86-64 or AArch64`
	};
	if (type !== 2 && type !== 3) return {
		ok: false,
		reason: "not an executable"
	};
	const entry = dv.getBigUint64(24, true);
	const phoff = Number(dv.getBigUint64(32, true));
	const phentsize = dv.getUint16(54, true);
	const phnum = dv.getUint16(56, true);
	if (phoff + phnum * phentsize > bytes.length || phentsize < 56) return {
		ok: false,
		reason: "program headers are truncated"
	};
	const segments = [];
	for (let i = 0; i < phnum; i += 1) {
		const at = phoff + i * phentsize;
		const ptype = dv.getUint32(at, true);
		if (ptype === 3) return {
			ok: false,
			reason: "dynamically linked (needs an interpreter); build it static"
		};
		if (ptype !== 1) continue;
		const flags = dv.getUint32(at + 4, true);
		const offset = Number(dv.getBigUint64(at + 8, true));
		const vaddr = dv.getBigUint64(at + 16, true);
		const filesz = dv.getBigUint64(at + 32, true);
		const memsz = dv.getBigUint64(at + 40, true);
		if (offset + Number(filesz) > bytes.length) return {
			ok: false,
			reason: "segment runs past the end of the file"
		};
		if (filesz > memsz) return {
			ok: false,
			reason: "segment file size exceeds memory size"
		};
		segments.push({
			vaddr,
			memsz,
			filesz,
			offset,
			flags
		});
	}
	if (!segments.length) return {
		ok: false,
		reason: "no loadable segments"
	};
	if (type === 3) return {
		ok: false,
		reason: "position-independent executable; build with -static -no-pie"
	};
	const holder = segments.find((s) => BigInt(phoff) >= BigInt(s.offset) && BigInt(phoff) < BigInt(s.offset) + s.filesz);
	return {
		ok: true,
		elf: {
			arch,
			entry,
			segments,
			type: "exec",
			phdr: {
				addr: holder ? holder.vaddr + BigInt(phoff - holder.offset) : 0n,
				entsize: phentsize,
				count: phnum
			}
		}
	};
}
/**
* Ingest. Take any file, say what it is, and say how the engine can run or use it.
* It only identifies and validates. It never executes anything. Running a module is a
* separate step that goes through the sandboxed VM.
*
* Routes
*   wasm      runs natively in the sandbox once its imports are satisfied
*   gguf      a local language model for the resident slot
*   glb/gltf  a 3D asset for the scene
*   image     a texture
*   script    source text, checked by the safe-compile gate before it is injected
*   archive   unpack, then ingest each member
*   native    a compiled program for another machine (ELF, PE, Mach-O). It needs an emulator layer.
*/
var ascii = (bytes, start, length) => String.fromCharCode(...Array.from(bytes.subarray(start, start + length)));
function ext(name) {
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}
/** Identify by magic bytes first. The extension only breaks ties for plain text. */
function sniff(bytes, name) {
	if (bytes.length >= 4) {
		if (bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109) return "wasm";
		const head4 = ascii(bytes, 0, 4);
		if (head4 === "GGUF") return "gguf";
		if (head4 === "glTF") return "glb";
		if (head4 === "PK") return "archive";
		if (bytes[0] === 127 && head4.slice(1) === "ELF") return "native";
		if (bytes[0] === 77 && bytes[1] === 90) return "native";
		const mach = bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3];
		if ([
			4277009102,
			4277009103,
			3405691582,
			3472551422,
			3489328638
		].includes(mach >>> 0)) return "native";
		if (bytes[0] === 137 && head4.slice(1) === "PNG") return "image";
		if (bytes[0] === 255 && bytes[1] === 216) return "image";
		if (head4 === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image";
		if (head4 === "GIF8") return "image";
	}
	if (bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139) return "archive";
	switch (ext(name)) {
		case "gltf": return "gltf";
		case "js":
		case "mjs":
		case "ts":
		case "tsx":
		case "jsx":
		case "html": return "script";
		case "json":
		case "txt":
		case "md":
		case "csv": return "data";
		default: return "unknown";
	}
}
var ROUTE = {
	wasm: {
		route: "sandbox-vm",
		ready: true,
		detail: "WebAssembly module. Runs in the sandbox once imports are met."
	},
	gguf: {
		route: "resident-model",
		ready: true,
		detail: "Local model weights. Can fill the resident model slot."
	},
	glb: {
		route: "scene-asset",
		ready: true,
		detail: "Binary glTF. Can be spawned as a scene asset."
	},
	gltf: {
		route: "scene-asset",
		ready: true,
		detail: "glTF scene description. Can be spawned as a scene asset."
	},
	image: {
		route: "texture",
		ready: true,
		detail: "Image. Can be wrapped onto a solid."
	},
	script: {
		route: "safe-compile",
		ready: true,
		detail: "Source text. Goes through the safe-compile gate (script-gate.ts) before it is injected."
	},
	archive: {
		route: "unpack",
		ready: false,
		detail: "Archive. Unpack it, then ingest each member."
	},
	native: {
		route: "emulator",
		ready: false,
		detail: "Compiled for another machine. Needs an emulator layer; it cannot run directly in the browser."
	},
	data: {
		route: "store",
		ready: true,
		detail: "Plain data. Kept as a document the forge can read."
	},
	unknown: {
		route: "reject",
		ready: false,
		detail: "Unrecognized format. Nothing was run."
	}
};
function ingest(bytes, name) {
	const kind = sniff(bytes, name);
	const base = ROUTE[kind];
	const report = {
		name,
		bytes: bytes.length,
		kind,
		route: base.route,
		ready: base.ready,
		detail: base.detail
	};
	if (kind === "native") {
		if (bytes[0] !== 127) return {
			...report,
			detail: "Windows (PE) or macOS (Mach-O) program. Forge's native layer runs static Linux programs today; this one is reported, not run."
		};
		const elf = readElf(bytes);
		if (!elf.ok) return {
			...report,
			detail: `Linux program, but not one Forge can run yet: ${elf.reason}. Nothing was run.`
		};
		return {
			...report,
			ready: true,
			detail: `Static Linux program for ${elf.elf.arch === "x86_64" ? "x86-64" : "ARM64"}. Runs in Forge's Linux layer: lifted to WebAssembly, unknown instructions reported and never executed.`
		};
	}
	if (kind === "wasm" && typeof WebAssembly !== "undefined") {
		const copy = new Uint8Array(bytes);
		const valid = WebAssembly.validate(copy);
		if (!valid) return {
			...report,
			ready: false,
			route: "reject",
			detail: "Looks like WebAssembly but failed validation. Nothing was run.",
			wasm: {
				valid,
				imports: [],
				exports: []
			}
		};
		const module = new WebAssembly.Module(copy);
		const imports = WebAssembly.Module.imports(module).map((item) => `${item.module}.${item.name}`);
		const exports = WebAssembly.Module.exports(module).map((item) => item.name);
		return {
			...report,
			wasm: {
				valid,
				imports,
				exports
			}
		};
	}
	return report;
}
/**
* Visitor side of a portal. Turns a forge:// address into an HTTP(S) base, fetches the signed
* manifest, runs the handshake, and reports the island as offline when its host is gone.
*/
function httpBase(address, secure = false) {
	const parsed = parseAddress(address);
	if (!parsed) return null;
	return `${secure ? "https" : "http"}://${parsed.host}${parsed.port === null ? "" : `:${parsed.port}`}`;
}
async function fetchWithin(url, init, ms) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timer);
	}
}
async function openPortal(from, identity, to, wants, options = {}) {
	const base = httpBase(to, options.secure);
	if (!base) return {
		status: "refused",
		reason: "bad address"
	};
	const timeout = options.timeoutMs ?? 4e3;
	let host;
	try {
		const res = await fetchWithin(`${base}/.well-known/forge-island`, {}, timeout);
		if (!res.ok) return {
			status: "offline",
			reason: `host answered ${res.status}`
		};
		host = await res.json();
	} catch {
		return {
			status: "offline",
			reason: "host is unreachable"
		};
	}
	const seen = await verifyManifest(host);
	if (!seen.ok) return {
		status: "refused",
		reason: seen.reason
	};
	const hello = await makeHello(from, identity, to, wants);
	let welcome;
	let session = null;
	try {
		const res = await fetchWithin(`${base}/portal/hello`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(hello)
		}, timeout);
		const body = await res.json();
		if (!res.ok || !("type" in body)) return {
			status: "refused",
			reason: "reason" in body ? body.reason : `host answered ${res.status}`
		};
		welcome = body;
		session = typeof body.session === "string" ? body.session : null;
	} catch {
		return {
			status: "offline",
			reason: "host went away during the handshake"
		};
	}
	const checked = await checkWelcome(hello, welcome);
	if (!checked.ok) return {
		status: "refused",
		reason: checked.reason
	};
	if (welcome.host.manifest.id !== host.manifest.id) return {
		status: "refused",
		reason: "handshake answered by a different island than the manifest"
	};
	return {
		status: "open",
		host,
		grant: checked.grant,
		session
	};
}
/**
* Walk through a portal: handshake, then download the island's starting world and check it against
* the hash in the host's signed manifest before showing any of it.
*/
async function enterIsland(from, identity, to, wants = ["render", "input"], options = {}) {
	const opened = await openPortal(from, identity, to, wants, options);
	if (opened.status !== "open") return opened;
	if (!opened.session) return {
		status: "refused",
		reason: "host did not open a session"
	};
	if (!opened.grant.includes("render")) return {
		status: "refused",
		reason: "host did not grant render"
	};
	const base = httpBase(to, options.secure);
	let bytes;
	try {
		const res = await fetchWithin(`${base}/island/content`, { headers: { authorization: `Forge ${opened.session}` } }, options.timeoutMs ?? 8e3);
		if (!res.ok) return {
			status: "refused",
			reason: `content answered ${res.status}`
		};
		bytes = new Uint8Array(await res.arrayBuffer());
	} catch {
		return {
			status: "offline",
			reason: "host went away while sending its world"
		};
	}
	const checked = await verifyEntry(opened.host.manifest, bytes);
	if (!checked.ok) return {
		status: "refused",
		reason: checked.reason
	};
	return {
		status: "inside",
		host: opened.host,
		grant: opened.grant,
		session: opened.session,
		base,
		entry: checked.entry
	};
}
/**
* This browser's identity when it walks through portals. Generated once, kept in this browser only.
* The private key never leaves the page; only the signed manifest is sent.
*/
var KEY = "forge-visitor-identity-v1";
var cached = null;
async function load() {
	try {
		const raw = globalThis.localStorage?.getItem(KEY);
		if (raw) {
			const saved = JSON.parse(raw);
			const der = fromB64url(saved.pkcs8);
			if (der) {
				const privateKey = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
				return {
					publicKey: saved.publicKey,
					id: await idOf(saved.publicKey),
					privateKey
				};
			}
		}
	} catch {}
	const identity = await generateIdentity();
	try {
		const pkcs8 = b64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", identity.privateKey)));
		globalThis.localStorage?.setItem(KEY, JSON.stringify({
			publicKey: identity.publicKey,
			pkcs8
		}));
	} catch {}
	return identity;
}
function visitorIdentity() {
	cached ??= (async () => {
		const identity = await load();
		return {
			identity,
			signed: await signManifest(await buildManifest(identity, {
				name: "Forge visitor",
				address: `forge://visitor.local/v-${identity.id.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, "x")}`,
				entry: {
					kind: "world",
					sha256: "",
					bytes: 0
				},
				wants: ["render", "input"]
			}), identity)
		};
	})();
	return cached;
}
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
var say = (tone, title, body) => useForge.getState().note([{
	tone,
	title,
	body: body.slice(0, 1200)
}]);
async function routeFile(file) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const report = ingest(bytes, file.name);
	if (report.kind === "native") {
		if (!report.ready) {
			say("warn", "Ingest", `${file.name}: ${report.detail}`);
			return;
		}
		say("engine", "Linux", `${file.name}: ${report.detail} Running…`);
		const { runLinuxProgram } = await import("./linux-client-DOYGoW8S.mjs");
		const ran = await runLinuxProgram(bytes, {
			fuel: 4e8,
			argv: [file.name]
		});
		const out = ran.stdout.trim() ? `\n${ran.stdout.trimEnd().slice(0, 900)}` : "";
		const gaps = ran.gaps.length ? `\n${ran.gaps.length} undecoded spot(s) seen while lifting (often data after code); none were executed.` : "";
		say(ran.ok ? "engine" : "warn", `Linux · ${ran.arch ?? "?"}`, `${file.name}: ${ran.detail}.${out}${gaps}`);
		return;
	}
	if (report.kind === "script") {
		const { runGatedScript } = await import("./script-runtime-CCruvs3T.mjs");
		const run = await runGatedScript(new TextDecoder().decode(bytes), file.name, {
			log: (line) => say("engine", `Script · ${file.name}`, String(line).slice(0, 400)),
			query: (tag) => Object.values(useForge.getState().entities).filter((e) => e.tags.includes(String(tag))).map((e) => ({
				id: e.id,
				name: e.name,
				position: e.transform.position
			})),
			spawn: (name, asset) => {
				const before = useForge.getState().nextId;
				useForge.getState().dispatchManual("spawn_entity", {
					name: String(name).slice(0, 40),
					asset: String(asset ?? "gem"),
					x: "2.2",
					y: "0",
					z: "1.3"
				});
				return before;
			}
		}, {
			grants: ["render", "input"],
			timeoutMs: 3e3
		});
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
function DropRunner() {
	const [over, setOver] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		let depth = 0;
		const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
		const enter = (event) => {
			if (!hasFiles(event)) return;
			depth += 1;
			setOver(true);
		};
		const leave = (event) => {
			if (!hasFiles(event)) return;
			depth = Math.max(0, depth - 1);
			if (!depth) setOver(false);
		};
		const overFn = (event) => {
			if (hasFiles(event)) event.preventDefault();
		};
		const drop = (event) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			depth = 0;
			setOver(false);
			for (const file of Array.from(event.dataTransfer?.files ?? []).slice(0, 4)) routeFile(file).catch((error) => say("warn", "Ingest", `${file.name}: ${String(error)}`));
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "drop-veil",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Drop to ingest. Linux programs (x86-64 or ARM) run here; scripts are checked first; nothing unknown runs." })
	});
}
function PortalWatcher() {
	const inside = (0, import_react.useRef)(null);
	const busy = (0, import_react.useRef)(false);
	(0, import_react.useEffect)(() => {
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
			(async () => {
				try {
					const me = await visitorIdentity();
					const visit = await enterIsland(me.signed, me.identity, hit.address, ["render", "input"], { secure: window.location.protocol === "https:" });
					if (visit.status !== "inside") {
						say("warn", "Portal", `${hit.address} is ${visit.status}: ${visit.reason}`);
						return;
					}
					const now = useForge.getState();
					if (Object.values(now.entities).some((e) => e.customData.island === visit.host.manifest.id)) {
						say("engine", "Portal", `${visit.host.manifest.name} is already beside you.`);
						return;
					}
					const p = now.entities[hit.id]?.transform.position ?? avatar.transform.position;
					const world = placeVisited(now, visit.entry, visit.host.manifest.id, {
						x: p.x + 14,
						y: 0,
						z: p.z
					});
					useForge.getState().adopt(world, [{
						tone: "engine",
						title: "Portal",
						body: `Inside ${visit.host.manifest.name} (${visit.entry.entities.length} entities, hash checked against its signed manifest). Granted: ${visit.grant.join(", ") || "nothing"}. It sits read-only beside your island.`
					}]);
				} catch (error) {
					say("warn", "Portal", String(error));
				} finally {
					busy.current = false;
				}
			})();
		}, 250);
		return () => window.clearInterval(timer);
	}, []);
	return null;
}
function project(x, y, z, yaw, cx, cy, scale) {
	const cos = Math.cos(yaw);
	const sin = Math.sin(yaw);
	const rx = x * cos - z * sin;
	const rz = x * sin + z * cos;
	return {
		sx: cx + rx * scale,
		sy: cy + rz * scale * .55 - y * scale,
		depth: rz
	};
}
function paint(canvas, yaw, selectedId) {
	const parent = canvas.parentElement;
	const width = parent?.clientWidth || 320;
	const height = parent?.clientHeight || 320;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = "#09090b";
	ctx.fillRect(0, 0, width, height);
	const cx = width * .5;
	const cy = height * .62;
	const scale = Math.min(width, height) * .085;
	ctx.strokeStyle = "#2a2c32";
	ctx.lineWidth = 1;
	for (let i = -8; i <= 8; i += 1) {
		const a = project(i, 0, -8, yaw, cx, cy, scale);
		const b = project(i, 0, 8, yaw, cx, cy, scale);
		ctx.beginPath();
		ctx.moveTo(a.sx, a.sy);
		ctx.lineTo(b.sx, b.sy);
		ctx.stroke();
		const c = project(-8, 0, i, yaw, cx, cy, scale);
		const d = project(8, 0, i, yaw, cx, cy, scale);
		ctx.beginPath();
		ctx.moveTo(c.sx, c.sy);
		ctx.lineTo(d.sx, d.sy);
		ctx.stroke();
	}
	const list = Object.values(useForge.getState().entities).sort((a, b) => project(a.transform.position.x, 0, a.transform.position.z, yaw, cx, cy, scale).depth - project(b.transform.position.x, 0, b.transform.position.z, yaw, cx, cy, scale).depth);
	for (const entity of list) drawEntity(ctx, entity, yaw, cx, cy, scale, entity.id === selectedId);
}
function drawEntity(ctx, entity, yaw, cx, cy, scale, selected) {
	const p = entity.transform.position;
	const pos = project(p.x, p.y, p.z, yaw, cx, cy, scale);
	const color = entity.customData.color || "#d7c4a3";
	const rep = entity.representation;
	ctx.fillStyle = color;
	if (entity.tags.includes("architect") || rep.kind === "hybrid") {
		ctx.fillRect(pos.sx - 7, pos.sy - 28, 14, 22);
		ctx.beginPath();
		ctx.arc(pos.sx, pos.sy - 34, 7, 0, Math.PI * 2);
		ctx.fill();
	} else if (rep.kind === "gaussian") {
		ctx.globalAlpha = .9;
		ctx.beginPath();
		ctx.arc(pos.sx, pos.sy - 12, 18, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
	} else if (rep.kind === "mesh" && rep.assetId === "platform") {
		ctx.globalAlpha = .95;
		ctx.fillRect(pos.sx - 40, pos.sy - 8, 80, 14);
		ctx.globalAlpha = 1;
	} else if (rep.kind === "mesh" && rep.assetId === "pillar") ctx.fillRect(pos.sx - 6, pos.sy - 42, 12, 42);
	else if (rep.kind === "mesh" && rep.assetId === "ring") {
		ctx.strokeStyle = color;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.ellipse(pos.sx, pos.sy - 4, 20, 8, 0, 0, Math.PI * 2);
		ctx.stroke();
	} else {
		const radius = 11 * (entity.transform.scale.x || 1);
		ctx.beginPath();
		ctx.arc(pos.sx, pos.sy - radius, radius, 0, Math.PI * 2);
		ctx.fill();
	}
	if (selected) {
		ctx.strokeStyle = "#f2f3f5";
		ctx.lineWidth = 1;
		ctx.strokeRect(pos.sx - 20, pos.sy - 48, 40, 54);
	}
	ctx.fillStyle = "#9aa1ab";
	ctx.font = "11px ui-monospace, monospace";
	ctx.textAlign = "center";
	ctx.fillText(entity.tags.includes("architect") ? "you" : entity.name, pos.sx, pos.sy + 16);
}
function FlatStage() {
	const canvasRef = (0, import_react.useRef)(null);
	const [yaw, setYaw] = (0, import_react.useState)(.6);
	const drag = (0, import_react.useRef)(null);
	const tick = useForge((s) => s.tick);
	const count = useForge((s) => Object.keys(s.entities).length);
	const selectedId = useForge((s) => s.selectedId);
	const selected = useForge((s) => s.selectedId == null ? null : s.entities[s.selectedId] ?? null);
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		paint(canvas, yaw, selectedId);
	}, [
		yaw,
		tick,
		count,
		selectedId
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "view",
		onPointerDown: (event) => {
			drag.current = {
				x: event.clientX,
				yaw
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove: (event) => {
			if (!drag.current) return;
			setYaw(drag.current.yaw + (event.clientX - drag.current.x) * .008);
		},
		onPointerUp: () => {
			drag.current = null;
		},
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
			ref: canvasRef,
			style: {
				width: "100%",
				height: "100%",
				touchAction: "none"
			}
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "hud",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "hud-readout",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["tick ", String(tick).padStart(4, "0")] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
						count,
						" ",
						count === 1 ? "entity" : "entities"
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: selected ? selected.tags.includes("architect") ? "Architect · you" : selected.name : "nothing selected" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["g ", GRAVITY.toFixed(2)] })
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "hud-hint",
				children: "Drag to turn the view. The model loads beside this."
			})]
		})]
	});
}
var CHIPS = [
	{
		label: "Walk forward",
		intent: "Walk the avatar forward"
	},
	{
		label: "Turn left",
		intent: "Turn the avatar left"
	},
	{
		label: "Paint me gold",
		intent: "Paint the avatar gold"
	},
	{
		label: "Spawn critic",
		intent: "Spawn a critic agent named Critic"
	},
	{
		label: "Pull marble",
		intent: "Pull a marble texture onto the avatar"
	},
	{
		label: "Platform at origin",
		intent: "Create a small platform near the origin"
	}
];
function fmt(n) {
	return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "0";
}
function SceneSlot() {
	const [View, setView] = (0, import_react.useState)(null);
	const [fault, setFault] = (0, import_react.useState)("");
	const mode = useLook().mode;
	(0, import_react.useEffect)(() => {
		let live = true;
		const timer = window.setTimeout(() => {
			import("./Viewport-3qvUlh9S.mjs").then((mod) => {
				if (live) setView(() => mod.Viewport);
			}).catch((error) => {
				if (!live) return;
				setFault(error instanceof Error ? error.message : "3D view stayed on the flat manifold");
			});
		}, 1200);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "view-slot",
		children: [View && !fault ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ViewBoundary, {
			onFault: setFault,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(View, {})
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FlatStage, {}), mode === "bench" || !View ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ManifoldBanner, {
			opening: !View && !fault,
			fault
		}) : null]
	});
}
var ViewBoundary = class extends import_react.Component {
	state = { fault: "" };
	static getDerivedStateFromError(error) {
		return { fault: error instanceof Error ? error.message : "The 3D view crashed" };
	}
	componentDidCatch() {
		if (this.state.fault) this.props.onFault(this.state.fault);
	}
	render() {
		if (this.state.fault) return null;
		return this.props.children;
	}
};
function ManifoldBanner({ opening, fault }) {
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
	const amount = total > 0 ? `${megabytes(loaded)} of ${megabytes(total)}` : `about ${spec.size}`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
		className: quiet ? "manifold-banner is-quiet" : "manifold-banner",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "panel-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Manifold" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: status === "ready" && !fault ? "live-pill is-on" : "live-pill",
					children: fault ? "3D off" : status === "ready" ? "Live" : status === "error" ? "Model failed" : `Model ${Math.round(progress)}%`
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "panel-lead",
				children: [
					count,
					" ",
					count === 1 ? "body" : "bodies",
					" · tick ",
					String(tick).padStart(4, "0")
				]
			}),
			opening ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: "Opening the 3D manifold."
			}) : null,
			fault ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "form-error",
				children: fault
			}) : null,
			power ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mono-line",
					children: [
						spec.label,
						" · ",
						status === "ready" ? "in this page" : status === "error" ? "failed" : amount
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: loading && progress < 1 ? "weight-bar is-busy" : "weight-bar",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: loading && progress < 1 ? void 0 : { width: `${width}%` } })
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: status === "error" ? "form-error" : "panel-lead",
					children: status === "ready" ? "Weights are in this page." : `${Math.round(progress)}% · ${detail}`
				})
			] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: "The model is off. The manifold is still here."
			}),
			criticPower && criticStatus !== "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mono-line",
				children: [
					"Critic ",
					Math.round(criticProgress),
					"% · ",
					criticDetail
				]
			}) : null
		]
	});
}
function megabytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
	const mb = bytes / 1048576;
	return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
function SimClock() {
	const running = useForge((s) => s.running);
	const mode = useLook().mode;
	(0, import_react.useEffect)(() => {
		if (!running) return;
		let frame = 0;
		let last = performance.now();
		let acc = 0;
		const loop = (now) => {
			const dt = Math.min(.05, (now - last) / 1e3);
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
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			const tag = event.target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || mode !== "bench") return;
			const move = event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : event.key === "ArrowUp" ? "rotate" : event.key === "ArrowDown" ? "drop" : "";
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
	const statusLine = !power ? "Off" : status === "ready" ? "In this page" : status === "error" ? "Failed" : `Loading ${Math.round(progress)}%`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "resident-bay",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
			type: "button",
			className: power ? "power is-on" : "power",
			"aria-pressed": power,
			"aria-label": power ? `Turn ${spec.short} off` : `Turn ${spec.short} on`,
			onClick: () => useForge.getState().setResidentPower(!power),
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "power-knob",
				"aria-hidden": "true"
			}), power ? "ON" : "OFF"]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "resident-readout",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: spec.short }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: statusLine }),
				power && status !== "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: progress < 1 && status !== "error" ? "bay-bar is-busy" : "bay-bar",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: progress < 1 ? void 0 : { width: `${Math.max(4, progress)}%` } })
				}) : null
			]
		})]
	});
}
function Header({ onScript, onDemo, scripting }) {
	const tick = useForge((s) => s.tick);
	const osTicks = useForge((s) => s.osTicks);
	const count = useForge((s) => Object.keys(s.entities).length);
	const events = useForge((s) => s.events.length);
	const running = useForge((s) => s.running);
	const memory = useForge((s) => s.memoryBudgetMb);
	const { immersive, setImmersive } = useLook();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "topbar",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "brand",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "brand-kicker",
					children: "Harness · v0.1.0"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "AetherForge" })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "stats",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Tick" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: String(tick).padStart(4, "0") })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Entities" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: count })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "OS" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: osTicks })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Events" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: events })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Memory" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", { children: [memory, " MB"] })] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResidentBay, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "top-actions",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: running ? "live-dot is-on" : "live-dot",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "btn btn-ghost",
						onClick: () => useForge.getState().stepSim(1),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkipForward, { "aria-hidden": "true" }), "Step"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "btn btn-primary",
						onClick: () => useForge.getState().setRunning(!running),
						children: [running ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { "aria-hidden": "true" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { "aria-hidden": "true" }), running ? "Pause" : "Run"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-ghost",
						onClick: onScript,
						disabled: scripting,
						children: "Run script"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-ghost",
						onClick: onDemo,
						disabled: scripting,
						children: "Tour the lab"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-ghost",
						onClick: () => useForge.getState().dispatchManual("undo", {}),
						children: "Undo"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-ghost",
						onClick: () => setImmersive(!immersive),
						children: immersive ? "Window" : "Fill view"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "btn btn-ghost",
						onClick: () => useForge.getState().reset(),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RotateCcw, { "aria-hidden": "true" }), "Reset"]
					})
				]
			})
		]
	});
}
function IntentDock() {
	const [intent, setIntent] = (0, import_react.useState)("");
	const busy = useForge((s) => s.busy);
	const power = useForge((s) => s.residentPower);
	const status = useForge((s) => s.residentStatus);
	const ticks = useForge((s) => s.ticksPerIntent);
	const spec = residentById(useForge((s) => s.residentId));
	const submit = (value) => {
		const next = value.trim();
		if (!next || busy || !power) return;
		useForge.getState().submitIntent(next);
		setIntent("");
	};
	const forgeLabel = !power ? "Off" : busy || status === "loading" ? "Loading…" : "Forge";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "dock",
		onSubmit: (event) => {
			event.preventDefault();
			submit(intent);
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				htmlFor: "intent",
				children: "Architect intent"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "dock-row",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					id: "intent",
					className: "field",
					value: intent,
					maxLength: 400,
					placeholder: power ? "Create a small platform near the origin" : `Turn ${spec.short} on to forge`,
					onChange: (event) => setIntent(event.target.value),
					autoComplete: "off",
					disabled: !power
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "submit",
					className: "btn btn-primary",
					disabled: !intent.trim() || busy || !power,
					children: busy && status === "ready" ? "Writing…" : forgeLabel
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "chips",
				children: CHIPS.map((chip) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "chip",
					disabled: busy || !power,
					onClick: () => void useForge.getState().submitIntent(chip.intent),
					children: chip.label
				}, chip.label))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "ticks",
				children: ["Ticks per intent", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					className: "field",
					inputMode: "numeric",
					value: String(ticks),
					onChange: (event) => useForge.getState().setTicks(Number(event.target.value))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "dock-note",
				children: "Click a body and change it from the computer. Splats only when you ask. Arrows move a Tetris piece."
			})
		]
	});
}
function ModelCard() {
	const id = useForge((s) => s.residentId);
	const power = useForge((s) => s.residentPower);
	const status = useForge((s) => s.residentStatus);
	const progress = useForge((s) => s.residentProgress);
	const detail = useForge((s) => s.residentDetail);
	const busy = useForge((s) => s.busy);
	const spec = residentById(id);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "panel",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "panel-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Resident model" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: power && status === "ready" ? "live-pill is-on" : "live-pill",
					children: power ? status === "ready" ? "Live" : status === "error" ? "Error" : "Powered" : "Off"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "panel-lead",
				children: [
					spec.blurb,
					" ",
					power ? "Power is on." : "Power is off, so Forge will not invent a call."
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "model-pick",
				role: "radiogroup",
				"aria-label": "Resident model",
				children: RESIDENT_MODELS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					role: "radio",
					"aria-checked": id === item.id,
					className: id === item.id ? "model-option is-on" : "model-option",
					disabled: busy,
					onClick: () => useForge.getState().setResidentModel(item.id),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.label }), item.outOfTheBox ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "Out of the box" }) : null] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
						item.size,
						" · ",
						item.place
					] })]
				}, item.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "weight-bar",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { width: `${power && status !== "off" ? Math.max(status === "ready" ? 100 : progress, status === "loading" ? 4 : 0) : 0}%` } })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mono-line",
				children: [
					spec.repo,
					"/",
					spec.file
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: status === "error" ? "form-error" : "panel-lead",
				children: detail
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CriticRow, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkillList, {})
		]
	});
}
function CriticRow() {
	const power = useForge((s) => s.criticPower);
	const status = useForge((s) => s.criticStatus);
	const progress = useForge((s) => s.criticProgress);
	const detail = useForge((s) => s.criticDetail);
	const line = !power ? "Off" : status === "ready" ? "In this page" : status === "loading" ? `Loading ${Math.round(progress)}%` : status === "error" ? "Failed" : "Starting";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "critic-row",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
			type: "button",
			className: power ? "power is-on" : "power",
			"aria-pressed": power,
			"aria-label": power ? "Turn the second model off" : "Turn the second model on",
			onClick: () => useForge.getState().setCriticPower(!power),
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "power-knob",
				"aria-hidden": "true"
			}), power ? "ON" : "OFF"]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Second model" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "panel-lead",
			children: [
				"Critic · ",
				line,
				". ",
				detail
			]
		})] })]
	});
}
function SkillList() {
	const skills = useForge((s) => s.skills ?? []);
	if (!skills.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "mono-line",
		children: ["Learned ", skills.map((skill) => skill.name).join(", ")]
	});
}
function defaultsFor(tool, selected) {
	if (tool === "spawn_entity") return {
		name: "Cube",
		x: "2",
		y: "0",
		z: "0",
		asset: "cube"
	};
	if (tool === "set_color") return {
		id: selected ? String(selected.id) : "",
		color: "blue"
	};
	if (tool === "edit_entity") return {
		id: selected ? String(selected.id) : "",
		color: "blue"
	};
	if (tool === "delete_entity") return { id: selected ? String(selected.id) : "" };
	if (tool === "undo") return {};
	if (tool === "define_skill") return {
		name: "edit_color",
		tool: "set_color",
		args: "id=$id,color=$color",
		job: "edit"
	};
	if (!selected) return {};
	if (tool === "set_transform") return {
		id: String(selected.id),
		x: fmt(selected.transform.position.x),
		y: fmt(selected.transform.position.y),
		z: fmt(selected.transform.position.z)
	};
	if (tool === "apply_velocity") return {
		id: String(selected.id),
		vx: "1.4",
		vy: "0.15",
		vz: "0.35"
	};
	return {};
}
function ToolForm({ tool }) {
	const names = Object.keys(tool.parameters);
	const selected = useForge((s) => s.selectedId == null ? void 0 : s.entities[s.selectedId]);
	const [values, setValues] = (0, import_react.useState)({});
	(0, import_react.useEffect)(() => {
		setValues(defaultsFor(tool.name, selected));
	}, [tool.name, selected?.id]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "stack",
		onSubmit: (event) => {
			event.preventDefault();
			const args = {};
			for (const name of names) {
				const value = (values[name] ?? "").trim();
				if (value) args[name] = value;
			}
			useForge.getState().dispatchManual(tool.name, args);
		},
		children: [names.map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
			className: "arg",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [name, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "arg-type",
				children: tool.parameters[name]
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				className: "field",
				value: values[name] ?? "",
				onChange: (event) => setValues((prev) => ({
					...prev,
					[name]: event.target.value
				}))
			})]
		}, name)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "submit",
			className: "btn btn-ghost",
			children: "Dispatch"
		})]
	});
}
function ToolCard() {
	const [active, setActive] = (0, import_react.useState)(TOOLS$1[0]?.name ?? "spawn_entity");
	const tool = TOOLS$1.find((item) => item.name === active) ?? TOOLS$1[0];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "panel",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Tools" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "tool-list",
				role: "tablist",
				"aria-label": "Tool registry",
				children: TOOLS$1.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					role: "tab",
					"aria-selected": item.name === tool.name,
					className: item.name === tool.name ? "tool is-on" : "tool",
					onClick: () => setActive(item.name),
					children: item.name
				}, item.name))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: tool.description
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToolForm, { tool })
		]
	});
}
function entityList(entities) {
	return Object.values(entities).sort((a, b) => a.id - b.id);
}
function LibraryCard() {
	const library = useForge((s) => s.library ?? []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "panel",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Library" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: "Neural splats. A recipe is a few hundred bytes. The viewport draws the points."
			}),
			library.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: "Empty. Ask for a material or an object the meshes do not have."
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "entity-list",
				children: library.map((asset) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "entity",
					onClick: () => useForge.getState().dispatchManual("place_neural", {
						title: asset.name,
						palette: asset.palette,
						seed: String(asset.seed),
						count: String(asset.count),
						shape: asset.shape,
						source: asset.source
					}),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "entity-id",
						children: [asset.bytes, "B"]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "entity-name",
						children: asset.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "entity-tags",
						children: [
							"splat · ",
							asset.shape,
							asset.source ? ` · ${asset.source.replace(/^https?:\/\//, "")}` : ""
						]
					})] })]
				}) }, asset.id))
			})
		]
	});
}
function ManifoldCard() {
	const entities = useForge((s) => s.entities);
	const selectedId = useForge((s) => s.selectedId);
	const list = entityList(entities);
	const selected = selectedId == null ? void 0 : entities[selectedId];
	const [pos, setPos] = (0, import_react.useState)({
		x: "",
		y: "",
		z: ""
	});
	const [vel, setVel] = (0, import_react.useState)({
		vx: "",
		vy: "",
		vz: ""
	});
	const architect = selected?.tags.includes("architect") ?? false;
	const helm = selected?.tags.includes("helm") ?? false;
	(0, import_react.useEffect)(() => {
		const current = useForge.getState().entities[selectedId ?? -1];
		if (!current) return;
		setPos({
			x: fmt(current.transform.position.x),
			y: fmt(current.transform.position.y),
			z: fmt(current.transform.position.z)
		});
		const velocity = current.physics?.velocity;
		setVel({
			vx: fmt(velocity?.x ?? 0),
			vy: fmt(velocity?.y ?? 0),
			vz: fmt(velocity?.z ?? 0)
		});
	}, [selectedId]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "panel",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "panel-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Manifold" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "live-pill is-on",
					children: [
						list.length,
						" ",
						list.length === 1 ? "body" : "bodies"
					]
				})]
			}),
			list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: "The manifold is empty."
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "entity-list",
				children: list.map((entity) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: entity.id === selectedId ? "entity is-on" : "entity",
					onClick: () => useForge.getState().select(entity.id),
					"aria-pressed": entity.id === selectedId,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "entity-id",
						children: entity.id
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "entity-name",
						children: entity.tags.includes("architect") ? "Architect" : entity.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "entity-tags",
						children: entity.tags.includes("architect") ? "you · body" : entity.tags.includes("helm") ? "you · helm" : entity.tags.includes("agent") ? entity.customData.role || "agent" : entity.tags.join(" · ")
					})] })]
				}) }, entity.id))
			}),
			selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "inspector",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mono-line",
						children: [selected.tags.includes("architect") ? "Your body. Walk it, turn it, recolor it. It stays." : selected.tags.includes("helm") ? "The helm you wear. It is the computer for this world." : selected.representation.kind === "mesh" ? `mesh ${selected.representation.assetId}` : selected.representation.kind === "gaussian" ? `gaussian ${selected.representation.particleCount}` : `agent ${selected.customData.role || "builder"}`, selected.customData.asset ? ` · ${selected.customData.asset}` : ""]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "live-pos",
						children: [
							fmt(selected.transform.position.x),
							" · ",
							fmt(selected.transform.position.y),
							" ·",
							" ",
							fmt(selected.transform.position.z),
							selected.customData.color ? `   ${selected.customData.color}` : "",
							selected.physics ? `   v ${fmt(selected.physics.velocity.x)} ${fmt(selected.physics.velocity.y)} ${fmt(selected.physics.velocity.z)}` : ""
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "pad",
						role: "group",
						"aria-label": "Move the selection",
						children: [
							["Forward", "forward"],
							["Back", "back"],
							["Left", "left"],
							["Right", "right"],
							["Turn left", "turn-left"],
							["Turn right", "turn-right"]
						].map(([label, move]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "btn btn-ghost",
							onClick: () => useForge.getState().dispatchManual("control_avatar", {
								id: String(selected.id),
								move
							}),
							children: label
						}, move))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "swatches",
						role: "group",
						"aria-label": "Color",
						children: NAMED_COLORS.map((swatch) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: selected.customData.color === swatch.hex ? "swatch is-on" : "swatch",
							style: { background: swatch.hex },
							"aria-label": swatch.name,
							"aria-pressed": selected.customData.color === swatch.hex,
							onClick: () => useForge.getState().dispatchManual("set_color", {
								id: String(selected.id),
								color: swatch.name
							})
						}, swatch.name))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "xyz",
						onSubmit: (event) => {
							event.preventDefault();
							useForge.getState().dispatchManual("set_transform", {
								id: String(selected.id),
								x: pos.x,
								y: pos.y,
								z: pos.z
							});
						},
						children: [[
							"x",
							"y",
							"z"
						].map((axis) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [axis, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "field",
							value: pos[axis],
							onChange: (event) => setPos((prev) => ({
								...prev,
								[axis]: event.target.value
							}))
						})] }, axis)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: "btn btn-ghost",
							children: "Set position"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "xyz",
						onSubmit: (event) => {
							event.preventDefault();
							useForge.getState().dispatchManual("apply_velocity", {
								id: String(selected.id),
								vx: vel.vx,
								vy: vel.vy,
								vz: vel.vz
							});
						},
						children: [[
							"vx",
							"vy",
							"vz"
						].map((axis) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [axis, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "field",
							value: vel[axis],
							onChange: (event) => setVel((prev) => ({
								...prev,
								[axis]: event.target.value
							}))
						})] }, axis)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: "btn btn-ghost",
							children: "Set velocity"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "btn btn-ghost",
						disabled: architect || helm,
						onClick: () => useForge.getState().despawn(selected.id),
						children: architect ? "Avatar stays" : helm ? "Helm stays" : "Despawn"
					})
				]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "panel-lead",
				children: "Select an entity to inspect it."
			})
		]
	});
}
function LogCard() {
	const history = useForge((s) => s.history);
	const bodyRef = (0, import_react.useRef)(null);
	const stick = (0, import_react.useRef)(true);
	const onScroll = () => {
		const el = bodyRef.current;
		if (!el) return;
		stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	};
	(0, import_react.useEffect)(() => {
		const el = bodyRef.current;
		if (!el || !stick.current) return;
		el.scrollTop = el.scrollHeight;
	}, [history.length]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "panel log-panel",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Log" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "log-body",
			ref: bodyRef,
			onScroll,
			children: history.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: `log-line tone-${entry.tone}`,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: entry.title }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: entry.body })]
			}, entry.id))
		})]
	});
}
function ForgeShell() {
	const look = useLook();
	const [scripting, setScripting] = (0, import_react.useState)(false);
	const lock = (0, import_react.useRef)(false);
	const ticks = useForge((s) => s.ticksPerIntent);
	const onDemo = () => {
		if (lock.current) return;
		lock.current = true;
		setScripting(true);
		useForge.getState().setRunning(false);
		useForge.getState().reset();
		const step = useForge.getState().ticksPerIntent;
		(async () => {
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
	(0, import_react.useEffect)(() => {
		startPersist();
		const boot = window.setTimeout(() => {
			if (useForge.getState().residentPower) useForge.getState().bootResident();
			if (useForge.getState().criticPower) useForge.getState().bootCritic();
		}, 600);
		return () => window.clearTimeout(boot);
	}, []);
	const onScript = () => {
		if (lock.current) return;
		lock.current = true;
		setScripting(true);
		useForge.getState().setRunning(false);
		(async () => {
			for (const line of ENGINE_SCRIPT) {
				useForge.getState().stepSim(ticks);
				await useForge.getState().submitScript(line);
				await new Promise((resolve) => window.setTimeout(resolve, 280));
			}
			lock.current = false;
			setScripting(false);
		})();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: look.immersive ? "app is-immersive" : "app",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SimClock, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DropRunner, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PortalWatcher, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Header, {
				onScript,
				onDemo,
				scripting
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SceneSlot, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(IntentDock, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "side",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "side-scroll",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ManifoldCard, {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelCard, {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LibraryCard, {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToolCard, {})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LogCard, {})]
			})
		]
	});
}
function ForgeApp() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LookProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForgeShell, {}) });
}
var routes_exports = /* @__PURE__ */ __exportAll({ component: () => Home });
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForgeApp, {});
}
//#endregion
export { fetchAsset as _, lookPose as a, setAimPoint as c, shiftLook as d, useGazeId as f, restoreLab as g, ensureAvatar as h, faceLook as i, setGazeLock as l, GRAVITY as m, readElf as n, pilotKeys as o, useLook as p, useForge as r, pointerClaim as s, routes_exports as t, setPilotSpeed as u, clusterDag as v, selectCut as y };

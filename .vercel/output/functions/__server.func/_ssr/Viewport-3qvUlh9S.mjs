import { i as __toESM } from "../_runtime.mjs";
import { t as TEXTURE_PACKS } from "./research-pk8zIg5V.mjs";
import { _ as require_jsx_runtime, a as CanvasTexture, c as Plane, d as SRGBColorSpace, f as TextureLoader, i as useThree, l as Quaternion, m as Vector3, n as Canvas, o as Matrix4, p as Vector2, r as useFrame, s as PerspectiveCamera, t as OrbitControls, u as Raycaster, v as require_react } from "../_libs/@react-three/drei+[...].mjs";
import { _ as fetchAsset, a as lookPose, c as setAimPoint, d as shiftLook, f as useGazeId, g as restoreLab, h as ensureAvatar, i as faceLook, l as setGazeLock, m as GRAVITY, o as pilotKeys, p as useLook, r as useForge, s as pointerClaim, u as setPilotSpeed, v as clusterDag, y as selectCut } from "./routes-CZadCkxY.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/Viewport-3qvUlh9S.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var cache = /* @__PURE__ */ new Map();
function loadAlbedo(url) {
	const hit = cache.get(url);
	if (hit) return hit;
	const pending = fetchAsset({ data: { url } }).then((result) => {
		if (!result.ok) return null;
		return new Promise((resolve) => {
			new TextureLoader().load(result.dataUrl, (texture) => {
				texture.colorSpace = SRGBColorSpace;
				texture.needsUpdate = true;
				resolve(texture);
			}, void 0, () => resolve(null));
		});
	}).catch(() => null);
	cache.set(url, pending);
	return pending;
}
/** Scene colors. UI chrome stays on CSS tokens; WebGL needs concrete values. */
var scenePalette = {
	bg: "#09090b",
	ground: "#101114",
	grid: "#2a2c32",
	gridMajor: "#3a3d46",
	fog: "#09090b",
	steel: [
		"#d5d8de",
		"#b7bec8",
		"#9aa3af",
		"#c9c3b8",
		"#8e97a3",
		"#e4e6ea"
	],
	mark: "#f2f3f5",
	trim: "#9aa1ab",
	key: "#f3f4f6",
	fill: "#8b919c",
	hit: "#000000"
};
/** The live three camera and the GPU canvas. The picture copies the GPU when it has pixels. */
var stageCamera = { current: null };
var stageGl = { current: null };
var fallback = new PerspectiveCamera(48, 1, .1, 80);
fallback.position.set(6.4, 4.8, 8.2);
fallback.lookAt(.2, .6, .2);
var P = new Vector3();
var scratch = new Vector3();
function project(camera, x, y, z, width, height) {
	scratch.set(x, y, z);
	scratch.applyMatrix4(camera.matrixWorldInverse);
	const inFront = scratch.z < -.05;
	P.copy(scratch).applyMatrix4(camera.projectionMatrix);
	return {
		x: (P.x * .5 + .5) * width,
		y: (-P.y * .5 + .5) * height,
		z: P.z,
		front: inFront
	};
}
function shade(hex, mul) {
	const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "d7c4a3";
	return `rgb(${Math.max(0, Math.min(255, Math.round(parseInt(n.slice(0, 2), 16) * mul)))},${Math.max(0, Math.min(255, Math.round(parseInt(n.slice(2, 4), 16) * mul)))},${Math.max(0, Math.min(255, Math.round(parseInt(n.slice(4, 6), 16) * mul)))})`;
}
function pushFace(faces, pts, color) {
	if (pts.some((p) => !p.front)) return;
	if ((pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x) <= 0) return;
	let depth = 0;
	for (const p of pts) depth += p.z;
	faces.push({
		pts,
		color,
		depth: depth / pts.length
	});
}
function pushBox(faces, camera, cx, cy, cz, sx, sy, sz, color, width, height) {
	const hx = sx / 2;
	const hy = sy / 2;
	const hz = sz / 2;
	const c = [
		[
			-hx,
			-hy,
			-hz
		],
		[
			hx,
			-hy,
			-hz
		],
		[
			hx,
			hy,
			-hz
		],
		[
			-hx,
			hy,
			-hz
		],
		[
			-hx,
			-hy,
			hz
		],
		[
			hx,
			-hy,
			hz
		],
		[
			hx,
			hy,
			hz
		],
		[
			-hx,
			hy,
			hz
		]
	].map(([x, y, z]) => project(camera, cx + x, cy + y, cz + z, width, height));
	for (const [a, b, d, e, mul] of [
		[
			0,
			1,
			2,
			3,
			.62
		],
		[
			5,
			4,
			7,
			6,
			.78
		],
		[
			3,
			2,
			6,
			7,
			1.12
		],
		[
			4,
			5,
			1,
			0,
			.42
		],
		[
			1,
			5,
			6,
			2,
			.9
		],
		[
			4,
			0,
			3,
			7,
			.72
		]
	]) pushFace(faces, [
		c[a],
		c[b],
		c[d],
		c[e]
	], shade(color, mul));
}
function pushCylinder(faces, camera, cx, cy, cz, sx, sy, sz, color, width, height) {
	const radius = Math.max(sx, sz) / 2;
	const hy = sy / 2;
	const sides = 12;
	const top = [];
	const bot = [];
	for (let i = 0; i < sides; i += 1) {
		const a = i / sides * Math.PI * 2;
		const x = Math.cos(a) * radius;
		const z = Math.sin(a) * radius;
		top.push(project(camera, cx + x, cy + hy, cz + z, width, height));
		bot.push(project(camera, cx + x, cy - hy, cz + z, width, height));
	}
	for (let i = 0; i < sides; i += 1) {
		const j = (i + 1) % sides;
		const light = .55 + .5 * (.5 + .5 * Math.cos(i / sides * Math.PI * 2));
		pushFace(faces, [
			bot[i],
			bot[j],
			top[j],
			top[i]
		], shade(color, light));
	}
	pushFace(faces, top, shade(color, 1.15));
	pushFace(faces, [...bot].reverse(), shade(color, .4));
}
function pushSphere(faces, camera, cx, cy, cz, radius, color, width, height) {
	const lat = 7;
	const lon = 10;
	const rings = [];
	for (let i = 0; i <= lat; i += 1) {
		const v = i / lat * Math.PI;
		const y = Math.cos(v) * radius;
		const rr = Math.sin(v) * radius;
		const ring = [];
		for (let j = 0; j < lon; j += 1) {
			const u = j / lon * Math.PI * 2;
			ring.push(project(camera, cx + Math.cos(u) * rr, cy + y, cz + Math.sin(u) * rr, width, height));
		}
		rings.push(ring);
	}
	for (let i = 0; i < lat; i += 1) for (let j = 0; j < lon; j += 1) {
		const k = (j + 1) % lon;
		const light = .4 + .75 * (1 - i / lat);
		pushFace(faces, [
			rings[i][j],
			rings[i][k],
			rings[i + 1][k],
			rings[i + 1][j]
		], shade(color, light));
	}
}
function pushTorus(faces, camera, cx, cy, cz, sx, sy, sz, color, width, height) {
	const R = .62;
	const tube = .09;
	const seg = 20;
	const sides = 7;
	const tilt = Math.PI / 2.5;
	const cosT = Math.cos(tilt);
	const sinT = Math.sin(tilt);
	const at = (u, v) => {
		const cxr = R + tube * Math.cos(v);
		const lx = Math.cos(u) * cxr;
		const ly = Math.sin(u) * cxr;
		const lz = Math.sin(v) * tube;
		const y = ly * cosT - lz * sinT;
		const z = ly * sinT + lz * cosT;
		return project(camera, cx + lx * sx, cy + y * sy, cz + z * sz, width, height);
	};
	for (let i = 0; i < seg; i += 1) {
		const u0 = i / seg * Math.PI * 2;
		const u1 = (i + 1) / seg * Math.PI * 2;
		for (let j = 0; j < sides; j += 1) {
			const v0 = j / sides * Math.PI * 2;
			const v1 = (j + 1) / sides * Math.PI * 2;
			const light = .5 + .55 * (.5 + .5 * Math.cos(v0));
			pushFace(faces, [
				at(u0, v0),
				at(u1, v0),
				at(u1, v1),
				at(u0, v1)
			], shade(color, light));
		}
	}
}
function assetOf(entity) {
	if (entity.representation.kind === "mesh") return entity.representation.assetId;
	if (entity.representation.kind === "gaussian") return "gaussian";
	return "avatar";
}
function addEntity(faces, entity, camera, width, height) {
	const p = entity.transform.position;
	const s = entity.transform.scale;
	const color = entity.customData.color || "#d7c4a3";
	const asset = assetOf(entity);
	if (entity.tags.includes("architect")) {
		const eye = project(camera, p.x, p.y + .7, p.z, width, height);
		if (eye.front && eye.z < .2) return;
		pushCylinder(faces, camera, p.x, p.y + .15, p.z, .44, .7, .44, color, width, height);
		pushSphere(faces, camera, p.x, p.y + .62, p.z, .16, color, width, height);
		return;
	}
	if (asset === "pillar") {
		pushCylinder(faces, camera, p.x, p.y, p.z, s.x, s.y, s.z, color, width, height);
		return;
	}
	if (asset === "ring") {
		pushTorus(faces, camera, p.x, p.y, p.z, s.x, s.y, s.z, color, width, height);
		return;
	}
	if (asset === "sphere") {
		pushSphere(faces, camera, p.x, p.y, p.z, Math.max(s.x, s.y, s.z) / 2, color, width, height);
		return;
	}
	if (asset === "gaussian") {
		pushSphere(faces, camera, p.x, p.y, p.z, .42, color, width, height);
		pushSphere(faces, camera, p.x, p.y + .35, p.z, .28, "#d5e7f7", width, height);
		return;
	}
	pushBox(faces, camera, p.x, p.y, p.z, Math.max(s.x, .08), Math.max(s.y, .08), Math.max(s.z, .08), color, width, height);
}
function gpuHasPicture(src, ctx, width, height) {
	if (src.width < 2 || src.height < 2) return false;
	try {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(src, 0, 0, width, height);
		let min = 765;
		let max = 0;
		for (let y = .3; y <= .75; y += .15) for (let x = .25; x <= .75; x += .16) {
			const px = ctx.getImageData(Math.max(0, Math.floor(x * width) - 1), Math.max(0, Math.floor(y * height) - 1), 1, 1).data;
			const l = px[0] + px[1] + px[2];
			if (l < min) min = l;
			if (l > max) max = l;
		}
		return max > 90 && max - min > 36;
	} catch {
		return false;
	}
}
function paintSolids(ctx, camera, width, height) {
	camera.updateMatrixWorld();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#14181e";
	ctx.fillRect(0, 0, width, height);
	const faces = [];
	const entities = Object.values(useForge.getState().entities).filter((entity) => !entity.tags.includes("helm"));
	for (const entity of entities) addEntity(faces, entity, camera, width, height);
	faces.sort((a, b) => b.depth - a.depth);
	for (const face of faces) {
		ctx.beginPath();
		ctx.moveTo(face.pts[0].x, face.pts[0].y);
		for (let i = 1; i < face.pts.length; i += 1) ctx.lineTo(face.pts[i].x, face.pts[i].y);
		ctx.closePath();
		ctx.fillStyle = face.color;
		ctx.fill();
	}
	ctx.strokeStyle = "rgba(154, 161, 171, 0.35)";
	ctx.lineWidth = 1;
	for (let i = -8; i <= 8; i += 2) {
		const a = project(camera, i, .02, -8, width, height);
		const b = project(camera, i, .02, 8, width, height);
		const c = project(camera, -8, .02, i, width, height);
		const d = project(camera, 8, .02, i, width, height);
		if (a.front && b.front) {
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
		}
		if (c.front && d.front) {
			ctx.beginPath();
			ctx.moveTo(c.x, c.y);
			ctx.lineTo(d.x, d.y);
			ctx.stroke();
		}
	}
}
function paint(canvas) {
	const parent = canvas.parentElement;
	const width = Math.max(2, parent?.clientWidth || 320);
	const height = Math.max(2, parent?.clientHeight || 320);
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return;
	const gl = stageGl.current;
	if (gl && gpuHasPicture(gl, ctx, width, height)) return;
	const camera = stageCamera.current ?? fallback;
	if (camera === fallback) {
		fallback.aspect = width / height;
		fallback.updateProjectionMatrix();
	}
	paintSolids(ctx, camera, width, height);
}
function RoomPicture() {
	const canvasRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let frame = 0;
		const draw = () => {
			try {
				paint(canvas);
			} catch {}
			frame = window.requestAnimationFrame(draw);
		};
		frame = window.requestAnimationFrame(draw);
		return () => window.cancelAnimationFrame(frame);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
		ref: canvasRef,
		className: "room-picture",
		"aria-hidden": "true"
	});
}
var EYE = .62;
var MIN_Y = .45;
var SPEED = 4.6;
var TURN = 1.8;
var BENCH_EYE = {
	x: .2,
	y: 16.4,
	z: 7.6
};
var BENCH_AT = {
	x: .2,
	y: .2,
	z: .4
};
function heading(yaw) {
	return {
		x: Math.sin(yaw),
		z: Math.cos(yaw)
	};
}
function setFov(camera, fov) {
	if (camera.fov == null || Math.abs(camera.fov - fov) < .5) return;
	camera.fov = fov;
	camera.updateProjectionMatrix?.();
}
/**
* God-mode body. Third person is a chase cam: A yaws the nose left on screen.
* First person is the helm: A strafes left, drag looks.
*/
function Pilot() {
	const mode = useLook().mode;
	const { camera, gl, controls } = useThree();
	const lookPrimed = (0, import_react.useRef)(false);
	const looking = (0, import_react.useRef)(null);
	const benchSet = (0, import_react.useRef)(false);
	const seenMode = (0, import_react.useRef)(mode);
	const modeRef = (0, import_react.useRef)(mode);
	modeRef.current = mode;
	(0, import_react.useEffect)(() => {
		useForge.setState((state) => {
			const next = restoreLab(state);
			faceLook(0, -.16);
			lookPrimed.current = true;
			return next;
		});
	}, []);
	(0, import_react.useEffect)(() => {
		const down = (event) => {
			const tag = event.target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			pilotKeys.add(event.code);
		};
		const up = (event) => pilotKeys.delete(event.code);
		const blur = () => pilotKeys.clear();
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", blur);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const el = gl.domElement;
		let tracking = null;
		const onDown = (event) => {
			if (modeRef.current === "bench" || event.button > 0) return;
			if (event.target?.closest("button, a, input, textarea, .steer, .mode-bar, .tex-sphere")) return;
			if (event.target !== el) return;
			tracking = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY
			};
			looking.current = event.pointerId;
		};
		const onMove = (event) => {
			if (!tracking || tracking.id !== event.pointerId || modeRef.current === "bench") return;
			const dx = event.clientX - tracking.x;
			const dy = event.clientY - tracking.y;
			tracking.x = event.clientX;
			tracking.y = event.clientY;
			const mx = dx || event.movementX || 0;
			const my = dy || event.movementY || 0;
			if (!mx && !my) return;
			lookPose.yaw -= mx * .006;
			lookPose.pitch = Math.max(-1.05, Math.min(1.05, lookPose.pitch - my * .006));
		};
		const onUp = (event) => {
			if (tracking?.id === event.pointerId) tracking = null;
			if (looking.current === event.pointerId) looking.current = null;
			pointerClaim.entity = false;
		};
		el.addEventListener("pointerdown", onDown);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			el.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [gl]);
	(0, import_react.useEffect)(() => {
		const probe = {
			getYaw: () => lookPose.yaw,
			getSpeed: () => {
				const state = useForge.getState();
				const avatar = Object.values(state.entities).find((entity) => entity.tags.includes("architect"));
				return avatar ? Number(avatar.customData.speed) || 0 : 0;
			},
			setKeys: (codes) => {
				pilotKeys.clear();
				for (const code of codes) pilotKeys.add(code);
			},
			setSteer: (value) => {
				pilotKeys.delete("KeyA");
				pilotKeys.delete("KeyD");
				if (value > .2) pilotKeys.add("KeyA");
				if (value < -.2) pilotKeys.add("KeyD");
			}
		};
		window.__controlsTest = probe;
		return () => {
			if (window.__controlsTest === probe) delete window.__controlsTest;
		};
	}, []);
	useFrame((_, delta) => {
		stageCamera.current = camera;
		stageGl.current = gl.domElement;
		const orbit = controls;
		if (seenMode.current !== mode) {
			lookPose.pitch = mode === "first" ? -.08 : -.16;
			seenMode.current = mode;
		}
		if (mode === "bench") {
			setPilotSpeed(0);
			if (!benchSet.current) {
				camera.position.set(BENCH_EYE.x, BENCH_EYE.y, BENCH_EYE.z);
				camera.lookAt(BENCH_AT.x, BENCH_AT.y, BENCH_AT.z);
				setFov(camera, 46);
				if (orbit?.target) {
					orbit.target.set(BENCH_AT.x, BENCH_AT.y, BENCH_AT.z);
					orbit.update?.();
					benchSet.current = true;
				}
			}
			return;
		}
		benchSet.current = false;
		if (orbit) orbit.enabled = false;
		setFov(camera, mode === "first" ? 68 : 52);
		const dt = Math.min(delta, .05);
		const keys = pilotKeys;
		const turn = (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0);
		const gas = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
		const lift = (keys.has("Space") ? 1 : 0) - (keys.has("ShiftLeft") || keys.has("ControlLeft") || keys.has("KeyC") ? 1 : 0);
		const pose = {
			x: 0,
			y: 0,
			z: 0,
			fx: 0,
			fz: 1,
			ok: false
		};
		useForge.setState((state) => {
			const avatar = Object.values(state.entities).find((entity) => entity.tags.includes("architect"));
			if (!avatar) return ensureAvatar(state);
			const storeYaw = Number(avatar.customData.yaw) || 0;
			if (!lookPrimed.current) {
				lookPose.yaw = storeYaw;
				lookPose.pitch = mode === "first" ? -.08 : -.16;
				lookPrimed.current = true;
			} else if (Math.abs(storeYaw - lookPose.yaw) > .35) lookPose.yaw = storeYaw;
			if (mode === "third") lookPose.yaw += turn * TURN * dt;
			const yaw = lookPose.yaw;
			const face = heading(yaw);
			const right = {
				x: -face.z,
				z: face.x
			};
			const strafe = mode === "first" ? -turn : 0;
			const p = avatar.transform.position;
			const vx = face.x * gas + right.x * strafe;
			const vz = face.z * gas + right.z * strafe;
			const moving = Math.hypot(vx, vz);
			setPilotSpeed(moving * SPEED);
			const x = p.x + vx * SPEED * dt;
			const z = p.z + vz * SPEED * dt;
			const y = Math.max(MIN_Y, p.y + lift * SPEED * dt);
			pose.x = x;
			pose.y = y;
			pose.z = z;
			pose.fx = face.x;
			pose.fz = face.z;
			pose.ok = true;
			const yawStr = String(Math.round(yaw * 1e3) / 1e3);
			const speedStr = String(Math.round(moving * SPEED * 100) / 100);
			if (!(Math.hypot(x - p.x, y - p.y, z - p.z) > 1e-5 || yawStr !== (avatar.customData.yaw || "0") || speedStr !== (avatar.customData.speed || "0"))) return state;
			const helm = Object.values(state.entities).find((entity) => entity.tags.includes("helm"));
			const nextAvatar = {
				...avatar,
				transform: {
					...avatar.transform,
					position: {
						x,
						y,
						z
					}
				},
				customData: {
					...avatar.customData,
					yaw: yawStr,
					speed: speedStr
				}
			};
			const entities = {
				...state.entities,
				[avatar.id]: nextAvatar
			};
			if (helm) entities[helm.id] = {
				...helm,
				transform: {
					...helm.transform,
					position: {
						x: x + face.x * .16,
						y: y + EYE,
						z: z + face.z * .16
					}
				},
				customData: {
					...helm.customData,
					yaw: yawStr
				}
			};
			return { entities };
		});
		if (!pose.ok) return;
		const eyeY = pose.y + EYE;
		const pitch = lookPose.pitch;
		if (mode === "first") {
			const cos = Math.cos(pitch);
			const ahead = .22;
			camera.position.set(pose.x + pose.fx * ahead, eyeY, pose.z + pose.fz * ahead);
			camera.lookAt(pose.x + pose.fx * (ahead + cos), eyeY + Math.sin(pitch), pose.z + pose.fz * (ahead + cos));
			stageCamera.current = camera;
			return;
		}
		const back = 6.2;
		const rise = 3.4 + pitch * .5;
		camera.position.set(pose.x - pose.fx * back, pose.y + rise, pose.z - pose.fz * back);
		camera.lookAt(pose.x + pose.fx * 2.2, pose.y + .85, pose.z + pose.fz * 2.2);
		stageCamera.current = camera;
	});
	return null;
}
var SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|softpipe|microsoft basic render/i;
function glInfo() {
	if (typeof document === "undefined") return {
		webgl: false,
		webgl2: false,
		renderer: ""
	};
	try {
		const canvas = document.createElement("canvas");
		const gl2 = canvas.getContext("webgl2");
		const gl = gl2 ?? canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
		if (!gl) return {
			webgl: false,
			webgl2: false,
			renderer: ""
		};
		const context = gl;
		const ext = context.getExtension("WEBGL_debug_renderer_info");
		const renderer = ext ? String(context.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "") : "";
		context.getExtension("WEBGL_lose_context")?.loseContext();
		return {
			webgl: true,
			webgl2: Boolean(gl2),
			renderer
		};
	} catch {
		return {
			webgl: false,
			webgl2: false,
			renderer: ""
		};
	}
}
function classify(input) {
	if (!input.webgl) return "none";
	if (input.software) return "low";
	if (input.memoryGb > 0 && input.memoryGb <= 2) return "low";
	if (input.cores > 0 && input.cores <= 2) return "low";
	if (input.touch || input.memoryGb > 0 && input.memoryGb <= 4 || input.cores <= 4) return "mid";
	return "high";
}
var cached = null;
function probeHardware() {
	if (cached) return cached;
	const nav = typeof navigator === "undefined" ? null : navigator;
	const info = glInfo();
	const base = {
		webgl: info.webgl,
		webgl2: info.webgl2,
		webgpu: Boolean(nav && "gpu" in nav && nav.gpu),
		software: SOFTWARE_RENDERER.test(info.renderer),
		renderer: info.renderer,
		cores: nav?.hardwareConcurrency ?? 0,
		memoryGb: nav?.deviceMemory ?? 0,
		touch: typeof window !== "undefined" && ("ontouchstart" in window || (nav?.maxTouchPoints ?? 0) > 0),
		dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
	};
	cached = {
		...base,
		tier: classify(base)
	};
	return cached;
}
function qualityFor(profile) {
	switch (profile.tier) {
		case "high": return {
			dpr: [1, 2],
			antialias: true,
			powerPreference: "high-performance"
		};
		case "mid": return {
			dpr: [1, 1.5],
			antialias: true,
			powerPreference: "default"
		};
		default: return {
			dpr: [1, 1],
			antialias: false,
			powerPreference: "low-power"
		};
	}
}
/** ?soft=1 turns on the flat software picture. Debug only, for GPUs that report WebGL but draw nothing. */
function softRenderRequested() {
	if (typeof window === "undefined") return false;
	try {
		return new URLSearchParams(window.location.search).get("soft") === "1";
	} catch {
		return false;
	}
}
var UP = new Vector3(0, 1, 0);
var texCache = /* @__PURE__ */ new Map();
function paintLabTexture(kind) {
	const hit = texCache.get(kind);
	if (hit) return hit;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		if (kind === "circuit") {
			ctx.fillStyle = "#102033";
			ctx.fillRect(0, 0, 128, 128);
			ctx.strokeStyle = "#7ee0c8";
			ctx.lineWidth = 2;
			for (let i = 8; i < 128; i += 16) {
				ctx.beginPath();
				ctx.moveTo(i, 0);
				ctx.lineTo(i, 128);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(0, i);
				ctx.lineTo(48, i);
				ctx.stroke();
			}
		} else if (kind === "clay") {
			ctx.fillStyle = "#c46a4a";
			ctx.fillRect(0, 0, 128, 128);
			for (let i = 0; i < 420; i += 1) {
				ctx.fillStyle = `rgba(70,28,18,${.08 + i % 4 * .04})`;
				ctx.fillRect(i * 17 % 128, i * 29 % 128, 3, 2);
			}
		} else if (kind === "paper") {
			ctx.fillStyle = "#efe6d4";
			ctx.fillRect(0, 0, 128, 128);
			ctx.strokeStyle = "rgba(90,70,40,0.28)";
			for (let y = 10; y < 128; y += 8) {
				ctx.beginPath();
				ctx.moveTo(6, y);
				ctx.lineTo(122, y);
				ctx.stroke();
			}
		} else if (kind === "steel") {
			ctx.fillStyle = "#c5c9d1";
			ctx.fillRect(0, 0, 128, 128);
			ctx.strokeStyle = "rgba(70,76,86,0.45)";
			ctx.lineWidth = 2;
			for (let y = 4; y < 128; y += 6) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(128, y + (y % 12 === 0 ? 2 : 0));
				ctx.stroke();
			}
		} else if (kind === "brick") {
			ctx.fillStyle = "#8d4636";
			ctx.fillRect(0, 0, 128, 128);
			ctx.fillStyle = "#e7d3c4";
			for (let row = 0; row < 5; row += 1) {
				const y = 4 + row * 25;
				const shift = row % 2 ? 16 : 0;
				for (let x = -16 + shift; x < 128; x += 32) ctx.fillRect(x + 2, y + 2, 26, 18);
			}
		} else if (kind === "grain") {
			ctx.fillStyle = "#b8884e";
			ctx.fillRect(0, 0, 128, 128);
			ctx.strokeStyle = "rgba(90,48,18,0.35)";
			for (let i = 0; i < 18; i += 1) {
				ctx.beginPath();
				ctx.moveTo(0, i * 7);
				ctx.bezierCurveTo(40, i * 7 + 4, 80, i * 7 - 3, 128, i * 7 + 2);
				ctx.stroke();
			}
		} else if (kind === "night") {
			ctx.fillStyle = "#141822";
			ctx.fillRect(0, 0, 128, 128);
			ctx.fillStyle = "#d5d8de";
			for (let i = 0; i < 40; i += 1) {
				const size = i % 5 === 0 ? 2 : 1;
				ctx.fillRect(i * 37 % 124, i * 19 % 124, size, size);
			}
		} else {
			ctx.fillStyle = "#f4f1ec";
			ctx.fillRect(0, 0, 128, 128);
			ctx.strokeStyle = "#b7b0a6";
			ctx.lineWidth = 3;
			for (let i = 0; i < 7; i += 1) {
				ctx.beginPath();
				ctx.moveTo(-10, i * 22);
				ctx.bezierCurveTo(30, i * 22 + 18, 70, i * 22 - 12, 140, i * 22 + 8);
				ctx.stroke();
			}
		}
	}
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.needsUpdate = true;
	texCache.set(kind, texture);
	return texture;
}
function useReducedMotion() {
	const [reduce, setReduce] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const apply = () => setReduce(media.matches);
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, []);
	return reduce;
}
function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state += 1831565813;
		let t = state;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function hexRgb(hex) {
	const raw = hex.replace("#", "");
	const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
	const value = Number.parseInt(full, 16);
	if (!Number.isFinite(value)) return [
		.8,
		.8,
		.8
	];
	return [
		(value >> 16 & 255) / 255,
		(value >> 8 & 255) / 255,
		(value & 255) / 255
	];
}
function NeuralCloud({ seed, count, palette, shape }) {
	const { positions, colors } = (0, import_react.useMemo)(() => {
		const rand = mulberry32(seed || 1);
		const cols = palette.split(",").map((item) => item.trim()).filter((item) => item.startsWith("#"));
		const pos = new Float32Array(count * 3);
		const col = new Float32Array(count * 3);
		for (let i = 0; i < count; i += 1) {
			let x = 0;
			let y = 0;
			let z = 0;
			if (shape === "column") {
				const angle = rand() * Math.PI * 2;
				const radius = rand() * .28;
				x = Math.cos(angle) * radius;
				z = Math.sin(angle) * radius;
				y = (rand() - .15) * 1.7;
			} else if (shape === "ring") {
				const angle = rand() * Math.PI * 2;
				const radius = .55 + (rand() - .5) * .14;
				x = Math.cos(angle) * radius;
				z = Math.sin(angle) * radius;
				y = (rand() - .5) * .16;
			} else if (shape === "slab") {
				x = (rand() - .5) * 1.8;
				z = (rand() - .5) * 1.8;
				y = (rand() - .5) * .1;
			} else {
				const theta = rand() * Math.PI * 2;
				const phi = Math.acos(2 * rand() - 1);
				const radius = rand() ** .45 * .85;
				x = radius * Math.sin(phi) * Math.cos(theta);
				y = radius * Math.cos(phi) * .85;
				z = radius * Math.sin(phi) * Math.sin(theta);
			}
			pos[i * 3] = x;
			pos[i * 3 + 1] = y;
			pos[i * 3 + 2] = z;
			const rgb = hexRgb(cols[Math.floor(rand() * Math.max(1, cols.length))] ?? "#d7d2cb");
			col[i * 3] = rgb[0];
			col[i * 3 + 1] = rgb[1];
			col[i * 3 + 2] = rgb[2];
		}
		return {
			positions: pos,
			colors: col
		};
	}, [
		seed,
		count,
		palette,
		shape
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("points", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("bufferGeometry", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
		attach: "attributes-position",
		args: [positions, 3]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
		attach: "attributes-color",
		args: [colors, 3]
	})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pointsMaterial", {
		vertexColors: true,
		size: shape === "slab" ? .06 : .042,
		sizeAttenuation: true,
		depthWrite: false,
		transparent: true,
		opacity: .92
	})] });
}
function ClusterCut() {
	const dag = (0, import_react.useMemo)(() => clusterDag(), []);
	const camera = useThree((state) => state.camera);
	const gl = useThree((state) => state.gl);
	const ref = (0, import_react.useRef)(null);
	const seen = (0, import_react.useRef)("");
	const local = (0, import_react.useRef)(new Vector3());
	const inverse = (0, import_react.useRef)(new Matrix4());
	const [cut, setCut] = (0, import_react.useState)(() => selectCut(dag, {
		x: 0,
		y: 0,
		z: 8
	}, 50, 720, 1));
	useFrame(() => {
		const mesh = ref.current;
		if (!mesh) return;
		mesh.updateWorldMatrix(true, false);
		inverse.current.copy(mesh.matrixWorld).invert();
		local.current.copy(camera.position).applyMatrix4(inverse.current);
		const height = gl.domElement?.clientHeight || gl.domElement?.height || 720;
		const fov = "fov" in camera && typeof camera.fov === "number" ? camera.fov : 50;
		const next = selectCut(dag, {
			x: local.current.x,
			y: local.current.y,
			z: local.current.z
		}, fov, height, .2);
		if (next.key === seen.current) return;
		seen.current = next.key;
		setCut(next);
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		ref,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("bufferGeometry", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
				attach: "attributes-position",
				args: [cut.positions, 3]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
				attach: "attributes-normal",
				args: [cut.normals, 3]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
				attach: "attributes-color",
				args: [cut.colors, 3]
			})
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			vertexColors: true,
			roughness: .4,
			metalness: .16,
			flatShading: true
		})]
	}, cut.key);
}
function SplatCloud({ seed, count, color, size = .045 }) {
	const positions = (0, import_react.useMemo)(() => {
		const rand = mulberry32(seed || 1);
		const arr = new Float32Array(count * 3);
		for (let i = 0; i < count; i += 1) {
			const theta = rand() * Math.PI * 2;
			const phi = Math.acos(2 * rand() - 1);
			const radius = .25 + rand() * .9;
			arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
			arr[i * 3 + 1] = radius * Math.cos(phi) * .72;
			arr[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
		}
		return arr;
	}, [seed, count]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("points", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferGeometry", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("bufferAttribute", {
		attach: "attributes-position",
		args: [positions, 3]
	}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pointsMaterial", {
		color,
		size,
		sizeAttenuation: true,
		depthWrite: false,
		transparent: true,
		opacity: .9
	})] });
}
function Solid({ children, selected, tone, map }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", { children: [children, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
		color: map ? "#ffffff" : tone,
		map: map ?? void 0,
		roughness: .62,
		metalness: .28,
		emissive: selected ? tone : "#12141a",
		emissiveIntensity: selected ? .45 : .2
	})] });
}
function useAlbedo(src) {
	const [map, setMap] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		if (!src) {
			setMap(null);
			return;
		}
		if (src.startsWith("tex:")) {
			setMap(paintLabTexture(src.slice(4)));
			return;
		}
		let dead = false;
		loadAlbedo(src).then((texture) => {
			if (!dead) setMap(texture);
		});
		return () => {
			dead = true;
		};
	}, [src]);
	return map;
}
function assetLabel(entity) {
	const rep = entity.representation;
	if (rep.kind === "mesh") return rep.assetId;
	if (rep.kind === "gaussian") return "gaussian";
	return "avatar";
}
function LabConsole() {
	const tick = useForge((s) => s.tick);
	const selected = useForge((s) => s.selectedId == null ? null : s.entities[s.selectedId] ?? null);
	const busy = useForge((s) => s.busy);
	const [line, setLine] = (0, import_react.useState)("");
	const source = selected ? `${selected.name} · ${assetLabel(selected)} · ${selected.customData.color || "default"} · ${selected.transform.position.x.toFixed(1)}, ${selected.transform.position.y.toFixed(1)}, ${selected.transform.position.z.toFixed(1)}` : `tick ${String(tick).padStart(4, "0")} · click a body`;
	const paint = (color) => {
		if (!selected || selected.tags.includes("architect")) return;
		useForge.getState().dispatchManual("set_color", {
			id: String(selected.id),
			color
		});
	};
	const act = (name, args) => {
		useForge.getState().dispatchManual(name, args);
		if (name === "apply_velocity") useForge.getState().setRunning(true);
	};
	const nudge = (x, y, z) => {
		const current = useForge.getState();
		const body = current.selectedId == null ? null : current.entities[current.selectedId];
		if (!body || body.tags.includes("floor") || body.tags.includes("tetris")) return;
		const p = body.transform.position;
		current.dispatchManual("set_transform", {
			id: String(body.id),
			x: String(Math.round((p.x + x) * 100) / 100),
			y: String(Math.round((p.y + y) * 100) / 100),
			z: String(Math.round((p.z + z) * 100) / 100)
		});
	};
	const play = (kind) => {
		act("build_play", { kind });
		useForge.getState().setRunning(true);
	};
	const wrapTexture = () => {
		const current = useForge.getState();
		const body = current.selectedId == null ? null : current.entities[current.selectedId];
		if (!body || body.tags.includes("architect")) return;
		const order = [
			"marble",
			"circuit",
			"clay",
			"paper"
		];
		const now = body.customData.src?.startsWith("tex:") ? body.customData.src.slice(4) : "";
		const next = order[(order.indexOf(now) + 1) % order.length] ?? "marble";
		act("set_asset", {
			id: String(body.id),
			src: `tex:${next}`,
			title: next
		});
	};
	const importMesh = () => {
		const current = useForge.getState();
		const body = current.selectedId == null ? null : current.entities[current.selectedId];
		const order = [
			"gem",
			"knot",
			"vase",
			"crystal"
		];
		if (body && !body.tags.includes("floor") && !body.tags.includes("architect") && !body.tags.includes("tetris")) {
			const asset = body.representation.kind === "mesh" ? body.representation.assetId : "";
			const next = order[(Math.max(0, order.indexOf(asset)) + (order.includes(asset) ? 1 : 0)) % order.length] ?? "gem";
			act("edit_entity", {
				id: String(body.id),
				asset: next
			});
			return;
		}
		act("spawn_entity", {
			name: "Gem",
			asset: "gem",
			x: "2.2",
			y: "0",
			z: "1.3"
		});
	};
	const onSubmit = (event) => {
		event.preventDefault();
		const intent = line.trim();
		if (!intent) return;
		setLine("");
		useForge.getState().submitIntent(intent);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "lab-console",
		onSubmit,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "lab-console-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Forge computer" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: source })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "lab-actions",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => paint("teal"),
						disabled: !selected || selected.tags.includes("architect"),
						children: "Paint teal"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => paint("gold"),
						disabled: !selected || selected.tags.includes("architect"),
						children: "Paint gold"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => nudge(-.85, 0, 0),
						disabled: !selected || selected.tags.includes("floor") || selected.tags.includes("tetris"),
						children: "Nudge left"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => nudge(.85, 0, 0),
						disabled: !selected || selected.tags.includes("floor") || selected.tags.includes("tetris"),
						children: "Nudge right"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: wrapTexture,
						disabled: !selected || selected.tags.includes("architect"),
						children: "Wrap texture"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: importMesh,
						children: "Import mesh"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => play("tetris"),
						children: "Tetris"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => play("marble"),
						children: "Marble run"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => act("play_move", { move: "left" }),
						children: "Piece left"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => act("play_move", { move: "rotate" }),
						children: "Rotate"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => act("play_move", { move: "drop" }),
						children: "Drop piece"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							const orb = Object.values(useForge.getState().entities).find((entity) => entity.name === "DropOrb");
							if (!orb) return;
							act("apply_velocity", {
								id: String(orb.id),
								vx: "0",
								vy: "6",
								vz: "0"
							});
						},
						children: "Drop orb"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							act("spawn_agent", {
								role: "critic",
								name: "Critic"
							});
							if (!useForge.getState().criticPower) useForge.getState().setCriticPower(true);
						},
						children: "Spawn critic"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => selected && useForge.getState().despawn(selected.id),
						disabled: !selected || selected.tags.includes("architect") || selected.tags.includes("helm"),
						children: !selected ? "Delete" : selected.tags.includes("architect") ? "Avatar stays" : selected.tags.includes("helm") ? "Helm stays" : "Delete"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "lab-line",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Ask" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: line,
					onChange: (event) => setLine(event.target.value),
					placeholder: "Edit the selected body, or tell the forge what to build",
					disabled: busy
				})]
			})
		]
	});
}
function entityTone(entity) {
	return entity.customData.color || scenePalette.steel[entity.id % scenePalette.steel.length] || scenePalette.steel[0];
}
function AssetMesh({ asset, selected, tone, map, screen }) {
	if (asset === "card") {
		if (!screen) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [1, 1.15] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			color: map ? "#ffffff" : tone,
			map: map ?? void 0,
			roughness: .55,
			metalness: .05
		})] });
		return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				0,
				-.04
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
				1.12,
				1.28,
				.08
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				color: scenePalette.ground,
				roughness: .42,
				metalness: .48
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				0,
				.05
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [.92, .62] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				color: scenePalette.grid,
				emissive: scenePalette.mark,
				emissiveIntensity: .08,
				roughness: .35,
				metalness: .2
			})]
		})] });
	}
	if (asset === "sphere") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("sphereGeometry", { args: [
			.5,
			28,
			18
		] })
	});
	if (asset === "gem") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("icosahedronGeometry", { args: [.62, 0] })
	});
	if (asset === "crystal") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("octahedronGeometry", { args: [.62, 0] })
	});
	if (asset === "knot") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("torusKnotGeometry", { args: [
			.34,
			.11,
			80,
			12
		] })
	});
	if (asset === "vase") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
			.32,
			.2,
			.55,
			24
		] })
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		position: [
			0,
			.42,
			0
		],
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
			.18,
			.3,
			.38,
			24
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			color: map ? "#ffffff" : tone,
			map: map ?? void 0,
			roughness: .55,
			metalness: .08
		})]
	})] });
	if (asset === "ring") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		rotation: [
			Math.PI / 2.5,
			.15,
			0
		],
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("torusGeometry", { args: [
			.62,
			.08,
			16,
			48
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			color: tone,
			roughness: .42,
			metalness: .35
		})]
	});
	if (asset === "portal") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		position: [
			0,
			1.15,
			0
		],
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("torusGeometry", { args: [
			.95,
			.09,
			16,
			64
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			color: tone,
			emissive: tone,
			emissiveIntensity: .55,
			roughness: .3,
			metalness: .4
		})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circleGeometry", { args: [.88, 48] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", {
			color: tone,
			transparent: true,
			opacity: .22,
			depthWrite: false
		})] })]
	});
	if (asset === "visitor") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", {
		position: [
			0,
			.45,
			0
		],
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("capsuleGeometry", { args: [
			.2,
			.55,
			6,
			14
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			color: tone,
			roughness: .5,
			metalness: .2
		})] })
	});
	if (asset === "pillar") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
			.5,
			.5,
			1,
			24
		] })
	});
	if (asset === "platform") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
			1,
			1,
			1
		] })
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Solid, {
		selected,
		tone,
		map,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
			1,
			1,
			1
		] })
	});
}
function AvatarMesh({ tone }) {
	const helm = useForge((s) => Object.values(s.entities).find((entity) => entity.tags.includes("helm")) ?? null);
	const select = useForge((s) => s.select);
	const frame = helm?.customData.color || "#d4a24a";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				.05,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("capsuleGeometry", { args: [
				.22,
				.62,
				6,
				16
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				color: tone,
				roughness: .48,
				metalness: .34
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				.62,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("sphereGeometry", { args: [
				.16,
				20,
				16
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				color: tone,
				roughness: .4,
				metalness: .3
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				.62,
				.2
			],
			rotation: [
				Math.PI / 2,
				0,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("coneGeometry", { args: [
				.06,
				.16,
				8
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				color: "#1c2430",
				roughness: .4,
				metalness: .2
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			position: [
				0,
				.78,
				0
			],
			rotation: [
				Math.PI / 2,
				0,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("torusGeometry", { args: [
				.28,
				.012,
				8,
				32
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", { color: tone })]
		}),
		helm ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
			position: [
				0,
				.64,
				.04
			],
			onPointerDown: (event) => {
				event.stopPropagation();
				pointerClaim.entity = true;
				select(helm.id);
			},
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
					rotation: [
						Math.PI / 2,
						0,
						0
					],
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("torusGeometry", { args: [
						.2,
						.018,
						8,
						28
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						color: frame,
						metalness: .72,
						roughness: .28
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
					position: [
						-.08,
						.02,
						.16
					],
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
						.13,
						.075,
						.018
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						color: "#b7f3f4",
						emissive: "#2f8f93",
						emissiveIntensity: .45,
						metalness: .05,
						roughness: .08,
						transparent: true,
						opacity: .72
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
					position: [
						.08,
						.02,
						.16
					],
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
						.13,
						.075,
						.018
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						color: "#b7f3f4",
						emissive: "#2f8f93",
						emissiveIntensity: .45,
						metalness: .05,
						roughness: .08,
						transparent: true,
						opacity: .72
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
					position: [
						0,
						.025,
						.13
					],
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
						.028,
						.018,
						.02
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
						color: frame,
						metalness: .65,
						roughness: .3
					})]
				})
			]
		}) : null
	] });
}
function Body({ entity, selected }) {
	const tone = entityTone(entity);
	const map = useAlbedo(entity.customData.src);
	const rep = entity.representation;
	const plate = map && rep.kind === "hybrid" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		position: [
			.42,
			.7,
			.15
		],
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("planeGeometry", { args: [.46, .46] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
			map,
			roughness: .5,
			metalness: .04
		})]
	}) : null;
	const neural = entity.customData.neural === "splat" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NeuralCloud, {
		seed: Number(entity.customData.seed) || entity.id,
		count: Math.max(80, Math.min(320, Number(entity.customData.count) || 220)),
		palette: entity.customData.palette || tone,
		shape: entity.customData.shape || "blob"
	}) : null;
	if (entity.customData.method === "nanite") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClusterCut, {});
	if (rep.kind === "hybrid") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AvatarMesh, { tone }),
		plate,
		neural ?? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SplatCloud, {
			seed: entity.id * 17,
			count: 56,
			color: tone,
			size: .028
		})
	] });
	if (rep.kind === "gaussian") {
		if (neural) return neural;
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SplatCloud, {
			seed: entity.id * 13,
			count: Math.min(360, Math.max(40, rep.particleCount)),
			color: tone
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [neural, neural ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AssetMesh, {
		asset: rep.assetId,
		selected,
		tone,
		map,
		screen: entity.customData.role === "terminal"
	})] });
}
function VelocityMark({ velocity }) {
	const length = Math.hypot(velocity.x, velocity.y, velocity.z);
	const quaternion = (0, import_react.useMemo)(() => {
		const dir = new Vector3(velocity.x, velocity.y, velocity.z);
		if (dir.lengthSq() < 1e-6) return new Quaternion();
		return new Quaternion().setFromUnitVectors(UP, dir.normalize());
	}, [
		velocity.x,
		velocity.y,
		velocity.z
	]);
	if (length < .08) return null;
	const span = Math.min(1.6, Math.max(.35, length * .45));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
		position: [
			velocity.x * .12,
			velocity.y * .12,
			velocity.z * .12
		],
		quaternion,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("cylinderGeometry", { args: [
			.018,
			.018,
			span,
			6
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", { color: scenePalette.mark })]
	});
}
function DragSurface({ drag, setDragging }) {
	const { camera, gl, controls } = useThree();
	(0, import_react.useEffect)(() => {
		const el = gl.domElement;
		const raycaster = new Raycaster();
		const ndc = new Vector2();
		const hit = new Vector3();
		const finish = () => {
			const session = drag.current;
			if (!session) return;
			drag.current = null;
			setDragging(false);
			const orbit = controls;
			if (orbit) orbit.enabled = true;
			const now = useForge.getState().entities[session.id];
			const before = session.snap[session.id];
			if (!now || !before) return;
			if (!(Math.hypot(now.transform.position.x - before.transform.position.x, now.transform.position.z - before.transform.position.z) > .05)) return;
			useForge.setState((state) => {
				const seq = state.logSeq;
				return {
					undo: [...state.undo ?? [], {
						entities: session.snap,
						nextId: state.nextId,
						skills: state.skills ?? []
					}].slice(-16),
					history: [...state.history, {
						id: seq,
						tone: "engine",
						title: "Move",
						body: `${now.name} repositioned`
					}].slice(-80),
					logSeq: seq + 1
				};
			});
		};
		const onMove = (event) => {
			const session = drag.current;
			if (!session) return;
			const rect = el.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
			raycaster.setFromCamera(ndc, camera);
			if (!raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -session.y), hit)) return;
			useForge.setState((state) => {
				const current = state.entities[session.id];
				if (!current) return {};
				return { entities: {
					...state.entities,
					[session.id]: {
						...current,
						transform: {
							...current.transform,
							position: {
								x: hit.x,
								y: session.y,
								z: hit.z
							}
						}
					}
				} };
			});
		};
		el.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", finish);
		window.addEventListener("pointercancel", finish);
		return () => {
			el.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", finish);
			window.removeEventListener("pointercancel", finish);
		};
	}, [
		camera,
		gl,
		controls,
		drag,
		setDragging
	]);
	return null;
}
function EntityNode({ entity, selected, drag, setDragging, gazed }) {
	const ref = (0, import_react.useRef)(null);
	const reduce = useReducedMotion();
	const select = useForge((s) => s.select);
	const controls = useThree((state) => state.controls);
	const mode = useLook().mode;
	const p = entity.transform.position;
	const s = entity.transform.scale;
	const q = entity.transform.rotation;
	const fixed = entity.tags.includes("floor") || entity.tags.includes("tetris");
	const yaw = Number(entity.customData.yaw) || 0;
	const facing = entity.tags.includes("architect") || entity.tags.includes("agent");
	const half = yaw / 2;
	const quat = facing ? [
		0,
		Math.sin(half),
		0,
		Math.cos(half)
	] : [
		q.x,
		q.y,
		q.z,
		q.w
	];
	(0, import_react.useLayoutEffect)(() => {
		if (ref.current && !reduce) ref.current.scale.setScalar(.94);
	}, [reduce, entity.id]);
	useFrame((_, delta) => {
		const group = ref.current;
		if (!group || reduce) return;
		const current = group.scale.x;
		const next = current + (1 - current) * Math.min(1, delta * 8);
		group.scale.setScalar(next);
	});
	if (entity.tags.includes("helm")) return null;
	if (mode === "first" && entity.tags.includes("architect")) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("group", {
		ref,
		position: [
			p.x,
			p.y,
			p.z
		],
		userData: { forgeId: entity.id },
		onPointerDown: (event) => {
			event.stopPropagation();
			select(entity.id);
			if (mode !== "bench" || fixed) return;
			pointerClaim.entity = true;
			if (controls) controls.enabled = false;
			drag.current = {
				id: entity.id,
				y: useForge.getState().entities[entity.id]?.transform.position.y ?? p.y,
				snap: useForge.getState().entities
			};
			setDragging(true);
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("group", {
				scale: [
					s.x,
					s.y,
					s.z
				],
				quaternion: quat,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Body, {
					entity,
					selected
				})
			}),
			entity.physics ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VelocityMark, { velocity: entity.physics.velocity }) : null,
			(selected || gazed) && !entity.tags.includes("floor") ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
				raycast: () => null,
				scale: [
					s.x * 1.08,
					s.y * 1.08,
					s.z * 1.08
				],
				quaternion: quat,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("boxGeometry", { args: [
					1,
					1,
					1
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshBasicMaterial", {
					color: gazed && !selected ? "#7ee0c8" : scenePalette.mark,
					wireframe: true,
					transparent: true,
					opacity: .95
				})]
			}) : null
		]
	});
}
function GazeLock() {
	const { camera, scene, gl } = useThree();
	const mode = useLook().mode;
	const modeRef = (0, import_react.useRef)(mode);
	modeRef.current = mode;
	const ray = (0, import_react.useRef)(new Raycaster());
	const ndc = (0, import_react.useRef)(new Vector2(0, 0));
	const live = (0, import_react.useRef)(false);
	(0, import_react.useEffect)(() => {
		const el = gl.domElement;
		const place = (event) => {
			if (modeRef.current !== "bench") return;
			const rect = el.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			const x = (event.clientX - rect.left) / rect.width;
			const y = (event.clientY - rect.top) / rect.height;
			ndc.current.set(x * 2 - 1, -(y * 2 - 1));
			live.current = true;
			setAimPoint(x * 100, y * 100, true);
		};
		const onLeave = () => {
			live.current = false;
			ndc.current.set(0, 0);
			setAimPoint(50, 50, false);
		};
		el.addEventListener("pointermove", place);
		el.addEventListener("pointerleave", onLeave);
		return () => {
			el.removeEventListener("pointermove", place);
			el.removeEventListener("pointerleave", onLeave);
		};
	}, [gl]);
	useFrame(() => {
		if (mode !== "bench") {
			ndc.current.set(0, 0);
			setAimPoint(50, 50, true);
		} else if (!live.current) {
			setGazeLock(null);
			return;
		}
		ray.current.params.Points.threshold = .03;
		ray.current.params.Line.threshold = .02;
		ray.current.setFromCamera(ndc.current, camera);
		const hits = ray.current.intersectObjects(scene.children, true);
		let meshId = null;
		let pointId = null;
		for (const hit of hits) {
			let node = hit.object;
			let id = null;
			while (node) {
				const tagged = node.userData?.forgeId;
				if (typeof tagged === "number") {
					id = tagged;
					break;
				}
				node = node.parent;
			}
			if (id == null) continue;
			const entity = useForge.getState().entities[id];
			if (!entity || entity.tags.includes("floor") || entity.tags.includes("helm") || entity.tags.includes("architect")) continue;
			if (hit.object.isPoints === true) {
				pointId ??= id;
				continue;
			}
			meshId = id;
			break;
		}
		setGazeLock(meshId ?? pointId);
	}, 1);
	return null;
}
var MESH_PACKS = [
	"gem",
	"knot",
	"vase",
	"crystal"
];
function packPreview(kind) {
	return paintLabTexture(kind).image?.toDataURL?.() ?? "";
}
function TextureDeck() {
	const gaze = useGazeId();
	const mode = useLook().mode;
	const selectedId = useForge((s) => s.selectedId);
	const [note, setNote] = (0, import_react.useState)("");
	const previews = (0, import_react.useMemo)(() => {
		const rows = {};
		for (const pack of TEXTURE_PACKS) rows[pack] = packPreview(pack);
		return rows;
	}, []);
	const target = (() => {
		const state = useForge.getState();
		const pick = (id) => {
			if (id == null) return null;
			const entity = state.entities[id];
			if (!entity || entity.tags.includes("floor") || entity.tags.includes("helm") || entity.tags.includes("architect")) return null;
			return entity;
		};
		return pick(gaze) ?? pick(selectedId);
	})();
	const applyTexture = (pack) => {
		if (!target) {
			setNote("Look at a solid first");
			return;
		}
		setNote(pack);
		useForge.getState().dispatchManual("set_asset", {
			id: String(target.id),
			src: `tex:${pack}`,
			title: pack
		});
	};
	const applyMesh = (asset) => {
		if (!target) {
			useForge.getState().dispatchManual("spawn_entity", {
				name: asset[0].toUpperCase() + asset.slice(1),
				asset,
				x: "2.2",
				y: "0",
				z: "1.3"
			});
			setNote(asset);
			return;
		}
		setNote(asset);
		useForge.getState().dispatchManual("edit_entity", {
			id: String(target.id),
			asset
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "tex-deck",
		"aria-label": "Texture deck",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "tex-deck-note",
				children: note || (target ? target.name : mode === "bench" ? "Select a solid" : "Look to wrap")
			}),
			TEXTURE_PACKS.map((pack, index) => {
				const angle = Math.PI + (index / (TEXTURE_PACKS.length - 1) - .5) * 2.15;
				const radius = 118;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "tex-sphere",
					style: { transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)` },
					onClick: () => applyTexture(pack),
					"aria-label": `Wrap ${pack} on ${target?.name ?? "the solid you are looking at"}`,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "tex-ball",
						style: { backgroundImage: previews[pack] ? `url(${previews[pack]})` : void 0 }
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "tex-name",
						children: pack
					})]
				}, pack);
			}),
			MESH_PACKS.map((asset, index) => {
				const angle = Math.PI + (index / (MESH_PACKS.length - 1) - .5) * 1.15;
				const radius = 58;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "tex-sphere is-asset",
					style: { transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)` },
					onClick: () => applyMesh(asset),
					"aria-label": `Use the ${asset} mesh on ${target?.name ?? "a new solid"}`,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tex-ball is-asset" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "tex-name",
						children: asset
					})]
				}, asset);
			})
		]
	});
}
function Stage() {
	const entities = useForge((s) => s.entities);
	const selectedId = useForge((s) => s.selectedId);
	const gazeId = useGazeId();
	const mode = useLook().mode;
	const [dragging, setDragging] = (0, import_react.useState)(false);
	const drag = (0, import_react.useRef)(null);
	const list = Object.values(entities).filter((entity) => !entity.tags.includes("helm")).sort((a, b) => a.id - b.id);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("color", {
			attach: "background",
			args: [scenePalette.bg]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("fog", {
			attach: "fog",
			args: [
				scenePalette.fog,
				36,
				72
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("hemisphereLight", { args: [
			scenePalette.key,
			scenePalette.fill,
			.7
		] }),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ambientLight", { intensity: .38 }),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("directionalLight", {
			position: [
				7,
				11,
				5
			],
			intensity: 1.55,
			color: scenePalette.key
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("mesh", {
			rotation: [
				-Math.PI / 2,
				0,
				0
			],
			position: [
				0,
				-.012,
				0
			],
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circleGeometry", { args: [30, 80] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("meshStandardMaterial", {
				color: "#1c2128",
				roughness: 1,
				metalness: 0
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("gridHelper", {
			args: [
				40,
				40,
				scenePalette.gridMajor,
				scenePalette.grid
			],
			position: [
				0,
				0,
				0
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DragSurface, {
			drag,
			setDragging
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(GazeLock, {}),
		list.map((entity) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EntityNode, {
			entity,
			selected: entity.id === selectedId,
			gazed: entity.id === gazeId && entity.id !== selectedId,
			drag,
			setDragging
		}, entity.id)),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pilot, {}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(OrbitControls, {
			makeDefault: true,
			enableDamping: true,
			enabled: mode === "bench" && !dragging,
			dampingFactor: .08,
			target: [
				.2,
				.2,
				.4
			],
			maxPolarAngle: 1.05,
			minPolarAngle: .2,
			minDistance: 8,
			maxDistance: 32
		})
	] });
}
function HoldKey({ code, label }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		className: "visor-key",
		onPointerDown: (event) => {
			event.preventDefault();
			pilotKeys.add(code);
		},
		onPointerUp: () => pilotKeys.delete(code),
		onPointerLeave: () => pilotKeys.delete(code),
		onPointerCancel: () => pilotKeys.delete(code),
		children: label
	});
}
function Steer() {
	const mode = useLook().mode;
	const drag = (0, import_react.useRef)(null);
	if (mode === "bench") return null;
	const home = () => {
		faceLook(0, mode === "first" ? -.08 : -.16);
		useForge.setState((state) => restoreLab(state));
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "steer",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "dpad",
				"aria-label": "Move",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Move" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HoldKey, {
						code: "KeyW",
						label: "Forward"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "dpad-row",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HoldKey, {
								code: "KeyA",
								label: mode === "first" ? "Left" : "Turn L"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HoldKey, {
								code: "KeyS",
								label: "Back"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HoldKey, {
								code: "KeyD",
								label: mode === "first" ? "Right" : "Turn R"
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "steer-home",
				onClick: home,
				children: "Find room"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "look-pad",
				onPointerDown: (event) => {
					event.preventDefault();
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = {
						id: event.pointerId,
						x: event.clientX,
						y: event.clientY
					};
				},
				onPointerMove: (event) => {
					const current = drag.current;
					if (!current || current.id !== event.pointerId) return;
					shiftLook(event.clientX - current.x, event.clientY - current.y);
					current.x = event.clientX;
					current.y = event.clientY;
				},
				onPointerUp: () => {
					drag.current = null;
				},
				onPointerCancel: () => {
					drag.current = null;
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Look" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "drag here" })]
			})
		]
	});
}
function ModeBar() {
	const { mode, setMode, immersive, setImmersive } = useLook();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mode-bar",
		role: "toolbar",
		"aria-label": "View",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: mode === "third" ? "is-on" : "",
				onClick: () => setMode("third"),
				children: "3rd"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: mode === "first" ? "is-on" : "",
				onClick: () => setMode("first"),
				children: "Helm"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: mode === "bench" ? "is-on" : "",
				onClick: () => setMode("bench"),
				children: "Bench"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: immersive ? "is-on" : "",
				onClick: () => setImmersive(!immersive),
				children: immersive ? "Window" : "Fill"
			})
		]
	});
}
function Visor() {
	const { mode, immersive } = useLook();
	const gaze = useGazeId();
	const looked = useForge((s) => gaze == null ? null : s.entities[gaze] ?? null);
	const last = useForge((s) => s.history[s.history.length - 1]);
	const busy = useForge((s) => s.busy);
	const [line, setLine] = (0, import_react.useState)("");
	if (mode === "bench") return null;
	const onSubmit = (event) => {
		event.preventDefault();
		const intent = line.trim();
		if (!intent) return;
		setLine("");
		useForge.getState().submitIntent(intent);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: mode === "first" ? "visor is-first" : "visor",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "visor-frame" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "visor-cross",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "visor-read",
				children: [looked ? `Looking at ${looked.name}` : "Looking at the lab", last ? ` · ${last.title}: ${last.body.replace(/\s+/g, " ").slice(0, 72)}` : ""]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "visor-hint",
				children: "Drag the view or the Look pad. Move walks the body. Find room puts the exhibits in front of you."
			}),
			immersive ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("form", {
				className: "visor-ask",
				onSubmit,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Helm" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: line,
					onChange: (event) => setLine(event.target.value),
					placeholder: "Tell the helm what to change in the world",
					disabled: busy
				})] })
			}) : null
		]
	});
}
function Viewport() {
	const hardware = (0, import_react.useMemo)(() => probeHardware(), []);
	const quality = (0, import_react.useMemo)(() => qualityFor(hardware), [hardware]);
	const soft = (0, import_react.useMemo)(() => softRenderRequested(), []);
	const tick = useForge((s) => s.tick);
	const count = useForge((s) => Object.keys(s.entities).length);
	const { mode } = useLook();
	const gaze = useGazeId();
	const selected = useForge((s) => s.selectedId == null ? null : s.entities[s.selectedId] ?? null);
	const aim = useForge((s) => gaze == null ? null : s.entities[gaze] ?? null) ?? selected;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "view",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Canvas, {
				camera: {
					position: [
						10.4,
						6.8,
						10.2
					],
					fov: 42,
					near: .1,
					far: 80
				},
				dpr: quality.dpr,
				gl: {
					antialias: quality.antialias,
					alpha: false,
					powerPreference: quality.powerPreference,
					failIfMajorPerformanceCaveat: false,
					preserveDrawingBuffer: soft
				},
				style: {
					width: "100%",
					height: "100%",
					touchAction: "none"
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stage, {})
			}),
			soft ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RoomPicture, {}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
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
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: aim ? aim.tags.includes("architect") ? "Architect · you" : aim.tags.includes("helm") ? "Helm · visor" : mode === "bench" ? aim.name : `looking at ${aim.name}` : "nothing in the crosshair" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["g ", GRAVITY.toFixed(2)] })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModeBar, {})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Visor, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Steer, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TextureDeck, {}),
			mode === "bench" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LabConsole, {}) : null
		]
	});
}
//#endregion
export { Viewport };

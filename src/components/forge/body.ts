/**
 * One smooth body for the jointed figure (Avatar.tsx): a skinned suit lofted round the skeleton the
 * pose system already drives. Each joint group gets a bone as a child, so the existing animation
 * moves the skin; rings of the body are weighted across the joints they bend round (hips, knees,
 * waist, shoulders, elbows, neck), so the figure bends as one surface instead of capsules meeting.
 *
 * The geometry is built in the figure's rest pose (every joint rotation zero), in the root group's
 * frame, and bound with inverse bind matrices from those rest positions, so it does not matter what
 * pose the figure is in when it is bound.
 */
import { Bone, BufferGeometry, Float32BufferAttribute, Matrix4, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Group, type Material } from "three";

export type BodyDims = { hipY: number; thigh: number; shin: number; torso: number; upperArm: number; forearm: number };

export const BONES = ["pelvis", "hipL", "kneeL", "hipR", "kneeR", "chest", "shoulderL", "elbowL", "shoulderR", "elbowR", "head"] as const;
export type BoneName = (typeof BONES)[number];

/** Where each joint sits at rest, in the root group's frame. */
export function restPositions(d: BodyDims): Record<BoneName, Vector3> {
  const chestY = d.hipY + 0.07;
  const shoulderY = chestY + d.torso - 0.02;
  return {
    pelvis: new Vector3(0, d.hipY, 0),
    hipL: new Vector3(0.09, d.hipY, 0),
    kneeL: new Vector3(0.09, d.hipY - d.thigh, 0),
    hipR: new Vector3(-0.09, d.hipY, 0),
    kneeR: new Vector3(-0.09, d.hipY - d.thigh, 0),
    chest: new Vector3(0, chestY, 0),
    shoulderL: new Vector3(0.2, shoulderY, 0),
    elbowL: new Vector3(0.2, shoulderY - d.upperArm, 0),
    shoulderR: new Vector3(-0.2, shoulderY, 0),
    elbowR: new Vector3(-0.2, shoulderY - d.upperArm, 0),
    head: new Vector3(0, chestY + d.torso + 0.09, 0),
  };
}

/** A ring of the body: height, centre, radii (side to side, front to back) and its bone weights. */
type Ring = { y: number; x: number; z: number; rx: number; rz: number; w: [BoneName, number][] };

const SIDES = 18;

function loft(rings: Ring[], pos: number[], idx: number[], wts: number[]): number {
  const index = (b: BoneName) => BONES.indexOf(b);
  // Two extra rings between each pair, eased, for smooth curvature.
  const fine: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i += 1) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let k = 0; k < 3; k += 1) {
      const t = k / 3;
      const s = t * t * (3 - 2 * t);
      const weights = new Map<BoneName, number>();
      for (const [n, v] of a.w) weights.set(n, (weights.get(n) ?? 0) + v * (1 - s));
      for (const [n, v] of b.w) weights.set(n, (weights.get(n) ?? 0) + v * s);
      fine.push({ y: a.y + (b.y - a.y) * t, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * s, rx: a.rx + (b.rx - a.rx) * s, rz: a.rz + (b.rz - a.rz) * s, w: [...weights.entries()] });
    }
  }
  fine.push(rings[rings.length - 1]);
  fine.forEach((r) => {
    const top = [...r.w].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((n, [, v]) => n + v, 0) || 1;
    for (let j = 0; j < SIDES; j += 1) {
      const a = (j / SIDES) * Math.PI * 2;
      pos.push(r.x + Math.cos(a) * r.rx, r.y, r.z + Math.sin(a) * r.rz);
      for (let k = 0; k < 4; k += 1) {
        idx.push(top[k] ? index(top[k][0]) : 0);
        wts.push(top[k] ? top[k][1] / sum : 0);
      }
    }
  });
  return fine.length;
}

/** The suit's skin: legs, torso with a collar, arms; rest pose, in the root group's frame. */
export function suitGeometry(d: BodyDims): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const wts: number[] = [];
  const faces: number[] = [];
  const rest = restPositions(d);
  const tube = (rings: Ring[]) => {
    const start = pos.length / 3;
    const count = loft(rings, pos, idx, wts);
    for (let i = 0; i < count - 1; i += 1) {
      for (let j = 0; j < SIDES; j += 1) {
        const a = start + i * SIDES + j;
        const b = start + i * SIDES + ((j + 1) % SIDES);
        const c = a + SIDES;
        const e = b + SIDES;
        // Rings run top to bottom; wind so the faces point outward.
        faces.push(a, b, c, b, e, c);
      }
    }
  };
  for (const side of ["L", "R"] as const) {
    const hip = rest[`hip${side}`];
    const knee = rest[`knee${side}`];
    const x = hip.x;
    const h = `hip${side}` as BoneName;
    const k = `knee${side}` as BoneName;
    const ankle = knee.y - d.shin;
    tube([
      { y: hip.y + 0.05, x: x * 0.8, z: 0, rx: 0.088, rz: 0.095, w: [["pelvis", 0.7], [h, 0.3]] },
      { y: hip.y - 0.03, x, z: 0.005, rx: 0.086, rz: 0.09, w: [[h, 1]] },
      { y: hip.y - 0.16, x, z: 0.008, rx: 0.075, rz: 0.08, w: [[h, 1]] },
      { y: knee.y + 0.06, x, z: 0.004, rx: 0.058, rz: 0.062, w: [[h, 0.85], [k, 0.15]] },
      { y: knee.y, x, z: 0.006, rx: 0.054, rz: 0.058, w: [[h, 0.5], [k, 0.5]] },
      { y: knee.y - 0.06, x, z: -0.004, rx: 0.056, rz: 0.06, w: [[k, 0.9], [h, 0.1]] },
      { y: knee.y - 0.12, x, z: -0.012, rx: 0.06, rz: 0.066, w: [[k, 1]] },
      { y: knee.y - 0.22, x, z: -0.004, rx: 0.046, rz: 0.05, w: [[k, 1]] },
      { y: ankle + 0.05, x, z: 0.004, rx: 0.038, rz: 0.042, w: [[k, 1]] },
    ]);
  }
  const chest = rest.chest;
  const top = chest.y + d.torso;
  tube([
    { y: top + 0.1, x: 0, z: 0.0, rx: 0.046, rz: 0.044, w: [["head", 0.7], ["chest", 0.3]] },
    { y: top + 0.035, x: 0, z: -0.002, rx: 0.058, rz: 0.054, w: [["chest", 0.7], ["head", 0.3]] },
    { y: top - 0.01, x: 0, z: -0.004, rx: 0.12, rz: 0.075, w: [["chest", 1]] },
    { y: top - 0.06, x: 0, z: 0.0, rx: 0.185, rz: 0.1, w: [["chest", 1]] },
    { y: chest.y + 0.24, x: 0, z: 0.012, rx: 0.172, rz: 0.115, w: [["chest", 1]] },
    { y: chest.y + 0.12, x: 0, z: 0.008, rx: 0.15, rz: 0.104, w: [["chest", 1]] },
    { y: chest.y + 0.03, x: 0, z: 0.0, rx: 0.136, rz: 0.096, w: [["chest", 0.55], ["pelvis", 0.45]] },
    { y: rest.pelvis.y + 0.0, x: 0, z: 0.0, rx: 0.15, rz: 0.104, w: [["pelvis", 1]] },
    { y: rest.pelvis.y - 0.07, x: 0, z: 0.0, rx: 0.13, rz: 0.095, w: [["pelvis", 1]] },
  ]);
  for (const side of ["L", "R"] as const) {
    const sh = rest[`shoulder${side}`];
    const el = rest[`elbow${side}`];
    const s = `shoulder${side}` as BoneName;
    const e = `elbow${side}` as BoneName;
    const x = sh.x;
    tube([
      { y: sh.y + 0.045, x: x * 0.8, z: 0, rx: 0.05, rz: 0.055, w: [["chest", 0.6], [s, 0.4]] },
      { y: sh.y - 0.01, x, z: 0, rx: 0.056, rz: 0.058, w: [[s, 0.85], ["chest", 0.15]] },
      { y: sh.y - 0.1, x, z: 0, rx: 0.05, rz: 0.054, w: [[s, 1]] },
      { y: el.y + 0.04, x, z: 0, rx: 0.042, rz: 0.044, w: [[s, 0.85], [e, 0.15]] },
      { y: el.y, x, z: 0, rx: 0.04, rz: 0.042, w: [[s, 0.5], [e, 0.5]] },
      { y: el.y - 0.06, x, z: 0.003, rx: 0.043, rz: 0.045, w: [[e, 1]] },
      { y: el.y - 0.15, x, z: 0.003, rx: 0.037, rz: 0.038, w: [[e, 1]] },
      { y: el.y - d.forearm + 0.025, x, z: 0, rx: 0.03, rz: 0.032, w: [[e, 1]] },
    ]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("skinIndex", new Uint16BufferAttribute(idx, 4));
  g.setAttribute("skinWeight", new Float32BufferAttribute(wts, 4));
  g.setIndex(faces);
  g.computeVertexNormals();
  return g;
}

/**
 * Puts a bone in each joint group and a skinned suit in the root. Returns a cleanup. The joint
 * groups must be the figure's (rest offsets as in `restPositions`).
 */
export function attachSuit(joints: Partial<Record<BoneName | "root", Group | null>>, d: BodyDims, material: Material): (() => void) | null {
  const root = joints.root;
  if (!root || BONES.some((b) => !joints[b])) return null;
  const rest = restPositions(d);
  const bones = BONES.map((name) => {
    const bone = new Bone();
    bone.name = `suit-${name}`;
    joints[name]!.add(bone);
    return bone;
  });
  const inverses = BONES.map((name) => new Matrix4().makeTranslation(rest[name].x, rest[name].y, rest[name].z).invert());
  const mesh = new SkinnedMesh(suitGeometry(d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  // Bone world matrices are the joints' (root included), times the rest inverse: identity bind.
  mesh.bind(new Skeleton(bones, inverses), new Matrix4());
  return () => {
    root.remove(mesh);
    bones.forEach((bone) => bone.parent?.remove(bone));
    mesh.geometry.dispose();
    mesh.skeleton.dispose();
  };
}

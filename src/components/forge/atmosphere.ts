/**
 * Air you can see, for the top quality rungs (PostFX.tsx): exponential height fog that pools in the
 * valley and thins with height, light scattered toward the sun (warm haze where you look into it,
 * cool where you look away), and the sun disc that god rays stream from.
 *
 * Scenery.tsx writes the live sky into `air` every frame (sun direction and colour, fog colour, how
 * hazy the weather is); the effect reads it. Everything is in linear light, before tone mapping.
 */
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Uniform, Vector3, type Camera, type WebGLRenderer, type WebGLRenderTarget } from "three";

export const air = {
  /** Toward the sun (unit). */
  sunDir: new Vector3(0.4, 0.5, 0.3).normalize(),
  /** The sun's light colour, linear. */
  sunColor: new Color(1, 0.86, 0.66),
  /** The sky's fog colour at the horizon, linear. */
  fogColor: new Color(0.74, 0.7, 0.66),
  /** 0 clear .. 1 thick fog (weather). */
  haze: 0.2,
  /** How high the sun is, 0 at or below the horizon .. 1 overhead. */
  sunUp: 0.5,
  /** Rain or snow falling, 0..1 (scattering goes grey and close). */
  wet: 0,
};

const FRAG = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uDensity;
uniform float uFalloff;
uniform float uScatter;
uniform float uMaxDist;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * clip;
  view /= view.w;
  vec3 world = (uViewInv * vec4(view.xyz, 1.0)).xyz;
  vec3 ray = world - uCam;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  bool sky = depth >= 0.99999;
  dist = sky ? uMaxDist : min(dist, uMaxDist);

  // Exponential height fog, integrated along the ray from the eye (closed form).
  float h = max(uCam.y, 0.0);
  float k = uFalloff;
  float fall = k * dir.y * dist;
  float shape = abs(fall) > 1e-3 ? (1.0 - exp(-fall)) / fall : 1.0;
  float optical = uDensity * exp(-k * h) * dist * shape;
  float fog = 1.0 - exp(-optical);
  // The sky above stays clear; only the haze at its foot is fogged.
  if (sky) fog *= smoothstep(0.42, -0.02, dir.y);

  // In-scattering: a Henyey-Greenstein lobe toward the sun, plus a little all round.
  float mu = dot(dir, uSunDir);
  float g = 0.72;
  float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5) / 12.566;
  vec3 inscatter = uFogColor + uSunColor * hg * uScatter * 6.0;
  outputColor = vec4(mix(inputColor.rgb, inscatter, clamp(fog, 0.0, 0.96)), inputColor.a);
}
`;

/** Height fog and sun scatter from the depth buffer, as one full-screen pass. */
export class AtmosphereEffect extends Effect {
  private camera: Camera | null = null;

  constructor() {
    super("AtmosphereEffect", FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uProjInv", new Uniform(new Matrix4())],
        ["uViewInv", new Uniform(new Matrix4())],
        ["uCam", new Uniform(new Vector3())],
        ["uSunDir", new Uniform(new Vector3())],
        ["uSunColor", new Uniform(new Color())],
        ["uFogColor", new Uniform(new Color())],
        ["uDensity", new Uniform(0.01)],
        ["uFalloff", new Uniform(0.09)],
        ["uScatter", new Uniform(0.6)],
        ["uMaxDist", new Uniform(420)],
      ]),
    });
  }

  override set mainCamera(camera: Camera) {
    this.camera = camera;
  }

  override update(_renderer: WebGLRenderer, _input: WebGLRenderTarget, _dt?: number) {
    const camera = this.camera;
    if (!camera) return;
    const u = this.uniforms;
    (u.get("uProjInv")!.value as Matrix4).copy(camera.projectionMatrixInverse);
    (u.get("uViewInv")!.value as Matrix4).copy(camera.matrixWorld);
    (u.get("uCam")!.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
    (u.get("uSunDir")!.value as Vector3).copy(air.sunDir);
    // Low sun: longer path through air, deeper colour; at night the scatter is moonlight-faint.
    const day = Math.min(1, air.sunUp * 4);
    (u.get("uSunColor")!.value as Color).copy(air.sunColor).multiplyScalar(0.25 + day * 1.1);
    (u.get("uFogColor")!.value as Color).copy(air.fogColor).multiplyScalar(0.55 + day * 0.4);
    u.get("uDensity")!.value = 0.0042 + air.haze * 0.03 + air.wet * 0.008;
    u.get("uFalloff")!.value = 0.11 - air.haze * 0.06;
    u.get("uScatter")!.value = (0.35 + (1 - air.sunUp) * 0.9) * (1 - air.wet * 0.7) * day;
  }
}

/**
 * The sun disc: what god rays stream from, and a hot spot for the bloom. One for the page; the
 * scenery puts it in the sky and moves it with the camera so it is always the same size.
 */
export const sunDisc = new Mesh(
  new SphereGeometry(16, 24, 12),
  new MeshBasicMaterial({ color: new Color(1, 0.9, 0.72).multiplyScalar(5), fog: false, transparent: true, depthWrite: false, toneMapped: false }),
);
sunDisc.frustumCulled = false;
sunDisc.renderOrder = -9;
sunDisc.userData.scenery = true;

/** Keep the disc in the sky, toward the sun, in step with the camera. */
export function placeSun(camera: Camera) {
  sunDisc.position.copy(camera.position).addScaledVector(air.sunDir, 430);
  sunDisc.visible = air.sunDir.y > -0.06;
  const m = sunDisc.material as MeshBasicMaterial;
  // Low and red near the horizon, white-gold high up; faint behind thick weather.
  m.color.copy(air.sunColor).multiplyScalar((2.5 + air.sunUp * 4) * (1 - air.haze * 0.75) * (1 - air.wet * 0.6));
}

/**
 * Hyper Breakout, the rules (drawn by src/components/forge/BreakoutGame.tsx). A paddle, a ball and a
 * wall of glowing bricks in the 4D palette; tougher bricks take two or three hits; some drop a
 * capsule: three balls, a wide paddle, or slow time. Clear the wall for the next level (a new
 * pattern, a faster ball). Three lives.
 *
 * The field is 1 wide and FIELD.height tall, y down. Plain numbers and a seeded generator, so a game
 * plays the same in tests; stepBreakout changes the state in place and returns what happened, for
 * the sparks and sounds.
 */

export const FIELD = { width: 1, height: 1.4, cols: 10, top: 0.14, brickH: 0.042, gap: 0.006, margin: 0.03 } as const;
export const PADDLE = { y: 1.32, h: 0.022, w: 0.19, wide: 0.3, speed: 1.9 } as const;
export const BALL = { r: 0.0115, speed: 0.82, perLevel: 0.07, most: 1.45 } as const;
export const LIVES = 3;

export type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean };
export type Brick = { x: number; y: number; w: number; h: number; hp: number; max: number; tone: number };
export type PowerKind = "multi" | "wide" | "slow";
export type Drop = { x: number; y: number; kind: PowerKind };

export type BreakoutState = {
  level: number;
  score: number;
  best: number;
  lives: number;
  balls: Ball[];
  bricks: Brick[];
  drops: Drop[];
  paddle: { x: number; w: number };
  /** Seconds left of the wide paddle and of slow time. */
  wide: number;
  slow: number;
  /** Bricks hit since the ball last touched the paddle. */
  combo: number;
  over: boolean;
  seed: number;
};

export type BreakoutEvent = { kind: "hit" | "break" | "paddle" | "wall" | "lost" | "power" | "level" | "over"; x: number; y: number; tone?: number; power?: PowerKind };

export type BreakoutInput = {
  /** Where the paddle should go (a finger or the mouse), or null. */
  target: number | null;
  /** Keys or a stick: -1 left .. 1 right. */
  move: number;
  launch: boolean;
};

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const PATTERNS = ["wall", "pyramid", "checker", "diamond", "waves", "columns"] as const;

/** The wall for a level: a pattern, rows getting tougher toward the top, more rows later on. */
export function bricksFor(level: number, seed: number): Brick[] {
  const rand = rng(seed * 7919 + level * 104729);
  const pattern = PATTERNS[(level - 1) % PATTERNS.length];
  const rows = Math.min(9, 5 + Math.floor((level - 1) / 2));
  const { cols, top, brickH, gap, margin } = FIELD;
  const w = (FIELD.width - margin * 2 - gap * (cols - 1)) / cols;
  const out: Brick[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const mid = (cols - 1) / 2;
      const keep =
        pattern === "wall"
          ? true
          : pattern === "pyramid"
            ? Math.abs(c - mid) <= r * 0.75 + 0.5
            : pattern === "checker"
              ? (r + c) % 2 === 0
              : pattern === "diamond"
                ? Math.abs(c - mid) + Math.abs(r - (rows - 1) / 2) <= Math.max(mid, (rows - 1) / 2) + 0.5
                : pattern === "waves"
                  ? Math.sin(c * 0.9 + r * 0.6) > -0.45
                  : c % 3 !== 1;
      if (!keep) continue;
      const tough = rows - 1 - r;
      const hp = Math.max(1, Math.min(3, 1 + Math.floor((tough + level - 1) / 3) - (rand() < 0.3 ? 1 : 0)));
      out.push({ x: margin + c * (w + gap), y: top + r * (brickH + gap), w, h: brickH, hp, max: hp, tone: Math.floor(r + c * 0.35 + level) % 6 });
    }
  }
  return out;
}

const ballSpeed = (s: BreakoutState) => Math.min(BALL.most, BALL.speed + BALL.perLevel * (s.level - 1)) * (s.slow > 0 ? 0.62 : 1);

function stuckBall(s: BreakoutState): Ball {
  return { x: s.paddle.x, y: PADDLE.y - BALL.r - 0.002, vx: 0, vy: 0, stuck: true };
}

export function newBreakout(seed: number, best = 0): BreakoutState {
  const s: BreakoutState = {
    level: 1,
    score: 0,
    best,
    lives: LIVES,
    balls: [],
    bricks: bricksFor(1, seed),
    drops: [],
    paddle: { x: 0.5, w: PADDLE.w },
    wide: 0,
    slow: 0,
    combo: 0,
    over: false,
    seed,
  };
  s.balls = [stuckBall(s)];
  return s;
}

/** Turn the ball to `angle` (radians from straight up, + right) at the game's speed. */
function aim(ball: Ball, angle: number, speed: number) {
  ball.vx = Math.sin(angle) * speed;
  ball.vy = -Math.cos(angle) * speed;
}

function hitsBrick(b: Ball, k: Brick): boolean {
  return b.x + BALL.r > k.x && b.x - BALL.r < k.x + k.w && b.y + BALL.r > k.y && b.y - BALL.r < k.y + k.h;
}

/** One frame. Changes `s` and returns what happened. */
export function stepBreakout(s: BreakoutState, input: BreakoutInput, dt: number): BreakoutEvent[] {
  const events: BreakoutEvent[] = [];
  if (s.over) return events;
  const h = Math.min(0.05, Math.max(0, dt));
  s.wide = Math.max(0, s.wide - h);
  s.slow = Math.max(0, s.slow - h);
  const wantW = s.wide > 0 ? PADDLE.wide : PADDLE.w;
  s.paddle.w += (wantW - s.paddle.w) * Math.min(1, h * 10);

  // The paddle follows a finger directly, or slides with the keys.
  const half = s.paddle.w / 2;
  if (input.target != null) s.paddle.x += (input.target - s.paddle.x) * Math.min(1, h * 24);
  else s.paddle.x += input.move * PADDLE.speed * h;
  s.paddle.x = Math.max(half, Math.min(FIELD.width - half, s.paddle.x));

  const speed = ballSpeed(s);
  for (const ball of s.balls) {
    if (ball.stuck) {
      ball.x = s.paddle.x;
      ball.y = PADDLE.y - BALL.r - 0.002;
      if (input.launch) {
        ball.stuck = false;
        aim(ball, (s.paddle.x - 0.5) * 0.6 + 0.12, speed);
      }
      continue;
    }
    // Keep the pace (slow time eases it down, and back up).
    const v = Math.hypot(ball.vx, ball.vy) || 1;
    const k = 1 + (speed / v - 1) * Math.min(1, h * 4);
    ball.vx *= k;
    ball.vy *= k;
    const steps = Math.max(1, Math.ceil((Math.hypot(ball.vx, ball.vy) * h) / (BALL.r * 0.8)));
    const sh = h / steps;
    for (let i = 0; i < steps; i += 1) {
      // Across, then down: a brick hit on one axis turns that part of the motion back.
      for (const axis of ["x", "y"] as const) {
        const d = (axis === "x" ? ball.vx : ball.vy) * sh;
        if (axis === "x") ball.x += d;
        else ball.y += d;
        let turned = false;
        for (let j = s.bricks.length - 1; j >= 0; j -= 1) {
          const brick = s.bricks[j];
          if (!hitsBrick(ball, brick)) continue;
          if (!turned) {
            if (axis === "x") {
              ball.x -= d;
              ball.vx = -ball.vx;
            } else {
              ball.y -= d;
              ball.vy = -ball.vy;
            }
            turned = true;
          }
          brick.hp -= 1;
          s.combo += 1;
          const cx = brick.x + brick.w / 2;
          const cy = brick.y + brick.h / 2;
          if (brick.hp <= 0) {
            s.bricks.splice(j, 1);
            s.score += 10 * brick.max + 5 * Math.min(10, s.combo);
            events.push({ kind: "break", x: cx, y: cy, tone: brick.tone });
            if (dropRoll(s, cx, cy) < 0.14) {
              const kinds: PowerKind[] = ["multi", "wide", "slow"];
              s.drops.push({ x: cx, y: cy, kind: kinds[Math.floor(dropRoll(s, cy, cx) * 3) % 3] });
            }
          } else {
            s.score += 5;
            events.push({ kind: "hit", x: cx, y: cy, tone: brick.tone });
          }
          break;
        }
      }
      // Walls and ceiling.
      if (ball.x < BALL.r) {
        ball.x = BALL.r;
        ball.vx = Math.abs(ball.vx);
        events.push({ kind: "wall", x: ball.x, y: ball.y });
      } else if (ball.x > FIELD.width - BALL.r) {
        ball.x = FIELD.width - BALL.r;
        ball.vx = -Math.abs(ball.vx);
        events.push({ kind: "wall", x: ball.x, y: ball.y });
      }
      if (ball.y < BALL.r) {
        ball.y = BALL.r;
        ball.vy = Math.abs(ball.vy);
        events.push({ kind: "wall", x: ball.x, y: ball.y });
      }
      // The paddle: where it lands on it sets the angle out (the middle straight up, the ends steep).
      const top = PADDLE.y;
      if (ball.vy > 0 && ball.y + BALL.r >= top && ball.y - BALL.r <= top + PADDLE.h && Math.abs(ball.x - s.paddle.x) <= s.paddle.w / 2 + BALL.r) {
        const off = Math.max(-1, Math.min(1, (ball.x - s.paddle.x) / (s.paddle.w / 2)));
        aim(ball, off * 1.05, Math.hypot(ball.vx, ball.vy));
        ball.y = top - BALL.r;
        s.combo = 0;
        events.push({ kind: "paddle", x: ball.x, y: top });
      }
      // Never let it settle into a flat back-and-forth.
      if (Math.abs(ball.vy) < 0.18 * Math.hypot(ball.vx, ball.vy)) ball.vy = (ball.vy < 0 ? -1 : 1) * 0.18 * Math.hypot(ball.vx, ball.vy);
    }
  }

  // Lost balls.
  const before = s.balls.length;
  s.balls = s.balls.filter((b) => b.y < FIELD.height + 0.05);
  if (s.balls.length < before && !s.balls.length) {
    s.lives -= 1;
    s.combo = 0;
    events.push({ kind: "lost", x: s.paddle.x, y: FIELD.height });
    if (s.lives <= 0) {
      s.over = true;
      s.best = Math.max(s.best, s.score);
      events.push({ kind: "over", x: 0.5, y: FIELD.height / 2 });
      return events;
    }
    s.balls = [stuckBall(s)];
    s.wide = 0;
    s.slow = 0;
    s.drops = [];
  }

  // Capsules fall; the paddle catches them.
  for (let i = s.drops.length - 1; i >= 0; i -= 1) {
    const d = s.drops[i];
    d.y += 0.42 * h;
    if (d.y >= PADDLE.y - 0.012 && d.y <= PADDLE.y + PADDLE.h + 0.012 && Math.abs(d.x - s.paddle.x) <= s.paddle.w / 2 + 0.03) {
      s.drops.splice(i, 1);
      power(s, d.kind);
      events.push({ kind: "power", x: d.x, y: d.y, power: d.kind });
    } else if (d.y > FIELD.height + 0.05) s.drops.splice(i, 1);
  }

  // A clear wall: the next level.
  if (!s.bricks.length) {
    s.level += 1;
    s.score += 100 * (s.level - 1);
    s.bricks = bricksFor(s.level, s.seed);
    s.balls = [stuckBall(s)];
    s.drops = [];
    events.push({ kind: "level", x: 0.5, y: FIELD.height / 2 });
  }
  s.best = Math.max(s.best, s.score);
  return events;
}

function power(s: BreakoutState, kind: PowerKind) {
  if (kind === "wide") s.wide = 10;
  else if (kind === "slow") s.slow = 8;
  else {
    // Every free ball splits into three, fanned out.
    const free = s.balls.filter((b) => !b.stuck);
    const from = free.length ? free : s.balls;
    const extra: Ball[] = [];
    for (const b of from.slice(0, 4)) {
      const speed = Math.hypot(b.vx, b.vy) || ballSpeed(s);
      const angle = Math.atan2(b.vx, -b.vy);
      for (const turn of [-0.45, 0.45]) {
        const nb = { ...b, stuck: false };
        aim(nb, angle + turn, speed);
        extra.push(nb);
      }
      if (b.stuck) {
        b.stuck = false;
        aim(b, 0.1, speed);
      }
    }
    s.balls.push(...extra);
  }
}

/** A repeatable roll from the game's seed and a place, so drops are the same in every replay. */
function dropRoll(s: BreakoutState, a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + s.seed * 0.137 + s.score * 0.0131) * 43758.5453;
  return v - Math.floor(v);
}

# Mechanics you carry

A mechanic is how something moves: walking, a car, a plane, or anything you write. Yours travels with
you. Walk or drive through a portal and, if the island allows it, you keep moving there exactly as you
do at home. Someone who likes your mechanic can keep a copy, with your name on it.

## Choosing how you move

Open **Mechanics** in the side panel and pick **Walk**, **Car** or **Plane**, or a mechanic you made or
kept.

| Mechanic | Keys |
| --- | --- |
| Walk | W/S walk, A/D turn (strafe in first person), Space/Shift rise and sink |
| Car | W accelerates, S brakes then reverses, A/D steer (only while rolling) |
| Plane | W/S throttle, Space/Shift pitch up and down, A/D bank. It needs speed to climb |

Your mechanics, and which one you move with, are part of your shared save, so they follow you to your
other linked devices.

## Through a portal

When you go through a portal with a mechanic, Forge asks the island to let you bring it (the **carry**
permission). If the island agrees:

- It checks your mechanic first: who signed it, the code itself, and every test case in it.
- It then runs your mechanic for you, and only for you, until you leave.
- Your device runs the same mechanic at the same time, so nothing jumps or corrects. If you arrive at
  speed, you keep your speed.
- The island's own rules still apply: its speed limit (60 m/s unless the owner sets another), its
  ground, and its walls.
- Others there see your car or plane and who made it.

If the island does not allow it, you move its way while you are there, and the log says why.

## Keeping someone else's mechanic

While you are on an island, **Mechanics** lists the mechanics in use there, under **In use where you
are**. Tap **Keep** and it is checked on your device and added to your list, still credited to its
author. Choose it to move with it.

## Making your own

Tap **Make your own**, write a recipe, and tap **Build and move with it**. A recipe is a name, a look
(`walker`, `car`, `plane` or `hover`), up to seven numbers of your own (`Vars`), and one line per
number:

```text
Name: Bouncy car
Look: car
Vars: hop
speed = clamp(speed + (forward * 10 - speed * 0.4) * dt, -6, 26)
yaw = yaw + steer * speed * 0.12 * dt
hop = hop + dt * 9
x = x + sin(yaw) * speed * dt
z = z + cos(yaw) * speed * dt
y = 0.45 + abs(sin(hop)) * min(abs(speed), 10) * 0.05
```

- **Inputs:** `forward`, `strafe`, `turn`, `steer` (A is +1), `lift` (Space is +1), `dt` (seconds),
  `action`.
- **State:** `x`, `y`, `z`, `yaw` (0 faces +z, increasing turns left), `pitch`, `speed`, `vx`, `vy`,
  `vz`, and your `Vars`.
- **Functions:** `sin`, `cos`, `sqrt`, `abs`, `min`, `max`, `clamp`, `floor`, `ceil`, `sign`,
  `if(condition, then, else)`, plus the constant `pi`.

Lines run in order. Forge compiles the recipe to WebAssembly and signs it with your name.

## Hosting an island

`forge island` allows carrying by default. To refuse it, leave `carry` out of `--allow`.

Mechanics that visitors bring are saved under `.forge/mechanics/`. To make one your island's own
(visitors who carry nothing move with it):

```sh
forge island --name "Sky Island" --slug sky --mechanic .forge/mechanics/plane-XXXXXXXX.json
```

`--max-speed 20` sets the island's speed limit for every mover.

## Why it is safe to run a stranger's mechanic

A mechanic is a small WebAssembly module, and before it ever runs, Forge reads every instruction:

- Only plain arithmetic, memory reads and writes, and forward jumps are allowed.
- No loops and no calls, so it always finishes, and quickly.
- No imports: it cannot reach the network, files or the screen.
- No hidden state: memory is reset before every step and globals are read-only.

It can only turn the numbers it is given into new numbers, and the island then applies its own rules
to the result. Every package also carries test cases with exact answers. A device that computes even
one bit differently refuses the package, and that is also what keeps visitor and host in perfect step.

## Not yet

- Mechanics move only their owner's own avatar. Mechanics that act on an island's world (doors,
  tools, weapons) need a wider permission system and are next.
- Carried looks are the built-in car, plane and hover models. Custom 3D models do not travel yet.
- Islands are hosted with `forge island` (Node). The app visits them; it does not host.

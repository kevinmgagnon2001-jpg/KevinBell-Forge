# Working on Forge with Claude

Read `AGENTS.md`, `NEXT.md` and the last sections of `PATCH_NOTES.md` first.

## What the owner wants from every session

- **This project is a showcase.** Aim for work that shows extraordinary skill: modern, beautiful,
  current-generation graphics and feel, never "pre-Zelda era". When choosing between safe and
  impressive, pick impressive and make it solid.
- **Graphics:** the top quality rung may drop to 30-45 fps for the most demanding look; lower rungs
  stay smooth on phones (auto quality, `src/engine/perf.ts`).
- **UI:** bubbles. Round, glassy, iridescent controls; a dark theme like the 4D bubbles from
  Adventure Time. Controls show icons, not words (keep `aria-label` and `title` for each).
- **Feel:** third person moves camera-relative, never tank turning: the stick puts a point on the
  ground around you and the body chases it, walking to running smoothly by how far the stick is
  dragged (`src/engine/drive.ts`); flight steers by
  looking (climb and dive with the view), like Anthem. Interaction prompts only show up close.

## How to work

- **Work in long, uninterrupted runs, every session (the owner asked for this always; do not ask
  at the start).** Take a request all the way to done in one go: chain as many commands, edits,
  tests and browser checks as it takes (dozens is normal) without stopping to report, ask "should I
  continue?" or narrate the plan. When working through `NEXT.md` or the roadmap, go from item to item
  without asking what's next. No progress updates between steps, even if reminded to give one.
- Report once at the end: short, what changed and what to try. Stop early only for a decision that
  is truly the owner's (secrets, releases, spending, a change of direction) or a blocker that needs
  them. Answer the app's update nudges in one line.
- Interpret casual or voice-typed requests generously and pick the impressive reading; mention the
  reading taken in the final report rather than asking first.
- Checks before every push: `npm run lint`, `npm run typecheck`, `npm run test:engine`, and a real
  browser check (Playwright with `/opt/pw-browsers/chromium`) with no console errors.
- Do not commit `.vercel/output` changes made by a local build.

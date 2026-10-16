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
- **Feel:** third person moves camera-relative with side steps, not tank turning; flight steers by
  looking (climb and dive with the view), like Anthem. Interaction prompts only show up close.

## How to work

- Work quietly: no progress narration between steps. Report once, briefly, when the work is done,
  or when something needs the owner's decision.
- Checks before every push: `npm run lint`, `npm run typecheck`, `npm run test:engine`, and a real
  browser check (Playwright with `/opt/pw-browsers/chromium`) with no console errors.
- Do not commit `.vercel/output` changes made by a local build.

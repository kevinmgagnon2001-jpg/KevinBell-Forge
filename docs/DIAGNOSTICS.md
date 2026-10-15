# Diagnostics: reporting what happened on the phone back to the build session

Forge keeps the last few minutes of what your device did: frame rate, frame time, heat, thermal
headroom, memory, battery, power draw, draw calls and the quality rung (one reading every 5 s, up to
6 minutes), plus the last errors, the gauges in the room and the device's profile.

## Sending a report

- **Stats** → type what's wrong (optional) → **Send to Claude**, or
- type `send diagnostics` (or `report a problem: the boiler steam stutters`) in the intent box.

Forge opens a pre-filled GitHub issue on this repository in your browser, labelled `diagnostics`.
Nothing is sent until you read it and tap **Submit**. The app holds no GitHub token, so a copy of the
APK cannot post anything by itself.

What is in it: the app version, screen size, GPU name, core count, the readings above and error
messages. No serial number, accounts, location or app list. If the repository is public, so is the
issue.

## Reading reports (build sessions, workflows)

- `npm run forge:diagnostics`: every open report, newest first, with what it found (low frame rate,
  near throttling, hot, memory tight, quality stepping down, errors) and min/avg/max readings.
  `-- --json` prints the parsed reports. Uses `GITHUB_TOKEN` / `GH_TOKEN` when set.
- In code: `parseReport(issueBody)` in `src/engine/diagnostics.ts` reads the `forge-diagnostics` JSON
  block from an issue body.

A scheduled check runs every morning (5:53 AM Eastern): it reads new reports, fixes what they show
on a `diagnostics/<date>` branch, opens one pull request ("Fixes #N"), and comments on each report.
For a faster turn, send a report and then tell a session "fix the open diagnostics reports".

The loop: send a report from the phone → a session reads the open reports, fixes what they point
at, pushes, and closes each issue with a link to the fix → the next build reaches the phone through
Forge's updater → send another report to confirm.

# Releases and updates

## Making a release

**The easy way:** merge a pull request into `main` with the label **release**, or with `[release]` in
its title. GitHub then:

1. works out the next version (v0.6.1 becomes v0.6.2);
2. tags it and creates the Release;
3. builds the Android APK (after its emulator test) and the desktop installers, and attaches them.

That takes 20–40 minutes. For a bigger step, use **release:minor** (v0.6.2 becomes v0.7.0) or
**release:major** (v1.0.0), as a label or `[release:minor]` / `[release:major]` in the title.

Merging a pull request without the label (or the title mark) releases nothing. The code is on `main`,
and the next release will include it.

**Release what is on `main` now:** **Actions → Release → Run workflow**, then choose patch, minor or
major.

**By hand, as before:** create a tag like `v0.6.3` (lowercase `v`, three numbers) on `main`, from
**Releases → Draft a new release**. The builds run the same way.

Version numbers come from the existing `v1.2.3` tags. Others (`Forgereleasetag`, `V0.6.1`) are
ignored.

## Updates on your devices

When Forge starts, and every few hours after, the Android and desktop apps check GitHub for a newer
Release. If there is one, a notice says **Forge 0.6.3 is ready**:

- **Download** opens the right file for that device: the APK on Android, the setup `.exe` on
  Windows, the `.dmg` on a Mac, or the `.AppImage` for that machine on Linux.
- **Install it over the old one.** Your world is kept. On Android that needs the permanent signing
  key (docs/ANDROID.md).
- **Later** hides the notice until the next version.
- **Files not attached yet:** if the builds are still running when the notice appears, it opens the
  release page instead.

The web version is always the latest and never shows the notice.

### Why not fully automatic?

- **Android:** apps installed from outside the Play Store can't replace themselves silently, so
  Android always asks you to tap **Install**.
- **Desktop:** silent self-updating is possible with Tauri's updater. It needs an update-signing key
  of your own, added to the repository secrets the same way as the Android key. That is a next step;
  ask for it when you want it.

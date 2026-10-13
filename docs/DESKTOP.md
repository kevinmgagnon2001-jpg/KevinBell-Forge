# Forge on a desktop or laptop

Open **[Releases](../../releases)** and download the file for your machine:

| Machine | File |
| --- | --- |
| Windows PC | `Forge_…_x64-setup.exe` (or the `.msi`) |
| Mac with Apple silicon (M1 and later) | `Forge_…_aarch64.dmg` |
| Linux PC | `Forge_…_amd64.deb` (Debian, Ubuntu) or `Forge_…_amd64.AppImage` (any distribution) |
| Linux on ARM (Raspberry Pi 5, ARM laptops) | `Forge_…_arm64.deb` or `Forge_…_aarch64.AppImage` |

The world, islands, portals and Linux programs work without an internet connection. Only the
local AI model downloads its weights the first time it is used.

## First launch

The installers are not code-signed yet, so the system asks once:

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info → Run anyway**.
- **macOS:** open the `.dmg`, drag Forge to Applications, then right-click Forge → **Open** → **Open**.
  If macOS says the app "is damaged", run `xattr -cr /Applications/Forge.app` in Terminal once.
- **Linux AppImage:** `chmod +x Forge_*.AppImage`, then run it.

## How the installers are made

`.github/workflows/desktop.yml` builds them on GitHub's servers when a `v*` tag is pushed (or by
hand from the Actions tab). The Linux builds, x86-64 and ARM64, are opened on a virtual display
first; the screenshots are kept on the run page, and nothing is attached to the Release unless the
window stays up.

Known gaps: the Windows and macOS builds are not launched in CI (there is no screen to look at),
there are no Intel Mac builds yet, and the model weights are kept in memory only, so they download
again on each launch.

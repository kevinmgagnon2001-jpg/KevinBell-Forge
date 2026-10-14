import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, isReleaseLink, pickDownload, updateFrom, type Asset } from "./updates.ts";

const base = "https://github.com/kevinmgagnon2001-jpg/KevinBell-Forge/releases/download/v0.6.2/";
// The files the v0.6.1 Release really has.
const ASSETS: Asset[] = [
  "Forge-0.6.2-android.apk",
  "Forge_0.6.2_aarch64.AppImage",
  "Forge_0.6.2_aarch64.dmg",
  "Forge_0.6.2_amd64.AppImage",
  "Forge_0.6.2_amd64.deb",
  "Forge_0.6.2_arm64.deb",
  "Forge_0.6.2_x64-setup.exe",
  "Forge_0.6.2_x64_en-US.msi",
].map((name) => ({ name, browser_download_url: base + name }));

test("versions compare as numbers", () => {
  assert.equal(compareVersions("v0.6.2", "0.6.1"), 1);
  assert.equal(compareVersions("0.6.10", "0.6.9"), 1);
  assert.equal(compareVersions("0.7.0", "0.6.99"), 1);
  assert.equal(compareVersions("v0.6.1", "0.6.1"), 0);
  assert.equal(compareVersions("0.6.0", "0.6.1"), -1);
});

test("each device gets its own download", () => {
  const pick = (os: string, arch: string) => pickDownload(ASSETS, { os, arch })?.split("/").pop();
  assert.equal(pick("android", "aarch64"), "Forge-0.6.2-android.apk");
  assert.equal(pick("windows", "x86_64"), "Forge_0.6.2_x64-setup.exe");
  assert.equal(pick("macos", "aarch64"), "Forge_0.6.2_aarch64.dmg");
  assert.equal(pick("linux", "x86_64"), "Forge_0.6.2_amd64.AppImage");
  assert.equal(pick("linux", "aarch64"), "Forge_0.6.2_aarch64.AppImage");
  assert.equal(pick("ios", "aarch64"), undefined);
  // Builds still running: no file yet.
  assert.equal(pickDownload([], { os: "android", arch: "aarch64" }), null);
});

test("a newer release becomes an update; the same or older, or a stray tag, does not", () => {
  const release = { tag_name: "v0.6.2", html_url: "https://github.com/kevinmgagnon2001-jpg/KevinBell-Forge/releases/tag/v0.6.2", body: "notes", assets: ASSETS };
  const u = updateFrom(release, "0.6.1", { os: "android", arch: "aarch64" });
  assert.equal(u?.version, "0.6.2");
  assert.equal(u?.download, base + "Forge-0.6.2-android.apk");
  assert.equal(updateFrom(release, "0.6.2", { os: "android", arch: "aarch64" }), null);
  assert.equal(updateFrom(release, "0.7.0", { os: "android", arch: "aarch64" }), null);
  assert.equal(updateFrom({ ...release, tag_name: "Forgereleasetag" }, "0.0.1", { os: "android", arch: "aarch64" }), null);
  // Links elsewhere are never offered.
  const evil = updateFrom({ ...release, html_url: "https://evil.example/", assets: [{ name: "Forge-9-android.apk", browser_download_url: "https://evil.example/x.apk" }] }, "0.6.1", { os: "android", arch: "aarch64" });
  assert.equal(evil?.download, null);
  assert.ok(evil?.page.startsWith("https://github.com/kevinmgagnon2001-jpg/KevinBell-Forge/releases/"));
  assert.equal(isReleaseLink("https://github.com/kevinmgagnon2001-jpg/KevinBell-Forge/releases/x\" & calc"), false);
});

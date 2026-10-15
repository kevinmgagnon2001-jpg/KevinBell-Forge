// Adjust the AndroidManifest.xml that `tauri android init` generates (src-tauri/gen is never
// committed; .github/workflows/android.yml runs this after init):
//
//   <queries> for launcher apps   Android 11+ hides other apps unless the manifest says which ones it
//                                 needs to see. Forge lists the apps that have a launcher icon, for
//                                 the screen in its world (MainActivity.kt, ForgeApps).
//   HomeActivity                  The home screen entry (MainActivity.kt). It shows nothing: it brings
//                                 the one running Forge to the front and closes. Disabled until the
//                                 person turns it on in Forge, so installing Forge never changes their
//                                 phone. (An alias of MainActivity used to be the home screen, but
//                                 Android starts home screens in a task of their own, so pressing Home
//                                 made a second MainActivity, and Tauri draws its world in only one:
//                                 the second was a black screen.)
//   launchMode singleTask         Only ever one MainActivity, which HomeActivity brings back.
//   configChanges                 Turning the phone does not restart Forge (screen rotation, rotation.ts).
//   install permissions           Forge can install its own updates (MainActivity.kt, update section):
//                                 REQUEST_INSTALL_PACKAGES, which the person still has to allow once
//                                 ("Install unknown apps"), and UPDATE_PACKAGES_WITHOUT_USER_ACTION, so
//                                 on Android 12+ later updates need no tap once Forge installed one.
//
//   node scripts/android-manifest.mjs path/to/AndroidManifest.xml
import { readFileSync, writeFileSync } from "node:fs";

/** @param {string} xml @returns {string} */
export function patchManifest(xml) {
  let out = xml;
  if (!/<queries>[\s\S]*LAUNCHER[\s\S]*<\/queries>/.test(out)) {
    const queries = `    <queries>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent>
    </queries>
`;
    const at = out.indexOf("<application");
    if (at < 0) throw new Error("no <application> in the manifest");
    const lineStart = out.lastIndexOf("\n", at) + 1;
    out = out.slice(0, lineStart) + queries + out.slice(lineStart);
  }

  for (const permission of ["android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION"]) {
    if (out.includes(`"${permission}"`)) continue;
    const at = out.indexOf("<application");
    const lineStart = out.lastIndexOf("\n", at) + 1;
    out = out.slice(0, lineStart) + `    <uses-permission android:name="${permission}" />\n` + out.slice(lineStart);
  }

  const main = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/.exec(out);
  if (!main) throw new Error("no .MainActivity in the manifest");
  let tag = main[0];
  if (/android:launchMode="[^"]*"/.test(tag)) tag = tag.replace(/android:launchMode="[^"]*"/, 'android:launchMode="singleTask"');
  else tag = tag.replace(/<activity\b/, '<activity android:launchMode="singleTask"');
  // Turning the phone must not restart Forge (the world and the model would reload): it handles a
  // rotation itself (rotation.ts, MainActivity.setOrientation).
  const handled = ["orientation", "screenSize", "screenLayout", "smallestScreenSize"];
  const changes = /android:configChanges="([^"]*)"/.exec(tag);
  if (changes) {
    const have = new Set(changes[1].split("|").filter(Boolean));
    handled.forEach((c) => have.add(c));
    tag = tag.replace(changes[0], `android:configChanges="${[...have].join("|")}"`);
  } else {
    tag = tag.replace(/<activity\b/, `<activity android:configChanges="${handled.join("|")}"`);
  }
  out = out.slice(0, main.index) + tag + out.slice(main.index + main[0].length);

  if (!out.includes(".HomeActivity")) {
    const home = `        <activity
            android:name=".HomeActivity"
            android:label="Forge"
            android:enabled="false"
            android:exported="true"
            android:launchMode="singleTask"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.HOME" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </activity>
`;
    const end = out.lastIndexOf("</application>");
    if (end < 0) throw new Error("no </application> in the manifest");
    const lineStart = out.lastIndexOf("\n", end) + 1;
    out = out.slice(0, lineStart) + home + out.slice(lineStart);
  }
  return out;
}

if (process.argv[1]?.endsWith("android-manifest.mjs")) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/android-manifest.mjs path/to/AndroidManifest.xml");
    process.exit(2);
  }
  writeFileSync(file, patchManifest(readFileSync(file, "utf8")));
  console.log(`patched ${file}`);
}

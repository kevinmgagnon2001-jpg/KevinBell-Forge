// Adjust the AndroidManifest.xml that `tauri android init` generates (src-tauri/gen is never
// committed; .github/workflows/android.yml runs this after init):
//
//   <queries> for launcher apps   Android 11+ hides other apps unless the manifest says which ones it
//                                 needs to see. Forge lists the apps that have a launcher icon, for
//                                 the screen in its world (MainActivity.kt, ForgeApps).
//   HomeAlias                     An alias of MainActivity that can be the home screen. Disabled until
//                                 the person turns it on in Forge, so installing Forge never changes
//                                 their phone.
//   launchMode singleTask         Pressing Home (with Forge as the home screen) brings back the running
//                                 Forge instead of starting a second one.
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

  const main = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/.exec(out);
  if (!main) throw new Error("no .MainActivity in the manifest");
  let tag = main[0];
  if (/android:launchMode="[^"]*"/.test(tag)) tag = tag.replace(/android:launchMode="[^"]*"/, 'android:launchMode="singleTask"');
  else tag = tag.replace(/<activity\b/, '<activity android:launchMode="singleTask"');
  out = out.slice(0, main.index) + tag + out.slice(main.index + main[0].length);

  if (!out.includes(".HomeAlias")) {
    const alias = `        <activity-alias
            android:name=".HomeAlias"
            android:targetActivity=".MainActivity"
            android:label="Forge"
            android:enabled="false"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.HOME" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </activity-alias>
`;
    const end = out.lastIndexOf("</application>");
    if (end < 0) throw new Error("no </application> in the manifest");
    const lineStart = out.lastIndexOf("\n", end) + 1;
    out = out.slice(0, lineStart) + alias + out.slice(lineStart);
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

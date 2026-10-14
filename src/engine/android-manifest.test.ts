import assert from "node:assert/strict";
import test from "node:test";
import { patchManifest } from "../../scripts/android-manifest.mjs";

// The shape `tauri android init` generates (Tauri 2).
const GENERATED = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />

    <!-- AndroidTV support -->
    <uses-feature android:name="android.software.leanback" android:required="false" />

    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.forge"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:launchMode="singleTask"
            android:label="@string/main_activity_title"
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <!-- AndroidTV support -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
          android:name="androidx.core.content.FileProvider"
          android:authorities="\${applicationId}.fileprovider"
          android:exported="false"
          android:grantUriPermissions="true">
          <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
`;

test("the Android manifest gains launcher queries and a home-screen entry that starts disabled", () => {
  const out = patchManifest(GENERATED);
  assert.match(out, /<queries>\s*<intent>\s*<action android:name="android.intent.action.MAIN" \/>\s*<category android:name="android.intent.category.LAUNCHER" \/>/);
  assert.ok(out.indexOf("<queries>") < out.indexOf("<application"), "queries sit outside <application>");
  const home = /<activity\s+android:name="\.HomeActivity"[\s\S]*?<\/activity>/.exec(out)?.[0] ?? "";
  assert.match(home, /android:enabled="false"/);
  assert.match(home, /category.HOME/);
  assert.match(home, /Theme.Translucent/);
  assert.ok(out.indexOf(".HomeActivity") < out.indexOf("</application>"));
  // The home screen is its own small activity, never MainActivity: Android starts home screens in a
  // task of their own, and a second MainActivity there is a black screen (Tauri draws in only one).
  assert.doesNotMatch(out, /activity-alias/);
  const main = /<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/.exec(out)?.[0] ?? "";
  assert.doesNotMatch(main, /category.HOME/);
  assert.match(main, /launchMode="singleTask"/);
  // Forge may install its own updates (the person still allows it once in Android's settings).
  assert.match(out, /<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" \/>/);
  assert.match(out, /<uses-permission android:name="android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION" \/>/);
  assert.ok(out.indexOf("REQUEST_INSTALL_PACKAGES") < out.indexOf("<application"));
  // Running it twice changes nothing more.
  assert.equal(patchManifest(out), out);
  // A MainActivity without a launch mode gets one.
  const plain = patchManifest(GENERATED.replace('android:launchMode="singleTask"\n            ', ""));
  assert.match(plain, /<activity android:launchMode="singleTask"[\s\S]*?android:name="\.MainActivity"/);
});

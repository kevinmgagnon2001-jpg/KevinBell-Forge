// Forge's Android activity. `tauri android init` generates src-tauri/gen/android (never committed);
// .github/workflows/android.yml copies this file over the generated MainActivity.kt.
//
// Tauri draws the page edge to edge, under the status bar, the gesture bar and the keyboard. The
// WebView does not reliably report those areas to CSS (env(safe-area-inset-*) is 0 on many
// versions), so the page's header sat under the clock and the text box under the gesture bar.
// Here the content is padded by the system bars, the display cutout and the keyboard instead, and
// the bars are drawn over Forge's own background colour with light icons.
//
// It also gives the page `window.ForgeAndroid` (ForgeApps below): the apps on this phone, for the
// screen in Forge's world (src/engine/device-apps.ts). Opening one starts it and Forge steps back;
// open Forge again (or press Home, if Forge is the home screen) to carry on where you were.
package dev.forge.app

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity : TauriActivity() {
  // Added before the page loads, so the page sees it from the start.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(ForgeApps(this), "ForgeAndroid")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    window.decorView.setBackgroundColor(Color.parseColor("#09090b"))
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      val bars = insets.getInsets(types)
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}

/**
 * What the page may ask of the phone, and nothing more: list the apps that have a launcher icon,
 * open one of them, and (only when the person asks) offer Forge as the home screen.
 */
class ForgeApps(private val activity: Activity) {
  private val pm: PackageManager get() = activity.packageManager
  private val homeAlias get() = ComponentName(activity.packageName, "${activity.packageName}.HomeAlias")
  private val launcherIntent get() = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)

  private fun launchable() = pm.queryIntentActivities(launcherIntent, 0)
    .filter { it.activityInfo.packageName != activity.packageName }
    .distinctBy { it.activityInfo.packageName }

  /** How many apps there are (cheap: no labels or icons). Logged, so the emulator test can see the page reached here. */
  @JavascriptInterface
  fun countApps(): Int {
    val count = launchable().size
    Log.i("ForgeApps", "apps on this device: $count")
    return count
  }

  /** JSON: [{ id, name, icon }], icon a small PNG data URL. */
  @JavascriptInterface
  fun listApps(): String {
    val out = JSONArray()
    for (info in launchable()) {
      val item = JSONObject()
      item.put("id", info.activityInfo.packageName)
      item.put("name", info.loadLabel(pm).toString())
      item.put("icon", iconData(info.loadIcon(pm)))
      out.put(item)
    }
    return out.toString()
  }

  /** Open an app by package name. Only apps with a launcher entry can be opened. */
  @JavascriptInterface
  fun openApp(id: String): Boolean {
    val intent = pm.getLaunchIntentForPackage(id) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    activity.runOnUiThread { activity.startActivity(intent) }
    return true
  }

  /** "off" (not offered), "offered" (Forge is listed as a home screen) or "home" (it is the home screen). */
  @JavascriptInterface
  fun homeState(): String {
    val home = pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
    if (home?.activityInfo?.packageName == activity.packageName) return "home"
    return if (pm.getComponentEnabledSetting(homeAlias) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) "offered" else "off"
  }

  /**
   * Offer Forge as a home screen (or stop offering it). Android lets only the person choose the
   * home screen, so this opens the system's own setting for that.
   */
  @JavascriptInterface
  fun setHome(on: Boolean) {
    val state = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    pm.setComponentEnabledSetting(homeAlias, state, PackageManager.DONT_KILL_APP)
    activity.runOnUiThread {
      try {
        activity.startActivity(Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }

  private fun iconData(drawable: Drawable): String {
    return try {
      val size = 96
      val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      drawable.setBounds(0, 0, size, size)
      drawable.draw(Canvas(bitmap))
      val bytes = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
      "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
      ""
    }
  }
}

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
//
// HomeActivity (below) is what Android starts as the home screen. It never draws anything.
//
// ForgeApps also lets Forge update itself (the update section): with the person's permission it
// downloads a newer Release, checks it is Forge signed with the same key, and hands it to Android's
// package installer. Android asks the first time; from then on (Android 12+) updates need no tap.
package dev.forge.app

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : TauriActivity() {
  // Added before the page loads, so the page sees it from the start.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(ForgeApps(this, webView), "ForgeAndroid")
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
 * Forge as the phone's home screen. Android starts the home screen in a task of its own, so if this
 * were MainActivity (an alias of it, as before), pressing Home would make a second MainActivity next
 * to the one already running. Tauri draws its world in only one of them: the other was a black
 * screen. Instead this opens Forge exactly as its icon does, which brings back the running Forge
 * (or starts it after a reboot), and closes. scripts/android-manifest.mjs declares it, disabled
 * until the person turns it on in Forge.
 */
class HomeActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    openForge()
  }

  @Suppress("DEPRECATION")
  private fun openForge() {
    val forge = Intent(this, MainActivity::class.java)
      .setAction(Intent.ACTION_MAIN)
      .addCategory(Intent.CATEGORY_LAUNCHER)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    startActivity(forge)
    finish()
    overridePendingTransition(0, 0)
  }
}

/**
 * What the page may ask of the phone, and nothing more: list the apps that have a launcher icon,
 * open one of them, and (only when the person asks) offer Forge as the home screen.
 */
class ForgeApps(private val activity: Activity, private val webView: WebView) {
  private val pm: PackageManager get() = activity.packageManager
  private val homeEntry get() = ComponentName(activity, HomeActivity::class.java)
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

  /** Open a page of Forge's own releases (a newer version to install) in the browser. Nothing else. */
  @JavascriptInterface
  fun openReleaseLink(url: String): Boolean {
    val allowed = "https://github.com/kevinmgagnon2001-jpg/KevinBell-Forge/releases/"
    if (!url.startsWith(allowed) || url.length > 300 || !url.all { it.isLetterOrDigit() || "/:._-+%~".contains(it) }) return false
    activity.runOnUiThread {
      activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    return true
  }

  /** "off" (not offered), "offered" (Forge is listed as a home screen) or "home" (it is the home screen). */
  @JavascriptInterface
  fun homeState(): String {
    val home = pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
    if (home?.activityInfo?.packageName == activity.packageName) return "home"
    return if (pm.getComponentEnabledSetting(homeEntry) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) "offered" else "off"
  }

  /**
   * Offer Forge as a home screen (or stop offering it). Android lets only the person choose the
   * home screen, so this opens the system's own setting for that.
   */
  @JavascriptInterface
  fun setHome(on: Boolean) {
    val state = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    pm.setComponentEnabledSetting(homeEntry, state, PackageManager.DONT_KILL_APP)
    activity.runOnUiThread {
      try {
        activity.startActivity(Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }

  // ---------- updating Forge itself ----------

  private val releases = "https://github.com/kevinmgagnon2001-jpg/KevinBell-Forge/releases/download/"
  private val downloaded get() = File(activity.cacheDir, "forge-update.apk")
  @Volatile private var busy = false

  /** Tell the page how an update is going: window.__forgeUpdate({ stage, percent?, message? }). */
  private fun report(stage: String, percent: Int = -1, message: String = "") {
    val json = JSONObject().put("stage", stage)
    if (percent >= 0) json.put("percent", percent)
    if (message.isNotEmpty()) json.put("message", message)
    webView.post { webView.evaluateJavascript("window.__forgeUpdate && window.__forgeUpdate($json)", null) }
  }

  /** Who installed this copy of Forge (a browser, a file manager, or Forge itself after an update). */
  @Suppress("DEPRECATION")
  private fun installer(): String? = try {
    if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(activity.packageName).installingPackageName
    else pm.getInstallerPackageName(activity.packageName)
  } catch (e: Exception) {
    null
  }

  /**
   * JSON { allowed, silent, ready }: may Forge install updates (the person allowed "Install unknown
   * apps" for it), will Android install them without a tap (12+, once Forge installed one itself),
   * and the version of a downloaded update waiting to be installed ("" if none).
   */
  @Suppress("DEPRECATION")
  @JavascriptInterface
  fun updateState(): String {
    val allowed = if (Build.VERSION.SDK_INT >= 26) pm.canRequestPackageInstalls() else true
    val silent = allowed && Build.VERSION.SDK_INT >= 31 && installer() == activity.packageName
    val ready = if (downloaded.exists()) pm.getPackageArchiveInfo(downloaded.path, 0)?.versionName ?: "" else ""
    return JSONObject().put("allowed", allowed).put("silent", silent).put("ready", ready).toString()
  }

  /** Open Android's own "Install unknown apps" switch for Forge. Only the person can turn it on. */
  @JavascriptInterface
  fun allowUpdates() {
    activity.runOnUiThread {
      try {
        val intent = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")) else Intent(Settings.ACTION_SECURITY_SETTINGS)
        activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
  }

  /** Download a Forge APK from Forge's own Releases, in the background. Reports "downloading", then "ready" or "failed". */
  @JavascriptInterface
  fun downloadUpdate(url: String): Boolean {
    if (!url.startsWith(releases) || !url.endsWith(".apk") || url.length > 300 || !url.all { it.isLetterOrDigit() || "/:._-+%~".contains(it) }) return false
    if (busy) return false
    busy = true
    Thread {
      val part = File(activity.cacheDir, "forge-update.part")
      try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.setRequestProperty("User-Agent", "Forge-Android")
        if (conn.responseCode != 200) throw Exception("the download answered ${conn.responseCode}")
        val total = conn.contentLengthLong
        if (total > 400L * 1024 * 1024) throw Exception("the download is too large")
        var done = 0L
        var shown = -1
        conn.inputStream.use { input ->
          part.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buffer)
              if (n < 0) break
              output.write(buffer, 0, n)
              done += n
              if (done > 400L * 1024 * 1024) throw Exception("the download is too large")
              val percent = if (total > 0) (done * 100 / total).toInt() else -1
              if (percent >= 0 && percent / 5 != shown / 5) {
                shown = percent
                report("downloading", percent)
              }
            }
          }
        }
        val why = checkApk(part)
        if (why != null) throw Exception(why)
        part.renameTo(downloaded)
        report("ready")
      } catch (e: Exception) {
        part.delete()
        report("failed", message = e.message ?: "the download failed")
      } finally {
        busy = false
      }
    }.start()
    return true
  }

  @Suppress("DEPRECATION")
  private fun signers(info: PackageInfo?): Set<String> {
    if (Build.VERSION.SDK_INT < 28) return emptySet()
    val signing = info?.signingInfo ?: return emptySet()
    return signing.apkContentsSigners.map { it.toCharsString() }.toSet()
  }

  @Suppress("DEPRECATION")
  private fun versionOf(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

  /** Is this file Forge, newer than this copy, and signed with the same key? null when it is, else why not. */
  @Suppress("DEPRECATION")
  private fun checkApk(file: File): String? {
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0
    val apk = pm.getPackageArchiveInfo(file.path, flags) ?: return "the download is not an Android app"
    if (apk.packageName != activity.packageName) return "the download is not Forge"
    val mine = pm.getPackageInfo(activity.packageName, flags)
    if (versionOf(apk) <= versionOf(mine)) return "the download is not newer than this Forge"
    if (Build.VERSION.SDK_INT >= 28 && signers(apk) != signers(mine)) {
      return "the new Forge is signed with a different key, so Android will not install it over this one. Uninstall this Forge first, then install the new one from the release page."
    }
    return null
  }

  /**
   * Install the downloaded update. Android closes Forge to replace it; open Forge again and you are
   * where you were. The first time Android asks; after that (Android 12+) it does not.
   */
  @JavascriptInterface
  fun installUpdate(): Boolean {
    val file = downloaded
    if (!file.exists() || busy) return false
    busy = true
    Thread {
      try {
        val installer = pm.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(activity.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
          file.inputStream().use { input ->
            session.openWrite("forge.apk", 0, file.length()).use { output ->
              input.copyTo(output)
              session.fsync(output)
            }
          }
          listen()
          val intent = Intent(INSTALL_DONE).setPackage(activity.packageName)
          val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
          val pending = PendingIntent.getBroadcast(activity, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
          report("installing")
          session.commit(pending.intentSender)
        }
      } catch (e: Exception) {
        report("failed", message = e.message ?: "Android would not install it")
      } finally {
        busy = false
      }
    }.start()
    return true
  }

  private var listening = false

  /** Android's answer to an install: it needs a tap, it is done, or it failed. */
  private fun listen() {
    if (listening) return
    listening = true
    val receiver = object : BroadcastReceiver() {
      @Suppress("DEPRECATION")
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
          PackageInstaller.STATUS_PENDING_USER_ACTION -> {
            val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)
            if (confirm != null) activity.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            report("confirm")
          }
          PackageInstaller.STATUS_SUCCESS -> {
            downloaded.delete()
            report("done")
          }
          else -> report("failed", message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Android did not install it")
        }
      }
    }
    ContextCompat.registerReceiver(activity.applicationContext, receiver, IntentFilter(INSTALL_DONE), ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  private companion object {
    const val INSTALL_DONE = "dev.forge.app.INSTALL_DONE"
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

// Forge's Android activity. `tauri android init` generates src-tauri/gen/android (never committed);
// .github/workflows/android.yml copies this file over the generated MainActivity.kt.
//
// Tauri draws the page edge to edge, under the status bar, the gesture bar and the keyboard. The
// WebView does not reliably report those areas to CSS (env(safe-area-inset-*) is 0 on many
// versions), so the page's header sat under the clock and the text box under the gesture bar.
// Here the content is padded by the system bars, the display cutout and the keyboard instead, and
// the bars are drawn over Forge's own background colour with light icons.
package dev.forge.app

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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

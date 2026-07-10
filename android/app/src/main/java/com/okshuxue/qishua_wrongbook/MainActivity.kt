package com.okshuxue.qishua_wrongbook
import expo.modules.splashscreen.SplashScreenManager

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

import java.io.File
import java.io.FileOutputStream
import java.util.Locale

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    normalizeShareIntent(intent)?.let { normalizedIntent ->
      setIntent(normalizedIntent)
    }

    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    val normalizedIntent = normalizeShareIntent(intent) ?: intent
    super.onNewIntent(normalizedIntent)
    setIntent(normalizedIntent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }

  private fun normalizeShareIntent(sourceIntent: Intent?): Intent? {
    if (sourceIntent?.action != Intent.ACTION_SEND) {
      return null
    }

    val deepLinkUri = buildShareDeepLinkUri(sourceIntent)
    return Intent(Intent.ACTION_VIEW, deepLinkUri).apply {
      addCategory(Intent.CATEGORY_DEFAULT)
      addCategory(Intent.CATEGORY_BROWSABLE)
      setPackage(packageName)
    }
  }

  private fun buildShareDeepLinkUri(sourceIntent: Intent): Uri {
    val nonce = System.currentTimeMillis().toString()
    val builder = Uri.parse(SHARED_IMAGE_DEEP_LINK).buildUpon()
      .appendQueryParameter("sharedImageNonce", nonce)

    val intentType = sourceIntent.type.orEmpty()
    if (!intentType.lowercase(Locale.US).startsWith("image/")) {
      return builder
        .appendQueryParameter("sharedImageError", "unsupported_share_type")
        .build()
    }

    val sharedUri = getSharedImageUri(sourceIntent)
      ?: return builder
        .appendQueryParameter("sharedImageError", "missing_image")
        .build()

    val mimeType = contentResolver.getType(sharedUri) ?: intentType
    val cachedUri = copySharedImageToCache(sharedUri, mimeType)
      ?: return builder
        .appendQueryParameter("sharedImageError", "image_read_failed")
        .build()

    return builder
      .appendQueryParameter("sharedImageUri", cachedUri.toString())
      .appendQueryParameter("sharedImageMimeType", mimeType)
      .build()
  }

  private fun getSharedImageUri(sourceIntent: Intent): Uri? {
    val extraStreamUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      sourceIntent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      sourceIntent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
    }

    if (extraStreamUri != null) {
      return extraStreamUri
    }

    val clipData = sourceIntent.clipData
    if (clipData != null && clipData.itemCount > 0) {
      clipData.getItemAt(0)?.uri?.let { return it }
    }

    return sourceIntent.data
  }

  private fun copySharedImageToCache(sourceUri: Uri, mimeType: String): Uri? {
    return try {
      val sharedImageDir = File(cacheDir, SHARED_IMAGE_CACHE_DIR)
      if (!sharedImageDir.exists() && !sharedImageDir.mkdirs()) {
        return null
      }

      val targetFile = File(
        sharedImageDir,
        "shared_${System.currentTimeMillis()}_${kotlin.math.abs(sourceUri.hashCode())}.${guessImageExtension(mimeType, sourceUri)}",
      )

      contentResolver.openInputStream(sourceUri)?.use { input ->
        FileOutputStream(targetFile).use { output ->
          input.copyTo(output)
        }
      } ?: return null

      Uri.fromFile(targetFile)
    } catch (_: Exception) {
      null
    }
  }

  private fun guessImageExtension(mimeType: String, sourceUri: Uri): String {
    val normalizedMimeType = mimeType.lowercase(Locale.US)
    return when {
      normalizedMimeType.contains("png") -> "png"
      normalizedMimeType.contains("webp") -> "webp"
      normalizedMimeType.contains("gif") -> "gif"
      normalizedMimeType.contains("bmp") -> "bmp"
      normalizedMimeType.contains("heic") -> "heic"
      normalizedMimeType.contains("heif") -> "heif"
      else -> {
        val extension = sourceUri.lastPathSegment
          ?.substringAfterLast('.', missingDelimiterValue = "")
          ?.lowercase(Locale.US)
          .orEmpty()
        if (extension in SUPPORTED_IMAGE_EXTENSIONS) {
          extension
        } else {
          "jpg"
        }
      }
    }
  }

  companion object {
    private const val SHARED_IMAGE_DEEP_LINK = "qishuawrongbook://add"
    private const val SHARED_IMAGE_CACHE_DIR = "shared_images"
    private val SUPPORTED_IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif")
  }
}

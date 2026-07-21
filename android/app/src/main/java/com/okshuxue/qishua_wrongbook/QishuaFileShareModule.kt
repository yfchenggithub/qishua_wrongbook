package com.okshuxue.qishua_wrongbook

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class QishuaFileShareModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun shareFile(
    fileUri: String,
    mimeType: String,
    dialogTitle: String,
    promise: Promise,
  ) {
    try {
      val sourceUri = Uri.parse(fileUri)
      if (sourceUri.scheme != "file") {
        promise.reject(ERROR_INVALID_URI, "Only local file URIs can be shared.")
        return
      }

      val sourcePath = sourceUri.path
      if (sourcePath.isNullOrBlank()) {
        promise.reject(ERROR_INVALID_URI, "The shared file URI has no path.")
        return
      }

      val sourceFile = File(sourcePath)
      if (!sourceFile.isFile) {
        promise.reject(ERROR_FILE_MISSING, "The shared file does not exist.")
        return
      }

      val contentUri = FileProvider.getUriForFile(
        reactContext,
        "${reactContext.packageName}.SharingFileProvider",
        sourceFile,
      )
      val readPermissionFlag = Intent.FLAG_GRANT_READ_URI_PERMISSION
      val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType.ifBlank { "*/*" }
        putExtra(Intent.EXTRA_STREAM, contentUri)
        clipData = ClipData.newRawUri(sourceFile.name, contentUri)
        addFlags(readPermissionFlag)
      }

      reactContext.packageManager
        .queryIntentActivities(sendIntent, PackageManager.MATCH_DEFAULT_ONLY)
        .forEach { resolveInfo ->
          reactContext.grantUriPermission(
            resolveInfo.activityInfo.packageName,
            contentUri,
            readPermissionFlag,
          )
        }

      val chooserIntent = Intent.createChooser(sendIntent, dialogTitle)
      val activity = reactContext.currentActivity
      if (activity != null) {
        activity.runOnUiThread {
          try {
            activity.startActivity(chooserIntent)
            promise.resolve(null)
          } catch (error: Exception) {
            promise.reject(ERROR_SHARE_FAILED, "Unable to open the Android share sheet.", error)
          }
        }
        return
      }

      chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactContext.startActivity(chooserIntent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(ERROR_SHARE_FAILED, "Unable to share the file.", error)
    }
  }

  companion object {
    private const val MODULE_NAME = "QishuaFileShareModule"
    private const val ERROR_INVALID_URI = "ERR_QISHUA_SHARE_INVALID_URI"
    private const val ERROR_FILE_MISSING = "ERR_QISHUA_SHARE_FILE_MISSING"
    private const val ERROR_SHARE_FAILED = "ERR_QISHUA_SHARE_FAILED"
  }
}

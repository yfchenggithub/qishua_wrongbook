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
import com.facebook.react.bridge.ReadableArray
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
    shareLocalFiles(listOf(fileUri), mimeType, dialogTitle, promise)
  }

  @ReactMethod
  fun shareFiles(
    fileUris: ReadableArray,
    mimeType: String,
    dialogTitle: String,
    promise: Promise,
  ) {
    val uriList = mutableListOf<String>()
    for (index in 0 until fileUris.size()) {
      val fileUri = fileUris.getString(index)
      if (!fileUri.isNullOrBlank()) {
        uriList.add(fileUri)
      }
    }
    shareLocalFiles(uriList, mimeType, dialogTitle, promise)
  }

  private fun shareLocalFiles(
    fileUris: List<String>,
    mimeType: String,
    dialogTitle: String,
    promise: Promise,
  ) {
    try {
      if (fileUris.isEmpty()) {
        promise.reject(ERROR_INVALID_URI, "At least one local file URI is required.")
        return
      }

      val sourceFiles = fileUris.map { fileUri -> resolveLocalFile(fileUri) }
      val contentUris = ArrayList<Uri>(sourceFiles.size)
      sourceFiles.forEach { sourceFile ->
        contentUris.add(
          FileProvider.getUriForFile(
            reactContext,
            "${reactContext.packageName}.SharingFileProvider",
            sourceFile,
          ),
        )
      }
      val readPermissionFlag = Intent.FLAG_GRANT_READ_URI_PERMISSION
      val sendIntent = Intent(
        if (contentUris.size > 1) Intent.ACTION_SEND_MULTIPLE else Intent.ACTION_SEND,
      ).apply {
        type = mimeType.ifBlank { "*/*" }
        if (contentUris.size > 1) {
          putParcelableArrayListExtra(Intent.EXTRA_STREAM, contentUris)
        } else {
          putExtra(Intent.EXTRA_STREAM, contentUris.first())
        }
        clipData = ClipData.newRawUri(sourceFiles.first().name, contentUris.first()).apply {
          for (index in 1 until contentUris.size) {
            addItem(ClipData.Item(contentUris[index]))
          }
        }
        addFlags(readPermissionFlag)
      }

      val shareTargets = reactContext.packageManager.queryIntentActivities(
        sendIntent,
        PackageManager.MATCH_DEFAULT_ONLY,
      )
      if (shareTargets.isEmpty()) {
        throw IllegalStateException("No application can handle this share request.")
      }
      if (
        contentUris.size > 1
        && shareTargets.none { resolveInfo -> resolveInfo.activityInfo.packageName == WECHAT_PACKAGE_NAME }
      ) {
        throw IllegalStateException("WeChat cannot receive multiple PDF attachments on this device.")
      }
      shareTargets.forEach { resolveInfo ->
        contentUris.forEach { contentUri ->
          reactContext.grantUriPermission(
            resolveInfo.activityInfo.packageName,
            contentUri,
            readPermissionFlag,
          )
        }
      }

      val chooserIntent = Intent.createChooser(sendIntent, dialogTitle)
      val activity = reactContext.currentActivity
      if (activity != null) {
        activity.startActivity(chooserIntent)
      } else {
        chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(chooserIntent)
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(ERROR_SHARE_FAILED, "Unable to share the file.", error)
    }
  }

  private fun resolveLocalFile(fileUri: String): File {
    val sourceUri = Uri.parse(fileUri)
    if (sourceUri.scheme != "file") {
      throw IllegalArgumentException("Only local file URIs can be shared.")
    }

    val sourcePath = sourceUri.path
    if (sourcePath.isNullOrBlank()) {
      throw IllegalArgumentException("The shared file URI has no path.")
    }

    val sourceFile = File(sourcePath)
    if (!sourceFile.isFile) {
      throw IllegalArgumentException("The shared file does not exist.")
    }
    return sourceFile
  }

  companion object {
    private const val MODULE_NAME = "QishuaFileShareModule"
    private const val WECHAT_PACKAGE_NAME = "com.tencent.mm"
    private const val ERROR_INVALID_URI = "ERR_QISHUA_SHARE_INVALID_URI"
    private const val ERROR_SHARE_FAILED = "ERR_QISHUA_SHARE_FAILED"
  }
}

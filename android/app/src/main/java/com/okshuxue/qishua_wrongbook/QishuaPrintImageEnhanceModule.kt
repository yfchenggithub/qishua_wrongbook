package com.okshuxue.qishua_wrongbook

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.net.Uri
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.Size
import org.opencv.imgproc.CLAHE
import org.opencv.imgproc.Imgproc
import org.opencv.photo.Photo
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.roundToInt

class QishuaPrintImageEnhanceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private enum class EnhanceMode {
    CLEAR_PRINT,
    BW_SCAN,
  }

  private data class EnhanceRequest(
    val sourceUri: String,
    val outputUri: String,
    val mode: EnhanceMode,
    val maxLongEdgePx: Int,
    val jpegQualityPercent: Int,
  )

  @Volatile
  private var openCvReady = false

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun enhanceForPdfPrint(request: ReadableMap, promise: Promise) {
    runEnhanceTask(
      request = request,
      promise = promise,
      engineName = "opencv",
      enhance = { sourceBitmap, mode -> enhanceWithOpenCv(sourceBitmap, mode) },
    )
  }

  @ReactMethod
  fun enhanceForPdfPrintBitmap(request: ReadableMap, promise: Promise) {
    runEnhanceTask(
      request = request,
      promise = promise,
      engineName = "bitmap_fallback",
      enhance = { sourceBitmap, mode -> enhanceWithBitmap(sourceBitmap, mode) },
    )
  }

  private fun runEnhanceTask(
    request: ReadableMap,
    promise: Promise,
    engineName: String,
    enhance: (sourceBitmap: Bitmap, mode: EnhanceMode) -> Bitmap,
  ) {
    val startedAt = SystemClock.elapsedRealtime()
    try {
      val parsedRequest = parseEnhanceRequest(request)
      val sourceBitmap = decodeSourceBitmap(parsedRequest.sourceUri, parsedRequest.maxLongEdgePx)
      val enhancedBitmap = try {
        if (engineName == "opencv") {
          ensureOpenCvInitialized()
        }
        enhance(sourceBitmap, parsedRequest.mode)
      } finally {
        sourceBitmap.recycle()
      }

      val outputWidth = enhancedBitmap.width
      val outputHeight = enhancedBitmap.height
      try {
        writeBitmapToUri(
          bitmap = enhancedBitmap,
          outputUriText = parsedRequest.outputUri,
          jpegQualityPercent = parsedRequest.jpegQualityPercent,
        )
      } finally {
        enhancedBitmap.recycle()
      }

      val response = Arguments.createMap().apply {
        putBoolean("success", true)
        putString("outputUri", parsedRequest.outputUri)
        putString("engine", engineName)
        putInt("width", outputWidth)
        putInt("height", outputHeight)
        putDouble("durationMs", (SystemClock.elapsedRealtime() - startedAt).toDouble())
      }
      promise.resolve(response)
    } catch (error: Throwable) {
      val response = Arguments.createMap().apply {
        putBoolean("success", false)
        putString("error", error.message ?: error.javaClass.simpleName)
        putDouble("durationMs", (SystemClock.elapsedRealtime() - startedAt).toDouble())
      }
      promise.resolve(response)
    }
  }

  private fun parseEnhanceRequest(request: ReadableMap): EnhanceRequest {
    val sourceUri = readRequiredString(request, "sourceUri")
    val outputUri = readRequiredString(request, "outputUri")
    val mode = parseMode(readRequiredString(request, "mode"))
    val maxLongEdgePx = parseMaxLongEdge(request)
    val jpegQualityPercent = parseJpegQualityPercent(request)

    return EnhanceRequest(
      sourceUri = sourceUri,
      outputUri = outputUri,
      mode = mode,
      maxLongEdgePx = maxLongEdgePx,
      jpegQualityPercent = jpegQualityPercent,
    )
  }

  private fun readRequiredString(request: ReadableMap, key: String): String {
    if (!request.hasKey(key) || request.isNull(key)) {
      throw IllegalArgumentException("Missing required field: $key")
    }
    val value = request.getString(key)?.trim().orEmpty()
    if (value.isEmpty()) {
      throw IllegalArgumentException("Field cannot be empty: $key")
    }
    return value
  }

  private fun parseMode(rawMode: String): EnhanceMode {
    return when (rawMode) {
      "clear_print" -> EnhanceMode.CLEAR_PRINT
      "bw_scan" -> EnhanceMode.BW_SCAN
      else -> throw IllegalArgumentException("Unsupported enhance mode: $rawMode")
    }
  }

  private fun parseMaxLongEdge(request: ReadableMap): Int {
    val fallback = 2200
    val value = if (request.hasKey("maxLongEdgePx") && !request.isNull("maxLongEdgePx")) {
      request.getDouble("maxLongEdgePx").roundToInt()
    } else {
      fallback
    }
    return value.coerceIn(800, 4096)
  }

  private fun parseJpegQualityPercent(request: ReadableMap): Int {
    val quality = if (request.hasKey("jpegQuality") && !request.isNull("jpegQuality")) {
      request.getDouble("jpegQuality")
    } else {
      0.9
    }
    return (quality.coerceIn(0.35, 1.0) * 100.0).roundToInt().coerceIn(35, 100)
  }

  private fun decodeSourceBitmap(sourceUriText: String, maxLongEdgePx: Int): Bitmap {
    val sourceUri = Uri.parse(sourceUriText)
    val bounds = decodeBounds(sourceUri)
    val sampleSize = computeSampleSize(
      width = max(bounds.first, 1),
      height = max(bounds.second, 1),
      maxLongEdgePx = maxLongEdgePx,
    )

    val bitmap = decodeBitmap(sourceUri, sampleSize)
      ?: throw IllegalStateException("Failed to decode source bitmap.")
    val resized = resizeBitmapIfNeeded(bitmap, maxLongEdgePx)
    if (resized !== bitmap) {
      bitmap.recycle()
    }
    return resized
  }

  private fun decodeBounds(uri: Uri): Pair<Int, Int> {
    val options = BitmapFactory.Options().apply {
      inJustDecodeBounds = true
    }

    decodeWithOptions(uri, options)
    return Pair(options.outWidth, options.outHeight)
  }

  private fun decodeBitmap(uri: Uri, inSampleSize: Int): Bitmap? {
    val options = BitmapFactory.Options().apply {
      this.inSampleSize = max(1, inSampleSize)
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inMutable = false
    }
    return decodeWithOptions(uri, options)
  }

  private fun decodeWithOptions(uri: Uri, options: BitmapFactory.Options): Bitmap? {
    return when (uri.scheme?.lowercase()) {
      "file", null -> {
        val filePath = uri.path ?: throw IllegalArgumentException("Invalid file uri: $uri")
        BitmapFactory.decodeFile(filePath, options)
      }

      else -> {
        openInputStream(uri).use { input ->
          if (input == null) {
            throw IllegalArgumentException("Cannot open input stream: $uri")
          }
          BitmapFactory.decodeStream(input, null, options)
        }
      }
    }
  }

  private fun openInputStream(uri: Uri): InputStream? {
    return reactApplicationContext.contentResolver.openInputStream(uri)
  }

  private fun computeSampleSize(width: Int, height: Int, maxLongEdgePx: Int): Int {
    if (width <= 0 || height <= 0) {
      return 1
    }
    var sample = 1
    var scaledLongEdge = max(width, height)
    while (scaledLongEdge > maxLongEdgePx * 2) {
      sample *= 2
      scaledLongEdge /= 2
    }
    return max(sample, 1)
  }

  private fun resizeBitmapIfNeeded(bitmap: Bitmap, maxLongEdgePx: Int): Bitmap {
    val width = bitmap.width
    val height = bitmap.height
    val longEdge = max(width, height)
    if (longEdge <= maxLongEdgePx || longEdge <= 0) {
      return bitmap
    }

    val scale = maxLongEdgePx.toDouble() / longEdge.toDouble()
    val targetWidth = max(1, (width * scale).roundToInt())
    val targetHeight = max(1, (height * scale).roundToInt())
    return Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true)
  }

  private fun ensureOpenCvInitialized() {
    if (openCvReady) {
      return
    }
    synchronized(this) {
      if (openCvReady) {
        return
      }
      if (!tryInitializeOpenCv()) {
        throw IllegalStateException("OpenCV initialization failed.")
      }
      openCvReady = true
    }
  }

  private fun tryInitializeOpenCv(): Boolean {
    return try {
      val loaderClass = OpenCVLoader::class.java
      val initLocal = loaderClass.methods.firstOrNull {
        it.name == "initLocal" && it.parameterCount == 0
      }
      if (initLocal != null) {
        (initLocal.invoke(null) as? Boolean) == true
      } else {
        val initDebug = loaderClass.methods.firstOrNull {
          it.name == "initDebug" && it.parameterCount == 0
        }
        (initDebug?.invoke(null) as? Boolean) == true
      }
    } catch (_: Throwable) {
      false
    }
  }

  private fun enhanceWithOpenCv(sourceBitmap: Bitmap, mode: EnhanceMode): Bitmap {
    val rgba = Mat()
    Utils.bitmapToMat(sourceBitmap, rgba)
    if (rgba.type() != CvType.CV_8UC4) {
      rgba.convertTo(rgba, CvType.CV_8UC4)
    }

    val gray = Mat()
    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)

    val processedGray = when (mode) {
      EnhanceMode.CLEAR_PRINT -> buildClearPrintMat(gray)
      EnhanceMode.BW_SCAN -> buildBwScanMat(gray)
    }

    val outputRgba = Mat()
    Imgproc.cvtColor(processedGray, outputRgba, Imgproc.COLOR_GRAY2RGBA)
    val outputBitmap = Bitmap.createBitmap(outputRgba.cols(), outputRgba.rows(), Bitmap.Config.ARGB_8888)
    Utils.matToBitmap(outputRgba, outputBitmap)

    outputRgba.release()
    processedGray.release()
    gray.release()
    rgba.release()

    return outputBitmap
  }

  private fun buildClearPrintMat(gray: Mat): Mat {
    val denoised = Mat()
    Photo.fastNlMeansDenoising(gray, denoised)

    val contrastEnhanced = Mat()
    val clahe: CLAHE = Imgproc.createCLAHE(2.2, Size(8.0, 8.0))
    clahe.apply(denoised, contrastEnhanced)

    val edges = Mat()
    Imgproc.Laplacian(contrastEnhanced, edges, CvType.CV_8U, 3, 1.0, 0.0)

    val sharpened = Mat()
    Core.addWeighted(contrastEnhanced, 1.18, edges, -0.22, 8.0, sharpened)

    val normalized = Mat()
    Core.normalize(sharpened, normalized, 0.0, 255.0, Core.NORM_MINMAX)

    denoised.release()
    contrastEnhanced.release()
    edges.release()
    sharpened.release()

    return normalized
  }

  private fun buildBwScanMat(gray: Mat): Mat {
    val blurred = Mat()
    Imgproc.GaussianBlur(gray, blurred, Size(3.0, 3.0), 0.0)

    val binary = Mat()
    Imgproc.adaptiveThreshold(
      blurred,
      binary,
      255.0,
      Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
      Imgproc.THRESH_BINARY,
      35,
      11.0,
    )

    val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(2.0, 2.0))
    val cleaned = Mat()
    Imgproc.morphologyEx(binary, cleaned, Imgproc.MORPH_OPEN, kernel)

    blurred.release()
    binary.release()
    kernel.release()

    return cleaned
  }

  private fun enhanceWithBitmap(sourceBitmap: Bitmap, mode: EnhanceMode): Bitmap {
    return when (mode) {
      EnhanceMode.CLEAR_PRINT -> enhanceBitmapClearPrint(sourceBitmap)
      EnhanceMode.BW_SCAN -> enhanceBitmapBwScan(sourceBitmap)
    }
  }

  private fun enhanceBitmapClearPrint(sourceBitmap: Bitmap): Bitmap {
    val output = Bitmap.createBitmap(sourceBitmap.width, sourceBitmap.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    val grayscaleMatrix = ColorMatrix().apply {
      setSaturation(0f)
    }

    val contrast = 1.18f
    val brightness = 12f
    val translate = ((-0.5f * contrast) + 0.5f) * 255f + brightness
    val contrastMatrix = ColorMatrix(
      floatArrayOf(
        contrast, 0f, 0f, 0f, translate,
        0f, contrast, 0f, 0f, translate,
        0f, 0f, contrast, 0f, translate,
        0f, 0f, 0f, 1f, 0f,
      ),
    )
    grayscaleMatrix.postConcat(contrastMatrix)

    paint.colorFilter = ColorMatrixColorFilter(grayscaleMatrix)
    canvas.drawBitmap(sourceBitmap, 0f, 0f, paint)
    paint.colorFilter = null

    return output
  }

  private fun enhanceBitmapBwScan(sourceBitmap: Bitmap): Bitmap {
    val width = sourceBitmap.width
    val height = sourceBitmap.height
    val pixelCount = width * height
    val pixels = IntArray(pixelCount)
    sourceBitmap.getPixels(pixels, 0, width, 0, 0, width, height)

    val luminance = IntArray(pixelCount)
    for (index in 0 until pixelCount) {
      val color = pixels[index]
      val r = Color.red(color)
      val g = Color.green(color)
      val b = Color.blue(color)
      luminance[index] = ((0.299 * r) + (0.587 * g) + (0.114 * b)).roundToInt().coerceIn(0, 255)
    }

    val threshold = computeOtsuThreshold(luminance).coerceIn(75, 210)
    val outputPixels = IntArray(pixelCount)
    for (index in 0 until pixelCount) {
      val value = if (luminance[index] >= threshold) 255 else 0
      outputPixels[index] = Color.argb(255, value, value, value)
    }

    val output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    output.setPixels(outputPixels, 0, width, 0, 0, width, height)
    return output
  }

  private fun computeOtsuThreshold(luminance: IntArray): Int {
    if (luminance.isEmpty()) {
      return 127
    }

    val histogram = IntArray(256)
    for (value in luminance) {
      histogram[value.coerceIn(0, 255)] += 1
    }

    val total = luminance.size
    var sumAll = 0.0
    for (level in 0..255) {
      sumAll += level * histogram[level].toDouble()
    }

    var sumBackground = 0.0
    var weightBackground = 0
    var maxVariance = -1.0
    var threshold = 127

    for (level in 0..255) {
      weightBackground += histogram[level]
      if (weightBackground == 0) {
        continue
      }

      val weightForeground = total - weightBackground
      if (weightForeground == 0) {
        break
      }

      sumBackground += level * histogram[level].toDouble()
      val meanBackground = sumBackground / weightBackground
      val meanForeground = (sumAll - sumBackground) / weightForeground
      val betweenVariance = weightBackground.toDouble() * weightForeground.toDouble() *
        (meanBackground - meanForeground) * (meanBackground - meanForeground)

      if (betweenVariance > maxVariance) {
        maxVariance = betweenVariance
        threshold = level
      }
    }

    return threshold
  }

  private fun writeBitmapToUri(
    bitmap: Bitmap,
    outputUriText: String,
    jpegQualityPercent: Int,
  ) {
    val outputUri = Uri.parse(outputUriText)
    when (outputUri.scheme?.lowercase()) {
      "file", null -> {
        val path = outputUri.path ?: throw IllegalArgumentException("Invalid output file uri: $outputUriText")
        val outputFile = File(path)
        outputFile.parentFile?.mkdirs()
        FileOutputStream(outputFile).use { stream ->
          if (!bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQualityPercent, stream)) {
            throw IllegalStateException("Failed to compress output bitmap.")
          }
          stream.flush()
        }
      }

      else -> {
        reactApplicationContext.contentResolver.openOutputStream(outputUri, "w").use { stream ->
          if (stream == null) {
            throw IllegalStateException("Cannot open output stream: $outputUriText")
          }
          if (!bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQualityPercent, stream)) {
            throw IllegalStateException("Failed to compress output bitmap.")
          }
          stream.flush()
        }
      }
    }
  }

  companion object {
    private const val MODULE_NAME = "QishuaPrintImageEnhanceModule"
  }
}

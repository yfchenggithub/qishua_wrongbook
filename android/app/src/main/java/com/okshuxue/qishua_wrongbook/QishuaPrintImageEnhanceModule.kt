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
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.CLAHE
import org.opencv.imgproc.Imgproc
import org.opencv.photo.Photo
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class QishuaPrintImageEnhanceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private enum class EnhanceMode {
    CLEAR_PRINT,
    BW_SCAN,
  }

  private enum class ClearPrintStrength {
    WEAK,
    MEDIUM,
    STRONG,
  }

  private data class BwScanParams(
    val illuminationSigma: Double,
    val adaptiveBlockSize: Int,
    val adaptiveC: Double,
    val minComponentAreaPx: Int,
  )

  private data class ClearPrintParams(
    val illuminationSigma: Double,
    val claheClipLimit: Double,
    val unsharpAmount: Double,
    val unsharpSigma: Double,
    val toneAlpha: Double,
    val toneBeta: Double,
    val textAlpha: Double,
    val textBeta: Double,
    val textMaskBlockSize: Int,
    val textMaskC: Double,
    val textMaskDilateKernel: Int,
    val backgroundGray: Double,
  )

  private data class EnhanceRequest(
    val sourceUri: String,
    val outputUri: String,
    val mode: EnhanceMode,
    val clearPrintStrength: ClearPrintStrength,
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
      enhance = { sourceBitmap, mode, clearPrintStrength ->
        enhanceWithOpenCv(sourceBitmap, mode, clearPrintStrength)
      },
    )
  }

  @ReactMethod
  fun enhanceForPdfPrintBitmap(request: ReadableMap, promise: Promise) {
    runEnhanceTask(
      request = request,
      promise = promise,
      engineName = "bitmap_fallback",
      enhance = { sourceBitmap, mode, clearPrintStrength ->
        enhanceWithBitmap(sourceBitmap, mode, clearPrintStrength)
      },
    )
  }

  private fun runEnhanceTask(
    request: ReadableMap,
    promise: Promise,
    engineName: String,
    enhance: (sourceBitmap: Bitmap, mode: EnhanceMode, clearPrintStrength: ClearPrintStrength) -> Bitmap,
  ) {
    val startedAt = SystemClock.elapsedRealtime()
    try {
      val parsedRequest = parseEnhanceRequest(request)
      val sourceBitmap = decodeSourceBitmap(parsedRequest.sourceUri, parsedRequest.maxLongEdgePx)
      val enhancedBitmap = try {
        if (engineName == "opencv") {
          ensureOpenCvInitialized()
        }
        enhance(sourceBitmap, parsedRequest.mode, parsedRequest.clearPrintStrength)
      } finally {
        sourceBitmap.recycle()
      }

      val outputWidth = enhancedBitmap.width
      val outputHeight = enhancedBitmap.height
      try {
        writeBitmapToUri(
          bitmap = enhancedBitmap,
          outputUriText = parsedRequest.outputUri,
          mode = parsedRequest.mode,
          jpegQualityPercent = parsedRequest.jpegQualityPercent,
        )
      } finally {
        enhancedBitmap.recycle()
      }

      val response = Arguments.createMap().apply {
        putBoolean("success", true)
        putString("outputUri", parsedRequest.outputUri)
        putString("engine", engineName)
        putString("outputFormat", if (parsedRequest.mode == EnhanceMode.BW_SCAN) "png" else "jpeg")
        putString("clearPrintStrength", parsedRequest.clearPrintStrength.name.lowercase())
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
    val clearPrintStrength = parseClearPrintStrength(request)
    val maxLongEdgePx = parseMaxLongEdge(request)
    val jpegQualityPercent = parseJpegQualityPercent(request)

    return EnhanceRequest(
      sourceUri = sourceUri,
      outputUri = outputUri,
      mode = mode,
      clearPrintStrength = clearPrintStrength,
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

  private fun parseClearPrintStrength(request: ReadableMap): ClearPrintStrength {
    val raw = if (request.hasKey("clearPrintStrength") && !request.isNull("clearPrintStrength")) {
      request.getString("clearPrintStrength")?.trim()?.lowercase()
    } else {
      null
    }

    return when (raw) {
      "weak" -> ClearPrintStrength.WEAK
      "strong" -> ClearPrintStrength.STRONG
      else -> ClearPrintStrength.MEDIUM
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

  private fun enhanceWithOpenCv(
    sourceBitmap: Bitmap,
    mode: EnhanceMode,
    clearPrintStrength: ClearPrintStrength,
  ): Bitmap {
    val rgba = Mat()
    Utils.bitmapToMat(sourceBitmap, rgba)
    if (rgba.type() != CvType.CV_8UC4) {
      rgba.convertTo(rgba, CvType.CV_8UC4)
    }

    val gray = Mat()
    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)

    val processedGray = when (mode) {
      EnhanceMode.CLEAR_PRINT -> buildClearPrintMat(gray, clearPrintStrength)
      EnhanceMode.BW_SCAN -> buildBwScanMat(gray, clearPrintStrength)
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

  private fun resolveClearPrintParams(strength: ClearPrintStrength): ClearPrintParams {
    return when (strength) {
      ClearPrintStrength.WEAK -> ClearPrintParams(
        illuminationSigma = 30.0,
        claheClipLimit = 1.8,
        unsharpAmount = 0.34,
        unsharpSigma = 1.2,
        toneAlpha = 1.03,
        toneBeta = 12.0,
        textAlpha = 1.12,
        textBeta = -22.0,
        textMaskBlockSize = 31,
        textMaskC = 5.0,
        textMaskDilateKernel = 1,
        backgroundGray = 248.0,
      )
      ClearPrintStrength.STRONG -> ClearPrintParams(
        illuminationSigma = 38.0,
        claheClipLimit = 2.8,
        unsharpAmount = 0.58,
        unsharpSigma = 1.45,
        toneAlpha = 1.1,
        toneBeta = 18.0,
        textAlpha = 1.28,
        textBeta = -44.0,
        textMaskBlockSize = 45,
        textMaskC = 7.0,
        textMaskDilateKernel = 2,
        backgroundGray = 246.0,
      )
      ClearPrintStrength.MEDIUM -> ClearPrintParams(
        illuminationSigma = 34.0,
        claheClipLimit = 2.2,
        unsharpAmount = 0.46,
        unsharpSigma = 1.3,
        toneAlpha = 1.06,
        toneBeta = 16.0,
        textAlpha = 1.19,
        textBeta = -32.0,
        textMaskBlockSize = 37,
        textMaskC = 6.0,
        textMaskDilateKernel = 2,
        backgroundGray = 247.0,
      )
    }
  }

  private fun buildClearPrintMat(gray: Mat, strength: ClearPrintStrength): Mat {
    val params = resolveClearPrintParams(strength)
    val denoised = Mat()
    Photo.fastNlMeansDenoising(gray, denoised)

    val illuminationNormalized = normalizeIlluminationForScan(
      denoised,
      params.illuminationSigma,
    )

    val contrastEnhanced = Mat()
    val clahe: CLAHE = Imgproc.createCLAHE(params.claheClipLimit, Size(8.0, 8.0))
    clahe.apply(illuminationNormalized, contrastEnhanced)

    val blurred = Mat()
    Imgproc.GaussianBlur(contrastEnhanced, blurred, Size(0.0, 0.0), params.unsharpSigma)

    val sharpened = Mat()
    Core.addWeighted(
      contrastEnhanced,
      1.0 + params.unsharpAmount,
      blurred,
      -params.unsharpAmount,
      0.0,
      sharpened,
    )

    val toned = Mat()
    Core.convertScaleAbs(sharpened, toned, params.toneAlpha, params.toneBeta)

    val textMaskBinary = Mat()
    Imgproc.adaptiveThreshold(
      contrastEnhanced,
      textMaskBinary,
      255.0,
      Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
      Imgproc.THRESH_BINARY,
      params.textMaskBlockSize,
      params.textMaskC,
    )
    val reinforced = composeSoftBwScanFromBinary(
      textSourceGray = toned,
      binary = textMaskBinary,
      textAlpha = params.textAlpha,
      textBeta = params.textBeta,
      maskDilateKernel = params.textMaskDilateKernel,
      backgroundGray = params.backgroundGray,
    )

    denoised.release()
    illuminationNormalized.release()
    contrastEnhanced.release()
    blurred.release()
    sharpened.release()
    toned.release()
    textMaskBinary.release()

    return reinforced
  }

  private fun resolveBwScanParams(strength: ClearPrintStrength): BwScanParams {
    return when (strength) {
      ClearPrintStrength.WEAK -> BwScanParams(
        illuminationSigma = 29.0,
        adaptiveBlockSize = 41,
        adaptiveC = 9.0,
        minComponentAreaPx = 14,
      )
      ClearPrintStrength.STRONG -> BwScanParams(
        illuminationSigma = 42.0,
        adaptiveBlockSize = 63,
        adaptiveC = 19.0,
        minComponentAreaPx = 36,
      )
      ClearPrintStrength.MEDIUM -> BwScanParams(
        illuminationSigma = 35.0,
        adaptiveBlockSize = 51,
        adaptiveC = 9.0,
        minComponentAreaPx = 24,
      )
    }
  }

  private fun buildBwScanMat(gray: Mat, strength: ClearPrintStrength): Mat {
    if (strength == ClearPrintStrength.WEAK) {
      val weakResult = buildBwScanMatWeak(gray)
      if (!isBwScanResultPlausible(weakResult)) {
        weakResult.release()
        return buildBwScanMat(gray, ClearPrintStrength.MEDIUM)
      }
      return weakResult
    }

    val params = resolveBwScanParams(strength)
    val denoised = Mat()
    Photo.fastNlMeansDenoising(gray, denoised)

    val illuminationNormalized = normalizeIlluminationForScan(
      denoised,
      params.illuminationSigma,
    )

    val contrastEnhanced = Mat()
    val clahe: CLAHE = Imgproc.createCLAHE(2.0, Size(8.0, 8.0))
    clahe.apply(illuminationNormalized, contrastEnhanced)

    val binary = Mat()
    Imgproc.adaptiveThreshold(
      contrastEnhanced,
      binary,
      255.0,
      Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
      Imgproc.THRESH_BINARY,
      params.adaptiveBlockSize,
      params.adaptiveC,
    )

    val median = Mat()
    Imgproc.medianBlur(binary, median, 3)

    val openKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(2.0, 2.0))
    val opened = Mat()
    Imgproc.morphologyEx(median, opened, Imgproc.MORPH_OPEN, openKernel)

    val closeKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(2.0, 2.0))
    val closed = Mat()
    Imgproc.morphologyEx(opened, closed, Imgproc.MORPH_CLOSE, closeKernel)

    val cleaned = removeTinyDarkComponents(closed, params.minComponentAreaPx)
    val normalizedBinary = Mat()
    Imgproc.threshold(cleaned, normalizedBinary, 0.0, 255.0, Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU)
    val output = if (strength == ClearPrintStrength.STRONG) {
      normalizedBinary
    } else {
      val soft = composeSoftBwScanFromBinary(
        textSourceGray = contrastEnhanced,
        binary = normalizedBinary,
        textAlpha = 1.3,
        textBeta = -70.0,
        maskDilateKernel = 2,
        backgroundGray = 250.0,
      )
      normalizedBinary.release()
      soft
    }

    denoised.release()
    illuminationNormalized.release()
    contrastEnhanced.release()
    binary.release()
    median.release()
    openKernel.release()
    opened.release()
    closeKernel.release()
    closed.release()
    cleaned.release()

    return output
  }

  private fun buildBwScanMatWeak(gray: Mat): Mat {
    // Weak mode prioritizes legibility over aggressive whitening.
    val denoised = Mat()
    Photo.fastNlMeansDenoising(gray, denoised)

    val illuminationNormalized = normalizeIlluminationForScan(
      denoised,
      24.0,
    )

    val contrastEnhanced = Mat()
    val clahe: CLAHE = Imgproc.createCLAHE(1.5, Size(8.0, 8.0))
    clahe.apply(illuminationNormalized, contrastEnhanced)

    val globalBinary = Mat()
    Imgproc.threshold(
      contrastEnhanced,
      globalBinary,
      0.0,
      255.0,
      Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU,
    )

    val adaptiveBinary = Mat()
    Imgproc.adaptiveThreshold(
      contrastEnhanced,
      adaptiveBinary,
      255.0,
      Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
      Imgproc.THRESH_BINARY,
      35,
      4.0,
    )

    val globalDark = Mat()
    val adaptiveDark = Mat()
    Core.bitwise_not(globalBinary, globalDark)
    Core.bitwise_not(adaptiveBinary, adaptiveDark)

    val mergedDark = Mat()
    Core.bitwise_or(globalDark, adaptiveDark, mergedDark)

    val mergedBinary = Mat()
    Core.bitwise_not(mergedDark, mergedBinary)

    val closeKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(2.0, 2.0))
    val closed = Mat()
    Imgproc.morphologyEx(mergedBinary, closed, Imgproc.MORPH_CLOSE, closeKernel)

    val darkMask = Mat()
    Core.bitwise_not(closed, darkMask)
    val dilateKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(2.0, 2.0))
    val thickDarkMask = Mat()
    Imgproc.dilate(darkMask, thickDarkMask, dilateKernel)
    val thickBinary = Mat()
    Core.bitwise_not(thickDarkMask, thickBinary)

    val cleaned = removeTinyDarkComponents(thickBinary, 6)
    val trimmed = removeLargeBorderDarkComponents(cleaned, 900, 0.028)
    val softOutput = composeSoftBwScanFromBinary(
      textSourceGray = contrastEnhanced,
      binary = trimmed,
      textAlpha = 1.26,
      textBeta = -60.0,
      maskDilateKernel = 2,
      backgroundGray = 248.0,
    )

    denoised.release()
    illuminationNormalized.release()
    contrastEnhanced.release()
    globalBinary.release()
    adaptiveBinary.release()
    globalDark.release()
    adaptiveDark.release()
    mergedDark.release()
    mergedBinary.release()
    closeKernel.release()
    closed.release()
    darkMask.release()
    dilateKernel.release()
    thickDarkMask.release()
    thickBinary.release()
    cleaned.release()
    trimmed.release()

    return softOutput
  }

  private fun normalizeIlluminationForScan(gray: Mat, sigma: Double): Mat {
    val background = Mat()
    Imgproc.GaussianBlur(gray, background, Size(0.0, 0.0), sigma)

    val gray32 = Mat()
    val background32 = Mat()
    gray.convertTo(gray32, CvType.CV_32F)
    background.convertTo(background32, CvType.CV_32F)
    Core.add(background32, Scalar(1.0), background32)

    val normalized32 = Mat()
    Core.divide(gray32, background32, normalized32, 255.0)

    val normalized = Mat()
    normalized32.convertTo(normalized, CvType.CV_8U)

    background.release()
    gray32.release()
    background32.release()
    normalized32.release()

    return normalized
  }

  private fun removeTinyDarkComponents(binary: Mat, minAreaPx: Int): Mat {
    if (minAreaPx <= 1) {
      return binary.clone()
    }

    val inverted = Mat()
    Core.bitwise_not(binary, inverted)

    val labels = Mat()
    val stats = Mat()
    val centroids = Mat()
    val componentCount = Imgproc.connectedComponentsWithStats(
      inverted,
      labels,
      stats,
      centroids,
      8,
      CvType.CV_32S,
    )

    val keptComponents = Mat.zeros(inverted.size(), CvType.CV_8UC1)
    val labelMask = Mat()
    for (label in 1 until componentCount) {
      val area = statValueAsInt(stats, label, Imgproc.CC_STAT_AREA, 0)
      if (area >= minAreaPx) {
        Core.compare(labels, Scalar(label.toDouble()), labelMask, Core.CMP_EQ)
        keptComponents.setTo(Scalar(255.0), labelMask)
      }
    }

    val cleaned = Mat()
    Core.bitwise_not(keptComponents, cleaned)

    inverted.release()
    labels.release()
    stats.release()
    centroids.release()
    keptComponents.release()
    labelMask.release()

    return cleaned
  }

  private fun removeLargeBorderDarkComponents(
    binary: Mat,
    minLargeAreaPx: Int,
    maxAreaRatio: Double,
  ): Mat {
    val rows = binary.rows()
    val cols = binary.cols()
    if (rows <= 0 || cols <= 0) {
      return binary.clone()
    }

    val totalPixels = rows * cols
    val dynamicAreaThreshold = (totalPixels.toDouble() * maxAreaRatio).roundToInt()
    val largeAreaThreshold = max(minLargeAreaPx, dynamicAreaThreshold)

    val inverted = Mat()
    Core.bitwise_not(binary, inverted)

    val labels = Mat()
    val stats = Mat()
    val centroids = Mat()
    val componentCount = Imgproc.connectedComponentsWithStats(
      inverted,
      labels,
      stats,
      centroids,
      8,
      CvType.CV_32S,
    )

    val keptComponents = Mat.zeros(inverted.size(), CvType.CV_8UC1)
    val labelMask = Mat()
    for (label in 1 until componentCount) {
      val area = statValueAsInt(stats, label, Imgproc.CC_STAT_AREA, 0)
      val left = statValueAsInt(stats, label, Imgproc.CC_STAT_LEFT, 0)
      val top = statValueAsInt(stats, label, Imgproc.CC_STAT_TOP, 0)
      val width = statValueAsInt(stats, label, Imgproc.CC_STAT_WIDTH, 0)
      val height = statValueAsInt(stats, label, Imgproc.CC_STAT_HEIGHT, 0)
      val right = left + width
      val bottom = top + height
      val touchesBorder =
        left <= 1 || top <= 1 || right >= cols - 1 || bottom >= rows - 1
      val isLarge = area >= largeAreaThreshold

      if (!(touchesBorder && isLarge)) {
        Core.compare(labels, Scalar(label.toDouble()), labelMask, Core.CMP_EQ)
        keptComponents.setTo(Scalar(255.0), labelMask)
      }
    }

    val cleaned = Mat()
    Core.bitwise_not(keptComponents, cleaned)

    inverted.release()
    labels.release()
    stats.release()
    centroids.release()
    keptComponents.release()
    labelMask.release()

    return cleaned
  }

  private fun isBwScanResultPlausible(binary: Mat): Boolean {
    val darkRatio = computeDarkPixelRatio(binary)
    val borderDarkRatio = computeBorderDarkRatio(binary)
    val largestDarkComponentRatio = computeLargestDarkComponentRatio(binary)

    if (darkRatio < 0.012 || darkRatio > 0.34) {
      return false
    }
    if (largestDarkComponentRatio > 0.16) {
      return false
    }
    if (borderDarkRatio > 0.34 && largestDarkComponentRatio > 0.045) {
      return false
    }
    return true
  }

  private fun computeDarkPixelRatio(binary: Mat): Double {
    val rows = binary.rows()
    val cols = binary.cols()
    if (rows <= 0 || cols <= 0) {
      return 0.0
    }

    val total = rows.toLong() * cols.toLong()
    if (total <= 0L) {
      return 0.0
    }
    val whitePixels = Core.countNonZero(binary).toLong().coerceIn(0L, total)
    val darkPixels = total - whitePixels
    return darkPixels.toDouble() / total.toDouble()
  }

  private fun computeBorderDarkRatio(binary: Mat): Double {
    val rows = binary.rows()
    val cols = binary.cols()
    if (rows <= 0 || cols <= 0) {
      return 0.0
    }

    val band = max(1, min(rows, cols) / 30)
    if (rows <= band * 2 || cols <= band * 2) {
      return computeDarkPixelRatio(binary)
    }

    val total = rows.toLong() * cols.toLong()
    val inner = binary.submat(band, rows - band, band, cols - band)
    val innerTotal = inner.rows().toLong() * inner.cols().toLong()
    val innerWhite = Core.countNonZero(inner).toLong().coerceIn(0L, innerTotal)
    inner.release()

    val totalWhite = Core.countNonZero(binary).toLong().coerceIn(0L, total)
    val totalDark = total - totalWhite
    val innerDark = innerTotal - innerWhite
    val borderTotal = total - innerTotal
    if (borderTotal <= 0L) {
      return 0.0
    }
    val borderDark = (totalDark - innerDark).coerceAtLeast(0L)
    return borderDark.toDouble() / borderTotal.toDouble()
  }

  private fun computeLargestDarkComponentRatio(binary: Mat): Double {
    val rows = binary.rows()
    val cols = binary.cols()
    if (rows <= 0 || cols <= 0) {
      return 0.0
    }
    val totalPixels = rows.toLong() * cols.toLong()
    if (totalPixels <= 0L) {
      return 0.0
    }

    val inverted = Mat()
    Core.bitwise_not(binary, inverted)
    val labels = Mat()
    val stats = Mat()
    val centroids = Mat()
    val componentCount = Imgproc.connectedComponentsWithStats(
      inverted,
      labels,
      stats,
      centroids,
      8,
      CvType.CV_32S,
    )

    var largestArea = 0
    for (label in 1 until componentCount) {
      val area = statValueAsInt(stats, label, Imgproc.CC_STAT_AREA, 0)
      if (area > largestArea) {
        largestArea = area
      }
    }

    inverted.release()
    labels.release()
    stats.release()
    centroids.release()

    return largestArea.toDouble() / totalPixels.toDouble()
  }

  private fun composeSoftBwScanFromBinary(
    textSourceGray: Mat,
    binary: Mat,
    textAlpha: Double,
    textBeta: Double,
    maskDilateKernel: Int,
    backgroundGray: Double,
  ): Mat {
    val textTone = Mat()
    Core.convertScaleAbs(textSourceGray, textTone, textAlpha, textBeta)

    val darkMask = Mat()
    Core.bitwise_not(binary, darkMask)

    val finalMask = if (maskDilateKernel > 1) {
      val kernel = Imgproc.getStructuringElement(
        Imgproc.MORPH_RECT,
        Size(maskDilateKernel.toDouble(), maskDilateKernel.toDouble()),
      )
      val dilatedMask = Mat()
      Imgproc.dilate(darkMask, dilatedMask, kernel)
      kernel.release()
      darkMask.release()
      dilatedMask
    } else {
      darkMask
    }

    val output = Mat(binary.size(), CvType.CV_8UC1, Scalar(backgroundGray.coerceIn(236.0, 255.0)))
    textTone.copyTo(output, finalMask)

    textTone.release()
    finalMask.release()
    return output
  }

  private fun statValueAsInt(stats: Mat, row: Int, column: Int, fallback: Int): Int {
    val raw = stats.get(row, column) ?: return fallback
    if (raw.isEmpty()) {
      return fallback
    }
    return raw[0].roundToInt()
  }

  private fun enhanceWithBitmap(
    sourceBitmap: Bitmap,
    mode: EnhanceMode,
    clearPrintStrength: ClearPrintStrength,
  ): Bitmap {
    return when (mode) {
      EnhanceMode.CLEAR_PRINT -> enhanceBitmapClearPrint(sourceBitmap, clearPrintStrength)
      EnhanceMode.BW_SCAN -> enhanceBitmapBwScan(sourceBitmap, clearPrintStrength)
    }
  }

  private fun enhanceBitmapClearPrint(sourceBitmap: Bitmap, strength: ClearPrintStrength): Bitmap {
    val output = Bitmap.createBitmap(sourceBitmap.width, sourceBitmap.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    val grayscaleMatrix = ColorMatrix().apply {
      setSaturation(0f)
    }

    val contrast = when (strength) {
      ClearPrintStrength.WEAK -> 1.14f
      ClearPrintStrength.STRONG -> 1.3f
      ClearPrintStrength.MEDIUM -> 1.22f
    }
    val brightness = when (strength) {
      ClearPrintStrength.WEAK -> 8f
      ClearPrintStrength.STRONG -> 14f
      ClearPrintStrength.MEDIUM -> 12f
    }
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

  private fun enhanceBitmapBwScan(sourceBitmap: Bitmap, strength: ClearPrintStrength): Bitmap {
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

    val thresholdOffset = when (strength) {
      ClearPrintStrength.WEAK -> -8
      ClearPrintStrength.STRONG -> 12
      ClearPrintStrength.MEDIUM -> 0
    }
    val threshold = (computeOtsuThreshold(luminance) + thresholdOffset).coerceIn(60, 220)
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
    mode: EnhanceMode,
    jpegQualityPercent: Int,
  ) {
    val usePng = mode == EnhanceMode.BW_SCAN
    val compressFormat = if (usePng) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
    val compressQuality = if (usePng) 100 else jpegQualityPercent

    val outputUri = Uri.parse(outputUriText)
    when (outputUri.scheme?.lowercase()) {
      "file", null -> {
        val path = outputUri.path ?: throw IllegalArgumentException("Invalid output file uri: $outputUriText")
        val outputFile = File(path)
        outputFile.parentFile?.mkdirs()
        FileOutputStream(outputFile).use { stream ->
          if (!bitmap.compress(compressFormat, compressQuality, stream)) {
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
          if (!bitmap.compress(compressFormat, compressQuality, stream)) {
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


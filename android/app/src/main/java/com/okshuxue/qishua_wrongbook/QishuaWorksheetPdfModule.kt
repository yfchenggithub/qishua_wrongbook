package com.okshuxue.qishua_wrongbook

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

class QishuaWorksheetPdfModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private data class WorksheetItem(
    val title: String,
    val module: String,
    val progress: String,
    val difficulty: String,
    val dueDate: String,
    val imageUri: String?,
    val fallbackImageUri: String?,
    val imageWidth: Int,
    val imageHeight: Int,
  )

  private data class WorksheetRequest(
    val requestId: String,
    val date: String,
    val sheetId: String,
    val totalQuestionCount: Int,
    val questionNumberOffset: Int,
    val timeoutMs: Long,
    val qrSize: Int,
    val qrCells: BooleanArray,
    val items: List<WorksheetItem>,
  )

  private val renderExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "qishua-worksheet-pdf-render").apply {
      isDaemon = true
    }
  }
  private val timeoutExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "qishua-worksheet-pdf-timeout").apply {
      isDaemon = true
    }
  }
  private val activeJob = AtomicReference<WorksheetPdfJob?>(null)

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun printWorksheetToFile(request: ReadableMap, promise: Promise) {
    val parsed = try {
      parseRequest(request)
    } catch (error: Throwable) {
      promise.reject(ERROR_INVALID_REQUEST, "Invalid native worksheet PDF request.", error)
      return
    }

    if (parsed.requestId.isEmpty() || parsed.items.isEmpty()) {
      promise.reject(
        ERROR_INVALID_REQUEST,
        "Worksheet PDF requestId and items cannot be empty.",
      )
      return
    }

    val job = WorksheetPdfJob(parsed, promise)
    if (!activeJob.compareAndSet(null, job)) {
      promise.reject(ERROR_BUSY, "Another native worksheet PDF job is still active.")
      return
    }
    job.start()
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by React Native event emitter modules.
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required by React Native event emitter modules.
  }

  private fun parseRequest(request: ReadableMap): WorksheetRequest {
    val requestId = request.getStringOrNull("requestId")?.trim().orEmpty()
    val itemsArray = request.getArrayOrNull("items")
      ?: throw IllegalArgumentException("items are required")
    val items = ArrayList<WorksheetItem>(itemsArray.size())
    for (index in 0 until itemsArray.size()) {
      val item = itemsArray.getMap(index)
        ?: throw IllegalArgumentException("item $index is invalid")
      items.add(
        WorksheetItem(
          title = item.getStringOrNull("title")?.trim().orEmpty().ifEmpty { "未命名题目" },
          module = item.getStringOrNull("module")?.trim().orEmpty().ifEmpty { "模块未知" },
          progress = item.getStringOrNull("progress")?.trim().orEmpty().ifEmpty { "-" },
          difficulty = item.getStringOrNull("difficulty")?.trim().orEmpty().ifEmpty { "-" },
          dueDate = item.getStringOrNull("dueDate")?.trim().orEmpty().ifEmpty { "-" },
          imageUri = item.getStringOrNull("imageUri")?.trim()?.ifEmpty { null },
          fallbackImageUri = item.getStringOrNull("fallbackImageUri")?.trim()?.ifEmpty { null },
          imageWidth = item.getIntOrDefault("imageWidth", 0).coerceAtLeast(0),
          imageHeight = item.getIntOrDefault("imageHeight", 0).coerceAtLeast(0),
        ),
      )
    }

    val qrSize = request.getIntOrDefault("qrSize", 0)
    val qrCellsArray = request.getArrayOrNull("qrCells")
    val qrCells = if (
      qrSize in MIN_QR_SIZE..MAX_QR_SIZE
      && qrCellsArray != null
      && qrCellsArray.size() == qrSize * qrSize
    ) {
      BooleanArray(qrCellsArray.size()) { index ->
        qrCellsArray.getDouble(index) >= 0.5
      }
    } else {
      BooleanArray(0)
    }

    return WorksheetRequest(
      requestId = requestId,
      date = request.getStringOrNull("date")?.trim().orEmpty(),
      sheetId = request.getStringOrNull("sheetId")?.trim().orEmpty(),
      totalQuestionCount = request
        .getIntOrDefault("totalQuestionCount", items.size)
        .coerceAtLeast(items.size),
      questionNumberOffset = request
        .getIntOrDefault("questionNumberOffset", 0)
        .coerceAtLeast(0),
      timeoutMs = request
        .getLongOrDefault("timeoutMs", DEFAULT_TIMEOUT_MS)
        .coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      qrSize = if (qrCells.isNotEmpty()) qrSize else 0,
      qrCells = qrCells,
      items = items,
    )
  }

  private inner class WorksheetPdfJob(
    private val request: WorksheetRequest,
    private val promise: Promise,
  ) {
    private val startedAt = System.currentTimeMillis()
    private val completed = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)
    private val keepOutput = AtomicBoolean(false)
    private var currentStage = STAGE_CREATED
    private var outputFile: File? = null
    private var workerFuture: Future<*>? = null
    private var timeoutFuture: ScheduledFuture<*>? = null

    fun start() {
      markStage(STAGE_JOB_STARTED)
      workerFuture = renderExecutor.submit {
        render()
      }
      timeoutFuture = timeoutExecutor.schedule(
        {
          val blockedStage = currentStage
          cancelled.set(true)
          workerFuture?.cancel(true)
          fail(
            ERROR_TIMEOUT,
            "Native worksheet PDF timed out after ${request.timeoutMs}ms at $blockedStage.",
            null,
            STAGE_TIMEOUT,
            blockedStage,
          )
        },
        request.timeoutMs,
        TimeUnit.MILLISECONDS,
      )
    }

    private fun render() {
      val document = PdfDocument()
      var pageCount = 0
      try {
        checkNotCancelled()
        outputFile = File.createTempFile(
          "qishua_worksheet_${request.requestId.takeLast(12)}_",
          ".pdf",
          reactContext.cacheDir,
        )
        markStage(STAGE_DOCUMENT_CREATED)

        for ((index, item) in request.items.withIndex()) {
          checkNotCancelled()
          val questionNumber = request.questionNumberOffset + index + 1
          markStage(
            STAGE_ITEM_STARTED,
            itemNumber = questionNumber,
            pageCount = pageCount,
          )
          val bitmap = decodeBestBitmap(item, questionNumber)
          try {
            val imageRatio = resolveImageRatio(item, bitmap)
            val singlePage = bitmap == null || CONTENT_WIDTH * imageRatio <= SINGLE_PAGE_IMAGE_MAX_HEIGHT
            pageCount += drawQuestionPage(
              document = document,
              pageNumber = pageCount + 1,
              item = item,
              questionNumber = questionNumber,
              bitmap = bitmap,
              singlePage = singlePage,
            )
            if (!singlePage) {
              pageCount += drawAnswerPage(
                document = document,
                pageNumber = pageCount + 1,
                item = item,
                questionNumber = questionNumber,
              )
            }
          } finally {
            bitmap?.recycle()
          }
          markStage(
            STAGE_ITEM_FINISHED,
            itemNumber = questionNumber,
            pageCount = pageCount,
          )
        }

        checkNotCancelled()
        markStage(STAGE_WRITE_STARTED, pageCount = pageCount)
        FileOutputStream(outputFile).use { stream ->
          document.writeTo(stream)
          stream.flush()
        }
        checkNotCancelled()
        markStage(
          STAGE_WRITE_FINISHED,
          pageCount = pageCount,
          outputBytes = outputFile?.length(),
        )
        succeed(pageCount)
      } catch (error: Throwable) {
        if (!completed.get()) {
          val message = if (cancelled.get() || Thread.currentThread().isInterrupted) {
            "Native worksheet PDF rendering was cancelled."
          } else {
            "Native worksheet PDF rendering failed."
          }
          fail(ERROR_RENDER_FAILED, message, error)
        }
      } finally {
        try {
          document.close()
        } catch (_: Throwable) {
        }
        timeoutFuture?.cancel(false)
        if (!keepOutput.get()) {
          try {
            outputFile?.delete()
          } catch (_: Throwable) {
          }
        }
        activeJob.compareAndSet(this, null)
      }
    }

    private fun succeed(pageCount: Int) {
      val file = outputFile
      if (file == null || !file.exists() || file.length() <= 0L || pageCount <= 0) {
        fail(ERROR_EMPTY_OUTPUT, "Native worksheet PDF output is empty.", null)
        return
      }
      if (!completed.compareAndSet(false, true)) {
        return
      }
      keepOutput.set(true)
      timeoutFuture?.cancel(false)
      markStage(
        STAGE_COMPLETED,
        pageCount = pageCount,
        outputBytes = file.length(),
      )
      promise.resolve(
        Arguments.createMap().apply {
          putString("uri", Uri.fromFile(file).toString())
          putInt("numberOfPages", pageCount)
        },
      )
    }

    private fun fail(
      code: String,
      message: String,
      error: Throwable?,
      terminalStage: String = STAGE_FAILED,
      blockedStage: String? = currentStage,
    ) {
      if (!completed.compareAndSet(false, true)) {
        return
      }
      timeoutFuture?.cancel(false)
      markStage(
        terminalStage,
        level = if (terminalStage == STAGE_TIMEOUT) LOG_LEVEL_WARN else LOG_LEVEL_ERROR,
        message = message,
        blockedStage = blockedStage,
      )
      if (error == null) {
        promise.reject(code, message)
      } else {
        promise.reject(code, message, error)
      }
    }

    private fun checkNotCancelled() {
      if (cancelled.get() || Thread.currentThread().isInterrupted) {
        throw InterruptedException("Worksheet PDF job was cancelled.")
      }
    }

    private fun drawQuestionPage(
      document: PdfDocument,
      pageNumber: Int,
      item: WorksheetItem,
      questionNumber: Int,
      bitmap: Bitmap?,
      singlePage: Boolean,
    ): Int {
      val page = document.startPage(
        PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNumber).create(),
      )
      try {
        val canvas = page.canvas
        drawPageBackground(canvas)
        var y = drawHeader(
          canvas = canvas,
          item = item,
          questionNumber = questionNumber,
          pageLabel = if (singlePage) null else "题目页",
        )
        y += 8f
        drawText(canvas, "我的题目：", MARGIN, y, BODY_TEXT_SIZE, Color.DKGRAY, true)
        y += 12f

        val answerBottom = if (singlePage) RESULT_AREA_TOP - 18f else PAGE_HEIGHT - 128f
        val imageBottomLimit = if (singlePage) min(y + SINGLE_PAGE_IMAGE_MAX_HEIGHT, answerBottom - 92f)
        else min(y + QUESTION_PAGE_IMAGE_MAX_HEIGHT, answerBottom - 56f)
        val imageBottom = drawQuestionImage(
          canvas = canvas,
          bitmap = bitmap,
          top = y,
          maxBottom = imageBottomLimit,
        )
        val answerTop = max(imageBottom + 18f, y + 42f)
        if (singlePage) {
          drawAnswerLines(
            canvas = canvas,
            title = "我的解答：",
            top = answerTop,
            bottom = RESULT_AREA_TOP - 12f,
          )
          drawResultArea(canvas)
          drawFooter(canvas, "优先保证题图清晰")
        } else {
          drawAnswerLines(
            canvas = canvas,
            title = "我的思路：",
            top = answerTop,
            bottom = PAGE_HEIGHT - 55f,
          )
          drawFooter(canvas, "解答区在下一页")
        }
      } finally {
        document.finishPage(page)
      }
      return 1
    }

    private fun drawAnswerPage(
      document: PdfDocument,
      pageNumber: Int,
      item: WorksheetItem,
      questionNumber: Int,
    ): Int {
      val page = document.startPage(
        PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNumber).create(),
      )
      try {
        val canvas = page.canvas
        drawPageBackground(canvas)
        val y = drawHeader(
          canvas = canvas,
          item = item,
          questionNumber = questionNumber,
          pageLabel = "解答页",
        )
        drawAnswerLines(
          canvas = canvas,
          title = "我的解答：",
          top = y + 18f,
          bottom = RESULT_AREA_TOP - 12f,
        )
        drawResultArea(canvas)
      } finally {
        document.finishPage(page)
      }
      return 1
    }

    private fun drawPageBackground(canvas: Canvas) {
      canvas.drawColor(Color.WHITE)
    }

    private fun drawHeader(
      canvas: Canvas,
      item: WorksheetItem,
      questionNumber: Int,
      pageLabel: String?,
    ): Float {
      var y = MARGIN + 20f
      drawText(
        canvas,
        "第 $questionNumber 题",
        MARGIN,
        y,
        TITLE_TEXT_SIZE,
        Color.rgb(28, 28, 30),
        true,
      )
      if (!pageLabel.isNullOrEmpty()) {
        drawText(
          canvas,
          pageLabel,
          MARGIN + 92f,
          y,
          SMALL_TEXT_SIZE,
          Color.rgb(92, 92, 92),
          true,
        )
      }
      drawText(
        canvas,
        "${request.date} · ${request.totalQuestionCount} 题",
        MARGIN,
        y + 20f,
        SMALL_TEXT_SIZE,
        Color.GRAY,
        false,
      )
      drawQrBadge(canvas)

      y += 46f
      val metaWidth = PAGE_WIDTH - MARGIN * 2f - QR_BADGE_WIDTH - 12f
      y = drawWrappedText(
        canvas,
        "模块：${item.module}",
        MARGIN,
        y,
        metaWidth,
        META_TEXT_SIZE,
        Color.DKGRAY,
        2,
      )
      y = drawWrappedText(
        canvas,
        "标题：${item.title}",
        MARGIN,
        y + 2f,
        metaWidth,
        META_TEXT_SIZE,
        Color.DKGRAY,
        2,
      )
      val detail = "进度：${item.progress}    难度：${item.difficulty}    到期日：${item.dueDate}"
      y = drawWrappedText(
        canvas,
        detail,
        MARGIN,
        y + 2f,
        PAGE_WIDTH - MARGIN * 2f,
        META_TEXT_SIZE,
        Color.DKGRAY,
        2,
      )
      val dividerY = y + 7f
      val dividerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(224, 224, 224)
        strokeWidth = 1f
      }
      canvas.drawLine(MARGIN, dividerY, PAGE_WIDTH - MARGIN, dividerY, dividerPaint)
      return dividerY + 10f
    }

    private fun drawQrBadge(canvas: Canvas) {
      if (request.qrSize <= 0 || request.qrCells.isEmpty()) {
        return
      }
      val qrLeft = PAGE_WIDTH - MARGIN - QR_SIZE
      val qrTop = MARGIN - 10f
      val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(225, 225, 225)
        style = Paint.Style.STROKE
        strokeWidth = 1f
      }
      canvas.drawRect(
        qrLeft - 4f,
        qrTop - 4f,
        qrLeft + QR_SIZE + 4f,
        qrTop + QR_SIZE + 18f,
        borderPaint,
      )
      val cellSize = QR_SIZE / (request.qrSize + QR_QUIET_ZONE * 2f)
      val qrPaint = Paint().apply {
        color = Color.BLACK
        style = Paint.Style.FILL
      }
      for (row in 0 until request.qrSize) {
        for (column in 0 until request.qrSize) {
          if (!request.qrCells[row * request.qrSize + column]) {
            continue
          }
          val left = qrLeft + (column + QR_QUIET_ZONE) * cellSize
          val top = qrTop + (row + QR_QUIET_ZONE) * cellSize
          canvas.drawRect(left, top, left + cellSize + 0.2f, top + cellSize + 0.2f, qrPaint)
        }
      }
      drawText(
        canvas,
        "扫码回填",
        qrLeft + QR_SIZE / 2f,
        qrTop + QR_SIZE + 12f,
        7f,
        Color.DKGRAY,
        true,
        Paint.Align.CENTER,
      )
    }

    private fun drawQuestionImage(
      canvas: Canvas,
      bitmap: Bitmap?,
      top: Float,
      maxBottom: Float,
    ): Float {
      val availableHeight = max(24f, maxBottom - top)
      if (bitmap == null || bitmap.width <= 0 || bitmap.height <= 0) {
        val placeholderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.rgb(248, 248, 248)
          style = Paint.Style.FILL
        }
        val placeholderBorder = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.rgb(220, 220, 220)
          style = Paint.Style.STROKE
          strokeWidth = 1f
        }
        val box = RectF(MARGIN, top, PAGE_WIDTH - MARGIN, min(maxBottom, top + 74f))
        canvas.drawRect(box, placeholderPaint)
        canvas.drawRect(box, placeholderBorder)
        drawText(
          canvas,
          "题目图片暂时无法加载",
          PAGE_WIDTH / 2f,
          box.centerY() + 4f,
          BODY_TEXT_SIZE,
          Color.GRAY,
          false,
          Paint.Align.CENTER,
        )
        return box.bottom
      }

      val widthScale = CONTENT_WIDTH / bitmap.width.toFloat()
      val heightScale = availableHeight / bitmap.height.toFloat()
      val scale = min(widthScale, heightScale)
      val drawWidth = max(1f, bitmap.width * scale)
      val drawHeight = max(1f, bitmap.height * scale)
      val left = (PAGE_WIDTH - drawWidth) / 2f
      val target = RectF(left, top, left + drawWidth, top + drawHeight)
      val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
      canvas.drawBitmap(bitmap, null, target, bitmapPaint)
      val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(210, 210, 210)
        style = Paint.Style.STROKE
        strokeWidth = 0.8f
      }
      canvas.drawRect(target, borderPaint)
      return target.bottom
    }

    private fun drawAnswerLines(
      canvas: Canvas,
      title: String,
      top: Float,
      bottom: Float,
    ) {
      val safeTop = min(top, bottom - 26f)
      drawText(canvas, title, MARGIN, safeTop, BODY_TEXT_SIZE, Color.DKGRAY, true)
      val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(205, 205, 205)
        strokeWidth = 0.8f
      }
      var lineY = safeTop + 24f
      while (lineY <= bottom) {
        canvas.drawLine(MARGIN, lineY, PAGE_WIDTH - MARGIN, lineY, linePaint)
        lineY += 24f
      }
    }

    private fun drawResultArea(canvas: Canvas) {
      val titleY = RESULT_AREA_TOP + 12f
      drawText(canvas, "本次结果：", MARGIN, titleY, BODY_TEXT_SIZE, Color.DKGRAY, true)
      var x = MARGIN + 92f
      for (label in listOf("会了", "模糊", "不会")) {
        val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.rgb(100, 100, 100)
          style = Paint.Style.STROKE
          strokeWidth = 1.2f
        }
        canvas.drawRect(x, titleY - 11f, x + 13f, titleY + 2f, boxPaint)
        drawText(canvas, label, x + 20f, titleY, BODY_TEXT_SIZE, Color.DKGRAY, false)
        x += 94f
      }
    }

    private fun drawFooter(canvas: Canvas, text: String) {
      drawText(
        canvas,
        text,
        PAGE_WIDTH / 2f,
        PAGE_HEIGHT - 20f,
        SMALL_TEXT_SIZE,
        Color.GRAY,
        false,
        Paint.Align.CENTER,
      )
    }

    private fun drawText(
      canvas: Canvas,
      text: String,
      x: Float,
      y: Float,
      textSize: Float,
      color: Int,
      bold: Boolean,
      align: Paint.Align = Paint.Align.LEFT,
    ) {
      val paint = createTextPaint(textSize, color, bold, align)
      canvas.drawText(text, x, y, paint)
    }

    private fun drawWrappedText(
      canvas: Canvas,
      text: String,
      x: Float,
      firstBaseline: Float,
      maxWidth: Float,
      textSize: Float,
      color: Int,
      maxLines: Int,
    ): Float {
      val paint = createTextPaint(textSize, color, false, Paint.Align.LEFT)
      val lineHeight = textSize * 1.45f
      var remaining = text
      var baseline = firstBaseline
      var lines = 0
      while (remaining.isNotEmpty() && lines < maxLines) {
        var count = paint.breakText(remaining, true, maxWidth, null).coerceAtLeast(1)
        if (count < remaining.length) {
          val preferredBreak = remaining.substring(0, count).lastIndexOfAny(charArrayOf(' ', '，', '、'))
          if (preferredBreak > count / 2) {
            count = preferredBreak + 1
          }
        }
        var line = remaining.substring(0, min(count, remaining.length)).trim()
        remaining = remaining.substring(min(count, remaining.length)).trimStart()
        lines += 1
        if (lines == maxLines && remaining.isNotEmpty()) {
          while (line.isNotEmpty() && paint.measureText("$line…") > maxWidth) {
            line = line.dropLast(1)
          }
          line += "…"
          remaining = ""
        }
        canvas.drawText(line, x, baseline, paint)
        baseline += lineHeight
      }
      return baseline
    }

    private fun createTextPaint(
      textSize: Float,
      color: Int,
      bold: Boolean,
      align: Paint.Align,
    ): Paint {
      return Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.textSize = textSize
        this.color = color
        textAlign = align
        typeface = if (bold) Typeface.create(Typeface.DEFAULT, Typeface.BOLD) else Typeface.DEFAULT
      }
    }

    private fun decodeBestBitmap(item: WorksheetItem, questionNumber: Int): Bitmap? {
      val candidates = listOfNotNull(item.imageUri, item.fallbackImageUri).distinct()
      for (candidate in candidates) {
        checkNotCancelled()
        val bitmap = decodeSampledBitmap(candidate)
        if (bitmap != null) {
          return bitmap
        }
        Log.w(LOG_TAG, "Unable to decode worksheet image: ${safeUriPreview(candidate)}")
      }
      if (candidates.isNotEmpty()) {
        markStage(
          STAGE_ITEM_IMAGE_UNAVAILABLE,
          level = LOG_LEVEL_WARN,
          itemNumber = questionNumber,
          message = "Unable to decode all ${candidates.size} local image candidate(s).",
        )
      }
      return null
    }

    private fun decodeSampledBitmap(uriText: String): Bitmap? {
      val bounds = BitmapFactory.Options().apply {
        inJustDecodeBounds = true
      }
      decodeBitmapWithOptions(uriText, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        return null
      }

      var sampleSize = 1
      while (
        bounds.outWidth / sampleSize > MAX_BITMAP_DIMENSION
        || bounds.outHeight / sampleSize > MAX_BITMAP_DIMENSION
      ) {
        sampleSize *= 2
      }
      val options = BitmapFactory.Options().apply {
        inSampleSize = sampleSize
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      return decodeBitmapWithOptions(uriText, options)
    }

    private fun decodeBitmapWithOptions(
      uriText: String,
      options: BitmapFactory.Options,
    ): Bitmap? {
      return try {
        val uri = Uri.parse(uriText)
        when (uri.scheme?.lowercase()) {
          // Decode app-private files by their absolute path. This is more
          // reliable than streaming `file://` URIs on recent Android versions
          // and matches the path used by the image-enhancement native module.
          "file" -> {
            val path = uri.path ?: return null
            val file = File(path)
            if (!file.isFile) {
              Log.w(LOG_TAG, "Worksheet image file does not exist: ${safeUriPreview(uriText)}")
              null
            } else {
              BitmapFactory.decodeFile(file.absolutePath, options)
            }
          }

          null, "" -> {
            val file = File(uriText)
            if (!file.isFile) {
              Log.w(LOG_TAG, "Worksheet image path does not exist: ${safeUriPreview(uriText)}")
              null
            } else {
              BitmapFactory.decodeFile(file.absolutePath, options)
            }
          }

          else -> reactContext.contentResolver.openInputStream(uri)?.use { stream ->
            BitmapFactory.decodeStream(stream, null, options)
          }
        }
      } catch (error: Throwable) {
        Log.w(LOG_TAG, "Unable to decode worksheet image: ${safeUriPreview(uriText)}", error)
        null
      }
    }

    private fun resolveImageRatio(item: WorksheetItem, bitmap: Bitmap?): Float {
      val width = bitmap?.width ?: item.imageWidth
      val height = bitmap?.height ?: item.imageHeight
      if (width <= 0 || height <= 0) {
        return 0.72f
      }
      return (height.toFloat() / width.toFloat()).coerceIn(0.1f, 8f)
    }

    private fun safeUriPreview(uri: String): String {
      return if (uri.length <= 72) uri else "${uri.take(28)}...${uri.takeLast(24)}"
    }

    private fun markStage(
      stage: String,
      level: String = LOG_LEVEL_INFO,
      message: String? = null,
      itemNumber: Int? = null,
      pageCount: Int? = null,
      outputBytes: Long? = null,
      blockedStage: String? = null,
    ) {
      currentStage = stage
      val elapsedMs = (System.currentTimeMillis() - startedAt).coerceAtLeast(0L)
      val logMessage = buildString {
        append("requestId=")
        append(request.requestId)
        append(" stage=")
        append(stage)
        append(" elapsedMs=")
        append(elapsedMs)
        itemNumber?.let {
          append(" itemNumber=")
          append(it)
        }
        pageCount?.let {
          append(" pageCount=")
          append(it)
        }
        message?.let {
          append(" message=")
          append(it)
        }
      }
      when (level) {
        LOG_LEVEL_WARN -> Log.w(LOG_TAG, logMessage)
        LOG_LEVEL_ERROR -> Log.e(LOG_TAG, logMessage)
        else -> Log.i(LOG_TAG, logMessage)
      }

      if (!reactContext.hasActiveReactInstance()) {
        return
      }
      try {
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(
            EVENT_STAGE,
            Arguments.createMap().apply {
              putString("requestId", request.requestId)
              putString("stage", stage)
              putString("level", level)
              putDouble("elapsedMs", elapsedMs.toDouble())
              putDouble("timeoutMs", request.timeoutMs.toDouble())
              putInt("itemCount", request.items.size)
              message?.let { putString("message", it) }
              itemNumber?.let { putInt("itemNumber", it) }
              pageCount?.let { putInt("pageCount", it) }
              outputBytes?.let { putDouble("outputBytes", it.toDouble()) }
              blockedStage?.let { putString("blockedStage", it) }
            },
          )
      } catch (error: Throwable) {
        Log.w(LOG_TAG, "Unable to emit native worksheet PDF stage.", error)
      }
    }
  }

  private fun ReadableMap.getStringOrNull(key: String): String? {
    return if (hasKey(key) && !isNull(key)) getString(key) else null
  }

  private fun ReadableMap.getArrayOrNull(key: String): ReadableArray? {
    return if (hasKey(key) && !isNull(key)) getArray(key) else null
  }

  private fun ReadableMap.getIntOrDefault(key: String, fallback: Int): Int {
    return if (hasKey(key) && !isNull(key)) floor(getDouble(key)).toInt() else fallback
  }

  private fun ReadableMap.getLongOrDefault(key: String, fallback: Long): Long {
    return if (hasKey(key) && !isNull(key)) getDouble(key).toLong() else fallback
  }

  companion object {
    private const val MODULE_NAME = "QishuaWorksheetPdfModule"
    private const val EVENT_STAGE = "QishuaWorksheetPdfStage"
    private const val LOG_TAG = "QishuaWorksheetPdf"

    private const val PAGE_WIDTH = 595
    private const val PAGE_HEIGHT = 842
    private const val MARGIN = 34f
    private const val CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2f
    private const val SINGLE_PAGE_IMAGE_MAX_HEIGHT = 300f
    private const val QUESTION_PAGE_IMAGE_MAX_HEIGHT = 500f
    private const val RESULT_AREA_TOP = 760f
    private const val QR_SIZE = 66f
    private const val QR_BADGE_WIDTH = 74f
    private const val QR_QUIET_ZONE = 2
    private const val TITLE_TEXT_SIZE = 18f
    private const val BODY_TEXT_SIZE = 11f
    private const val META_TEXT_SIZE = 9f
    private const val SMALL_TEXT_SIZE = 8f
    private const val MAX_BITMAP_DIMENSION = 2400
    private const val MIN_QR_SIZE = 21
    private const val MAX_QR_SIZE = 177

    private const val DEFAULT_TIMEOUT_MS = 120_000L
    private const val MIN_TIMEOUT_MS = 10_000L
    private const val MAX_TIMEOUT_MS = 600_000L

    private const val LOG_LEVEL_INFO = "info"
    private const val LOG_LEVEL_WARN = "warn"
    private const val LOG_LEVEL_ERROR = "error"

    private const val STAGE_CREATED = "native_worksheet_pdf_created"
    private const val STAGE_JOB_STARTED = "native_worksheet_pdf_job_started"
    private const val STAGE_DOCUMENT_CREATED = "native_worksheet_pdf_document_created"
    private const val STAGE_ITEM_STARTED = "native_worksheet_pdf_item_started"
    private const val STAGE_ITEM_IMAGE_UNAVAILABLE = "native_worksheet_pdf_item_image_unavailable"
    private const val STAGE_ITEM_FINISHED = "native_worksheet_pdf_item_finished"
    private const val STAGE_WRITE_STARTED = "native_worksheet_pdf_write_started"
    private const val STAGE_WRITE_FINISHED = "native_worksheet_pdf_write_finished"
    private const val STAGE_COMPLETED = "native_worksheet_pdf_completed"
    private const val STAGE_TIMEOUT = "native_worksheet_pdf_timeout"
    private const val STAGE_FAILED = "native_worksheet_pdf_failed"

    private const val ERROR_INVALID_REQUEST = "ERR_QISHUA_WORKSHEET_PDF_INVALID_REQUEST"
    private const val ERROR_BUSY = "ERR_QISHUA_WORKSHEET_PDF_BUSY"
    private const val ERROR_TIMEOUT = "ERR_QISHUA_WORKSHEET_PDF_TIMEOUT"
    private const val ERROR_RENDER_FAILED = "ERR_QISHUA_WORKSHEET_PDF_RENDER"
    private const val ERROR_EMPTY_OUTPUT = "ERR_QISHUA_WORKSHEET_PDF_EMPTY_OUTPUT"
  }
}

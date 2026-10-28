package expo.modules.localpdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import io.legere.pdfiumandroid.PdfiumCore
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

object PdfExtractor {
  private data class CellText(val text: String, val confidence: Float, val box: RectF)
  private fun cellText(result: Text): List<CellText> = result.textBlocks.flatMap { it.lines }.flatMap { it.elements }.mapNotNull {
    val box = it.boundingBox ?: return@mapNotNull null
    CellText(it.text, it.confidence, RectF(box))
  }
  private fun isolatedCell(bitmap: Bitmap, recognizer: TextRecognizer): List<CellText> {
    val pixels = IntArray(bitmap.width*bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    var left = bitmap.width; var top = bitmap.height; var right = -1; var bottom = -1
    for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
      val pixel = pixels[y*bitmap.width+x]
      if (max(Color.red(pixel),max(Color.green(pixel),Color.blue(pixel))) < 160) {
        left = min(left,x); top = min(top,y); right = max(right,x); bottom = max(bottom,y)
      }
    }
    if (right < left || bottom < top) return emptyList()
    val ink = Rect(left,top,right+1,bottom+1)
    for (targetHeight in listOf(64f,48f,96f)) {
      val scale = min(targetHeight/ink.height(),1200f/ink.width())
      val dx = (1600-ink.width()*scale)/2; val dy = (900-ink.height()*scale)/2
      val normalized = Bitmap.createBitmap(1600,900,Bitmap.Config.ARGB_8888)
      try {
        normalized.eraseColor(Color.WHITE)
        Canvas(normalized).drawBitmap(bitmap,ink,RectF(dx,dy,dx+ink.width()*scale,dy+ink.height()*scale),Paint(Paint.FILTER_BITMAP_FLAG))
        val cells = cellText(Tasks.await(recognizer.process(InputImage.fromBitmap(normalized,0))))
        if (!cells.joinToString("") { it.text }.matches(Regex("^[<>≤≥]?[+-]?[0-9]+(?:\\.[0-9]+)?$"))) continue
        return cells.map { cell -> cell.copy(box = RectF(
          left+(cell.box.left-dx)/scale,top+(cell.box.top-dy)/scale,
          left+(cell.box.right-dx)/scale,top+(cell.box.bottom-dy)/scale)) }
      } finally { normalized.recycle() }
    }
    return emptyList()
  }

  fun recognizeRegions(context: Context, file: File, regions: List<Map<String, Any>>): List<Map<String, Any>> {
    require(regions.size <= 12) { "INVALID_REGIONS" }
    val started = System.nanoTime()
    val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
    try {
      PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
        require(pdf.pageCount in 1..50) { "INVALID_PAGE_COUNT" }
        return regions.map { region ->
          require(System.nanoTime() - started < 30_000_000_000L) { "PDF_TIMEOUT" }
          val index = (region["pageIndex"] as Number).toInt()
          val rect = region["rect"] as Map<*, *>
          val x = (rect["x"] as Number).toDouble(); val y = (rect["y"] as Number).toDouble()
          val width = (rect["width"] as Number).toDouble(); val height = (rect["height"] as Number).toDouble()
          require(index in 0 until pdf.pageCount && listOf(x,y,width,height).all { it.isFinite() } &&
            x >= 0 && y >= 0 && width > 0 && height > 0 && width <= 0.3 && height <= 0.08 && x+width <= 1 && y+height <= 1) { "INVALID_REGIONS" }
          pdf.openPage(index).use { page ->
            val base = min(3200.0 / max(page.width, page.height), 4.0)
            val scale = min(base * 4, 1800.0 / max(page.width * width, page.height * height))
            val w = max(1, (page.width * width * scale).toInt())
            val h = max(1, (page.height * height * scale).toInt())
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            try {
              bitmap.eraseColor(Color.WHITE)
              val matrix = Matrix().apply {
                setScale(scale.toFloat(), scale.toFloat())
                postTranslate((-page.width*x*scale).toFloat(), (-page.height*y*scale).toFloat())
              }
              page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
              val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
              val first = cellText(result)
              val cells = if (first.isEmpty()) isolatedCell(bitmap,recognizer) else first
              val spans = cells.map { element ->
                val box = element.box
                mapOf("text" to element.text, "confidence" to element.confidence, "rect" to mapOf(
                  "x" to x + box.left.toDouble()/scale/page.width,
                  "y" to y + box.top.toDouble()/scale/page.height,
                  "width" to box.width().toDouble()/scale/page.width,
                  "height" to box.height().toDouble()/scale/page.height))
              }
              require(spans.sumOf { (it["text"] as String).length } <= 200) { "PAGE_TOO_COMPLEX" }
              mapOf("pageIndex" to index, "rect" to rect, "spans" to spans)
            } finally { bitmap.recycle() }
          }
        }
      }
    } finally { recognizer.close() }
  }

  fun extract(context: Context, file: File): Map<String, Any> {
    val started = System.nanoTime()
    var total = 0
    fun budget() { require(System.nanoTime() - started < 120_000_000_000L) { "PDF_TIMEOUT" } }
    val recognizer by lazy { TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build()) }
    // Only allocate the recognizer for documents that actually need OCR.
    var usedOCR = false
    try {
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfiumCore(context).newDocument(fd).use { document ->
          val count = document.getPageCount()
          require(count in 1..50) { "INVALID_PAGE_COUNT" }
          val pages = (0 until count).map { index ->
            budget()
            var width = 0.0
            var height = 0.0
            var rotation = 0
            val spans = mutableListOf<Map<String, Any>>()
            val numericSpans = mutableListOf<Map<String, Any>>()
            val tableSpans = mutableListOf<Map<String, Any>>()
            val readingLines = mutableListOf<Map<String, Any>>()
            val textValue = StringBuilder()
            document.openPage(index).use { page ->
              width = page.getPageWidthPoint().toDouble()
              height = page.getPageHeightPoint().toDouble()
              rotation = page.getPageRotation()
              require(width > 0 && height > 0) { "INVALID_PAGE" }
              if (rotation == 0) page.openTextPage().use { text ->
                val n = text.textPageCountChars()
                require(n <= 20000) { "PAGE_TOO_COMPLEX" }
                for (i in 0 until n) {
                  if (i % 100 == 0) budget()
                  val value = text.textPageGetText(i, 1) ?: continue
                  textValue.append(value)
                  val b = text.textPageGetCharBox(i) ?: continue
                  if (value.isEmpty()) continue
                  spans.add(mapOf("text" to value, "rect" to mapOf("x" to min(b.left,b.right)/width, "y" to (height-max(b.top,b.bottom))/height, "width" to abs(b.right-b.left)/width, "height" to abs(b.top-b.bottom)/height)))
                }
              }
            }
            val useful = textValue.count { !it.isWhitespace() && it != '\uFFFD' }
            val bad = textValue.count { it == '\uFFFD' }
            val needsOCR = useful < 30 || bad * 20 > max(textValue.length, 1) || rotation != 0
            if (needsOCR) {
              usedOCR = true
              spans.clear()
              PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
                pdf.openPage(index).use { page ->
                  val scale = min(3200.0 / max(page.width, page.height), 4.0)
                  val w = max(1, (page.width*scale).toInt())
                  val h = max(1, (page.height*scale).toInt())
                  val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                  try {
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    fun append(result: Text, top: Int, target: MutableList<Map<String, Any>>, part: Int = -1, imageWidth: Int = w, imageHeight: Int = h, keepLines: Boolean = false) {
                      for (block in result.textBlocks) for (line in block.lines) {
                        val lineBox = line.boundingBox ?: continue
                        val center = (top + lineBox.exactCenterY()) / h
                        if ((part == 0 && center >= 0.5) || (part == 1 && center < 0.5)) continue
                        if (keepLines) readingLines.add(mapOf("text" to line.text, "rect" to mapOf("x" to lineBox.left.toDouble()/imageWidth, "y" to (top+lineBox.top).toDouble()/imageHeight, "width" to lineBox.width().toDouble()/imageWidth, "height" to lineBox.height().toDouble()/imageHeight)))
                        for (element in line.elements) {
                          if (element.symbols.isNotEmpty()) for (symbol in element.symbols) {
                            val b = symbol.boundingBox ?: continue
                            target.add(mapOf("text" to symbol.text, "confidence" to symbol.confidence, "rect" to mapOf("x" to b.left.toDouble()/imageWidth, "y" to (top+b.top).toDouble()/imageHeight, "width" to b.width().toDouble()/imageWidth, "height" to b.height().toDouble()/imageHeight)))
                          } else {
                            val b = element.boundingBox ?: continue
                            target.add(mapOf("text" to element.text, "confidence" to element.confidence, "rect" to mapOf("x" to b.left.toDouble()/imageWidth, "y" to (top+b.top).toDouble()/imageHeight, "width" to b.width().toDouble()/imageWidth, "height" to b.height().toDouble()/imageHeight)))
                          }
                        }
                      }
                    }
                    append(Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))), 0, spans, keepLines = true)
                    // A second tiled pass offers an independent read of small cells.
                    // The parser flags disagreements rather than silently replacing values.
                    for (part in 0..1) {
                      budget()
                      val top = if (part == 0) 0 else (h * 0.45).toInt()
                      val tileHeight = if (part == 0) (h * 0.55).toInt() else h - top
                      val tile = Bitmap.createBitmap(bitmap, 0, top, w, tileHeight)
                      try {
                        append(Tasks.await(recognizer.process(InputImage.fromBitmap(tile, 0))), top, numericSpans, part)
                      } finally { tile.recycle() }
                    }
                    budget()
                    val ratio = min(1.0, 1400.0 / max(w,h))
                    val smaller = Bitmap.createScaledBitmap(bitmap, max(1,(w*ratio).toInt()), max(1,(h*ratio).toInt()), true)
                    try {
                      append(Tasks.await(recognizer.process(InputImage.fromBitmap(smaller, 0))), 0, tableSpans, imageWidth = smaller.width, imageHeight = smaller.height)
                    } catch (_: Exception) {
                      // The optional alternate-scale pass must not discard a successful primary read.
                    } finally { if (smaller !== bitmap) smaller.recycle() }
                  } finally { bitmap.recycle() }
                }
              }
            }
            total += (spans + numericSpans + tableSpans).sumOf { (it["text"] as String).length }
            require(spans.size + numericSpans.size + tableSpans.size <= 20000 && total <= 100000) { "PAGE_TOO_COMPLEX" }
            budget()
            mapOf("pageIndex" to index, "width" to width, "height" to height, "spans" to spans, "readingLines" to readingLines, "numericSpans" to numericSpans, "tableSpans" to tableSpans, "extractionMethod" to if (needsOCR) "ocr" else "text")
          }
          return mapOf("pageCount" to count, "pages" to pages)
        }
      }
    } finally { if (usedOCR) recognizer.close() }
  }
}

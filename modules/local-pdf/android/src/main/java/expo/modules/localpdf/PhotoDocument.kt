package expo.modules.localpdf

import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

object PhotoDocument {
  // The image editor normalizes EXIF rotation before this bounded decode.
  fun write(source: File, target: File) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    require(bounds.outWidth in 1..3200 && bounds.outHeight in 1..3200) { "INVALID_REPORT_IMAGE" }
    val bitmap = requireNotNull(BitmapFactory.decodeFile(source.path)) { "INVALID_REPORT_IMAGE" }
    try {
      val scale = 800.0 / max(bitmap.width, bitmap.height)
      val width = (bitmap.width * scale).roundToInt().coerceAtLeast(1)
      val height = (bitmap.height * scale).roundToInt().coerceAtLeast(1)
      val pdf = PdfDocument()
      try {
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(width, height, 1).create())
        page.canvas.drawColor(Color.WHITE)
        page.canvas.drawBitmap(bitmap, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))
        pdf.finishPage(page)
        target.outputStream().use { pdf.writeTo(it) }
      } finally { pdf.close() }
    } catch (error: Exception) {
      target.delete()
      throw error
    } finally { bitmap.recycle() }
  }
}

package expo.modules.localpdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

object PdfRegionRenderer {
  fun render(file: File, index: Int, rect: Map<String, Double>, target: File): Map<String, Int> {
    val x = requireNotNull(rect["x"]); val y = requireNotNull(rect["y"])
    val width = requireNotNull(rect["width"]); val height = requireNotNull(rect["height"])
    require(listOf(x,y,width,height).all { it.isFinite() } && x >= 0 && y >= 0 &&
      width > 0 && height > 0 && x+width <= 1.000001 && y+height <= 1.000001) { "INVALID_REGION" }
    PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
      require(index in 0 until min(pdf.pageCount, 50)) { "INVALID_PAGE" }
      pdf.openPage(index).use { page ->
        val scale = min(6.0, 2200.0 / max(page.width*width, page.height*height))
        val w = max(1, ceil(page.width*width*scale).toInt())
        val h = max(1, ceil(page.height*height*scale).toInt())
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        try {
          bitmap.eraseColor(Color.WHITE)
          val matrix = Matrix().apply {
            setScale(scale.toFloat(), scale.toFloat())
            postTranslate((-page.width*x*scale).toFloat(), (-page.height*y*scale).toFloat())
          }
          page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
          target.outputStream().use { require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
          return mapOf("width" to w, "height" to h)
        } catch (e: Exception) { target.delete(); throw e }
        finally { bitmap.recycle() }
      }
    }
  }
}

package expo.modules.localpdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PhotoDocumentTest {
  @Test fun imageDocumentKeepsPixelsAndUsesLocalOCR() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val dir = File(context.cacheDir, UUID.randomUUID().toString()).apply { mkdirs() }
    try {
      val original = File(dir, "sample.pdf")
      instrumentation.context.assets.open("sample-first.pdf").use { input -> original.outputStream().use { input.copyTo(it) } }
      val photo = File(dir, "photo.jpg")
      PdfRenderer(ParcelFileDescriptor.open(original, ParcelFileDescriptor.MODE_READ_ONLY)).use { renderer ->
        renderer.openPage(0).use { page ->
          val bitmap = Bitmap.createBitmap(2000, 2588, Bitmap.Config.ARGB_8888)
          try {
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
            photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 100, it) }
          } finally { bitmap.recycle() }
        }
      }
      val target = File(dir, "photo.pdf")
      PhotoDocument.write(photo, target)
      val extracted = PdfExtractor.extract(context, target)
      File(context.filesDir, "photo-extraction-android.json").writeText(org.json.JSONObject(extracted).toString())
      val parsed = (extracted["pages"] as List<*>).single() as Map<*, *>
      assertEquals("ocr", parsed["extractionMethod"])
      val text = (parsed["spans"] as List<*>).joinToString("") { (it as Map<*, *>)["text"].toString() }
      assertTrue(text, text.contains("ALT")); assertTrue(text, text.contains("100")); assertTrue(text, text.contains("5.4"))
    } finally { dir.deleteRecursively() }
  }
  @Test fun invalidImageCannotCreateAnEmptyDocument() {
    val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, UUID.randomUUID().toString()).apply { mkdirs() }
    try {
      val source = File(dir, "invalid.jpg").apply { writeText("not an image") }
      val target = File(dir, "out.pdf")
      assertThrows(IllegalArgumentException::class.java) { PhotoDocument.write(source, target) }
      assertFalse(target.exists())
    } finally { dir.deleteRecursively() }
  }
}

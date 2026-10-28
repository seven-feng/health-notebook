package expo.modules.localpdf

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.json.JSONObject
import java.io.File

/** Opt-in local fixtures only. Neither originals nor output enter the app APK. */
@RunWith(AndroidJUnit4::class)
class ComplexDocumentTest {
  @Test fun extractDocument() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val assets = instrumentation.context.assets
    val context = instrumentation.targetContext
    assumeTrue(assets.list("")!!.contains("complex-document.pdf"))
    val file = File(context.cacheDir, "complex-document-test.pdf")
    assets.open("complex-document.pdf").use { input -> file.outputStream().use { input.copyTo(it) } }
    try {
      val started = System.currentTimeMillis()
      val result = JSONObject(PdfExtractor.extract(context, file))
      assertTrue(result.getJSONArray("pages").length() > 1)
      result.put("elapsedMs", System.currentTimeMillis() - started)
      File(context.filesDir, "complex-document-android.json").writeText(result.toString())
    } finally { file.delete() }
  }
}

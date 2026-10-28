package expo.modules.localpdf

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.json.JSONObject
import java.io.File

@RunWith(AndroidJUnit4::class)
class PublicReportOCRTest {
  @Test fun publicReportCorpus() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val testContext = instrumentation.context
    val context = instrumentation.targetContext
    val names = testContext.assets.list("")!!.filter { it.matches(Regex("^[0-9]{2}-.*\\.pdf$")) }.sorted()
    assumeTrue("Set DOCTOR_OCR_FIXTURES to a local corpus directory", names.isNotEmpty())
    for (name in names) {
      val file = File(context.cacheDir, "public-ocr-input.pdf")
      testContext.assets.open(name).use { input -> file.outputStream().use { input.copyTo(it) } }
      try {
        val started = System.currentTimeMillis()
        val result = JSONObject(PdfExtractor.extract(context, file))
        result.put("elapsedMs", System.currentTimeMillis() - started)
        assertEquals(1, result.getJSONArray("pages").length())
        assertEquals("ocr", result.getJSONArray("pages").getJSONObject(0).getString("extractionMethod"))
        File(context.filesDir, "public-android-${name.removeSuffix(".pdf")}.json").writeText(result.toString())
      } finally { file.delete() }
    }
  }
}

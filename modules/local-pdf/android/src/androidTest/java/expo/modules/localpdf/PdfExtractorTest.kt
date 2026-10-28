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
class PdfExtractorTest {
  @Test fun isolatedZeroAndNonzeroCellsWithoutInventingBlankValues() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val testContext = instrumentation.context
    val context = instrumentation.targetContext
    assumeTrue(testContext.assets.list("")?.contains("report-a.pdf") == true)
    val file = File(context.cacheDir, "ocr-cell-fixture.pdf")
    testContext.assets.open("report-a.pdf").use { input -> file.outputStream().use { input.copyTo(it) } }
    try {
      val regions = listOf(0.443, 0.427, 0.55).map { y ->
        mapOf("pageIndex" to 0, "rect" to mapOf("x" to 0.36, "y" to y, "width" to 0.15, "height" to 0.015))
      } + mapOf("pageIndex" to 0, "rect" to mapOf("x" to 0.36, "y" to 0.442578125, "width" to 0.15, "height" to 0.015734375))
      val result = PdfExtractor.recognizeRegions(context, file, regions)
      val texts = result.map { region -> (region["spans"] as List<*>).joinToString("") { (it as Map<*, *>)["text"] as String } }
      assertEquals(listOf("0", "9.9", "", "0"), texts)
      File(context.filesDir, "ocr-cells.json").writeText(org.json.JSONArray(listOf(result.last())).toString())
    } finally { file.delete() }
  }

  @Test fun privateReportsUseBundledChineseOCR() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val testContext = instrumentation.context
    val context = instrumentation.targetContext
    assumeTrue(testContext.assets.list("")?.contains("report-a.pdf") == true)
    for (name in listOf("a", "b")) {
      val file = File(context.cacheDir, "ocr-fixture-$name.pdf")
      testContext.assets.open("report-$name.pdf").use { input -> file.outputStream().use { input.copyTo(it) } }
      try {
        val result = PdfExtractor.extract(context, file)
        val pages = result["pages"] as List<*>
        assertEquals(1, pages.size)
        val page = pages.first() as Map<*, *>
        assertEquals("ocr", page["extractionMethod"])
        assertTrue((page["spans"] as List<*>).size > 100)
        File(context.filesDir, "ocr-$name.json").writeText(JSONObject(result).toString())
      } finally { file.delete() }
    }
  }
}

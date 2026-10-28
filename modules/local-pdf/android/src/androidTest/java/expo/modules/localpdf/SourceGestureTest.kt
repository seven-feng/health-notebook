package expo.modules.localpdf

import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiSelector
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

// Run .maestro/source-preview-ready.yaml first; only touches the synthetic draft.
@RunWith(AndroidJUnit4::class)
class SourceGestureTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val device = UiDevice.getInstance(instrumentation)
  private fun image() = device.findObject(UiSelector().resourceId("source-image-0"))
  private fun findNode(node: AccessibilityNodeInfo?, id: String): AccessibilityNodeInfo? {
    if (node == null) return null
    if (node.viewIdResourceName == id) return node
    for (i in 0 until node.childCount) {
      findNode(node.getChild(i), id)?.let { return it }
    }
    return null
  }
  private fun scale(): Float = findNode(instrumentation.uiAutomation.rootInActiveWindow, "source-image-0")?.rangeInfo?.current ?: -1f
  private fun waitForScale(test: (Float) -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + 4000
    while (!test(scale()) && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(50)
    assertTrue("Unexpected scale: ${scale()}", test(scale()))
  }
  private fun screenshot(): Bitmap {
    val bounds = image().visibleBounds
    val screen = instrumentation.uiAutomation.takeScreenshot()
    return Bitmap.createBitmap(screen, bounds.left, bounds.top, bounds.width(), bounds.height())
      .also { screen.recycle() }
  }

  @Test fun viewerPinchDragAndReturnToDraft() {
    if (!image().exists()) device.findObject(UiSelector().resourceId("source-toggle-0")).click()
    assertTrue(image().waitForExists(10000))
    assertTrue(image().contentDescription.contains("丙氨酸氨基转移酶"))
    assertEquals(100f, scale())
    val initialY = image().visibleBounds.centerY()
    assertTrue(image().pinchOut(65, 40))
    waitForScale { it > 150 }
    assertEquals("Pinch must not scroll the page", initialY, image().visibleBounds.centerY())
    val before = screenshot()
    val bounds = image().visibleBounds
    device.swipe(bounds.left + bounds.width() * 4 / 5, bounds.centerY(), bounds.left + bounds.width() / 5, bounds.centerY(), 35)
    val after = screenshot()
    assertFalse("Dragging must move the enlarged image", before.sameAs(after))
    assertEquals(initialY, image().visibleBounds.centerY())
    File(instrumentation.context.filesDir, "viewer-native-pinch.png").outputStream().use {
      after.compress(Bitmap.CompressFormat.PNG, 100, it)
    }
    before.recycle(); after.recycle()
    assertTrue(image().pinchIn(90, 50))
    waitForScale { it == 100f }
    repeat(2) {
      val tap = image().visibleBounds
      device.click(tap.centerX(), tap.centerY())
      SystemClock.sleep(80)
      device.click(tap.centerX(), tap.centerY())
      waitForScale { scale -> scale == if (it == 0) 300f else 100f }
      SystemClock.sleep(500)
    }
    device.findObject(UiSelector().resourceId("close-source-preview")).click()
    assertTrue(image().waitUntilGone(5000))
    assertEquals("79", device.findObject(UiSelector().resourceId("value-0")).text)
    val thumbnail = device.findObject(UiSelector().resourceId("source-toggle-0"))
    val thumbnailY = thumbnail.visibleBounds.centerY()
    thumbnail.click()
    assertTrue(image().waitForExists(5000))
    waitForScale { it == 100f }
    device.pressBack()
    assertTrue(image().waitUntilGone(5000))
    assertEquals(thumbnailY, thumbnail.visibleBounds.centerY())
  }
}

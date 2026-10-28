package expo.modules.localpdf

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlin.math.min

class LocalPdfModule : Module() {
  private fun context() = requireNotNull(appContext.reactContext)
  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "INVALID_FILE" }
    return File(requireNotNull(parsed.path))
  }
  private fun receive(intent: Intent?) {
    if (intent == null || intent.action !in listOf(Intent.ACTION_VIEW, Intent.ACTION_SEND)) return
    val uri = if (intent.action == Intent.ACTION_SEND) intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) else intent.data
    if (uri == null || intent.type != "application/pdf") return
    val dir = File(context().filesDir,"incoming").apply { mkdirs() }
    val target = File(dir,UUID.randomUUID().toString()+".pdf")
    try {
      context().contentResolver.openInputStream(uri).use { input ->
        requireNotNull(input)
        target.outputStream().use { output ->
          val buffer=ByteArray(65536); var size=0L
          while(true){val count=input.read(buffer);if(count<0)break;size+=count;require(size<=20*1024*1024){"FILE_TOO_LARGE"};output.write(buffer,0,count)}
        }
      }
      intent.removeExtra(Intent.EXTRA_STREAM); intent.data=null
    } catch (_: Exception) { target.delete() }
  }
  override fun definition() = ModuleDefinition {
    Name("LocalPdf")
    AsyncFunction("imageToPdf") { uri: String, target: String ->
      PhotoDocument.write(localFile(uri), localFile(target))
    }
    AsyncFunction("renderRegion") { uri: String, page: Int, rect: Map<String, Double>, target: String ->
      PdfRegionRenderer.render(localFile(uri), page, rect, localFile(target))
    }
    OnNewIntent { intent -> receive(intent) }
    AsyncFunction("getIncomingFiles") {
      receive(appContext.currentActivity?.intent)
      File(context().filesDir,"incoming").listFiles()?.filter {it.extension.equals("pdf", ignoreCase = true)}?.map {Uri.fromFile(it).toString()} ?: emptyList<String>()
    }
    AsyncFunction("deleteIncomingFile") { uri: String ->
      val file = localFile(uri).canonicalFile
      val folder = File(context().filesDir,"incoming").canonicalFile
      require(file.parentFile == folder && file.extension.equals("pdf", ignoreCase = true)) { "INVALID_INCOMING_FILE" }
      if (file.exists()) {
        require(file.isFile) { "INVALID_INCOMING_FILE" }
        check(file.delete()) { "INCOMING_DELETE_FAILED" }
      }
      Unit
    }
    AsyncFunction("protectFile") { _: String -> Unit }
    AsyncFunction("hashFile") { uri: String ->
      val digest=MessageDigest.getInstance("SHA-256")
      localFile(uri).inputStream().use { input -> val buffer=ByteArray(65536); while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)} }
      digest.digest().joinToString(""){"%02x".format(it)}
    }
    AsyncFunction("extract") { uri: String ->
      PdfExtractor.extract(context(), localFile(uri))
    }
    AsyncFunction("recognizeRegions") { uri: String, regions: List<Map<String, Any>> ->
      PdfExtractor.recognizeRegions(context(), localFile(uri), regions)
    }
    View(LocalPdfView::class) {
      Prop("uri") { view: LocalPdfView, uri: String -> view.setURI(uri) }
      Prop("page") { view: LocalPdfView, page: Int -> view.setPage(page) }
    }
  }
}

class LocalPdfView(context: Context, appContext: AppContext) : ExpoView(context,appContext) {
  private val image=ImageView(context).apply { scaleType=ImageView.ScaleType.FIT_CENTER;setBackgroundColor(Color.WHITE) }
  private var source="";private var pageIndex=0;private var bitmap:Bitmap?=null
  init { addView(image) }
  fun setURI(uri:String){source=uri;render()}
  fun setPage(page:Int){pageIndex=page;render()}
  override fun onLayout(changed:Boolean,left:Int,top:Int,right:Int,bottom:Int){image.layout(0,0,width,height);if(changed)render()}
  private fun render(){
    if(width<=0||source.isEmpty())return
    try {
      val file=File(requireNotNull(Uri.parse(source).path))
      PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
        pdf.openPage(pageIndex.coerceIn(0,pdf.pageCount-1)).use { page ->
          val scale=min(min(width*2,1800).toDouble()/page.width,2400.0/page.height)
          val w=(page.width*scale).toInt().coerceAtLeast(1);val h=(page.height*scale).toInt().coerceAtLeast(1)
          val next=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);next.eraseColor(Color.WHITE)
          page.render(next,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          image.setImageBitmap(next);bitmap?.recycle();bitmap=next
        }
      }
    }catch(_:Exception){image.setImageDrawable(null)}
  }
  override fun onDetachedFromWindow(){super.onDetachedFromWindow();image.setImageDrawable(null);bitmap?.recycle();bitmap=null}
}

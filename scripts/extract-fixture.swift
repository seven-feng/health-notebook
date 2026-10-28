import Foundation
import PDFKit
let url=URL(fileURLWithPath:CommandLine.arguments[1])
guard let document=PDFDocument(url:url) else { fatalError("Invalid fixture") }
var pages:[[String:Any]]=[]
for i in 0..<document.pageCount {
 let page=document.page(at:i)!, bounds=page.bounds(for:.cropBox)
 var spans:[[String:Any]]=[]
 let content=(page.string ?? "") as NSString
 for n in 0..<content.length {
  let range=NSRange(location:n,length:1)
  let text=content.substring(with:range)
  if text != "\n", text != "\r", let selection=page.selection(for:range) {
   let b=selection.bounds(for:page)
   spans.append(["text":text,"rect":["x":(b.minX-bounds.minX)/bounds.width,"y":(bounds.maxY-b.maxY)/bounds.height,"width":b.width/bounds.width,"height":b.height/bounds.height]])
  }
 }
 pages.append(["pageIndex":i,"width":bounds.width,"height":bounds.height,"spans":spans])
}
let data=try JSONSerialization.data(withJSONObject:pages,options:[.sortedKeys])
FileHandle.standardOutput.write(data)

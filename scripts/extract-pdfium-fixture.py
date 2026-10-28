from pathlib import Path
import json
import pypdfium2 as pdfium
root=Path(__file__).resolve().parents[1]
for name in ['first','second']:
    document=pdfium.PdfDocument(root/f'assets/samples/sample-{name}.pdf')
    pages=[]
    for i,page in enumerate(document):
        width,height=page.get_size()
        text=page.get_textpage()
        spans=[]
        for n in range(text.count_chars()):
            char=text.get_text_range(n,1)
            if char in ["\n", "\r", ""]:continue
            left,bottom,right,top=text.get_charbox(n)
            spans.append({'text':char,'rect':{'x':left/width,'y':(height-top)/height,'width':(right-left)/width,'height':(top-bottom)/height}})
        pages.append({'pageIndex':i,'width':width,'height':height,'spans':spans})
    (root/f'tests/fixtures/{name}-pdfium-layout.json').write_text(json.dumps(pages))

from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pypdf import PdfReader,PdfWriter
import json
root=Path(__file__).resolve().parents[1]
folder=root/'assets/samples'
folder.mkdir(parents=True,exist_ok=True)
def draw(path,date,values,marker=True):
    c=canvas.Canvas(str(path),pagesize=(612,792),invariant=1)
    c.setTitle('Synthetic laboratory report for software testing')
    c.setFillColor(HexColor('#123e35'));c.rect(0,676,612,116,fill=1,stroke=0)
    c.setFillColor(HexColor('#ffffff'));c.setFont('Helvetica-Bold',22)
    c.drawString(44,735,'Laboratory report')
    c.setFont('Helvetica',10);c.drawString(44,710,'SYNTHETIC SAMPLE - NOT A MEDICAL RECORD')
    c.setFillColor(HexColor('#233b35'));c.setFont('Helvetica',11)
    c.drawString(44,640,'Patient: SAMPLE')
    c.drawString(44,618,'Sample date: '+date)
    c.drawString(44,596,'Specimen: Serum / Method: Synthetic test method')
    c.setFillColor(HexColor('#edf4f0'));c.rect(40,542,532,34,fill=1,stroke=0)
    c.setFillColor(HexColor('#233b35'));c.setFont('Helvetica-Bold',10)
    for x,t in zip([50,235,335,440],['Item','Result','Unit','Reference']):c.drawString(x,554,t)
    c.setFont('Helvetica',12)
    for i,(name,value,unit,ref) in enumerate(zip(['ALT','AST','GLU'],values,['U/L','U/L','mmol/L'],['0-40','0-40','3.9-6.1'])):
        y=512-i*48
        for x,t in zip([50,235,335,440],[name,value,unit,ref]):c.drawString(x,y,t)
        c.setStrokeColor(HexColor('#dfe9e3'));c.line(44,y-15,568,y-15)
    c.setFont('Helvetica',10);c.drawString(44,290,'For import, correction, persistence and comparison tests only.')
    c.drawString(44,272,'No real patient information is included.')
    if marker:c.drawString(44,58,'DOCTOR-SAMPLE-V1')
    c.drawRightString(568,58,'Page 1 / 1')
    c.save()
draw(folder/'sample-first.pdf','2026-09-18',['100','48','5.4'])
draw(folder/'sample-second.pdf','2026-10-18',['80','35','5.1'])
draw(folder/'sample-unsupported.pdf','2026-10-18',['80','35','5.1'],False)
w=PdfWriter()
for name in ['sample-first.pdf','sample-second.pdf']:
    w.append(str(folder/name))
with open(folder/'sample-combined.pdf','wb') as f:w.write(f)
# Independent fixture expectations, entered from the authored table.
(root/'tests/fixtures/expected.json').write_text(json.dumps({'sample-first':{'date':'2026-09-18','values':['100','48','5.4']},'sample-second':{'date':'2026-10-18','values':['80','35','5.1']}},indent=2)+'\n')
for p in folder.glob('*.pdf'):
    assert 'Laboratory report' in PdfReader(p).pages[0].extract_text()
    print(p.name,p.stat().st_size)

"""Synthetic multi-page report for native end-to-end tests; no patient data."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('FixtureChinese', '/System/Library/Fonts/Supplemental/Songti.ttc', subfontIndex=0))
out = Path(__file__).resolve().parent.parent / 'assets/samples/sample-sections.pdf'
c = canvas.Canvas(str(out), pagesize=(600,800))
c.setTitle('合成多页报告 · 软件测试')
def draw(text,x,y,size=12):
    c.setFont('FixtureChinese',size)
    c.drawString(x*600,800-y*800-size,text)
def metadata():
    draw('姓名：测试甲',.1,.035)
    draw('报告编号：SYNTHETIC-001',.5,.035)
    draw('体检日期：2026-10-01',.1,.06)
def header(y):
    for text,x in [('检查项目',.1),('测量结果',.45),('参考区间',.66),('单位',.85)]:draw(text,x,y)
def row(name,value,reference,unit,y):
    for text,x in [(name,.11),(value,.46),(reference,.67),(unit,.86)]:draw(text,x,y)
metadata()
draw('合成检查',.1,.81,16)
header(.87)
c.showPage()
metadata()
row('项目甲','0','0—10','U/L',.12)
row('项目乙','阴性','阴性','',.17)
draw('小结：仅用于软件测试',.1,.24)
draw('双项检查',.1,.35,16)
header(.4)
row('项目丙','<5','<10','U/L',.45)
row('项目丁','未见异常','','',.5)
draw('小结：仅用于软件测试',.1,.58)
c.showPage()
metadata()
draw('使用说明',.1,.12,16)
draw('此页只用于测试原件保留。',.1,.2)
c.showPage()
c.save()
print(out)

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

OUT=Path(__file__).parent
BG='#F7F8FA'; INK='#182838'; MUT='#637183'; LINE='#DDE3EA'
BLUE='#2163C5'; BF='#DCEAFF'; ORANGE='#A95712'; OF='#FFE8CF'; GRAY='#E9EDF2'
FONT='/System/Library/Fonts/STHeiti Medium.ttc'
LIGHT='/System/Library/Fonts/STHeiti Light.ttc'
def font(n,bold=False): return ImageFont.truetype(FONT if bold else LIGHT,n)
def text(x,y,s,n=32,color=INK,bold=False):
    d.text((x,y),s,font=font(n,bold),fill=color)
def center(x,y,s,n=30,color=INK,bold=False):
    f=font(n,bold);box=d.textbbox((0,0),s,font=f);d.text((x-(box[2]-box[0])/2,y),s,font=f,fill=color)
def line(x1,y1,x2,y2,color=LINE,width=2): d.line((x1,y1,x2,y2),fill=color,width=width)
def arrow(x1,y1,x2,y2,color=BLUE):
    line(x1,y1,x2,y2,color,4);a=math.atan2(y2-y1,x2-x1)
    d.polygon([(x2,y2),(x2-16*math.cos(a-.45),y2-16*math.sin(a-.45)),(x2-16*math.cos(a+.45),y2-16*math.sin(a+.45))],fill=color)
def pill(x,y,w,h,label,fill=BF,color=BLUE,n=30):
    d.rounded_rectangle((x,y,x+w,y+h),radius=12,fill=fill);center(x+w/2,y+(h-n)/2-3,label,n,color,True)
def base(num,kicker,title,subtitle):
    global im,d
    im=Image.new('RGB',(1080,1440),BG);d=ImageDraw.Draw(im)
    text(76,58,'AI INFRA / 学习图解',25,MUT);text(896,58,f'{num:02d} / 06',25,MUT)
    line(76,108,1004,108)
    text(76,151,kicker,28,BLUE,True)
    text(76,207,title,66,INK,True)
    text(76,301,subtitle,33,MUT)
    line(76,1330,1004,1330)
    text(76,1360,'小乐学长 · 流水线并行',24,MUT)
    text(768,1360,'原理 / 场景 / 代价',24,MUT)
def bottom(rows,start=1010):
    for i,(label,content) in enumerate(rows):
        y=start+i*95;text(76,y,label,27,BLUE,True);text(216,y-2,content,31)
def save(name):im.save(OUT/name)
def legend(y=389):
    pill(76,y,58,40,'F',BF,BLUE,26);text(146,y+2,'前向',27)
    pill(266,y,58,40,'B',OF,ORANGE,26);text(336,y+2,'反向',27)
    pill(456,y,58,40,'',GRAY,MUT,26);text(526,y+2,'等待',27)
    text(722,y+2,'数字 = 微批次',26,MUT)
def timeline(rows,y=500):
    x=188;cw=80
    text(76,y-51,'时刻 →',25,MUT)
    for i in range(10):center(x+(i+.5)*cw,y-50,str(i+1),25,MUT)
    for r,row in enumerate(rows):
        yy=y+r*136;text(76,yy+27,'GPU '+str(r),25,INK,True)
        for i,op in enumerate(row):
            pill(x+i*cw,yy,72,84,op,OF if op.startswith('B') else BF if op else GRAY,ORANGE if op.startswith('B') else BLUE,29)

base(1,'一组图，理清五种策略','流水线并行','模型怎么切？任务怎么排？什么时候用？')
text(76,370,'先记住这条路径',31,INK,True)
pill(76,438,270,104,'GPU 0 · 前半段',n=30)
pill(730,438,274,104,'GPU 1 · 后半段',n=30)
arrow(366,463,706,463);center(536,418,'前向：激活',27,BLUE)
arrow(706,520,366,520,ORANGE);center(536,545,'反向：激活梯度',27,ORANGE)
items=[('Naive PP','分段放模型','解决单卡放不下'),('AFAB / GPipe','先前向，再反向','用微批次形成流水线'),('1F1B','一前一后','减少激活积压'),('Interleaved','模型块再切细','减少空泡，增加通信'),('Zero Bubble','反向拆成两项','先传输入梯度，再排参数梯度')]
for i,(name,desc,benefit) in enumerate(items):
    y=668+i*113;text(76,y,f'0{i+1}',26,BLUE,True);text(140,y,name,32,INK,True)
    text(476,y,desc,31);text(476,y+44,benefit,25,MUT);line(140,y+91,1004,y+91)
save('01-cover.png')

base(2,'01 / NAIVE PP','模型分卡，计算接力','先解决“放得下”，GPU 仍然经常等待。')
text(76,408,'一个完整 batch 的前向与反向',31,INK,True)
x=194;cw=196;y=525
for i in range(4):center(x+(i+.5)*cw,y-52,f'时刻 {i+1}',27,MUT)
for r,row in enumerate([['前向','','','反向'],['','前向','反向','']]):
    yy=y+r*160;text(76,yy+40,'GPU '+str(r),26,INK,True)
    for i,v in enumerate(row):pill(x+i*cw,yy,180,106,v or '等待',BF if v=='前向' else OF if v=='反向' else GRAY,BLUE if v=='前向' else ORANGE if v=='反向' else MUT,31)
text(194,899,'同一份数据必须依次经过各个模型段。',34,INK,True)
bottom([('适合','理解模型如何跨卡训练'),('收益','每张卡只持有部分模型'),('代价','没有微批次穿插，计算重叠少')])
save('02-naive.png')

base(3,'02 / AFAB · GPIPE','先全部前向，再全部反向','把 batch 切成微批次，让多张卡同时忙起来。')
legend();timeline([['F1','F2','F3','F4','','','B4','B3','B2','B1'],['','F1','F2','F3','F4','B4','B3','B2','B1','']])
text(76,813,'GPU 0：前向做完，激活还得留着',32,INK,True)
for i in range(4):pill(76+i*170,876,145,62,f'm{i+1}',BF,BLUE)
text(768,889,'待反向：4 份',28,MUT)
bottom([('适合','实现基线，或激活显存较充足'),('收益','不同微批次在不同 GPU 上重叠'),('代价','所有前向先完成，激活积压较多')])
text(188,768,'示意：前向、反向各 1 格，忽略通信',22,MUT)
save('03-afab.png')

base(4,'03 / 1F1B','提前反向，用完就释放','预热 → 一次前向、一次反向 → 收尾。')
legend();timeline([['F1','F2','','B1','F3','B2','F4','B3','','B4'],['','F1','B1','F2','B2','F3','B3','F4','B4','']])
text(188,768,'示意：前向、反向各 1 格，忽略通信',22,MUT)
text(76,819,'GPU 0 完成 B1：m1 激活可以释放',32,INK,True)
pill(76,879,180,64,'m1 已释放',GRAY,MUT,27);pill(298,879,150,64,'保留 m2',BF,BLUE,27)
text(654,897,'本例待反向激活峰值：2 份',26,MUT)
bottom([('适合','AFAB 的激活显存压力较大'),('收益','旧微批次更早反向，减少激活积压'),('注意','理想空泡时间与 AFAB 相同')])
save('04-1f1b.png')

base(5,'04 / INTERLEAVED 1F1B','块更小，交接更早','每张 GPU 持有多个模型块，交错安排计算。')
text(76,400,'8 层模型 / 2 张 GPU / 每张卡 2 个块',29,INK,True)
text(160,475,'GPU 0',31,INK,True);text(711,475,'GPU 1',31,INK,True)
pill(76,539,330,110,'A · 第 1–2 层',n=33);pill(674,539,330,110,'B · 第 3–4 层',n=33)
pill(76,766,330,110,'C · 第 5–6 层',n=33);pill(674,766,330,110,'D · 第 7–8 层',n=33)
arrow(425,594,655,594);center(540,548,'激活',26,BLUE)
arrow(837,668,837,697);line(837,697,241,697,BLUE,4);arrow(241,697,241,746)
center(540,714,'回到 GPU 0，计算后面的 C',25,BLUE)
arrow(425,821,655,821);center(540,780,'激活',26,BLUE)
text(76,933,'层的顺序不变：A → B → C → D',33,INK,True)
bottom([('适合','空泡明显，且设备互联较快'),('收益','小块配合交错调度，缩短等待'),('代价','通信次数增加，切太细可能更慢')])
save('05-interleaved.png')

base(6,'05 / ZERO BUBBLE','先让上一张卡开工','反向拆成两项：输入梯度 D、参数梯度 W。')
pill(76,387,66,44,'D',BF,BLUE,27);text(160,391,'上游反向需要，优先传回',29)
pill(76,450,66,44,'W',OF,ORANGE,27);text(160,454,'本卡更新需要，可以另行安排',29)
def zblock(start,y,length,label,color):
    pill(194+start*196,y,length*196-12,64,label,OF if color=='W' else BF if color=='D' else GRAY,ORANGE if color=='W' else BLUE if color=='D' else MUT,28)
def zpanel(y,split):
    text(76,y,'拆开后' if split else '整段反向',28,INK,True)
    yy=y+47;text(76,yy+15,'GPU 1',25);text(76,yy+112,'GPU 0',25)
    zblock(0,yy,1,'D','D');zblock(1,yy,1,'W','W')
    start=1 if split else 2
    zblock(0,yy+97,start,'等待','');zblock(start,yy+97,2,'继续反向','D')
    xx=194+196*start-6;arrow(xx,yy+65,xx,yy+95)
    text(xx+18,yy+66,'立即传回 D' if split else '完成后传回 D',22,BLUE)
zpanel(543,False);zpanel(783,True)
text(194,1009,'局部示意：同样的计算量，上游更早开始。',26,MUT)
bottom([('关键','上游等的是 D，不需要等 W'),('用法','把可推迟的 W 安排进空闲时段'),('代价','可能多占显存，还需完整调度支持')],start=1060)
save('06-zero-bubble.png')

thumbs=[]
for p in sorted(OUT.glob('0*.png')):
    a=Image.open(p);a.thumbnail((360,480));thumbs.append(a)
sheet=Image.new('RGB',(1120,1000),'#DDE3EA')
for i,a in enumerate(thumbs):sheet.paste(a,(10+(i%3)*370,10+(i//3)*490))
sheet.save(OUT/'preview.png')

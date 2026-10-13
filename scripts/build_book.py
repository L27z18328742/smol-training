"""Build the Chinese static book from the frozen English HTML and reviewed translations.
No translation service, credentials or network access is used by this build.
"""
import sys,json,re,html,shutil,hashlib
from pathlib import Path
from bs4 import BeautifulSoup, Doctype
from translate_book import collect, ROOT, TD
OUT=ROOT/'webapp'; OUT.mkdir(exist_ok=True)
draft='--draft' in sys.argv
src=BeautifulSoup((TD/'original.html').read_text(),'html.parser')
units=collect(src)
translations={}
for path in [TD/'manual.json',*sorted(TD.glob('part-*.json'))]:
 for k,v in json.loads(path.read_text()).items():
  if k in translations: raise ValueError('Duplicate translation '+k)
  translations[k]=v
missing=[i for i in range(len(units)) if str(i) not in translations]
if missing and not draft: raise SystemExit('Incomplete translations: '+str(missing))
for i,u in enumerate(units):
 if isinstance(u['el'],Doctype): continue
 z=translations.get(str(i),u['en'])
 if sorted(re.findall(r'ZXH\d{4}HXZ',z))!=sorted(re.findall(r'ZXH\d{4}HXZ',u['en'])): raise ValueError('Placeholder mismatch '+str(i))
 if u['kind']=='html':
  # Unparsed Markdown bold markers are present in a few original rendered paragraphs.
  z=html.escape(z.replace('**','').replace('&lt;','<').replace('&gt;','>'),quote=False)
  for j,markup in enumerate(u['ph']): z=z.replace(f'ZXH{j:04}HXZ',markup)
  frag=BeautifulSoup(z,'html.parser');u['el'].clear()
  for child in list(frag.contents):u['el'].append(child)
  u['el']['data-translation-id']=str(i)
 elif u['kind']=='text':u['el'].replace_with(z)
 else:u['el'][u['attr']]=z
# Repair malformed and outdated internal links already present in the source.
p=src.select_one('[data-translation-id="1396"]')
if p:
 p.clear()
 fragment=BeautifulSoup('当你迭代了 SFT 数据混合配比、模型达到合理表现后，下一步往往是探索更高级的方法，例如<a href="#from-sft-to-preference-optimization-teaching-models-what-better-means">偏好优化</a>或<a href="#going-on-policy-and-beyond-supervised-labels">强化学习</a>。不过，在深入这些方法之前，值得先考虑：把额外计算资源用在<em>持续预训练</em>上，增强基座模型，会不会更划算。','html.parser')
 for child in list(fragment.contents):p.append(child)
aliases={'#infrastructure---the-unsung-hero':'#infrastructurethe-unsung-hero','#optimiser-and-training-hyperparameters':'#optimizer-and-training-hyperparameters','#beyond-base-models--post-training-in-2025':'#beyond-base-modelspost-training-in-2025','#document_masking':'#doc-masking','#going-online-and-beyond-supervised-labels':'#going-on-policy-and-beyond-supervised-labels'}
for link in src.select('a[href]'):
 if link['href'] in aliases:link['href']=aliases[link['href']]
src.html['lang']='zh-CN'
for tag in src.select('link[rel=canonical],meta[property="og:url"]'):tag.decompose()
for tag in src.select('meta[name=description],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]'):
 tag['content']='Smol 训练手册：构建世界一流大语言模型的秘诀 · 非官方简体中文译本'
# The original PDF button requires Hugging Face Pro and has no Chinese PDF behind it.
for tag in src.select('.meta-container-cell--pdf'):tag.decompose()
for tag in src.select('a[download]'):
 if '.pdf' in tag.get('href',''):tag.decompose()
# Correct an empty References heading produced by the upstream reference plugin.
ref=src.find('h2',id='references')
if ref:ref.clear();ref.append('参考资料')
chapters=[{'id':x.get('id'),'title':x.get_text(' ',strip=True)} for x in src.select('main h2') if x.get('id')!='footnote-label']
bar=BeautifulSoup('<nav class="reader-bar" aria-label="阅读工具"><a class="reader-brand" href="#">Smol <span>训练手册</span></a><label class="reader-jump"><span class="sr-only">跳转章节</span><select id="chapter-jump"><option value="">跳转章节</option></select></label><a href="original.html" id="english-link">English 原文</a><button type="button" id="reader-print">打印</button></nav><div class="reader-progress" aria-hidden="true"><span></span></div>','html.parser')
for i,c in enumerate(chapters,1):
 option=bar.new_tag('option',value='#'+c['id']);option.string=f'{i:02} · {c["title"]}';bar.select_one('select').append(option)
for t in reversed(list(bar.contents)):src.body.insert(0,t)
notice=BeautifulSoup('<aside class="translation-notice"><strong>非官方简体中文译本</strong><p>译自 HuggingFaceTB《The Smol Training Playbook》。正文、表格、图注与旁注均已翻译；代码、公式、文献条目及图片内文字保留原文。交互图表的常用标签已汉化，外部嵌入工具保留原站界面并需要联网。</p><p>原作者：Loubna Ben Allal 等。原文与译文依据 <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> 使用。本译本由 AI 辅助逐段翻译并进行术语、结构校对，不代表原作者认可。<a href="https://huggingface.co/spaces/HuggingFaceTB/smol-training-playbook">访问原书</a> · <a href="quality-report.json">覆盖检查</a></p></aside>','html.parser')
if draft:
 notice.aside.insert(0,BeautifulSoup(f'<p><strong>内部预览：尚有 {len(missing)} 个翻译单元待完成。</strong></p>','html.parser'))
hero=src.select_one('.hero');hero.insert_after(notice.aside)
theme=src.select_one('#theme-toggle')
if theme:src.select_one('.reader-bar').append(theme.extract())
# Translator's note identifies a source inconsistency instead of silently changing it.
n=src.select_one('[data-translation-id="2078"]')
if n:
 n.append(BeautifulSoup('<small class="translator-note">译注：原文将 MBS 写作 token 数；但结合下方 GBS = DP × MBS × GRAD_ACC × SEQLEN 及 MBS = 3 的配置，此处应理解为每个微批次的序列条数。</small>','html.parser'))
for frame in src.select('iframe'):
 frame['loading']='lazy';frame['referrerpolicy']='strict-origin-when-cross-origin'
 if not frame.get('title'):frame['title']='原书外部交互工具（需要联网）'
 a=src.new_tag('a',href=frame.get('src'),target='_blank',rel='noopener');a['class']='external-widget-link';a.string='在原站打开此交互工具 ↗';frame.insert_after(a)
for path in ['reader.css']:
 t=src.new_tag('link',rel='stylesheet',href=path);src.head.append(t)
script=src.new_tag('script',src='reader.js',defer='');src.head.append(script)
# Use local copies of D3 and SVG.js when available.
rendered=str(src)
for remote,local in [('https://d3js.org/d3.v7.min.js','/vendor/d3.min.js'),('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js','/vendor/d3.min.js'),('https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js','/vendor/d3.min.js'),('https://cdnjs.cloudflare.com/ajax/libs/svg.js/3.2.5/svg.min.js','/vendor/svg.min.js')]:rendered=rendered.replace(remote,local)
(OUT/'index.html').write_text(rendered)
shutil.copyfile(TD/'original.html',OUT/'original.html')
shutil.copyfile(TD/'chart-labels.json',OUT/'chart-labels.json')
# Source assets remain unmodified; content can be rebuilt with no dependencies on the reference project.
for name in ['_astro','data','scripts']:
 if not (OUT/name).exists():shutil.copytree(ROOT/'source/app/dist'/name,OUT/name)
for name in ['thumb.png','hf-space-parent-listener.js']:
 shutil.copyfile(ROOT/'source/app/dist'/name,OUT/name)
(TD/'chapters.json').write_text(json.dumps(chapters,ensure_ascii=False,indent=2))
print(json.dumps({'units':len(units),'translated':len(translations),'missing':len(missing),'chapters':len(chapters)},ensure_ascii=False))

import json,re,hashlib
from pathlib import Path
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parent.parent
old=BeautifulSoup((ROOT/'translation/original.html').read_text(),'html.parser')
new=BeautifulSoup((ROOT/'webapp/index.html').read_text(),'html.parser')
units=json.loads((ROOT/'translation/source-units.json').read_text());translations={}
for p in [ROOT/'translation/manual.json',*sorted((ROOT/'translation').glob('part-*.json'))]:translations.update(json.loads(p.read_text()))
errors=[]
missing=[u['id'] for u in units if str(u['id']) not in translations]
if missing:errors.append({'missing_units':missing})
for u in units:
 if str(u['id']) in translations and sorted(re.findall('ZXH\\d{4}HXZ',u['en']))!=sorted(re.findall('ZXH\\d{4}HXZ',translations[str(u['id'])])):errors.append({'placeholder_mismatch':u['id']})
for selector in ['pre','math','.katex','.csl-entry']:
 a=[x.get_text() for x in old.select(selector)];b=[x.get_text() for x in new.select(selector)]
 if a!=b:errors.append({'changed_protected_content':selector,'source':len(a),'translated':len(b)})
for selector in ['main p','main table','main tr','main img','main iframe','.sidenote','.html-embed']:
 a=len(old.select(selector));b=len(new.select(selector))
 if a!=b:errors.append({'structure_count_changed':selector,'source':a,'translated':b})
oldhead={x.get('id') for x in old.select('main h2,main h3,main h4')}
newhead={x.get('id') for x in new.select('main h2,main h3,main h4')}
if oldhead!=newhead:errors.append({'heading_anchors_changed':sorted(oldhead^newhead)})
assets=[]
for el in new.select('img[src],script[src],link[href]'):
 src=el.get('src') or el.get('href')
 if src.startswith(('http:','https:','data:','#')):continue
 path=ROOT/'webapp'/src.lstrip('/').split('?')[0]
 if not path.is_file():assets.append(src)
if assets:errors.append({'missing_local_assets':assets})
ids={x['id'] for x in new.select('[id]')}
broken=sorted({x['href'] for x in new.select('a[href^="#"]') if x['href'][1:] and x['href'][1:] not in ids})
if broken:errors.append({'broken_internal_links':broken})
if re.search(r'ZX[GH]\d{4}[GH]XZ',new.get_text()):errors.append('unresolved_placeholder')
report={'source_commit':'179c71bb4a1c10c8be98768dea04fbc2cfc8e9f9','source_url':'https://huggingface.co/spaces/HuggingFaceTB/smol-training-playbook','language':'zh-CN','translation_method':'AI agents, full paragraph-by-paragraph translation; automated structural verification and targeted terminology review','source_units':len(units),'translated_units':len(translations),'nonprose_doctype_units':3,'missing_units':len(missing),'counts':{k:len(new.select(v)) for k,v in {'paragraphs':'main p','tables':'main table','table_rows':'main tr','images':'main img','interactive_embeds':'.html-embed','external_iframes':'main iframe','code_blocks':'pre','formulas':'math','bibliography_entries':'.csl-entry','sidenotes':'.sidenote'}.items()},'errors':errors,'limitations':['Code, formula notation, bibliographic entries and text inside raster images remain in their original form.','External embedded tools retain original interfaces and require network access.','Interactive chart labels are translated through a local display dictionary; model/data identifiers are retained.','This is an unofficial AI-assisted translation, not author-reviewed.']}
for p in [ROOT/'translation/quality-report.json',ROOT/'webapp/quality-report.json']:p.write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2));raise SystemExit(bool(errors))

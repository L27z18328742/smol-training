"""Extract translation units while protecting original HTML, math and code."""
import re, json, hashlib, time, concurrent.futures, threading, html
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Comment
ROOT=Path(__file__).resolve().parent.parent
TD=ROOT/'translation'; TD.mkdir(exist_ok=True)
CACHE=TD/'cache'; CACHE.mkdir(exist_ok=True)
GLOSSARY=json.loads((TD/'glossary.json').read_text())
TERMS=re.compile(r'(?<![\w-])('+ '|'.join(re.escape(k) for k in sorted(GLOSSARY,key=len,reverse=True)) +r')(?![\w-])',re.I)
GL={k.lower():v for k,v in GLOSSARY.items()}
SKIP={'script','style','pre','code','math','svg','noscript','textarea'}
BLOCK={'p','li','h1','h2','h3','h4','h5','h6','td','th','figcaption','label','button','summary','dt','dd','title'}
lock=threading.Lock()

def protected(el):
 return el.name in SKIP or 'katex' in el.get('class',[]) or 'csl-bib-body' in el.get('class',[]) or 'citation' in el.get('class',[]) or el.get('role')=='doc-bibliography'

def eligible(n):
 return not isinstance(n,Comment) and re.search('[A-Za-z]{2}',str(n)) and not any(protected(p) for p in n.parents if p.name)

def key(s): return hashlib.sha256(s.encode()).hexdigest()

def encode(el):
 placeholders=[]
 def hold(s):
  placeholders.append(s); return f'ZXH{len(placeholders)-1:04}HXZ'
 def walk(n):
  if isinstance(n,NavigableString): return str(n) if not isinstance(n,Comment) else hold(str(n))
  if protected(n): return hold(str(n))
  if n.name in {'br','img','hr','input','source','wbr'}: return hold(str(n))
  string=str(n)
  # Opening markup is obtained with a shallow copy, avoiding '>' in attributes.
  c=BeautifulSoup('', 'html.parser').new_tag(n.name,attrs=dict(n.attrs))
  opening=str(c).split(f'</{n.name}>')[0]
  return hold(opening)+''.join(walk(x) for x in n.contents)+hold(f'</{n.name}>')
 return ''.join(walk(n) for n in el.contents),placeholders

def collect(soup):
 units=[]; covered=set()
 for el in soup.find_all(list(BLOCK)):
  if any(protected(p) for p in [el,*el.parents] if p.name): continue
  # Keep nested block structures intact; translate their leaf blocks separately.
  if el.find(list(BLOCK)): continue
  textnodes=[n for n in el.descendants if isinstance(n,NavigableString) and eligible(n)]
  if not textnodes: continue
  encoded,ph=encode(el)
  units.append({'el':el,'en':encoded,'ph':ph,'kind':'html'})
  covered.update(id(n) for n in el.descendants if isinstance(n,NavigableString))
 for n in list(soup.find_all(string=True)):
  if id(n) not in covered and eligible(n) and n.parent.name not in {'head'}:
   units.append({'el':n,'en':str(n),'ph':[],'kind':'text'})
 for el in soup.find_all(True):
  if any(protected(p) for p in [el,*el.parents] if p.name): continue
  for attr in ['alt','title','aria-label','placeholder']:
   if isinstance(el.get(attr),str) and re.search('[A-Za-z]{2}',el[attr]): units.append({'el':el,'en':el[attr],'ph':[],'kind':'attr','attr':attr})
 return units


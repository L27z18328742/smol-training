from pathlib import Path
import concurrent.futures, urllib.request, urllib.parse, hashlib, time
root=Path('source')
items=[]
for p in root.rglob('*'):
 if p.is_file() and not p.is_symlink() and '.git' not in p.parts and 'node_modules' not in p.parts and p.stat().st_size<1024:
  b=p.read_bytes()
  if b.startswith(b'version https://git-lfs.github.com/spec/v1'):
   oid=b.decode().split('oid sha256:')[1].split()[0]; items.append((p,oid))
def fetch(item):
 p,oid=item
 url='https://huggingface.co/spaces/HuggingFaceTB/smol-training-playbook/resolve/main/'+urllib.parse.quote(str(p.relative_to(root)))
 for attempt in range(4):
  try:
   b=urllib.request.urlopen(url,timeout=90).read()
   assert hashlib.sha256(b).hexdigest()==oid
   p.write_bytes(b)
   return str(p)
  except Exception as e:
   if attempt==3: return 'ERROR '+str(p)+' '+str(e)
   time.sleep(attempt+1)
print('LFS assets:',len(items),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
 for i,result in enumerate(ex.map(fetch,items),1):
  if i%20==0 or result.startswith('ERROR'): print(i,result,flush=True)
print('Complete',flush=True)

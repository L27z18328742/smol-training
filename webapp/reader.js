(()=>{
const normalize=s=>s.trim().replace(/\s+/g,' ');
const jump=document.getElementById('chapter-jump');jump?.addEventListener('change',()=>{if(jump.value)location.hash=jump.value});
document.getElementById('reader-print')?.addEventListener('click',()=>window.print());
const english=document.getElementById('english-link');const linkEnglish=()=>{if(english)english.href='original.html'+location.hash};window.addEventListener('hashchange',linkEnglish);linkEnglish();
let scrolling=false;const progress=()=>{const range=document.documentElement.scrollHeight-innerHeight;document.querySelector('.reader-progress span').style.width=(range?100*scrollY/range:0)+'%';scrolling=false};window.addEventListener('scroll',()=>{if(!scrolling){scrolling=true;requestAnimationFrame(progress)}},{passive:true});progress();
fetch('chart-labels.json').then(r=>r.json()).then(raw=>{
 const dict=new Map(Object.entries(raw).map(([k,v])=>[normalize(k),v]));dict.set('References','参考文献');dict.set('Footnotes','脚注');dict.set('Table of Contents','目录');
 function text(n){
  if(!n.parentElement||n.parentElement.closest('script,style,pre,code,math,.katex,.csl-bib-body,.citation,.reader-bar'))return;
  const key=normalize(n.nodeValue||'');const zh=dict.get(key);
  if(zh&&zh!==key)n.nodeValue=n.nodeValue.replace(n.nodeValue.trim(),zh);
 }
 function visit(node){
  if(node.nodeType===Node.TEXT_NODE){text(node);return}
  if(node.nodeType!==Node.ELEMENT_NODE)return;
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode())text(n);
 }
 visit(document.body);
 // Translate only changed nodes so interactive D3 redraws stay responsive.
 new MutationObserver(records=>{for(const r of records){if(r.type==='characterData')text(r.target);else r.addedNodes.forEach(visit)}}).observe(document.body,{subtree:true,childList:true,characterData:true});
}).catch(()=>{});
})();

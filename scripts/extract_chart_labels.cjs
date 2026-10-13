const fs=require('fs'), path=require('path');
const ts=require('../source/app/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript');
const dir='source/app/src/content/embeds';const out=new Set();const fragments=[];
for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.html'))){
 const text=fs.readFileSync(path.join(dir,file),'utf8');
 for(const match of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){
  const ast=ts.createSourceFile(file,match[1],ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  function walk(n){
   if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n)){
    const v=n.text.trim();
    if(v.includes('<')&&v.includes('>'))fragments.push(v);
    else if(/[A-Za-z]/.test(v)&&!/[{};=#/\\]|^\.|^--|^var\(/.test(v)&&v.length<350&&(v.includes(' ')||/^[A-Z][a-z]+$/.test(v)))out.add(v);
   }
   ts.forEachChild(n,walk);
  }walk(ast);
 }
}
fs.writeFileSync('translation/chart-strings.json',JSON.stringify([...out].sort(),null,2));
fs.writeFileSync('translation/chart-fragments.json',JSON.stringify(fragments,null,2));

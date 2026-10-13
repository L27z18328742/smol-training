const {chromium}=require('../source/app/node_modules/playwright');const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});let errors=[],bad=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith('http://127.0.0.1:8765')&&r.status()>=400)bad.push({url:r.url(),status:r.status()})});
 await page.goto('http://127.0.0.1:8765',{waitUntil:'domcontentloaded'});await page.evaluate(()=>{for(const x of document.images)x.loading='eager'});await page.waitForTimeout(3500);
 await page.screenshot({path:'translation/desktop-home.png'});
 await page.selectOption('#chapter-jump','#every-big-model-starts-with-a-small-ablation');await page.waitForTimeout(300);const nav=await page.evaluate(()=>location.hash);
 await page.goto('http://127.0.0.1:8765/#understanding-what-works-evaluation',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2000);await page.screenshot({path:'translation/desktop-evaluation.png'});
 await page.click('#theme-toggle');const dark=await page.getAttribute('html','data-theme');await page.screenshot({path:'translation/desktop-dark.png'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.click('#theme-toggle');await page.waitForTimeout(300);await page.screenshot({path:'translation/mobile-home.png'});
 const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 await page.evaluate(()=>{document.getElementById('understanding-what-works-evaluation').scrollIntoView()});await page.waitForTimeout(300);await page.screenshot({path:'translation/mobile-evaluation.png'});
 const imageResults=await page.evaluate(async()=>{await Promise.all([...document.images].map(x=>{x.loading='eager';return x.decode().catch(()=>{})}));return [...document.images].filter(x=>!x.naturalWidth).map(x=>x.src)});
 const report={errors,failedLocalRequests:bad,brokenImages:imageResults,chapterNavigation:nav,darkTheme:dark,mobile,renderedInteractiveSvgs:await page.locator('.html-embed svg').count()};fs.writeFileSync('translation/browser-report.json',JSON.stringify(report,null,2));console.log(report);await browser.close();
})();

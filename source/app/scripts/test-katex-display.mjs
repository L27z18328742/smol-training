import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://localhost:4321/?viz=true';
const OUTPUT_DIR = './test-screenshots';
const DEVICE_SCALE_FACTOR = 2;
const MAX_BLOCKS = 6;

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('🚀 Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    viewport: { width: 1200, height: 800 }
  });
  const page = await context.newPage();

  console.log(`📄 Navigating to ${URL}...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const blocks = await page.locator('.katex-display').all();
  console.log(`\n🔍 Found ${blocks.length} .katex-display blocks`);

  const targets = blocks.slice(0, MAX_BLOCKS);
  for (let i = 0; i < targets.length; i++) {
    const block = targets[i];
    const filename = `katex-display-${i + 1}.png`;
    const filepath = `${OUTPUT_DIR}/${filename}`;

    try {
      await page.waitForTimeout(50);

      const cloneId = await block.evaluate((el, idx) => {
        const existing = document.getElementById(`__katex-clone-wrapper-${idx}`);
        if (existing) existing.remove();

        const wrapper = document.createElement('div');
        wrapper.id = `__katex-clone-wrapper-${idx}`;
        wrapper.style.position = 'absolute';
        wrapper.style.left = '0';
        wrapper.style.top = '0';
        wrapper.style.background = 'white';
        wrapper.style.padding = '0';
        wrapper.style.margin = '0';
        wrapper.style.border = 'none';
        wrapper.style.zIndex = '99999';
        wrapper.style.width = 'max-content';

        const clone = el.cloneNode(true);
        clone.id = `__katex-clone-${idx}`;
        clone.style.display = 'inline-block';
        clone.style.width = 'max-content';
        clone.style.maxWidth = 'none';
        clone.style.margin = '0';

        wrapper.appendChild(clone);
        document.body.appendChild(wrapper);

        return clone.id;
      }, i);

      const wrapperSelector = `#__katex-clone-wrapper-${i}`;
      const cloneSelector = `#${cloneId}`;

      const cloneWidth = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        return el ? el.getBoundingClientRect().width : 0;
      }, wrapperSelector);

      const currentViewport = page.viewportSize();
      const neededWidth = Math.ceil(cloneWidth + 200);
      if (cloneWidth > currentViewport.width) {
        await page.setViewportSize({
          width: neededWidth,
          height: currentViewport.height
        });
        await page.waitForTimeout(200);
      }

      await page.locator(cloneSelector).screenshot({
        path: filepath,
        type: 'png'
      });

      const box = await page.locator(cloneSelector).boundingBox();
      const actualWidth = box ? Math.round(box.width * 2) : '?';
      const actualHeight = box ? Math.round(box.height * 2) : '?';
      console.log(`  ✅ ${filename} (${actualWidth}x${actualHeight}px)`);

      await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) el.remove();
      }, wrapperSelector);
    } catch (err) {
      console.log(`  ❌ Failed for block ${i + 1}: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n🎉 Done! Check ${OUTPUT_DIR}/`);
}

main().catch(console.error);

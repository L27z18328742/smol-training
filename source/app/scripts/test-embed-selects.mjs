import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://localhost:4321/?viz=true';
const OUTPUT_DIR = './test-screenshots';
const DEVICE_SCALE_FACTOR = 2;
const MAX_EMBEDS = 5;

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
  await page.waitForTimeout(3000);

  const embeds = await page.locator('.html-embed:has(select)').all();
  console.log(`\n🔍 Found ${embeds.length} embeds with <select>`);

  const targets = embeds.slice(0, MAX_EMBEDS);
  for (let i = 0; i < targets.length; i++) {
    const embed = targets[i];

    if (!(await embed.isVisible())) {
      console.log(`  ⏭️  Skipping hidden embed ${i + 1}`);
      continue;
    }

    const baseName = `htmlembed-select-${i + 1}`;
    const closedPath = `${OUTPUT_DIR}/${baseName}.png`;
    const openPath = `${OUTPUT_DIR}/${baseName}--open.png`;

    try {
      await embed.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);

      await embed.screenshot({ path: closedPath, type: 'png' });
      console.log(`  ✅ ${baseName}.png`);

      const select = embed.locator('select').first();
      await select.evaluate((el) => {
        el.dataset.__prevSize = el.getAttribute('size') ?? '';
        el.dataset.__prevStyle = el.getAttribute('style') ?? '';
        el.dataset.__prevMultiple = el.multiple ? '1' : '0';

        const optionCount = el.querySelectorAll('option').length;
        const size = Math.min(optionCount || 1, 8);

        el.setAttribute('size', String(size));
        el.multiple = true;
        el.style.position = 'relative';
        el.style.zIndex = '9999';
        el.style.height = 'auto';
        el.style.maxHeight = 'none';
        el.style.background = 'white';
      });
      await page.waitForTimeout(150);

      await embed.screenshot({ path: openPath, type: 'png' });
      console.log(`  ✅ ${baseName}--open.png`);

      await select.evaluate((el) => {
        const prevSize = el.dataset.__prevSize;
        const prevStyle = el.dataset.__prevStyle;
        const prevMultiple = el.dataset.__prevMultiple;

        if (prevSize) {
          el.setAttribute('size', prevSize);
        } else {
          el.removeAttribute('size');
        }
        el.multiple = prevMultiple === '1';
        el.setAttribute('style', prevStyle || '');

        delete el.dataset.__prevSize;
        delete el.dataset.__prevStyle;
        delete el.dataset.__prevMultiple;
      });
      await page.waitForTimeout(100);
    } catch (err) {
      console.log(`  ❌ Failed for embed ${i + 1}: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n🎉 Done! Check ${OUTPUT_DIR}/`);
}

main().catch(console.error);

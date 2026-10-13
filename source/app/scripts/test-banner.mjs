import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://localhost:4321/?viz=true';
const OUTPUT_DIR = './test-screenshots';

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('🚀 Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1200, height: 800 },
  });
  const page = await context.newPage();

  console.log(`📄 Navigating to ${URL}...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const button = page
    .locator('.html-embed__download[data-filename*="banner"]')
    .first();
  const buttonCount = await button.count();
  if (buttonCount === 0) {
    console.log('❌ No banner embed found (data-filename*="banner")');
    await browser.close();
    return;
  }

  const embed = button.locator(
    'xpath=ancestor::figure[contains(@class,"html-embed")]',
  );

  await embed.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);

  await embed.evaluate((el) => {
    const stash = (node) => {
      if (!node || !(node instanceof HTMLElement)) return;
      node.dataset.__prevStyle = node.getAttribute('style') ?? '';
      node.style.background = 'transparent';
      node.style.border = 'none';
      node.style.borderRadius = '0';
      node.style.boxShadow = 'none';
    };

    stash(el);
    const card = el.querySelector('.html-embed__card');
    if (card) stash(card);
    const figure = el.closest('figure');
    if (figure) stash(figure);

    const banners = el.querySelectorAll('[class*="banner"]');
    banners.forEach((banner) => stash(banner));

    // Aggressive: remove borders/rounding/background on all descendants
    const all = el.querySelectorAll('*');
    all.forEach((node) => stash(node));

    // If banner is an SVG with a rounded rect background, flatten it
    const svgRects = el.querySelectorAll('svg rect');
    svgRects.forEach((rect) => {
      rect.setAttribute('rx', '0');
      rect.setAttribute('ry', '0');
      rect.setAttribute('stroke', 'none');
    });
  });

  const filepath = `${OUTPUT_DIR}/banner-test.png`;
  await embed.screenshot({ path: filepath, type: 'png' });
  console.log(`✅ Saved ${filepath}`);

  await embed.evaluate((el) => {
    const restore = (node) => {
      if (!node || !(node instanceof HTMLElement)) return;
      const prev = node.dataset.__prevStyle ?? '';
      node.setAttribute('style', prev);
      delete node.dataset.__prevStyle;
    };

    restore(el);
    const card = el.querySelector('.html-embed__card');
    if (card) restore(card);
    const figure = el.closest('figure');
    if (figure) restore(figure);
    const banners = el.querySelectorAll('[class*="banner"]');
    banners.forEach((banner) => restore(banner));
  });

  await browser.close();
  console.log('🎉 Done! Check ./test-screenshots/banner-test.png');
}

main().catch(console.error);

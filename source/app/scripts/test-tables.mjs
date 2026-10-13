import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const URL = 'http://localhost:4321/?viz=true';
const OUTPUT_DIR = './test-screenshots';
const MAX_TABLES = 3; // Juste 3 premiers tableaux pour itérer vite

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('🚀 Launching browser...');
  const browser = await chromium.launch({ headless: false }); // Debug mode
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1200, height: 800 }
  });
  const page = await context.newPage();

  console.log(`📄 Navigating to ${URL}...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const tables = (await page.locator('.table-scroll > table').all()).slice(0, MAX_TABLES);
  console.log(`\n🔍 Found ${tables.length} tables (testing first ${MAX_TABLES})`);

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    
    if (!(await table.isVisible())) {
      console.log(`  ⏭️  Skipping hidden table ${i + 1}`);
      continue;
    }

    const filename = `table-${i + 1}.png`;
    const filepath = `${OUTPUT_DIR}/${filename}`;

    try {
      await table.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      
      // Debug: log column count and widths
      const debug = await table.evaluate((el) => {
        const rows = el.querySelectorAll('tr');
        const firstRow = rows[0];
        if (!firstRow) return { cols: 0, widths: [] };
        
        const cells = Array.from(firstRow.children);
        const widths = cells.map(cell => ({
          text: cell.textContent?.trim().substring(0, 30),
          width: cell.getBoundingClientRect().width,
          scrollWidth: cell.scrollWidth
        }));
        
        return { cols: cells.length, widths };
      });
      
      console.log(`    Table ${i+1}: ${debug.cols} columns`);
      debug.widths.forEach((w, idx) => {
        console.log(`      Col ${idx+1}: "${w.text}" - width: ${Math.round(w.width)}px, scroll: ${w.scrollWidth}px`);
      });

      // Clone table into a clean container to avoid layout constraints
      const cloneId = await table.evaluate((el, idx) => {
        const existing = document.getElementById(`__table-clone-wrapper-${idx}`);
        if (existing) existing.remove();

        const wrapper = document.createElement('div');
        wrapper.id = `__table-clone-wrapper-${idx}`;
        wrapper.style.position = 'absolute';
        wrapper.style.left = '0';
        wrapper.style.top = '0';
        wrapper.style.background = 'white';
        wrapper.style.padding = '0';
        wrapper.style.margin = '0';
        wrapper.style.border = 'none';
        wrapper.style.zIndex = '99999';
        wrapper.style.width = 'max-content';

        // Build a minimal structure that matches the original CSS selectors
        const contentGrid = document.createElement('section');
        contentGrid.className = 'content-grid';
        const main = document.createElement('main');
        const tableScroll = document.createElement('div');
        tableScroll.className = 'table-scroll';

        const clone = el.cloneNode(true);
        clone.id = `__table-clone-${idx}`;
        clone.style.width = 'max-content';
        clone.style.minWidth = '0';
        clone.style.maxWidth = 'none';
        clone.style.tableLayout = 'auto';

        const cells = clone.querySelectorAll('th, td');
        cells.forEach(cell => {
          cell.style.width = 'auto';
          cell.style.minWidth = '0';
          cell.style.maxWidth = 'none';
        });

        tableScroll.appendChild(clone);
        main.appendChild(tableScroll);
        contentGrid.appendChild(main);
        wrapper.appendChild(contentGrid);
        document.body.appendChild(wrapper);

        return clone.id;
      }, i);

      const wrapperSelector = `#__table-clone-wrapper-${i}`;
      const cloneSelector = `#${cloneId}`;

      const cloneWidth = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        return el ? el.getBoundingClientRect().width : 0;
      }, wrapperSelector);

      const currentViewport = page.viewportSize();
      const neededWidth = Math.ceil(cloneWidth + 200);
      if (cloneWidth > currentViewport.width) {
        console.log(`    Resizing viewport from ${currentViewport.width}px to ${neededWidth}px`);
        await page.setViewportSize({
          width: neededWidth,
          height: currentViewport.height
        });
        await page.waitForTimeout(200);
      }

      await page.waitForTimeout(100);

      await page.locator(cloneSelector).screenshot({
        path: filepath,
        type: 'png'
      });

      const box = await page.locator(cloneSelector).boundingBox();
      const actualWidth = box ? Math.round(box.width * 2) : '?';
      const actualHeight = box ? Math.round(box.height * 2) : '?';

      console.log(`  ✅ ${filename} (${actualWidth}x${actualHeight}px, clone: ${Math.round(cloneWidth)}px)`);

      await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) el.remove();
      }, wrapperSelector);
    } catch (err) {
      console.log(`  ❌ Failed: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n🎉 Done! Check ${OUTPUT_DIR}/`);
}

main().catch(console.error);

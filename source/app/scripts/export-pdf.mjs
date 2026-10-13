#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import process from 'node:process';

async function run(command, args = [], options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(undefined);
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { }
    await delay(500);
  }
  throw new Error(`Server did not start in time: ${url}`);
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.replace(/^--/, '').split('=');
    out[k] = v === undefined ? true : v;
  }
  return out;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'article';
}

function parseMargin(margin) {
  if (!margin) return { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' };
  const parts = String(margin).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  }
  if (parts.length === 3) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  }
  return { top: parts[0] || '12mm', right: parts[1] || '12mm', bottom: parts[2] || '16mm', left: parts[3] || '12mm' };
}

function cssLengthToMm(val) {
  if (!val) return 0;
  const s = String(val).trim();
  if (/mm$/i.test(s)) return parseFloat(s);
  if (/cm$/i.test(s)) return parseFloat(s) * 10;
  if (/in$/i.test(s)) return parseFloat(s) * 25.4;
  if (/px$/i.test(s)) return (parseFloat(s) / 96) * 25.4; // 96 CSS px per inch
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : 0; // assume mm if unitless
}

function getFormatSizeMm(format) {
  const f = String(format || 'A4').toLowerCase();
  switch (f) {
    case 'letter': return { w: 215.9, h: 279.4 };
    case 'legal': return { w: 215.9, h: 355.6 };
    case 'a3': return { w: 297, h: 420 };
    case 'tabloid': return { w: 279.4, h: 431.8 };
    case 'a4':
    default: return { w: 210, h: 297 };
  }
}

async function waitForImages(page, timeoutMs = 15000) {
  await page.evaluate(async (timeout) => {
    const deadline = Date.now() + timeout;
    const imgs = Array.from(document.images || []);
    const unloaded = imgs.filter(img => !img.complete || (img.naturalWidth === 0));
    await Promise.race([
      Promise.all(unloaded.map(img => new Promise(res => {
        if (img.complete && img.naturalWidth !== 0) return res(undefined);
        img.addEventListener('load', () => res(undefined), { once: true });
        img.addEventListener('error', () => res(undefined), { once: true });
      }))),
      new Promise(res => setTimeout(res, Math.max(0, deadline - Date.now())))
    ]);
  }, timeoutMs);
}

async function waitForPlotly(page, timeoutMs = 20000) {
  try {
    await page.evaluate(async (timeout) => {
      const start = Date.now();
      const hasPlots = () => Array.from(document.querySelectorAll('.js-plotly-plot')).length > 0;
      // Wait until plots exist or timeout
      while (!hasPlots() && (Date.now() - start) < timeout) {
        await new Promise(r => setTimeout(r, 200));
      }
      const deadline = start + timeout;
      // Then wait until each plot contains the main svg
      const allReady = () => Array.from(document.querySelectorAll('.js-plotly-plot')).every(el => el.querySelector('svg.main-svg'));
      while (!allReady() && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
      }
      console.log('Plotly ready or timeout');
    }, timeoutMs);
  } catch (e) {
    console.warn('waitForPlotly timeout or error:', e.message);
  }
}

async function waitForD3(page, timeoutMs = 20000) {
  try {
    await page.evaluate(async (timeout) => {
      const start = Date.now();
      const isReady = () => {
        // Prioritize hero banner if present (generic container)
        const hero = document.querySelector('.hero-banner');
        if (hero) {
          return !!hero.querySelector('svg circle, svg path, svg rect, svg g');
        }
        // Else require all D3 containers on page to have shapes
        const containers = [
          ...Array.from(document.querySelectorAll('.d3-line')),
          ...Array.from(document.querySelectorAll('.d3-bar'))
        ];
        if (!containers.length) return true;
        return containers.every(c => c.querySelector('svg circle, svg path, svg rect, svg g'));
      };
      while (!isReady() && (Date.now() - start) < timeout) {
        await new Promise(r => setTimeout(r, 200));
      }
      console.log('D3 ready or timeout');
    }, timeoutMs);
  } catch (e) {
    console.warn('waitForD3 timeout or error:', e.message);
  }
}

async function waitForStableLayout(page, timeoutMs = 5000) {
  const start = Date.now();
  let last = await page.evaluate(() => document.scrollingElement ? document.scrollingElement.scrollHeight : document.body.scrollHeight);
  let stableCount = 0;
  while ((Date.now() - start) < timeoutMs && stableCount < 3) {
    await page.waitForTimeout(250);
    const now = await page.evaluate(() => document.scrollingElement ? document.scrollingElement.scrollHeight : document.body.scrollHeight);
    if (now === last) stableCount += 1; else { stableCount = 0; last = now; }
  }
}

/**
 * Apply responsive SVG fixes in page context.
 * Factored out to avoid duplication.
 */
async function applyResponsiveSvgFixes(page) {
  await page.evaluate(() => {
    function isSmallSvg(svg) {
      try {
        const vb = svg?.viewBox?.baseVal;
        if (vb && vb.width <= 50 && vb.height <= 50) return true;
        const r = svg.getBoundingClientRect?.();
        if (r && r.width <= 50 && r.height <= 50) return true;
      } catch { }
      return false;
    }
    
    function lockSmallSvgSize(svg) {
      try {
        const r = svg.getBoundingClientRect?.();
        if (r?.width) svg.style.setProperty('width', Math.round(r.width) + 'px', 'important');
        if (r?.height) svg.style.setProperty('height', Math.round(r.height) + 'px', 'important');
        svg.style.setProperty('max-width', 'none', 'important');
      } catch { }
    }
    
    function fixSvg(svg) {
      if (!svg) return;
      try { if (svg.closest?.('.hero-banner')) return; } catch { }
      if (isSmallSvg(svg)) { lockSmallSvgSize(svg); return; }
      try { svg.removeAttribute('width'); } catch { }
      try { svg.removeAttribute('height'); } catch { }
      svg.style.maxWidth = '100%';
      svg.style.width = '100%';
      svg.style.height = 'auto';
      if (!svg.getAttribute('preserveAspectRatio')) {
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    }
    
    document.querySelectorAll('svg').forEach(svg => {
      isSmallSvg(svg) ? lockSmallSvgSize(svg) : fixSvg(svg);
    });
    
    document.querySelectorAll('.mermaid, .mermaid svg').forEach(el => {
      if (el.tagName?.toLowerCase() === 'svg') fixSvg(el);
      else { el.style.display = 'block'; el.style.width = '100%'; el.style.maxWidth = '100%'; }
    });
    
    document.querySelectorAll('iframe, embed, object').forEach(el => {
      el.style.width = '100%';
      el.style.maxWidth = '100%';
      try { el.removeAttribute('width'); } catch { }
      try {
        const doc = el.contentDocument;
        if (doc?.head) {
          const s = doc.createElement('style');
          s.textContent = 'html,body{overflow-x:hidden;} svg,canvas,img,video{max-width:100%!important;height:auto!important;} svg[width]{width:100%!important}';
          doc.head.appendChild(s);
          doc.querySelectorAll('svg').forEach(svg => {
            isSmallSvg(svg) ? lockSmallSvgSize(svg) : fixSvg(svg);
          });
        }
      } catch { /* cross-origin */ }
    });
  });
}

/** PDF print styles */
const PDF_PRINT_CSS = `
/* General container safety */
html, body { overflow-x: hidden !important; }

/* Make all vector/bitmap media responsive for print */
svg, canvas, img, video { max-width: 100% !important; height: auto !important; }
.mermaid, .mermaid svg { display: block; width: 100% !important; max-width: 100% !important; height: auto !important; }
svg[width] { width: 100% !important; }
iframe, embed, object { width: 100% !important; max-width: 100% !important; height: auto; }

/* HtmlEmbed wrappers */
.html-embed, .html-embed__card { max-width: 100% !important; width: 100% !important; }
.html-embed__card > div[id^="frag-"] { width: 100% !important; max-width: 100% !important; }

/* Wide mode: remove blur/mask effects for print */
.wide, .html-embed--wide {
  -webkit-mask: none !important;
  mask: none !important;
  background: transparent !important;
  padding: 0 !important;
  width: 100% !important;
  margin-left: 0 !important;
  transform: none !important;
  border-radius: 0 !important;
}

/* Banner centering */
.hero .points { mix-blend-mode: normal !important; }
.hero-banner, .hero .hero-banner, [class*="hero-banner"] {
  display: block !important; width: 100% !important; max-width: 100% !important; text-align: center !important;
}
.hero .html-embed--screenshot, .hero-banner .html-embed--screenshot,
.hero .html-embed--screenshot img, .hero-banner .html-embed--screenshot img {
  display: block !important; margin-left: auto !important; margin-right: auto !important; max-width: 100% !important;
}
.hero-banner svg, .hero-banner canvas, [class*="hero-banner"] svg, [class*="hero-banner"] canvas {
  display: block !important; margin-left: auto !important; margin-right: auto !important; max-width: 100% !important; height: auto !important;
}
.hero figure, .hero-banner figure { text-align: center !important; }
.hero figure img, .hero-banner figure img { margin-left: auto !important; margin-right: auto !important; }

/* Complex flexbox layouts */
.d3-neural .panel { flex-direction: column !important; gap: 16px !important; }
.d3-neural .left, .d3-neural .right { flex: 0 0 100% !important; max-width: 100% !important; min-width: 0 !important; width: 100% !important; }
.d3-neural .arrow-sep { display: none !important; }
.d3-neural .canvas-wrap { max-width: 280px !important; margin: 0 auto !important; }
.d3-neural canvas { max-width: 100% !important; height: auto !important; }
.d3-neural .right svg { width: 100% !important; height: auto !important; min-height: 300px !important; }
.html-embed__card .panel { flex-direction: column !important; }
.html-embed__card .panel > * { flex: 0 0 auto !important; max-width: 100% !important; width: 100% !important; }
.html-embed__card .controls { flex-wrap: wrap !important; justify-content: flex-start !important; }
.html-embed__card .chart-card { width: 100% !important; max-width: 100% !important; }
.d3-six-line-charts .chart-grid { grid-template-columns: 1fr !important; }

/* Screenshot replacements */
.html-embed--screenshot, .iframe--screenshot {
  width: 100% !important; max-width: 100% !important; page-break-inside: avoid !important; break-inside: avoid !important;
}
.html-embed--screenshot img, .iframe--screenshot img {
  width: auto !important; 
  height: auto !important; 
  max-width: 100% !important; 
  /* Limit height to fit on a single page (~269mm printable = ~1015px, with margin) */
  max-height: 950px !important;
  display: block !important;
  object-fit: contain !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
.iframe--screenshot { margin: 1em 0 !important; }
.iframe--screenshot img { border-radius: 8px !important; border: 1px solid #e5e5e5 !important; }

/* Interactive links under screenshots */
.screenshot-link {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  margin-top: 8px !important;
  padding: 4px 10px !important;
  font-size: 0.75rem !important;
  color: var(--primary-color, #6366f1) !important;
  background: var(--primary-color-alpha, rgba(99, 102, 241, 0.08)) !important;
  border-radius: 4px !important;
  text-decoration: none !important;
  font-weight: 500 !important;
  letter-spacing: 0.01em !important;
}
.screenshot-link::before {
  content: "↗" !important;
  font-size: 0.85em !important;
}

/* Iframe sizing */
iframe {
  width: 100% !important; max-width: 100% !important; min-height: 400px !important;
  border: 1px solid var(--border-color, #e5e5e5) !important; border-radius: 8px !important;
  page-break-inside: avoid !important; break-inside: avoid !important;
}
iframe[src*="hf.space"], iframe[src*="huggingface.co"], iframe[src*="gradio"] { min-height: 500px !important; height: auto !important; }
iframe.card { min-height: 450px !important; }
`;

/**
 * Screenshot-first approach: Captures HTML embeds as high-resolution images
 * and replaces them in the DOM. This ensures perfect visual fidelity in PDFs.
 * 
 * @param {import('playwright').Page} page - Playwright page
 * @param {string} liveUrl - Base URL for interactive links
 * @param {number} deviceScaleFactor - Scale factor for retina quality (default: 2)
 * @returns {Promise<{replaced: number, skipped: number, errors: number}>}
 */
async function replaceEmbedsWithScreenshots(page, liveUrl, deviceScaleFactor = 2) {
  const stats = { replaced: 0, skipped: 0, errors: 0 };
  
  // Get all HTML embeds
  const embeds = await page.$$('.html-embed');
  console.log(`   Found ${embeds.length} HTML embeds to process`);
  
  for (let i = 0; i < embeds.length; i++) {
    const embed = embeds[i];
    
    try {
      // Check visibility
      const isVisible = await embed.isVisible();
      if (!isVisible) {
        stats.skipped++;
        continue;
      }
      
      // Get embed ID (now automatically generated from filename in HtmlEmbed.astro)
      const embedAnchor = await embed.evaluate((el) => {
        const id = el.id || el.getAttribute('id');
        // Skip internal IDs like frag-xxx
        return (id && !id.startsWith('frag-')) ? id : null;
      });
      
      // Scroll into view
      await embed.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      
      // Clean up styles for cleaner screenshot (remove shadows, borders, etc.)
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
        
        // For banners, clean up more aggressively
        const banners = el.querySelectorAll('[class*="banner"]');
        if (banners.length > 0) {
          banners.forEach((banner) => stash(banner));
          const all = el.querySelectorAll('*');
          all.forEach((node) => stash(node));
          const svgRects = el.querySelectorAll('svg rect');
          svgRects.forEach((rect) => {
            rect.setAttribute('rx', '0');
            rect.setAttribute('ry', '0');
            rect.setAttribute('stroke', 'none');
          });
        }
      });
      
      // Take screenshot as base64
      const screenshotBuffer = await embed.screenshot({ 
        type: 'png',
        scale: 'device' // Uses deviceScaleFactor from context
      });
      const base64 = screenshotBuffer.toString('base64');
      const dataUri = `data:image/png;base64,${base64}`;
      
      // Get dimensions for the replacement image
      const box = await embed.boundingBox();
      const width = box ? Math.round(box.width) : 'auto';
      const height = box ? Math.round(box.height) : 'auto';
      
      // Get caption if present
      const caption = await embed.evaluate((el) => {
        const figcaption = el.closest('figure')?.querySelector('figcaption');
        return figcaption ? figcaption.outerHTML : '';
      });
      
      // Build interactive link with anchor to nearest heading
      const interactiveUrl = liveUrl ? (embedAnchor ? `${liveUrl}#${embedAnchor}` : liveUrl) : null;
      
      // Replace embed with image
      await embed.evaluate((el, { dataUri, width, height, caption, index, interactiveUrl }) => {
        // Create replacement container
        const replacement = document.createElement('div');
        replacement.className = 'html-embed--screenshot';
        replacement.dataset.originalIndex = String(index);
        replacement.style.width = '100%';
        replacement.style.maxWidth = '100%';
        replacement.style.pageBreakInside = 'avoid';
        
        // Create image element
        const img = document.createElement('img');
        img.src = dataUri;
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.maxWidth = '100%';
        img.style.display = 'block';
        img.alt = 'Embedded visualization';
        
        replacement.appendChild(img);
        
        // Add interactive link if available
        if (interactiveUrl) {
          const link = document.createElement('a');
          link.href = interactiveUrl;
          link.className = 'screenshot-link';
          link.textContent = 'View interactive version';
          link.target = '_blank';
          link.rel = 'noopener';
          replacement.appendChild(link);
        }
        
        // Handle figure wrapper if present
        const figure = el.closest('figure');
        if (figure) {
          // Keep the figure structure but replace content
          const newFigure = document.createElement('figure');
          newFigure.className = figure.className;
          newFigure.style.cssText = figure.style.cssText;
          newFigure.appendChild(replacement);
          
          // Re-add caption if present
          if (caption) {
            newFigure.insertAdjacentHTML('beforeend', caption);
          }
          
          figure.replaceWith(newFigure);
        } else {
          el.replaceWith(replacement);
        }
      }, { dataUri, width, height, caption, index: i, interactiveUrl });
      
      stats.replaced++;
      
      if ((i + 1) % 10 === 0 || i === embeds.length - 1) {
        console.log(`   Progress: ${i + 1}/${embeds.length} embeds processed`);
      }
      
    } catch (err) {
      console.warn(`   ⚠️  Failed to capture embed ${i + 1}: ${err.message}`);
      stats.errors++;
      
      // Restore original styles on error
      try {
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
        });
      } catch { }
    }
  }
  
  return stats;
}

/**
 * Screenshot-first approach for iframes: Captures iframes as high-resolution images
 * and replaces them in the DOM. This handles cross-origin iframes like HuggingFace Spaces.
 * 
 * @param {import('playwright').Page} page - Playwright page
 * @param {number} deviceScaleFactor - Scale factor for retina quality (default: 2)
 * @returns {Promise<{replaced: number, skipped: number, errors: number}>}
 */
async function replaceIframesWithScreenshots(page, deviceScaleFactor = 2) {
  const stats = { replaced: 0, skipped: 0, errors: 0 };
  
  // Get all iframes
  const iframes = await page.$$('iframe');
  console.log(`   Found ${iframes.length} iframes to process`);
  
  if (iframes.length === 0) {
    return stats;
  }
  
  // Wait for iframes to load
  console.log('   ⏳ Waiting for iframes to load...');
  await page.evaluate(async () => {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    await Promise.all(iframes.map(iframe => {
      return new Promise((resolve) => {
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
          resolve(undefined);
        } else {
          iframe.addEventListener('load', () => resolve(undefined), { once: true });
          // Timeout after 10 seconds
          setTimeout(() => resolve(undefined), 10000);
        }
      });
    }));
  });
  
  // Extra wait for Gradio/HuggingFace Spaces to render
  await page.waitForTimeout(3000);
  
  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];
    
    try {
      // Check visibility
      const isVisible = await iframe.isVisible();
      if (!isVisible) {
        stats.skipped++;
        continue;
      }
      
      // Get iframe src for logging and interactive link
      const src = await iframe.getAttribute('src') || '';
      const shortSrc = src.length > 50 ? src.substring(0, 50) + '...' : src;
      
      // Scroll into view
      await iframe.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500); // Extra time for iframe content to render after scroll
      
      // Take screenshot
      const screenshotBuffer = await iframe.screenshot({ 
        type: 'png',
        scale: 'device'
      });
      const base64 = screenshotBuffer.toString('base64');
      const dataUri = `data:image/png;base64,${base64}`;
      
      // Get dimensions
      const box = await iframe.boundingBox();
      const width = box ? Math.round(box.width) : 'auto';
      const height = box ? Math.round(box.height) : 'auto';
      
      // Replace iframe with image
      await iframe.evaluate((el, { dataUri, width, height, index, iframeSrc }) => {
        // Create replacement container
        const replacement = document.createElement('div');
        replacement.className = 'iframe--screenshot';
        replacement.dataset.originalIndex = String(index);
        replacement.style.width = '100%';
        replacement.style.maxWidth = '100%';
        replacement.style.pageBreakInside = 'avoid';
        
        // Create image element
        const img = document.createElement('img');
        img.src = dataUri;
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.maxWidth = '100%';
        img.style.display = 'block';
        img.style.borderRadius = '8px';
        img.style.border = '1px solid #e5e5e5';
        img.alt = 'Embedded widget screenshot';
        
        replacement.appendChild(img);
        
        // Add interactive link if iframe has a valid src
        if (iframeSrc && iframeSrc.startsWith('http')) {
          const link = document.createElement('a');
          link.href = iframeSrc;
          link.className = 'screenshot-link';
          link.textContent = 'View interactive version';
          link.target = '_blank';
          link.rel = 'noopener';
          replacement.appendChild(link);
        }
        
        el.replaceWith(replacement);
      }, { dataUri, width, height, index: i, iframeSrc: src });
      
      stats.replaced++;
      console.log(`   ✅ [${i + 1}/${iframes.length}] ${shortSrc}`);
      
    } catch (err) {
      console.warn(`   ⚠️  Failed to capture iframe ${i + 1}: ${err.message}`);
      stats.errors++;
    }
  }
  
  return stats;
}

/**
 * Injects viewBox attributes on SVGs that don't have one, making them responsive.
 * This captures the current rendered dimensions before switching to print mode.
 */
async function injectSvgViewBoxes(page) {
  const stats = await page.evaluate(() => {
    let fixed = 0;
    let skipped = 0;
    let errors = 0;

    // Target all D3 embeds and general HTML embed SVGs
    const selectors = [
      '.html-embed__card svg',
      '.d3-bar svg',
      '.d3-scatter svg', 
      '.d3-line svg',
      '.d3-galaxy svg',
      '.d3-neural svg',
      '.d3-pie svg',
      '.d3-confusion-matrix svg',
      '.d3-benchmark svg',
      '.d3-six-line-charts svg',
      '[class^="d3-"] svg',
      '[class*=" d3-"] svg'
    ].join(', ');

    document.querySelectorAll(selectors).forEach(svg => {
      try {
        // Skip if already has a viewBox
        if (svg.getAttribute('viewBox')) {
          skipped++;
          return;
        }

        // Get current rendered dimensions
        const rect = svg.getBoundingClientRect();
        const width = rect.width || svg.clientWidth || parseFloat(svg.getAttribute('width')) || 0;
        const height = rect.height || svg.clientHeight || parseFloat(svg.getAttribute('height')) || 0;

        if (width > 0 && height > 0) {
          // Add viewBox based on current dimensions
          svg.setAttribute('viewBox', `0 0 ${Math.round(width)} ${Math.round(height)}`);
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          // Remove fixed dimensions to allow scaling
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          // Make responsive via CSS
          svg.style.width = '100%';
          svg.style.height = 'auto';
          svg.style.maxWidth = '100%';
          fixed++;
        } else {
          skipped++;
        }
      } catch (e) {
        errors++;
      }
    });

    return { fixed, skipped, errors };
  });

  return stats;
}

async function main() {
  const cwd = process.cwd();
  const port = Number(process.env.PREVIEW_PORT || 8080);
  const baseUrl = `http://localhost:${port}/`;
  const args = parseArgs(process.argv);
  // Default: light (do not rely on env vars implicitly)
  const theme = (args.theme === 'dark' || args.theme === 'light') ? args.theme : 'light';
  const format = args.format || 'A4';
  const margin = parseMargin(args.margin);
  const wait = (args.wait || 'full'); // 'networkidle' | 'images' | 'plotly' | 'full'
  const bookMode = !!args.book; // Activer le mode livre avec --book
  const useScreenshots = !args['no-screenshots']; // Screenshot-first approach (default: enabled)
  const liveUrl = args['live-url'] || ''; // URL de l'article en ligne (pour les liens interactifs)

  // filename can be provided, else computed from DOM (button) or page title later
  let outFileBase = (args.filename && String(args.filename).replace(/\.pdf$/i, '')) || 'article';

  // Build only if dist/ does not exist
  const distDir = resolve(cwd, 'dist');
  let hasDist = false;
  try {
    const st = await fs.stat(distDir);
    hasDist = st && st.isDirectory();
  } catch { }
  if (!hasDist) {
    console.log('> Building Astro site…');
    await run('npm', ['run', 'build']);
  } else {
    console.log('> Skipping build (dist/ exists)…');
  }

  console.log('> Starting Astro preview…');
  // Start preview in its own process group so we can terminate all children reliably
  const preview = spawn('npm', ['run', 'preview'], { cwd, stdio: 'inherit', detached: true });
  const previewExit = new Promise((resolvePreview) => {
    preview.on('close', (code, signal) => resolvePreview({ code, signal }));
  });

  try {
    await waitForServer(baseUrl, 60000);
    console.log('> Server ready, generating PDF…');

    const browser = await chromium.launch({ headless: true });
    try {
      // Use 4x scale factor for high-DPI screenshots
      const deviceScaleFactor = 4;
      const context = await browser.newContext({
        deviceScaleFactor
      });
      await context.addInitScript((desired) => {
        try {
          localStorage.setItem('theme', desired);
          // Apply theme immediately to avoid flashes
          if (document && document.documentElement) {
            document.documentElement.dataset.theme = desired;
          }
        } catch { }
      }, theme);
      const page = await context.newPage();
      // Start with a wider viewport so D3/Plotly embeds render at their intended "web" size
      // We'll capture viewBox dimensions before switching to print viewport
      const webViewportWidth = 1200;
      await page.setViewportSize({ width: webViewportWidth, height: 1400 });
      await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
      // Give time for CDN scripts (Plotly/D3) to attach and for our fragment hooks to run
      try { await page.waitForFunction(() => !!window.Plotly, { timeout: 8000 }); } catch { }
      try { await page.waitForFunction(() => !!window.d3, { timeout: 8000 }); } catch { }
      // Prefer explicit filename from the download button if present
      if (!args.filename) {
        const fromBtn = await page.evaluate(() => {
          const btn = document.getElementById('download-pdf-btn');
          const f = btn ? btn.getAttribute('data-pdf-filename') : null;
          return f || '';
        });
        if (fromBtn) {
          outFileBase = String(fromBtn).replace(/\.pdf$/i, '');
        } else {
          // Fallback: compute slug from hero title or document.title
          const title = await page.evaluate(() => {
            const h1 = document.querySelector('h1.hero-title');
            const t = h1 ? h1.textContent : document.title;
            return (t || '').replace(/\s+/g, ' ').trim();
          });
          outFileBase = slugify(title);
        }
        // Ajouter suffixe -book si en mode livre
        if (bookMode) {
          outFileBase += '-book';
        }
      }

      // Wait for render readiness
      if (wait === 'images' || wait === 'full') {
        console.log('⏳ Waiting for images…');
        await waitForImages(page);
      }
      if (wait === 'd3' || wait === 'full') {
        console.log('⏳ Waiting for D3…');
        await waitForD3(page);
      }
      if (wait === 'plotly' || wait === 'full') {
        console.log('⏳ Waiting for Plotly…');
        await waitForPlotly(page);
      }
      if (wait === 'full') {
        console.log('⏳ Waiting for stable layout…');
        await waitForStableLayout(page);
      }

      // Mode livre : ouvrir tous les accordéons
      if (bookMode) {
        console.log('📂 Opening all accordions for book mode…');
        await page.evaluate(() => {
          const accordions = document.querySelectorAll('details.accordion, details');
          accordions.forEach((accordion) => {
            if (!accordion.hasAttribute('open')) {
              accordion.setAttribute('open', '');
              const wrapper = accordion.querySelector('.accordion__content-wrapper');
              if (wrapper) {
                wrapper.style.height = 'auto';
                wrapper.style.overflow = 'visible';
              }
            }
          });
        });
        await waitForStableLayout(page, 2000);
      }

      // Screenshot-first approach: capture HTML embeds as images before PDF generation
      // This ensures perfect visual fidelity regardless of CSS/flexbox issues
      if (useScreenshots) {
        console.log('📸 Capturing HTML embeds as screenshots (screenshot-first approach)…');
        if (liveUrl) console.log(`   🔗 Interactive links will point to: ${liveUrl}`);
        const screenshotStats = await replaceEmbedsWithScreenshots(page, liveUrl, deviceScaleFactor);
        console.log(`   ✅ Replaced: ${screenshotStats.replaced}, Skipped: ${screenshotStats.skipped}, Errors: ${screenshotStats.errors}`);
        
        // Also capture iframes (HuggingFace Spaces, etc.)
        console.log('📸 Capturing iframes as screenshots…');
        const iframeStats = await replaceIframesWithScreenshots(page, deviceScaleFactor);
        console.log(`   ✅ Replaced: ${iframeStats.replaced}, Skipped: ${iframeStats.skipped}, Errors: ${iframeStats.errors}`);
        
        // Wait for layout to stabilize after replacements
        await waitForStableLayout(page, 2000);
      } else {
        // Fallback: Inject viewBox on SVGs that don't have one
        console.log('🔧 Fixing SVG viewBox attributes…');
        const svgStats = await injectSvgViewBoxes(page);
        console.log(`   Fixed: ${svgStats.fixed}, Skipped: ${svgStats.skipped}, Errors: ${svgStats.errors}`);
      }

      await page.emulateMedia({ media: 'print' });

      // Enforce responsive sizing for SVG/iframes
      try { await applyResponsiveSvgFixes(page); } catch { }

      // Generate OG thumbnail (1200x630)
      try {
        const ogW = 1200, ogH = 630;
        await page.setViewportSize({ width: ogW, height: ogH });
        // Give layout a tick to adjust
        await page.waitForTimeout(200);
        // Ensure layout & D3 re-rendered after viewport change
        await page.evaluate(() => { window.scrollTo(0, 0); window.dispatchEvent(new Event('resize')); });
        try { await waitForD3(page, 8000); } catch { }

        // Temporarily improve visibility for light theme thumbnails
        // - Force normal blend for points
        // - Ensure an SVG background (CSS background on svg element)
        const cssHandle = await page.addStyleTag({
          content: `
          .hero .points { mix-blend-mode: normal !important; }
        ` });
        const thumbPath = resolve(cwd, 'dist', 'thumb.auto.jpg');
        await page.screenshot({ path: thumbPath, type: 'jpeg', quality: 85, fullPage: false });
        // Also emit PNG for compatibility if needed
        const thumbPngPath = resolve(cwd, 'dist', 'thumb.auto.png');
        await page.screenshot({ path: thumbPngPath, type: 'png', fullPage: false });
        const publicThumb = resolve(cwd, 'public', 'thumb.auto.jpg');
        const publicThumbPng = resolve(cwd, 'public', 'thumb.auto.png');
        try { await fs.copyFile(thumbPath, publicThumb); } catch { }
        try { await fs.copyFile(thumbPngPath, publicThumbPng); } catch { }
        // Remove temporary style so PDF is unaffected
        try { await cssHandle.evaluate((el) => el.remove()); } catch { }
        console.log(`✅ OG thumbnail generated: ${thumbPath}`);
      } catch (e) {
        console.warn('Unable to generate OG thumbnail:', e?.message || e);
      }
      const outPath = resolve(cwd, 'dist', `${outFileBase}.pdf`);
      // Restore viewport to printable width before PDF (thumbnail changed it)
      // SVGs now have viewBox so they should scale automatically
      try {
        const fmt2 = getFormatSizeMm(format);
        const mw2 = fmt2.w - cssLengthToMm(margin.left) - cssLengthToMm(margin.right);
        const printableWidthPx2 = Math.max(320, Math.round((mw2 / 25.4) * 96));
        console.log(`📐 Setting viewport to printable width: ${printableWidthPx2}px`);
        await page.setViewportSize({ width: printableWidthPx2, height: 1400 });
        await page.evaluate(() => { window.scrollTo(0, 0); window.dispatchEvent(new Event('resize')); });
        await page.waitForTimeout(500);
        await waitForStableLayout(page, 2000);
        // Re-apply responsive fixes after viewport change
        try { await applyResponsiveSvgFixes(page); } catch { }
      } catch { }

      // Inject styles for PDF
      let pdfCssHandle = null;
      try {
        if (bookMode) {
          // Mode livre : injecter le CSS livre complet
          console.log('📚 Applying book styles…');
          const bookCssPath = resolve(cwd, 'src', 'styles', '_print-book.css');
          const bookCss = await fs.readFile(bookCssPath, 'utf-8');
          pdfCssHandle = await page.addStyleTag({ content: bookCss });
          await page.waitForTimeout(500);
        } else {
          // Mode normal : styles responsive de base
          pdfCssHandle = await page.addStyleTag({ content: PDF_PRINT_CSS });
        }
      } catch { }
      await page.pdf({
        path: outPath,
        format,
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: false,
        margin: bookMode ? {
          top: '20mm',
          right: '20mm',
          bottom: '25mm',
          left: '25mm'
        } : margin
      });
      try { if (pdfCssHandle) await pdfCssHandle.evaluate((el) => el.remove()); } catch { }
      console.log(`✅ PDF generated: ${outPath}`);

      // Copy into public only under the slugified name
      const publicSlugPath = resolve(cwd, 'public', `${outFileBase}.pdf`);
      try {
        await fs.mkdir(resolve(cwd, 'public'), { recursive: true });
        await fs.copyFile(outPath, publicSlugPath);
        console.log(`✅ PDF copied to: ${publicSlugPath}`);
      } catch (e) {
        console.warn('Unable to copy PDF to public/:', e?.message || e);
      }
    } finally {
      await browser.close();
    }
  } finally {
    // Try a clean shutdown of preview (entire process group first)
    try {
      if (process.platform !== 'win32') {
        try { process.kill(-preview.pid, 'SIGINT'); } catch { }
      }
      try { preview.kill('SIGINT'); } catch { }
      await Promise.race([previewExit, delay(3000)]);
      // Force kill if still alive
      // eslint-disable-next-line no-unsafe-optional-chaining
      if (!preview.killed) {
        try {
          if (process.platform !== 'win32') {
            try { process.kill(-preview.pid, 'SIGKILL'); } catch { }
          }
          try { preview.kill('SIGKILL'); } catch { }
        } catch { }
        await Promise.race([previewExit, delay(1000)]);
      }
    } catch { }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});



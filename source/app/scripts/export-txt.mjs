#!/usr/bin/env node

/**
 * Export article to TXT format for book publishing
 * 
 * This script exports the article to a simple text format with custom tags:
 * - <f> NAME ANCHOR DESCRIPTION </f> for figures/images
 * - <t> NAME DESCRIPTION </t> for tables
 * - <c> CODE | DESCRIPTION </c> for code blocks
 * - <ic> CODE </ic> for inline code
 * - <il> FORMULA </il> for inline LaTeX
 * - <l> katex-number </l> for LaTeX display formulas (references exported PNGs)
 * - <b> TEXT </b> for bold
 * - <i> TEXT </i> for italic
 * - <a href="URL"> TEXT </a> for links
 * - <ref> TEXT </ref> for literature/citation references
 * - <n> TITLE | CONTENT </n> for note boxes
 * 
 * Usage:
 *   node scripts/export-txt.mjs
 *   npm run export:txt
 * 
 * Output: dist/article.txt
 */

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

async function waitForServer(urlOrFn, timeoutMs = 60000) {
  const getUrl = typeof urlOrFn === 'function' ? urlOrFn : () => urlOrFn;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const url = getUrl();
      if (!url) { await delay(200); continue; }
      const res = await fetch(url);
      if (res.ok) return;
    } catch { }
    await delay(500);
  }
  const lastUrl = getUrl();
  throw new Error(`Server did not start in time: ${lastUrl || '(unknown url)'}`);
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

function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
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

/**
 * Clean text content: remove extra whitespace, normalize line breaks
 */
function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Convert heading level to markdown syntax
 */
function headingToMarkdown(level, text) {
  const hashes = '#'.repeat(Math.min(level, 6));
  return `${hashes} ${text}`;
}

// ─── Code block wrapping utilities ──────────────────────────────────────────

function wrapLineWithIndent(line, maxWidth) {
  if (line.length <= maxWidth) return [line];
  const indentMatch = line.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const indentLen = indent.length;
  const available = Math.max(10, maxWidth - indentLen);
  let rest = line.slice(indentLen);
  const out = [];
  while (rest.length > available) {
    let breakPos = -1;
    for (let i = available; i >= 1; i--) {
      if (/\s/.test(rest[i - 1])) { breakPos = i; break; }
    }
    if (breakPos === -1) breakPos = available;
    out.push(indent + rest.slice(0, breakPos).replace(/\s+$/g, ''));
    rest = rest.slice(breakPos).replace(/^\s+/g, '');
  }
  out.push(indent + rest);
  return out;
}

function wrapCodeTextAccountingForTags(codeText, maxWidth) {
  const width = Number(maxWidth);
  if (!Number.isFinite(width) || width <= 0) return String(codeText || '');
  const baseLines = String(codeText || '').split('\n');
  const wrappedLines = [];
  for (const line of baseLines) wrappedLines.push(...wrapLineWithIndent(line, width));
  if (wrappedLines.length === 0) return '';
  if (wrappedLines.length === 1) {
    const maxInner = width - '<c>'.length - '</c>'.length;
    if (wrappedLines[0].length > maxInner && maxInner > 0) {
      return wrapLineWithIndent(wrappedLines[0], maxInner).join('\n');
    }
    return wrappedLines[0];
  }
  const firstMaxInner = width - '<c>'.length;
  if (firstMaxInner > 0 && wrappedLines[0].length > firstMaxInner) {
    const rewrappedFirst = wrapLineWithIndent(wrappedLines[0], firstMaxInner);
    wrappedLines.splice(0, 1, ...rewrappedFirst);
  }
  const lastMaxInner = width - '</c>'.length;
  const lastIdx = wrappedLines.length - 1;
  if (lastMaxInner > 0 && wrappedLines[lastIdx].length > lastMaxInner) {
    const rewrappedLast = wrapLineWithIndent(wrappedLines[lastIdx], lastMaxInner);
    wrappedLines.splice(lastIdx, 1, ...rewrappedLast);
  }
  return wrappedLines.join('\n');
}

function wrapCodeBlocksInTxt(txt, maxWidth = 80) {
  const width = Number(maxWidth);
  if (!Number.isFinite(width) || width <= 0) return txt;
  return String(txt || '').replace(/<c>([\s\S]*?)<\/c>/g, (_m, inner) => {
    const wrappedInner = wrapCodeTextAccountingForTags(inner, width);
    return `<c>${wrappedInner}</c>`;
  });
}

/**
 * Extract and convert article content to TXT format
 */
async function extractArticleContent(page) {
  return await page.evaluate(() => {
    const output = [];
    let globalCounter = 0; // Global counter for all visual elements (matches screenshot script)
    const katexMap = new Map(); // Track unique katex formulas for referencing
    
    // Helper: clean text
    const cleanText = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    
    // Helper: strip HTML
    const stripHtml = (html) => {
      const div = document.createElement('div');
      div.innerHTML = html;
      return cleanText(div.textContent || '');
    };
    
    // Helper: get element ID or generate anchor
    const getAnchor = (el) => {
      if (el.id) return el.id;
      // Try to find ID in parent figure
      const figure = el.closest('figure');
      if (figure?.id) return figure.id;
      return '';
    };
    
    // Helper: parse caption to extract name and description
    const parseCaptionText = (captionText, type = 'Figure') => {
      if (!captionText) return { name: '', description: '' };
      
      // Try to match patterns like:
      // "Figure 1: Description"
      // "Table 2: Description"  
      // "Fig. 3: Description"
      const patterns = [
        new RegExp(`^(${type}\\s*\\d+[a-z]?)\\s*[:\\-–—]\\s*(.+)$`, 'i'),
        new RegExp(`^(Fig\\.?\\s*\\d+[a-z]?)\\s*[:\\-–—]\\s*(.+)$`, 'i'),
        new RegExp(`^(Table\\s*\\d+[a-z]?)\\s*[:\\-–—]\\s*(.+)$`, 'i'),
      ];
      
      for (const pattern of patterns) {
        const match = captionText.match(pattern);
        if (match) {
          return { name: match[1].trim(), description: match[2].trim() };
        }
      }
      
      // No pattern found, entire text is description
      return { name: '', description: captionText.trim() };
    };
    
    // ── Reusable inline content processor ──────────────────────────────
    // Walks inline DOM nodes and produces tagged text for bold, italic,
    // links, inline code, inline katex, citations/references.
    const processInlineContent = (parentNode) => {
      let result = '';
      const walk = (n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          // Strip stray Markdown bold markers that leaked into the prose as
          // literal text (Notion comment residue produces unbalanced "**",
          // e.g. "evals.** Although" or "NVLink** is"). Only prose text nodes
          // are walked here: inline code (<code>) and block code (<pre>) are
          // handled by their own branches and never reach this path, so real
          // "**" in code stays intact.
          result += n.textContent.replace(/\*{2,}/g, '');
          return;
        }
        const tag = n.tagName?.toLowerCase();

        // Inline code (not inside <pre>)
        if (tag === 'code' && !n.closest('pre')) {
          result += `<ic>${cleanText(n.textContent)}</ic>`;
          return;
        }

        // Inline KaTeX
        if (n.classList?.contains('katex')) {
          // A .katex node holds three copies of the formula (MathML, the
          // x-tex annotation, and the HTML render), so textContent would emit
          // each variable ~3 times. Use only the raw TeX annotation.
          const tex = n.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
          result += `<il>${cleanText(tex || n.textContent || '')}</il>`;
          return;
        }

        // Bold
        if (tag === 'strong' || tag === 'b') {
          const inner = processInlineContent(n);
          if (inner) result += `<b>${inner}</b>`;
          return;
        }

        // Italic
        if (tag === 'em' || tag === 'i') {
          const inner = processInlineContent(n);
          if (inner) result += `<i>${inner}</i>`;
          return;
        }

        // Links
        if (tag === 'a') {
          const href = n.getAttribute('href') || '';
          const inner = processInlineContent(n);
          if (href && inner) {
            result += `<a href="${href}">${inner}</a>`;
          } else if (inner) {
            result += inner;
          }
          return;
        }

        // Superscript (often used for citations/footnotes)
        if (tag === 'sup') {
          const inner = cleanText(n.textContent || '');
          if (inner) result += `<ref>${inner}</ref>`;
          return;
        }

        // Mark / highlight
        if (tag === 'mark') {
          const inner = processInlineContent(n);
          if (inner) result += `<b>${inner}</b>`;
          return;
        }

        // Skip display-level elements inside inline context
        if (['div', 'figure', 'table', 'pre', 'ul', 'ol'].includes(tag)) return;

        // Recurse into children
        if (n.childNodes) {
          n.childNodes.forEach(walk);
        }
      };
      if (parentNode.childNodes) {
        parentNode.childNodes.forEach(walk);
      }
      return result.trim();
    };

    // Process main content
    const main = document.querySelector('main');
    if (!main) return 'Error: main element not found';
    
    // Helper: get all visual elements in DOM order from the whole document
    // (same scope as screenshot script which queries the full page)
    const allVisualElements = Array.from(document.querySelectorAll('.html-embed, .table-scroll > table, .image-wrapper, .katex-display'));
    const elementIndexMap = new Map();
    
    // Helper: slugify (same as screenshot script)
    const slugifyLabel = (text) => String(text || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
    
    // Helper: extract label from element (same logic as screenshot script)
    const getElementLabel = (el) => {
      if (el.classList.contains('html-embed')) {
        const btn = el.querySelector('.html-embed__download');
        const filename = btn?.getAttribute('data-filename') || '';
        if (filename) return filename;
        const title = el.querySelector('.html-embed__title');
        if (title?.textContent) return title.textContent;
      }
      const getAttr = (name) => el.getAttribute(name) || '';
      const direct = getAttr('data-title') || getAttr('data-name') || getAttr('data-label')
        || getAttr('data-slug') || getAttr('aria-label') || getAttr('title') || getAttr('id');
      if (direct) return direct;
      if (el.tagName.toLowerCase() === 'table') {
        const caption = el.querySelector('caption');
        if (caption) return caption.textContent || '';
      }
      const img = el.querySelector('img');
      if (img) return img.getAttribute('alt') || img.getAttribute('title') || '';
      const heading = el.querySelector('h1,h2,h3,h4,h5,h6');
      if (heading) return heading.textContent || '';
      return '';
    };
    
    // Helper: get element type (same as screenshot script)
    const getElementType = (el) => {
      if (el.matches('.html-embed')) return 'embed';
      if (el.matches('.table-scroll > table')) return 'table';
      if (el.matches('.image-wrapper')) return 'image';
      if (el.matches('.katex-display')) return 'katex';
      return 'unknown';
    };
    
    // Pre-process: assign screenshot-matching baseName to visual elements
    allVisualElements.forEach((el, idx) => {
      const type = getElementType(el);
      const label = getElementLabel(el);
      const slug = slugifyLabel(label);
      const baseName = `${idx + 1}-${type}${slug ? '--' + slug : ''}`;
      elementIndexMap.set(el, baseName);
    });
    
    // Walk through all child nodes
    const processNode = (node) => {
      const tag = node.tagName?.toLowerCase();
      
      // Headings
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1]);
        const text = cleanText(node.textContent);
        const hashes = '#'.repeat(level);
        output.push(`\n${hashes} ${text}\n`);
        return;
      }
      
      // Paragraphs
      if (tag === 'p') {
        const text = node.textContent?.trim();
        if (text) {
          // Process inline elements within paragraph
          output.push(processInlineContent(node) + '\n');
        }
        return;
      }
      
      // Display math (KaTeX)
      if (node.classList?.contains('katex-display')) {
        // Skip empty display-math blocks (stray "$$ $$" in the source render
        // as a .katex-display with no TeX annotation and would otherwise emit
        // a blank formula ref, e.g. <l>69-katex</l>). We do NOT renumber: the
        // global index is kept in sync with the screenshot export.
        const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '';
        if (!tex.trim()) return;
        const baseName = elementIndexMap.get(node);
        if (baseName) {
          output.push(`<l>${baseName}</l>\n`);
        }
        return;
      }
      
      // Code blocks
      if (tag === 'pre') {
        const code = node.querySelector('code');
        if (code) {
          const codeText = code.textContent || '';
          const language = code.className.match(/language-(\w+)/)?.[1] || '';
          
          // Try to find description from parent or next sibling
          let description = '';
          const figure = node.closest('figure');
          if (figure) {
            const caption = figure.querySelector('figcaption');
            if (caption) description = stripHtml(caption.innerHTML);
          }
          
          if (description) {
            output.push(`<c>${codeText.trim()} | ${description}</c>\n`);
          } else {
            output.push(`<c>${codeText.trim()}</c>\n`);
          }
        }
        return;
      }
      
      // Tables
      if (tag === 'table') {
        // Check if this table is in a .table-scroll container (visual element)
        const tableScroll = node.closest('.table-scroll');
        const baseName = tableScroll ? elementIndexMap.get(node) : null;
        
        // Skip if not a tracked table, but still recurse
        if (!baseName) {
          return;
        }
        
        const figure = node.closest('figure');
        let name = '';
        let description = '';
        let anchor = '';
        
        if (figure) {
          anchor = getAnchor(figure);
          const caption = figure.querySelector('figcaption');
          if (caption) {
            const captionText = stripHtml(caption.innerHTML);
            const parsed = parseCaptionText(captionText, 'Table');
            name = parsed.name;
            description = parsed.description;
          }
        }
        
        // If no name found, use the screenshot baseName
        if (!name) {
          name = baseName;
        }
        
        // Build the tag
        const parts = [name];
        if (anchor) parts.push(anchor);
        if (description) parts.push(description);
        
        output.push(`<t>${parts.join(' | ')}</t>\n`);
        
        // Extract table as simple text representation
        const rows = Array.from(node.querySelectorAll('tr'));
        const tableText = rows.map(row => {
          const cells = Array.from(row.querySelectorAll('th, td'));
          // Use processInlineContent so inline KaTeX in a cell is read from its
          // TeX annotation (<il>…</il>) instead of the whole .katex node, which
          // holds MathML + TeX + HTML and would triple the formula
          // (e.g. header "(dmodel)(d_\text{model})(dmodel)").
          return cells.map(cell => processInlineContent(cell) || cleanText(cell.textContent)).join(' | ');
        }).join('\n');
        
        output.push(tableText + '\n\n');
        return;
      }
      
      // Standalone .image-wrapper (not inside a <figure>)
      if (node.classList?.contains('image-wrapper') && !node.closest('figure')) {
        const baseName = elementIndexMap.get(node);
        if (baseName) {
          const img = node.querySelector('img');
          const alt = img?.alt || '';
          const parts = [baseName];
          if (alt) parts.push(alt);
          output.push(`<f>${parts.join(' | ')}</f>\n\n`);
        }
        return;
      }
      
      // Figures (images, embeds)
      if (tag === 'figure') {
        const img = node.querySelector('img');
        const htmlEmbed = node.querySelector('.html-embed, .html-embed--screenshot');
        const imageWrapper = node.querySelector('.image-wrapper');
        const caption = node.querySelector('figcaption');
        
        // Skip if it's not really a figure (no img, no embed, no caption)
        if (!img && !htmlEmbed && !imageWrapper && !caption) return;
        
        // Try to find the screenshot baseName from the visual element
        const visualElement = htmlEmbed || imageWrapper || node;
        const baseName = elementIndexMap.get(visualElement);
        
        if (!baseName) return; // Skip if not tracked
        
        let name = '';
        let anchor = getAnchor(node);
        let description = '';
        
        if (caption) {
          const captionText = stripHtml(caption.innerHTML);
          const parsed = parseCaptionText(captionText, 'Figure');
          name = parsed.name;
          description = parsed.description;
        }
        
        // Get image alt text as fallback for description
        if (!description && img?.alt) {
          description = img.alt;
        }
        
        // If no name found in caption, use the screenshot baseName
        if (!name) {
          name = baseName;
        }
        
        // Build the tag: <f> NAME ANCHOR DESCRIPTION </f>
        const parts = [name];
        if (anchor) parts.push(anchor);
        if (description) parts.push(description);
        
        output.push(`<f>${parts.join(' | ')}</f>\n\n`);
        return;
      }
      
      // Lists
      if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(node.querySelectorAll(':scope > li'));
        items.forEach((item, idx) => {
          const bullet = tag === 'ul' ? '-' : `${idx + 1}.`;
          const text = processInlineContent(item);
          output.push(`${bullet} ${text}\n`);
        });
        output.push('\n');
        return;
      }
      
      // Blockquotes
      if (tag === 'blockquote') {
        const text = processInlineContent(node);
        output.push(`> ${text}\n\n`);
        return;
      }
      
      // Notes (Note component and Sidenote)
      // DOM structure: .note > .note__body > .note__header > .note__title
      //                                   > .note__content > <slot/> (body)
      if (node.classList?.contains('note') || node.classList?.contains('sidenote')) {
        const titleEl = node.querySelector('.note__title, .note-title');
        const title = cleanText(titleEl?.textContent || '');
        
        // Target .note__content directly — that's where the slot body lives
        const contentEl = node.querySelector('.note__content');
        let body = '';
        
        if (contentEl) {
          // Process each child inside .note__content (paragraphs, lists, etc.)
          for (const child of contentEl.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              const t = child.textContent.trim();
              if (t) body += t + ' ';
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const childTag = child.tagName?.toLowerCase();
              // Handle lists inside notes
              if (childTag === 'ul' || childTag === 'ol') {
                const items = Array.from(child.querySelectorAll(':scope > li'));
                for (const item of items) {
                  body += '– ' + processInlineContent(item) + ' ';
                }
              } else {
                body += processInlineContent(child) + ' ';
              }
            }
          }
        } else {
          // Fallback: process all children except title
          const bodyNodes = Array.from(node.children).filter(
            (c) => c !== titleEl && !c.classList?.contains('note__title') && !c.classList?.contains('note-title'),
          );
          for (const child of bodyNodes) {
            body += processInlineContent(child) + ' ';
          }
        }
        body = body.replace(/\s+/g, ' ').trim();
        
        if (title && body) {
          output.push(`<n><b>${title}</b> | ${body}</n>\n\n`);
        } else if (title) {
          output.push(`<n><b>${title}</b></n>\n\n`);
        } else if (body) {
          output.push(`<n>${body}</n>\n\n`);
        }
        return;
      }
      
      // Recurse through children for unhandled elements
      if (node.children && node.children.length > 0 && !['pre', 'code', 'table', 'figure'].includes(tag)) {
        try {
          Array.from(node.children).forEach(processNode);
        } catch (e) {
          console.error('Error processing children:', e);
        }
      }
    };
    
    // Process all direct children of main
    Array.from(main.children).forEach(processNode);
    
    // Add metadata about visual elements
    const katexCount = Array.from(main.querySelectorAll('.katex-display')).length;
    if (katexCount > 0) {
      output.push(`\n\n<!-- Visual elements are numbered globally in DOM order (1, 2, 3...) to match exported screenshots -->\n`);
      output.push(`<!-- KaTeX formulas: ${katexCount} formulas exported as N-katex.png where N is the global index -->\n`);
    }
    
    return output.join('');
  });
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv);
  
  let outFileBase = args.filename || 'article';
  outFileBase = outFileBase.replace(/\.txt$/i, '');
  
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
  // Capture stdout/stderr to detect the actual port used
  let capturedPort = 8080;
  let sawPreviewUrl = false;

  const maybeCapturePort = (output) => {
    const match = output.match(/http:\/\/localhost:(\d+)\//);
    if (match) {
      capturedPort = parseInt(match[1]);
      sawPreviewUrl = true;
    }
  };

  const previewPortEnv = process.env.PREVIEW_PORT ? Number(process.env.PREVIEW_PORT) : null;
  if (previewPortEnv) {
    capturedPort = previewPortEnv;
    sawPreviewUrl = true;
  }

  const preview = spawn('npm', ['run', 'preview'], { 
    cwd, 
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true 
  });
  
  preview.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);
    maybeCapturePort(output);
  });
  
  preview.stderr.on('data', (data) => {
    const output = data.toString();
    process.stderr.write(output);
    maybeCapturePort(output);
  });
  
  const previewExit = new Promise((resolvePreview) => {
    preview.on('close', (code, signal) => resolvePreview({ code, signal }));
  });

  const getBaseUrl = () => {
    if (!sawPreviewUrl) return null;
    return `http://localhost:${capturedPort}/`;
  };
  
  try {
    await waitForServer(getBaseUrl, 60000);
    const baseUrl = getBaseUrl();
    console.log(`> Server ready (${baseUrl}), extracting content…`);
    
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Set viewport
      await page.setViewportSize({ width: 1200, height: 1400 });
      
      // Load page (use 'load' instead of 'networkidle' to avoid timeout on heavy pages)
      await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
      
      // Wait for content to be ready
      await page.waitForTimeout(3000);
      
      // Wait for main content to be present
      await page.waitForSelector('main', { timeout: 10000 });
      
      // Get article title for filename
      if (!args.filename) {
        const title = await page.evaluate(() => {
          const h1 = document.querySelector('h1.hero-title');
          const t = h1 ? h1.textContent : document.title;
          return (t || '').replace(/\s+/g, ' ').trim();
        });
        outFileBase = slugify(title);
      }
      
      console.log('> Extracting article content…');
      let txtContent = await extractArticleContent(page);
      
      // Optional code wrapping
      const wrapCode = parseBoolean(args['wrap-code'], true);
      const codeWidth = Number(args['code-width']) || 80;
      if (wrapCode) {
        txtContent = wrapCodeBlocksInTxt(txtContent, codeWidth);
        console.log(`> Code blocks wrapped at ${codeWidth} columns`);
      }
      
      // Write output
      const outPath = resolve(cwd, 'dist', `${outFileBase}.txt`);
      await fs.writeFile(outPath, txtContent, 'utf-8');
      console.log(`✅ TXT exported: ${outPath}`);
      
      // Copy to public folder
      const publicPath = resolve(cwd, 'public', `${outFileBase}.txt`);
      try {
        await fs.mkdir(resolve(cwd, 'public'), { recursive: true });
        await fs.copyFile(outPath, publicPath);
        console.log(`✅ TXT copied to: ${publicPath}`);
      } catch (e) {
        console.warn('Unable to copy TXT to public/:', e?.message || e);
      }
      
    } finally {
      await browser.close();
    }
  } finally {
    // Clean shutdown
    try {
      if (process.platform !== 'win32') {
        try { process.kill(-preview.pid, 'SIGINT'); } catch { }
      }
      try { preview.kill('SIGINT'); } catch { }
      await Promise.race([previewExit, delay(3000)]);
      
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
  console.error('❌ Error:', err.message);
  console.error(err);
  process.exit(1);
});

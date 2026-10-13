#!/usr/bin/env node

/**
 * Export TXT to DOCX format for book publishing
 * 
 * This script converts the exported TXT file to a simple DOCX document:
 * - Preserves headings, paragraphs, lists
 * - Renders inline formatting: <b> bold, <i> italic, <a> links, <ref> citations
 * - Renders <ic> inline code, <il> inline LaTeX
 * - Keeps block tags (<f>, <t>, <l>, <n>) with color coding
 * - Formats code blocks
 * - Creates a clean document ready for further editing
 * 
 * Usage:
 *   node scripts/export-docx.mjs [--input=path/to/file.txt]
 *   npm run export:docx
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LineRuleType } from 'docx';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.replace(/^--/, '').split('=');
    out[k] = v === undefined ? true : v;
  }
  return out;
}

function detectHeadingLevel(line) {
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (!match) return null;
  const level = match[1].length;
  const text = match[2].trim();
  return { level, text };
}

/**
 * Extract simple properties from a TextRun for re-wrapping.
 * docx TextRun stores options internally — this grabs what we need.
 */
function extractRunProps(run) {
  // TextRun constructor options are stored in run.options (docx ≥ 8)
  const opts = run.options || {};
  // Handle string-constructed TextRun: new TextRun("text")
  if (typeof opts === 'string') {
    return { text: opts };
  }
  return {
    text: opts.text || '',
    bold: opts.bold,
    italics: opts.italics,
    font: opts.font,
    color: opts.color,
    underline: opts.underline,
    superScript: opts.superScript,
    shading: opts.shading,
    size: opts.size,
    characterSpacing: opts.characterSpacing,
  };
}

function parseInlineFormatting(text) {
  const runs = [];
  let pos = 0;

  // Match all supported inline tags (including nested content)
  // Order matters: longer tag names first to avoid partial matches
  const tagPattern = /<(ic|il|ref|b|i|a)(\s[^>]*)?>([^<]*(?:<(?!\/\1>)[^<]*)*)<\/\1>/g;
  let match;

  while ((match = tagPattern.exec(text)) !== null) {
    // Text before the tag
    if (match.index > pos) {
      const before = text.substring(pos, match.index);
      if (before) runs.push(new TextRun(before));
    }

    const tagType = match[1];
    const attrs = match[2] || '';
    const content = match[3];

    switch (tagType) {
      case 'ic':
        runs.push(new TextRun({
          text: content,
          font: { name: 'Courier New' },
          size: 20, // 10pt — slightly smaller than body text
          color: '333333',
          shading: { fill: 'E8E8E8', type: 'clear' },
          characterSpacing: 10, // slight letter-spacing for readability
        }));
        break;

      case 'il':
        runs.push(new TextRun({
          text: content,
          italics: true,
          color: '0066CC',
        }));
        break;

      case 'b':
        // Bold — check for nested tags, otherwise simple bold
        if (content.includes('<')) {
          // Has nested tags: parse inner content and add bold to each run
          for (const innerRun of parseInlineFormatting(content)) {
            // Extract properties from existing run and add bold
            const props = {};
            if (innerRun.properties) Object.assign(props, innerRun.properties);
            runs.push(new TextRun({ ...extractRunProps(innerRun), bold: true }));
          }
        } else {
          runs.push(new TextRun({ text: content, bold: true }));
        }
        break;

      case 'i':
        if (content.includes('<')) {
          for (const innerRun of parseInlineFormatting(content)) {
            runs.push(new TextRun({ ...extractRunProps(innerRun), italics: true }));
          }
        } else {
          runs.push(new TextRun({ text: content, italics: true }));
        }
        break;

      case 'a': {
        // Link — extract href, render as underlined blue text
        const hrefMatch = attrs.match(/href="([^"]*)"/);
        const href = hrefMatch ? hrefMatch[1] : '';
        // Parse inner content for nested tags (e.g. <a><b>bold link</b></a>)
        if (content.includes('<')) {
          for (const innerRun of parseInlineFormatting(content)) {
            runs.push(new TextRun({
              ...extractRunProps(innerRun),
              color: '0066CC',
              underline: { type: 'single' },
            }));
          }
        } else {
          runs.push(new TextRun({
            text: content,
            color: '0066CC',
            underline: { type: 'single' },
          }));
        }
        // Add the URL in parentheses if it's a full URL
        if (href && href.startsWith('http')) {
          runs.push(new TextRun({
            text: ` [${href}]`,
            color: '888888',
            size: 18,
          }));
        }
        break;
      }

      case 'ref':
        runs.push(new TextRun({
          text: content,
          superScript: true,
          color: '0066CC',
        }));
        break;

      default:
        runs.push(new TextRun(match[0]));
    }

    pos = match.index + match[0].length;
  }

  // Remaining text after last tag
  if (pos < text.length) {
    runs.push(new TextRun(text.substring(pos)));
  }

  return runs.length > 0 ? runs : [new TextRun(text)];
}

/**
 * Convert a code block (array of lines) into a DOCX Paragraph with proper
 * line breaks. Uses Courier New + gray background shading.
 */
function codeBlockToParagraph(codeLines) {
  const runs = [];
  for (let i = 0; i < codeLines.length; i++) {
    if (i > 0) runs.push(new TextRun({ break: 1 }));
    runs.push(new TextRun({
      text: codeLines[i],
      font: 'Courier New',
      size: 18,
      color: '333333',
    }));
  }
  return new Paragraph({
    children: runs,
    shading: { fill: 'F5F5F5', type: 'clear' },
    spacing: {
      before: 200,
      after: 200,
      line: 276,
      lineRule: LineRuleType.AUTO,
    },
  });
}

async function convertTxtToDocx(txtPath, outputPath) {
  console.log(`📖 Reading TXT file: ${txtPath}`);
  const content = await fs.readFile(txtPath, 'utf-8');
  const lines = content.split('\n');
  
  const paragraphs = [];
  let inCodeBlock = false;
  let codeLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines unless in code block
    if (!line.trim() && !inCodeBlock) {
      paragraphs.push(new Paragraph({ text: '' }));
      continue;
    }
    
    // Handle code blocks <c>...</c>
    if (line.trim().startsWith('<c>')) {
      inCodeBlock = true;
      codeLines = [];
      // Single-line code block: <c>code</c>
      if (line.trim().endsWith('</c>') && line.trim() !== '<c></c>') {
        const inner = line.trim().replace(/^<c>/, '').replace(/<\/c>$/, '');
        if (inner) codeLines.push(inner);
        paragraphs.push(codeBlockToParagraph(codeLines));
        inCodeBlock = false;
        codeLines = [];
        continue;
      }
      const firstLine = line.replace(/^<c>\s*/, '').trimStart();
      if (firstLine && !firstLine.startsWith('</c>')) {
        codeLines.push(firstLine);
      }
      continue;
    }
    
    if (line.trim().endsWith('</c>')) {
      const lastLine = line.replace(/<\/c>\s*$/, '');
      if (lastLine) codeLines.push(lastLine);
      
      // Add code block as paragraph with proper line breaks
      paragraphs.push(codeBlockToParagraph(codeLines));
      
      inCodeBlock = false;
      codeLines = [];
      continue;
    }
    
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    
    // Handle figure tags <f>...</f>
    if (line.trim().startsWith('<f>')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({
          text: line.trim(),
          color: '0066CC',
          bold: true
        })],
        spacing: { before: 200, after: 100 }
      }));
      continue;
    }
    
    // Handle table tags <t>...</t>
    if (line.trim().startsWith('<t>')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({
          text: line.trim(),
          color: '009688',
          bold: true
        })],
        spacing: { before: 200, after: 100 }
      }));
      continue;
    }
    
    // Handle LaTeX display tags <l>...</l>
    if (line.trim().startsWith('<l>')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({
          text: line.trim(),
          color: '9C27B0',
          bold: true
        })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 }
      }));
      continue;
    }
    
    // Handle note/callout tags <n>...</n>
    if (line.trim().startsWith('<n>') && line.trim().endsWith('</n>')) {
      const inner = line.trim().replace(/^<n>/, '').replace(/<\/n>$/, '');
      paragraphs.push(new Paragraph({
        children: parseInlineFormatting(inner),
        indent: { left: 360 },
        shading: { fill: 'FFF8E1', type: 'clear' },
        spacing: { before: 200, after: 200 },
      }));
      continue;
    }
    
    // Handle headings
    const heading = detectHeadingLevel(line);
    if (heading) {
      const headingLevels = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6
      };
      
      paragraphs.push(new Paragraph({
        text: heading.text,
        heading: headingLevels[heading.level],
        spacing: { before: 400, after: 200 }
      }));
      continue;
    }
    
    // Handle list items
    if (line.trim().startsWith('- ')) {
      const text = line.trim().substring(2);
      paragraphs.push(new Paragraph({
        children: parseInlineFormatting(text),
        bullet: { level: 0 },
        spacing: { before: 100, after: 100 }
      }));
      continue;
    }
    
    // Handle numbered lists
    const numberedMatch = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      const text = numberedMatch[2];
      paragraphs.push(new Paragraph({
        children: parseInlineFormatting(text),
        numbering: { reference: 'default-numbering', level: 0 },
        spacing: { before: 100, after: 100 }
      }));
      continue;
    }
    
    // Handle blockquotes
    if (line.trim().startsWith('> ')) {
      const text = line.trim().substring(2);
      paragraphs.push(new Paragraph({
        children: parseInlineFormatting(text),
        italics: true,
        indent: { left: 720 },
        spacing: { before: 200, after: 200 }
      }));
      continue;
    }
    
    // Regular paragraph
    if (line.trim()) {
      paragraphs.push(new Paragraph({
        children: parseInlineFormatting(line.trim()),
        spacing: { before: 100, after: 100 }
      }));
    }
  }
  
  console.log(`📝 Creating DOCX with ${paragraphs.length} paragraphs...`);
  
  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs
    }]
  });
  
  console.log(`💾 Writing DOCX to: ${outputPath}`);
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);
  
  console.log(`✅ DOCX created successfully!`);
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv);
  
  const inputPath = args.input || resolve(cwd, 'dist', 'the-smol-training-playbook-the-secrets-to-building-world-class-llms.txt');
  const outputPath = args.output || inputPath.replace('.txt', '.docx');
  
  // Check if input exists
  try {
    await fs.access(inputPath);
  } catch {
    console.error(`❌ Error: Input file not found: ${inputPath}`);
    console.error('   Run "npm run export:txt" first to generate the TXT file.');
    process.exit(1);
  }
  
  await convertTxtToDocx(inputPath, outputPath);
  
  // Also copy to public folder
  const publicPath = outputPath.replace('/dist/', '/public/');
  try {
    await fs.mkdir(resolve(cwd, 'public'), { recursive: true });
    await fs.copyFile(outputPath, publicPath);
    console.log(`✅ DOCX copied to: ${publicPath}`);
  } catch (e) {
    console.warn('Unable to copy DOCX to public/:', e?.message || e);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Export bundle: TXT + DOCX + screenshots → ZIP archive
 *
 * Runs the three export steps in sequence, gathers all outputs
 * into a single folder, and creates a .zip archive.
 *
 * Usage:
 *   node scripts/export-bundle.mjs
 *   npm run export:bundle
 *
 * Output: dist/{slug}-bundle.zip
 */

import { spawn } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import process from 'node:process';
import { execSync } from 'node:child_process';

const cwd = process.cwd();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(command, args = [], options = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`  $ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`"${command} ${args.join(' ')}" exited with code ${code}`));
    });
  });
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function findFiles(dir, pattern) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && pattern.test(entry.name)) {
        results.push(join(dir, entry.name));
      }
    }
  } catch { /* dir may not exist */ }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const distDir = resolve(cwd, 'dist');
  const screenshotsDir = resolve(cwd, 'screenshots');

  console.log('📦 Export Bundle: TXT + DOCX + Images → ZIP\n');

  // ── Step 1: Export TXT ────────────────────────────────────────────────────
  console.log('━'.repeat(60));
  console.log('1/3  Exporting TXT…');
  console.log('━'.repeat(60));
  await run('node', ['scripts/export-txt.mjs']);
  console.log();

  // Find the generated TXT file
  const txtFiles = await findFiles(distDir, /\.txt$/);
  if (txtFiles.length === 0) {
    console.error('❌ No TXT file found in dist/ after export:txt');
    process.exit(1);
  }
  const txtPath = txtFiles[0];
  const slug = basename(txtPath, '.txt');
  console.log(`  → Found: ${basename(txtPath)}`);

  // ── Step 2: Export DOCX ───────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('2/3  Exporting DOCX…');
  console.log('━'.repeat(60));
  await run('node', ['scripts/export-docx.mjs', `--input=${txtPath}`]);
  console.log();

  const docxPath = txtPath.replace('.txt', '.docx');
  if (!(await exists(docxPath))) {
    console.error('❌ DOCX file not found after export:docx');
    process.exit(1);
  }
  console.log(`  → Found: ${basename(docxPath)}`);

  // ── Step 3: Export Images ─────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('3/3  Exporting screenshots…');
  console.log('━'.repeat(60));
  await run('node', ['scripts/screenshot-elements.mjs']);
  console.log();

  if (!(await exists(screenshotsDir))) {
    console.error('❌ screenshots/ folder not found after export:images');
    process.exit(1);
  }

  // Count screenshots
  const pngFiles = await findFiles(screenshotsDir, /\.png$/);
  console.log(`  → Found: ${pngFiles.length} screenshots`);

  // ── Step 4: Assemble bundle folder ────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('4/4  Creating archive…');
  console.log('━'.repeat(60));

  const bundleDir = resolve(distDir, `${slug}-bundle`);
  const imagesDir = join(bundleDir, 'images');

  // Clean previous bundle
  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.mkdir(imagesDir, { recursive: true });

  // Copy TXT
  await fs.copyFile(txtPath, join(bundleDir, basename(txtPath)));
  console.log(`  ✅ ${basename(txtPath)}`);

  // Copy DOCX
  await fs.copyFile(docxPath, join(bundleDir, basename(docxPath)));
  console.log(`  ✅ ${basename(docxPath)}`);

  // Copy screenshots
  for (const png of pngFiles) {
    await fs.copyFile(png, join(imagesDir, basename(png)));
  }
  console.log(`  ✅ images/ (${pngFiles.length} files)`);

  // ── Step 5: Create ZIP ────────────────────────────────────────────────────
  const zipPath = resolve(distDir, `${slug}-bundle.zip`);

  // Remove old zip
  try { await fs.unlink(zipPath); } catch { /* ok */ }

  // Use system zip command (available on macOS/Linux)
  execSync(
    `cd "${distDir}" && zip -r "${basename(zipPath)}" "${basename(bundleDir)}"`,
    { stdio: 'inherit' },
  );

  const zipStat = await fs.stat(zipPath);
  const sizeMB = (zipStat.size / 1024 / 1024).toFixed(1);

  // Clean up bundle folder (keep only the zip)
  await fs.rm(bundleDir, { recursive: true, force: true });

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`🎉 Bundle created: dist/${basename(zipPath)} (${sizeMB} MB)`);
  console.log(`   Contents: ${basename(txtPath)}, ${basename(docxPath)}, ${pngFiles.length} images`);
  console.log('━'.repeat(60));

  // Also copy to public/
  const publicZip = resolve(cwd, 'public', basename(zipPath));
  await fs.mkdir(resolve(cwd, 'public'), { recursive: true });
  await fs.copyFile(zipPath, publicZip);
  console.log(`   → Copied to public/${basename(zipPath)}`);
}

main().catch((err) => {
  console.error('❌ Bundle failed:', err.message);
  process.exit(1);
});

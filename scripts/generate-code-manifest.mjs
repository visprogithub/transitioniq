#!/usr/bin/env node
import { readdir, readFile, stat, writeFile, mkdir } from 'fs/promises';
import { join, relative, extname } from 'path';

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, 'src', 'generated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'code-manifest.json');

const INCLUDE_PATHS = [
  'README.md',
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'postcss.config.mjs',
  'eslint.config.mjs',
  'vercel.json',
  'src',
];

const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  '.env',
  '.next',
  'src/generated',
  'package-lock.json',
];

const LANGUAGE_MAP = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.mjs': 'javascript',
};

function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some(pattern => filePath.includes(pattern));
}

function getLanguage(ext) {
  return LANGUAGE_MAP[ext] || 'text';
}

async function walkDirectory(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(ROOT, fullPath);

    if (shouldExclude(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...await walkDirectory(fullPath));
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      try {
        const content = await readFile(fullPath, 'utf-8');
        const stats = await stat(fullPath);
        files.push({
          path: relativePath,
          content,
          language: getLanguage(ext),
          size: stats.size,
        });
      } catch (err) {
        console.warn(`Skipping ${relativePath}: ${err.message}`);
      }
    }
  }

  return files;
}

async function main() {
  console.log('Generating code manifest...');

  const files = [];

  for (const includePath of INCLUDE_PATHS) {
    const fullPath = join(ROOT, includePath);
    try {
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        files.push(...await walkDirectory(fullPath));
      } else if (stats.isFile()) {
        const ext = extname(includePath);
        const content = await readFile(fullPath, 'utf-8');
        files.push({
          path: includePath,
          content,
          language: getLanguage(ext),
          size: stats.size,
        });
      }
    } catch (err) {
      console.warn(`Skipping ${includePath}: ${err.message}`);
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(manifest));
  console.log(`Generated manifest with ${files.length} files`);
}

main().catch(err => {
  console.error('Failed to generate manifest:', err);
  process.exit(1);
});

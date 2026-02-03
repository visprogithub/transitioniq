#!/usr/bin/env node
import { readdir, readFile, stat, writeFile, mkdir } from 'fs/promises';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';

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
    const relativePath = relative(ROOT, fullPath).replace(/\\/g, '/');

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

  // Unshallow Vercel's shallow clone so we get full history
  try {
    execSync('git fetch --unshallow', { cwd: ROOT, encoding: 'utf-8' });
  } catch {
    // Already a full clone (local dev) — ignore
  }

  // Capture full git history
  let gitLog = '';
  try {
    gitLog = execSync(
      'git log --pretty=format:"%h|%an|%ad|%s" --date=short',
      { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );
    console.log(`Captured ${gitLog.split('\n').length} git commits`);
  } catch (err) {
    console.warn('Could not capture git history:', err.message);
  }

  const gitHistory = gitLog
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return { hash, author, date, message: msgParts.join('|') };
    });

  // Capture diffs for each commit
  const MAX_DIFF_SIZE = 50 * 1024; // 50KB cap per commit
  for (const commit of gitHistory) {
    try {
      // Try parent diff first, fall back to --root for initial commit
      // Use ~1 instead of ^ because Windows cmd interprets ^ as escape
      let diff = '';
      try {
        diff = execSync(
          `git diff ${commit.hash}~1..${commit.hash} -- ${INCLUDE_PATHS.join(' ')}`,
          { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
        );
      } catch {
        try {
          diff = execSync(
            `git diff --root ${commit.hash} -- ${INCLUDE_PATHS.join(' ')}`,
            { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
          );
        } catch {
          // skip this commit's diff
        }
      }

      if (diff && diff.length <= MAX_DIFF_SIZE) {
        commit.diff = diff;
      } else if (diff) {
        commit.diff = diff.slice(0, MAX_DIFF_SIZE) + '\n\n... diff truncated (exceeded 50KB) ...';
      }

      // Get stat summary
      try {
        const stat = execSync(
          `git diff --stat ${commit.hash}~1..${commit.hash} -- ${INCLUDE_PATHS.join(' ')}`,
          { cwd: ROOT, encoding: 'utf-8', maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
        );
        const summaryMatch = stat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
        if (summaryMatch) {
          commit.filesChanged = parseInt(summaryMatch[1]) || 0;
          commit.insertions = parseInt(summaryMatch[2]) || 0;
          commit.deletions = parseInt(summaryMatch[3]) || 0;
        }
      } catch {
        // stat for root commit
        try {
          const stat = execSync(
            `git diff --stat --root ${commit.hash} -- ${INCLUDE_PATHS.join(' ')}`,
            { cwd: ROOT, encoding: 'utf-8', maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
          );
          const summaryMatch = stat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
          if (summaryMatch) {
            commit.filesChanged = parseInt(summaryMatch[1]) || 0;
            commit.insertions = parseInt(summaryMatch[2]) || 0;
            commit.deletions = parseInt(summaryMatch[3]) || 0;
          }
        } catch {
          // skip
        }
      }
    } catch (err) {
      console.warn(`Could not capture diff for ${commit.hash}: ${err.message}`);
    }
  }
  console.log(`Captured diffs for ${gitHistory.filter(c => c.diff).length}/${gitHistory.length} commits`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
    gitHistory,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(manifest));
  console.log(`Generated manifest with ${files.length} files`);
}

main().catch(err => {
  console.error('Failed to generate manifest:', err);
  process.exit(1);
});

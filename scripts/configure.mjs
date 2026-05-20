#!/usr/bin/env node
// configure.mjs — set the backup destination repo + which projects to sync.
//
// Usage:
//   node scripts/configure.mjs --backup-repo=/abs/path/to/backup/repo
//   node scripts/configure.mjs --include=base-* --exclude=temp-*
//   node scripts/configure.mjs --reset-projects
//   node scripts/configure.mjs /abs/path/to/backup/repo   (positional)
//
// Writes ~/.claude/memory-sync.config.json with:
//   {
//     tool_repo_path,
//     backup_repo_path,
//     projects: { include: [...], exclude: [...] }
//   }
//
// Idempotent. Re-run any time to switch backup repo or update selection.
// When --backup-repo is omitted, the existing backup_repo_path is preserved.
// --include and --exclude APPEND to the existing lists (deduplicated).
// --reset-projects clears include + exclude (back to defaults: all included).

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, '..');
const CLAUDE_DIR = join(homedir(), '.claude');
const CONFIG_PATH = join(CLAUDE_DIR, 'memory-sync.config.json');

function parseArgs(argv) {
  let backupRepo = null;
  const include = [];
  const exclude = [];
  let resetProjects = false;
  for (const a of argv) {
    if (a.startsWith('--backup-repo=')) backupRepo = a.slice('--backup-repo='.length);
    else if (a.startsWith('--include=')) include.push(a.slice('--include='.length));
    else if (a.startsWith('--exclude=')) exclude.push(a.slice('--exclude='.length));
    else if (a === '--reset-projects') resetProjects = true;
    else if (!a.startsWith('--') && !backupRepo) backupRepo = a;
  }
  return { backupRepo, include, exclude, resetProjects };
}

function readExistingConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function dedupe(arr) {
  return Array.from(new Set(arr));
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1));
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { backupRepo: rawBackup, include, exclude, resetProjects } = args;

  const existing = readExistingConfig();

  // Resolve backup_repo_path: from CLI if provided, else from existing config.
  let backupRepoPath = existing?.backup_repo_path ?? null;
  if (rawBackup) {
    backupRepoPath = resolve(expandHome(rawBackup));
  }

  // If we have no backup repo at all AND no project selection changes,
  // the user invoked configure with no useful arguments.
  if (!backupRepoPath && include.length === 0 && exclude.length === 0 && !resetProjects) {
    console.error('error: nothing to configure.\n');
    console.error('usage:');
    console.error('  node scripts/configure.mjs --backup-repo=/abs/path/to/backup/repo');
    console.error('  node scripts/configure.mjs --include=PATTERN   (append to include list)');
    console.error('  node scripts/configure.mjs --exclude=PATTERN   (append to exclude list)');
    console.error('  node scripts/configure.mjs --reset-projects    (clear include + exclude)');
    console.error('\nProject patterns operate on the portable id (e.g. "base-myapp", "code-*").');
    console.error("First-time setup requires --backup-repo. It must point at a separate git repo");
    console.error("(typically PRIVATE) where memory data will be committed. The tool only writes");
    console.error("into that repo's data/ directory — never anywhere else under ~/.claude.");
    process.exit(1);
  }

  // Validate backup repo path
  if (backupRepoPath) {
    if (!isAbsolute(backupRepoPath)) {
      console.error(`error: backup-repo path must resolve to absolute (got: ${rawBackup})`);
      process.exit(1);
    }
    if (!existsSync(backupRepoPath)) {
      console.error(`error: backup repo path does not exist: ${backupRepoPath}`);
      console.error('  clone the repo there first, then re-run configure.');
      process.exit(1);
    }
    if (!existsSync(join(backupRepoPath, '.git'))) {
      console.error(`error: ${backupRepoPath} is not a git repo (no .git directory).`);
      console.error('  initialize it with `git init` + `git remote add origin <url>` first.');
      process.exit(1);
    }
    if (backupRepoPath === TOOL_ROOT) {
      console.error('error: backup-repo must be a SEPARATE repo from this tool.');
      console.error('  Tool lives at  ' + TOOL_ROOT);
      console.error('  Pick a different repo to hold the actual memory data.');
      process.exit(1);
    }
  }

  // Compose final project selection.
  let finalInclude, finalExclude;
  if (resetProjects) {
    finalInclude = [];
    finalExclude = [];
  } else {
    const existingProjects = existing?.projects ?? {};
    finalInclude = dedupe([...(existingProjects.include ?? []), ...include]);
    finalExclude = dedupe([...(existingProjects.exclude ?? []), ...exclude]);
  }

  await mkdir(CLAUDE_DIR, { recursive: true });
  const config = {
    tool_repo_path: TOOL_ROOT,
    backup_repo_path: backupRepoPath,
    projects: {
      include: finalInclude,
      exclude: finalExclude,
    },
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`wrote ${CONFIG_PATH}`);
  console.log(`  tool_repo_path:   ${TOOL_ROOT}`);
  console.log(`  backup_repo_path: ${backupRepoPath}`);
  console.log(`  projects.include: ${finalInclude.length ? JSON.stringify(finalInclude) : '[]  (defaults to all)'}`);
  console.log(`  projects.exclude: ${finalExclude.length ? JSON.stringify(finalExclude) : '[]'}`);
  console.log('\n✓ configure complete.');
  console.log('  See selection:  node scripts/list.mjs');
  console.log('  Push/pull:      node scripts/push.mjs   |   node scripts/pull.mjs');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

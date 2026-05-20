#!/usr/bin/env node
// configure.mjs — set the backup destination repo for memory-sync.
//
// Usage:
//   node scripts/configure.mjs --backup-repo=/abs/path/to/your/backup/repo
//   node scripts/configure.mjs /abs/path/to/your/backup/repo   (positional)
//
// Writes ~/.claude/memory-sync.config.json with:
//   { tool_repo_path, backup_repo_path }
//
// The Claude Code plugin manager handles skill discovery; this script is
// only about pointing the tool at the destination repo where memory data
// will be committed.
//
// Idempotent. Re-run any time to switch backup repos.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, '..');
const CLAUDE_DIR = join(homedir(), '.claude');
const CONFIG_PATH = join(CLAUDE_DIR, 'memory-sync.config.json');

function parseArgs(argv) {
  let backupRepo = null;
  for (const a of argv) {
    if (a.startsWith('--backup-repo=')) backupRepo = a.slice('--backup-repo='.length);
    else if (!a.startsWith('--') && !backupRepo) backupRepo = a;
  }
  return { backupRepo };
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1));
  return p;
}

async function main() {
  const { backupRepo: rawBackup } = parseArgs(process.argv.slice(2));
  if (!rawBackup) {
    console.error('error: --backup-repo=/path is required.\n');
    console.error('usage: node scripts/configure.mjs --backup-repo=/absolute/path/to/your/backup/repo');
    console.error('\nThe backup repo must be a separate git checkout (typically a PRIVATE repo on');
    console.error("your own GitHub account) where memory data will be committed. This tool only");
    console.error("writes into that repo's data/ directory — never anywhere else under ~/.claude.");
    process.exit(1);
  }

  const backupRepoPath = resolve(expandHome(rawBackup));

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

  await mkdir(CLAUDE_DIR, { recursive: true });
  const config = {
    tool_repo_path: TOOL_ROOT,
    backup_repo_path: backupRepoPath,
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`wrote ${CONFIG_PATH}`);
  console.log(`  tool_repo_path:   ${TOOL_ROOT}`);
  console.log(`  backup_repo_path: ${backupRepoPath}`);
  console.log('\n✓ configure complete.');
  console.log('  Try:  /memory-sync push   (or pull, status)');
  console.log('        node scripts/push.mjs   (from this tool repo)');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

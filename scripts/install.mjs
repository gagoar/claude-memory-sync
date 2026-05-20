#!/usr/bin/env node
// install.mjs — configure this tool to back up to a specific git repo.
//
// Usage:
//   node scripts/install.mjs --backup-repo=/abs/path/to/your/backup/repo
//   node scripts/install.mjs /abs/path/to/your/backup/repo   (positional also works)
//
// What it does:
//   1. Validates that the backup-repo path exists and is a git repo.
//   2. Writes ~/.claude/memory-sync.config.json with:
//        { tool_repo_path, backup_repo_path }
//   3. Symlinks (or copies, if symlink is denied) this repo's SKILL.md into
//      ~/.claude/skills/memory-sync.md so Claude Code discovers it.
//
// Idempotent. Re-run any time to switch backup repos.

import { mkdir, writeFile, symlink, unlink, lstat, readlink, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, '..');
const CLAUDE_DIR = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const CONFIG_PATH = join(CLAUDE_DIR, 'memory-sync.config.json');
const SKILL_TARGET = join(SKILLS_DIR, 'memory-sync.md');
const SKILL_SOURCE = join(TOOL_ROOT, 'SKILL.md');

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
    console.error('usage: node scripts/install.mjs --backup-repo=/absolute/path/to/your/backup/repo');
    console.error('\nThe backup repo must be a separate git checkout (typically a PRIVATE repo on');
    console.error('your own GitHub account) where memory data will be committed. This tool only');
    console.error('writes into that repo\'s data/ directory.');
    process.exit(1);
  }

  const backupRepoPath = resolve(expandHome(rawBackup));

  // Validations
  if (!isAbsolute(backupRepoPath)) {
    console.error(`error: backup-repo path must be absolute (got: ${rawBackup})`);
    process.exit(1);
  }
  if (!existsSync(backupRepoPath)) {
    console.error(`error: backup repo path does not exist: ${backupRepoPath}`);
    console.error('  clone the repo there first, then re-run install.');
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

  // 1. Write config
  await mkdir(CLAUDE_DIR, { recursive: true });
  const config = {
    tool_repo_path: TOOL_ROOT,
    backup_repo_path: backupRepoPath,
  };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`wrote ${CONFIG_PATH}`);
  console.log(`  tool_repo_path:   ${TOOL_ROOT}`);
  console.log(`  backup_repo_path: ${backupRepoPath}`);

  // 2. Make SKILL.md available at ~/.claude/skills/memory-sync.md.
  //    Prefer a symlink so edits in the tool repo propagate; fall back to a
  //    copy if the environment forbids symlinks (e.g. Claude Code sandbox).
  await mkdir(SKILLS_DIR, { recursive: true });
  let mode = 'symlink';
  try {
    const st = await lstat(SKILL_TARGET).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (st) {
      if (st.isSymbolicLink()) {
        const current = await readlink(SKILL_TARGET);
        if (current === SKILL_SOURCE) {
          console.log(`symlink already correct: ${SKILL_TARGET}`);
          mode = 'already-correct';
        } else {
          await unlink(SKILL_TARGET);
        }
      } else {
        await unlink(SKILL_TARGET);
      }
    }
    if (mode === 'symlink') {
      await symlink(SKILL_SOURCE, SKILL_TARGET);
      console.log(`created symlink: ${SKILL_TARGET} -> ${SKILL_SOURCE}`);
    }
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      try {
        await copyFile(SKILL_SOURCE, SKILL_TARGET);
        mode = 'copy';
        console.log(`copied (symlink denied): ${SKILL_SOURCE} -> ${SKILL_TARGET}`);
        console.log('  note: re-run `node scripts/install.mjs` after editing SKILL.md.');
      } catch (e2) {
        if (e2.code === 'EACCES' || e2.code === 'EPERM') {
          console.error(`error: cannot write to ${SKILL_TARGET}.`);
          console.error('  This happens inside Claude Code\'s restricted sandbox.');
          console.error('  Run this script from your normal terminal.');
          process.exit(1);
        }
        throw e2;
      }
    } else {
      throw e;
    }
  }

  console.log('\n✓ install complete. The memory-sync skill is now available.');
  console.log('  Try:  /memory-sync push   (or pull, status)');
  console.log('        node scripts/push.mjs   (from this tool repo)');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

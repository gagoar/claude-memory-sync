#!/usr/bin/env node
// history.mjs — show recent backup history from the backup repo.
//
// Default: last 20 commits touching data/, with relative timestamps and the
// + ~ - file counts from each commit message.
//
// Flags:
//   --limit=N        show last N commits (default 20)
//   --since=TIME     git --since= form (e.g. "2 weeks ago", "2026-05-01")
//   --paths          also list the changed file paths for each commit

import { spawnSync } from 'node:child_process';
import { loadConfig } from './_lib.mjs';

const args = process.argv.slice(2);
const SHOW_PATHS = args.includes('--paths');
let limit = 20;
let since = null;
for (const a of args) {
  if (a.startsWith('--limit=')) limit = parseInt(a.slice('--limit='.length), 10) || 20;
  if (a.startsWith('--since=')) since = a.slice('--since='.length);
}

function git(cwd, cmdArgs) {
  const r = spawnSync('git', cmdArgs, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`git ${cmdArgs.join(' ')} failed in ${cwd}`);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

async function main() {
  const cfg = loadConfig();
  const REPO = cfg.backup_repo_path;

  console.log(`backup repo: ${REPO}\n`);

  const fmtArgs = [
    'log',
    `--max-count=${limit}`,
    '--date=relative',
    '--pretty=format:%h\t%ad\t%s',
    '--',
    'data/',
  ];
  if (since) fmtArgs.splice(2, 0, `--since=${since}`);

  const log = git(REPO, fmtArgs).trim();
  if (!log) {
    console.log('no backup commits yet. Run `/memory-sync push` to create the first one.');
    return;
  }

  const lines = log.split('\n');
  console.log('  SHA       WHEN                       SUMMARY');
  console.log('  ────────  ─────────────────────────  ──────────────────────────────────────');
  for (const line of lines) {
    const [sha, when, ...rest] = line.split('\t');
    const summary = rest.join('\t');
    console.log(`  ${sha.padEnd(8)}  ${when.padEnd(25)}  ${summary}`);
    if (SHOW_PATHS) {
      const stat = git(REPO, ['show', '--stat=80', '--pretty=format:', sha, '--', 'data/']).trim();
      for (const l of stat.split('\n').filter(Boolean)) {
        console.log(`              ${l.replace(/^ /, '')}`);
      }
      console.log('');
    }
  }

  console.log('');
  console.log(`Showing last ${lines.length} commit(s) touching data/.`);
  if (!SHOW_PATHS) console.log('For file-level detail per commit:  /memory-sync history --paths');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

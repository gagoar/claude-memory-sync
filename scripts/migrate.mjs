#!/usr/bin/env node
// migrate.mjs — one-time migration of an older backup repo layout to the
// portable home-relative layout.
//
// Old layout:
//   data/projects/-Users-<originaluser>-<suffix>/memory/...
//
// New layout:
//   data/home-projects/<suffix>/memory/...                  (portable)
//   data/absolute-projects/<encoded>/memory/...             (non-portable)
//
// The migration:
//   - For each directory under data/projects/, decide if it starts with a
//     "-Users-*" prefix (or any "-<segment>-<user>-" home pattern). If yes,
//     strip the home prefix and move the rest under data/home-projects/.
//   - If not (path was outside any recognizable $HOME), move under
//     data/absolute-projects/ unchanged.
//   - Stage the move in the backup repo and exit. The caller commits.
//
// Run this once per backup repo when upgrading from an older layout.

import { rename, mkdir, readdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './_lib.mjs';

// Heuristic: encoded keys for projects under $HOME on macOS look like
// "-Users-<user>-<rest>". On Linux they look like "-home-<user>-<rest>".
// Strip the first three dash-separated segments to get the suffix.
function stripHomePrefix(encoded) {
  // Try macOS-style: -Users-<user>-<rest>
  let m = encoded.match(/^-Users-([^-]+)-(.+)$/);
  if (m) return { kind: 'home', suffix: m[2] };
  // Try Linux-style: -home-<user>-<rest>
  m = encoded.match(/^-home-([^-]+)-(.+)$/);
  if (m) return { kind: 'home', suffix: m[2] };
  return { kind: 'absolute', suffix: encoded };
}

function run(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`error: ${cmd} ${args.join(' ')} failed (exit ${r.status})`);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  return r.stdout.trim();
}

async function main() {
  const cfg = loadConfig();
  const oldDir = join(cfg.backup_repo_path, 'data', 'projects');
  const newHomeDir = join(cfg.backup_repo_path, 'data', 'home-projects');
  const newAbsDir  = join(cfg.backup_repo_path, 'data', 'absolute-projects');

  if (!existsSync(oldDir)) {
    console.log('no data/projects/ directory — nothing to migrate.');
    return;
  }

  const entries = await readdir(oldDir, { withFileTypes: true });
  const projects = entries.filter(e => e.isDirectory());
  if (projects.length === 0) {
    console.log('data/projects/ is empty — nothing to migrate.');
    await rmdir(oldDir).catch(() => {});
    return;
  }

  let movedHome = 0, movedAbs = 0;
  for (const ent of projects) {
    const { kind, suffix } = stripHomePrefix(ent.name);
    const targetDir = kind === 'home' ? newHomeDir : newAbsDir;
    const slug = suffix || '__root__';
    await mkdir(targetDir, { recursive: true });
    const from = join(oldDir, ent.name);
    const to = join(targetDir, slug);
    if (existsSync(to)) {
      console.warn(`skip ${ent.name} — target already exists: ${to}`);
      continue;
    }
    // Use git mv so the move is tracked correctly in history.
    run(cfg.backup_repo_path, 'git', ['mv', from, to]);
    if (kind === 'home') movedHome++; else movedAbs++;
    console.log(`[${kind}] ${ent.name}  →  ${kind === 'home' ? 'home-projects' : 'absolute-projects'}/${slug}`);
  }

  // Remove the now-empty data/projects directory.
  try { await rmdir(oldDir); } catch { /* may still have residue if a skip happened */ }

  console.log(`\n✓ migrated ${movedHome} home + ${movedAbs} absolute project(s).`);
  console.log('  Review with: git -C ' + cfg.backup_repo_path + ' status');
  console.log('  Commit with: git -C ' + cfg.backup_repo_path + ' commit -m "migrate: portable home-relative layout"');
  console.log('  Push   with: git -C ' + cfg.backup_repo_path + ' push');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

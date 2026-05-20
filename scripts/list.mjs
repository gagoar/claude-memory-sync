#!/usr/bin/env node
// list.mjs — list all known projects and their selection state.
//
// Shows every project that exists EITHER locally
// (~/.claude/projects/*/memory/) OR in the backup repo, along with:
//   - portable id
//   - kind (home / absolute)
//   - whether it's currently selected by cfg.projects.include / .exclude
//   - whether the data is present locally, in the repo, or both
//
// Use this to decide what to add to --exclude or to confirm a fresh
// selection covers what you expect.

import { loadConfig, listLocalProjects, listRepoProjects, isProjectSelected } from './_lib.mjs';

async function main() {
  const cfg = loadConfig();

  const local = await listLocalProjects(cfg, { includeFiltered: true });
  const repo  = await listRepoProjects(cfg, { includeFiltered: true });

  const all = new Map();
  for (const p of local) {
    all.set(p.localKey, { ...p, hasLocal: true });
  }
  for (const p of repo) {
    const prev = all.get(p.localKey) ?? {};
    all.set(p.localKey, { ...prev, ...p, hasRepo: true });
  }

  if (all.size === 0) {
    console.log('no projects found anywhere.');
    return;
  }

  console.log(`backup repo:   ${cfg.backup_repo_path}`);
  const sel = cfg.projects ?? {};
  console.log(`include:       ${sel.include?.length ? JSON.stringify(sel.include) : '[]  (defaults to all)'}`);
  console.log(`exclude:       ${sel.exclude?.length ? JSON.stringify(sel.exclude) : '[]'}`);
  console.log('');
  console.log('  STATE  KIND      WHERE   PORTABLE-ID');
  console.log('  ─────  ────────  ──────  ──────────────────────────────────────');

  const rows = [...all.values()].sort((a, b) => (a.portableId || '').localeCompare(b.portableId || ''));
  for (const p of rows) {
    const portableId = p.portableId === '' ? '(at $HOME root)' : (p.portableId || '__missing__');
    const state = p.selected === false ? 'EXCL ' : 'incl ';
    const kind = p.portableKind === 'home' ? 'home    ' : 'absolute';
    const where =
      p.hasLocal && p.hasRepo ? 'both  '
        : p.hasLocal           ? 'local '
        : 'repo  ';
    console.log(`  ${state}  ${kind}  ${where}  ${portableId}`);
  }

  console.log('');
  console.log('To exclude a project:  node scripts/configure.mjs --exclude=PORTABLE-ID');
  console.log('To include only some:  node scripts/configure.mjs --reset-projects --include=PATTERN [--include=...]');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

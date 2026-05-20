#!/usr/bin/env node
// list.mjs — list all known projects and their selection state.
//
// Default output is human-readable. Pass --json for a machine-readable
// payload that the `/memory-sync select` skill mode uses to drive an
// interactive multi-select via AskUserQuestion.
//
// JSON shape:
//   {
//     "backup_repo_path": "/abs/path",
//     "include": [...patterns],
//     "exclude": [...patterns],
//     "projects": [
//       {
//         "localKey":     "-Users-gago-base-foo",
//         "portableId":   "base-foo",
//         "portableKind": "home" | "absolute",
//         "selected":     true | false,
//         "hasLocal":     true | false,
//         "hasRepo":      true | false
//       },
//       ...
//     ]
//   }

import { loadConfig, listLocalProjects, listRepoProjects } from './_lib.mjs';

const args = new Set(process.argv.slice(2));
const JSON_MODE = args.has('--json');

async function main() {
  const cfg = loadConfig();

  const local = await listLocalProjects(cfg, { includeFiltered: true });
  const repo  = await listRepoProjects(cfg, { includeFiltered: true });

  const all = new Map();
  for (const p of local) {
    all.set(p.localKey, { ...p, hasLocal: true, hasRepo: false });
  }
  for (const p of repo) {
    const prev = all.get(p.localKey) ?? { hasLocal: false };
    all.set(p.localKey, { ...prev, ...p, hasRepo: true });
  }

  const rows = [...all.values()].sort((a, b) =>
    (a.portableId || '').localeCompare(b.portableId || '')
  );

  if (JSON_MODE) {
    const sel = cfg.projects ?? {};
    const payload = {
      backup_repo_path: cfg.backup_repo_path,
      include: sel.include ?? [],
      exclude: sel.exclude ?? [],
      projects: rows.map(p => ({
        localKey:     p.localKey,
        portableId:   p.portableId ?? '',
        portableKind: p.portableKind,
        selected:     p.selected !== false,
        hasLocal:     !!p.hasLocal,
        hasRepo:      !!p.hasRepo,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
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
  console.log('Interactive selection:  /memory-sync select   (from inside Claude Code)');
  console.log('Exclude one:            node scripts/configure.mjs --exclude=PORTABLE-ID');
  console.log('Include only some:      node scripts/configure.mjs --reset-projects --include=PATTERN [--include=...]');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

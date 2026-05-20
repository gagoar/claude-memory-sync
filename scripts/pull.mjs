#!/usr/bin/env node
// pull.mjs — copy memory directories from the configured backup repo into
// ~/.claude/projects/.
//
// Direction: $BACKUP_REPO/data/projects/*/memory/  →  ~/.claude/projects/*/memory/
//
// - Reads backup repo path from ~/.claude/memory-sync.config.json.
// - Pulls the latest from origin first (unless --no-fetch).
// - Refuses to overwrite local files that aren't represented in the backup,
//   unless --force is passed.

import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { loadConfig, listRepoProjects, listGlobalEntries, fingerprint, fingerprintEntry, diff, globalEnabled } from './_lib.mjs';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const NO_FETCH = args.has('--no-fetch');

function run(cwd, cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`error: ${cmd} ${cmdArgs.join(' ')} failed in ${cwd} (exit ${r.status})`);
    if (r.stderr) console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  return r.stdout.trim();
}

async function main() {
  const cfg = loadConfig();
  const REPO = cfg.backup_repo_path;

  if (!NO_FETCH) {
    const remotes = run(REPO, 'git', ['remote']);
    if (remotes.includes('origin')) {
      run(REPO, 'git', ['pull', '--ff-only', 'origin', 'HEAD']);
      console.log(`fetched latest from origin (${REPO})`);
    } else {
      console.log('no origin remote in backup repo; using local state');
    }
  }

  const repo = await listRepoProjects(cfg);
  if (repo.length === 0) {
    console.log('backup repo has no memory data yet. Did you push from another machine first?');
    return;
  }

  // Conflict pre-check: bail if local has changes that pull would clobber,
  // unless --force.
  if (!FORCE) {
    const conflicts = [];
    for (const proj of repo) {
      const localMap = await fingerprint(proj.localMemoryDir);
      const repoMap  = await fingerprint(proj.repoMemoryDir);
      const wouldOverwrite = [];
      for (const [p, sha] of localMap) {
        if (!repoMap.has(p)) wouldOverwrite.push({ p, kind: 'local-only' });
        else if (repoMap.get(p) !== sha) wouldOverwrite.push({ p, kind: 'differs' });
      }
      if (wouldOverwrite.length) conflicts.push({ localKey: proj.localKey, items: wouldOverwrite });
    }
    if (conflicts.length) {
      console.error('error: local memory has changes the backup repo does not. Pull would lose them.\n');
      for (const c of conflicts) {
        console.error(`  [${c.localKey}]`);
        for (const it of c.items) console.error(`    ${it.kind.padEnd(11)} ${it.p}`);
      }
      console.error('\nFix one of:');
      console.error('  - run `node scripts/push.mjs` first to back up local changes, then pull');
      console.error('  - re-run pull with --force to overwrite local with backup contents');
      process.exit(2);
    }
  }

  let totals = { added: 0, changed: 0, removed: 0, unchanged: 0 };

  for (const proj of repo) {
    const localMap = await fingerprint(proj.localMemoryDir);
    const repoMap  = await fingerprint(proj.repoMemoryDir);
    const d = diff(repoMap, localMap); // apply onto local

    if (d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0) {
      totals.unchanged += d.unchanged.length;
      continue;
    }

    await mkdir(proj.localMemoryDir, { recursive: true });
    for (const f of [...d.added, ...d.changed]) {
      const dst = join(proj.localMemoryDir, f);
      await mkdir(dirname(dst), { recursive: true });
      await cp(join(proj.repoMemoryDir, f), dst);
    }
    if (FORCE) {
      for (const f of d.removed) {
        await rm(join(proj.localMemoryDir, f));
      }
    }

    totals.added    += d.added.length;
    totals.changed  += d.changed.length;
    totals.removed  += FORCE ? d.removed.length : 0;
    totals.unchanged += d.unchanged.length;
    console.log(`[${proj.localKey}] +${d.added.length} ~${d.changed.length} -${FORCE ? d.removed.length : 0}`);
  }

  // Global track: pull ~/.claude/CLAUDE.md, RTK.md, skills/, etc. from repo.
  if (globalEnabled(cfg)) {
    const globals = await listGlobalEntries(cfg);
    for (const g of globals) {
      if (g.presence === 'local') continue; // local-only — never created in repo, leave it
      const localMap = await fingerprintEntry(g.localPath);
      const repoMap  = await fingerprintEntry(g.repoPath);
      // Pre-check: refuse to overwrite local changes that aren't in the repo
      if (!FORCE) {
        const wouldClobber = [];
        for (const [p, sha] of localMap) {
          if (!repoMap.has(p)) wouldClobber.push({ p, kind: 'local-only' });
          else if (repoMap.get(p) !== sha) wouldClobber.push({ p, kind: 'differs' });
        }
        if (wouldClobber.length) {
          console.error(`error: local copy of [global:${g.name}] has changes the backup repo lacks. Pull would lose them.`);
          for (const w of wouldClobber) {
            const path = w.p === '' ? g.localPath : `${g.localPath}/${w.p}`;
            console.error(`    ${w.kind.padEnd(11)} ${path}`);
          }
          console.error('  Run `node scripts/push.mjs` first, or re-run pull with --force to overwrite.');
          process.exit(2);
        }
      }
      const d = diff(repoMap, localMap);
      if (d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0) {
        totals.unchanged += d.unchanged.length;
        continue;
      }
      for (const f of [...d.added, ...d.changed]) {
        const src = f === '' ? g.repoPath : join(g.repoPath, f);
        const dst = f === '' ? g.localPath : join(g.localPath, f);
        await mkdir(dirname(dst), { recursive: true });
        await cp(src, dst);
      }
      if (FORCE) {
        for (const f of d.removed) {
          await rm(f === '' ? g.localPath : join(g.localPath, f), { recursive: true });
        }
      }
      totals.added    += d.added.length;
      totals.changed  += d.changed.length;
      totals.removed  += FORCE ? d.removed.length : 0;
      totals.unchanged += d.unchanged.length;
      console.log(`[global:${g.name}] +${d.added.length} ~${d.changed.length} -${FORCE ? d.removed.length : 0}`);
    }
  }

  console.log(`\n✓ pull complete. +${totals.added} ~${totals.changed} -${totals.removed} (${totals.unchanged} unchanged)`);
  if (!FORCE && totals.removed === 0) {
    console.log('  note: --force not passed, so files only present locally were preserved');
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

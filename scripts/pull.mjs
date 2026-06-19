#!/usr/bin/env node
// pull.mjs — copy memory directories from the configured backup repo into
// ~/.claude/projects/.
//
// Direction: $BACKUP_REPO/data/projects/*/memory/  →  ~/.claude/projects/*/memory/
//
// - Reads backup repo path from ~/.claude/memory-sync.config.json.
// - Fetches and pulls the latest from origin first (unless --no-fetch).
//   Prints the HEAD sha before and after so you can see whether it advanced.
// - Per-project conflict handling: projects where local has files the backup
//   lacks are skipped (with a clear warning) — other projects still pull.
//   Pass --force to overwrite local-only files instead of skipping.
// - Filtered projects (excluded by include/exclude config) are listed at the
//   end so nothing disappears silently.

import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { loadConfig, listRepoProjects, listGlobalEntries, fingerprint, fingerprintEntry, diff, globalEnabled, globalDataDir, SETTINGS_PATH, PERMISSIONS_BACKUP, localizeSettings, extractStatusLineScript, CLAUDE_HOME } from './_lib.mjs';

const argSet = new Set(process.argv.slice(2));
const FORCE    = argSet.has('--force');
const NO_FETCH = argSet.has('--no-fetch');

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
  const cfg  = loadConfig();
  const REPO = cfg.backup_repo_path;

  // Fetch + pull latest from origin, with before/after HEAD for visibility.
  if (!NO_FETCH) {
    const remotes = run(REPO, 'git', ['remote']);
    if (remotes.includes('origin')) {
      const before = run(REPO, 'git', ['rev-parse', '--short', 'HEAD']);
      run(REPO, 'git', ['pull', '--ff-only', 'origin', 'HEAD']);
      const after = run(REPO, 'git', ['rev-parse', '--short', 'HEAD']);
      if (before !== after) {
        console.log(`fetched latest from origin (${before} → ${after})`);
      } else {
        console.log(`already up to date with origin (${after})`);
      }
    } else {
      console.log('no origin remote in backup repo; using local state');
    }
  }

  // Get all repo projects (selected + filtered-out).
  const repoAll = await listRepoProjects(cfg, { includeFiltered: true });
  const repo    = repoAll.filter(p => p.selected);
  const filtered = repoAll.filter(p => !p.selected);

  if (repoAll.length === 0) {
    console.log('backup repo has no memory data yet. Did you push from another machine first?');
    return;
  }

  if (repo.length === 0) {
    console.log('all backup projects are filtered out by your include/exclude config. Nothing to pull.');
    if (filtered.length) {
      console.log(`  filtered: ${filtered.map(p => p.portableId || '(root)').join(', ')}`);
      console.log('  Use `/memory-sync configure --reset-projects` to reset filters.');
    }
    return;
  }

  // Per-project conflict check — skip conflicted, still pull the clean ones.
  const conflicted = [];
  const clean      = [];

  if (FORCE) {
    clean.push(...repo);
  } else {
    for (const proj of repo) {
      const localMap = await fingerprint(proj.localMemoryDir);
      const repoMap  = await fingerprint(proj.repoMemoryDir);
      const wouldOverwrite = [];
      for (const [p, sha] of localMap) {
        if (!repoMap.has(p))            wouldOverwrite.push({ p, kind: 'local-only' });
        else if (repoMap.get(p) !== sha) wouldOverwrite.push({ p, kind: 'differs'   });
      }
      if (wouldOverwrite.length) {
        conflicted.push({ proj, items: wouldOverwrite });
      } else {
        clean.push(proj);
      }
    }
  }

  // Apply clean projects.
  let totals = { added: 0, changed: 0, removed: 0, unchanged: 0 };

  for (const proj of clean) {
    const localMap = await fingerprint(proj.localMemoryDir);
    const repoMap  = await fingerprint(proj.repoMemoryDir);
    const d = diff(repoMap, localMap); // what to apply onto local

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

    totals.added     += d.added.length;
    totals.changed   += d.changed.length;
    totals.removed   += FORCE ? d.removed.length : 0;
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

    // Settings: merge syncable keys from settings.permissions.json — never overwrite full settings.
    const permsBackupPath = join(globalDataDir(cfg), PERMISSIONS_BACKUP);
    if (existsSync(permsBackupPath)) {
      const backed = localizeSettings(JSON.parse(await readFile(permsBackupPath, 'utf8')));
      let local = {};
      if (existsSync(SETTINGS_PATH)) local = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
      let settingsChanged = false;
      for (const key of ['permissions', 'skipAutoPermissionPrompt', 'statusLine']) {
        if (backed[key] !== undefined &&
            JSON.stringify(local[key]) !== JSON.stringify(backed[key])) {
          local[key] = backed[key];
          settingsChanged = true;
        }
      }
      if (settingsChanged) {
        await writeFile(SETTINGS_PATH, JSON.stringify(local, null, 2) + '\n', 'utf8');
        console.log('[global:settings.permissions] merged → ~/.claude/settings.json');
        totals.changed++;
      } else {
        totals.unchanged++;
      }

      // Restore any statusLine script that was backed up alongside the settings.
      const scriptRel = extractStatusLineScript(backed.statusLine?.command);
      if (scriptRel) {
        const scriptSrc  = join(globalDataDir(cfg), scriptRel);
        const scriptDest = join(CLAUDE_HOME, scriptRel);
        if (existsSync(scriptSrc)) {
          const newScript = await readFile(scriptSrc, 'utf8');
          const oldScript = existsSync(scriptDest) ? await readFile(scriptDest, 'utf8') : null;
          if (newScript !== oldScript) {
            await mkdir(dirname(scriptDest), { recursive: true });
            await writeFile(scriptDest, newScript, 'utf8');
            // Preserve executable bit.
            const { chmod } = await import('node:fs/promises');
            await chmod(scriptDest, 0o755);
            if (oldScript) { totals.changed++; console.log(`[global:${scriptRel}] ~1 → ~/.claude/${scriptRel}`); }
            else            { totals.added++;   console.log(`[global:${scriptRel}] +1 → ~/.claude/${scriptRel}`); }
          } else {
            totals.unchanged++;
          }
        }
      }
    }
  }

  console.log(`\n✓ pull complete. +${totals.added} ~${totals.changed} -${totals.removed} (${totals.unchanged} unchanged)`);
  if (!FORCE && totals.removed === 0 && clean.length > 0) {
    console.log('  note: --force not passed, so files only present locally were preserved');
  }

  // Report skipped-by-conflict projects.
  if (conflicted.length > 0) {
    console.log(`\n⚠  ${conflicted.length} project(s) skipped — local has changes the backup lacks:`);
    for (const c of conflicted) {
      console.log(`  [${c.proj.localKey}]`);
      for (const it of c.items.slice(0, 5)) console.log(`    ${it.kind.padEnd(11)} ${it.p}`);
      if (c.items.length > 5) console.log(`    ... and ${c.items.length - 5} more`);
    }
    console.log('\n  Fix one of:');
    console.log('    - run `/memory-sync push` first to back up local changes, then pull again');
    console.log('    - re-run pull with --force to overwrite local with backup contents');
  }

  // Surface projects silently filtered by include/exclude.
  if (filtered.length > 0) {
    console.log(`\n  (${filtered.length} project(s) not pulled — filtered by include/exclude: ${filtered.map(p => p.portableId || '(root)').join(', ')})`);
    console.log('  Use `/memory-sync list` to see all projects or `/memory-sync select` to change selection.');
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

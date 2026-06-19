#!/usr/bin/env node
// push.mjs — copy local memory directories into the configured backup repo,
// then commit + push.
//
// Direction: ~/.claude/projects/*/memory/  →  $BACKUP_REPO/data/projects/*/memory/
//
// - Reads backup repo path from ~/.claude/memory-sync.config.json.
// - Copies every file under each per-project memory directory.
// - Deletes files in the repo that no longer exist locally (push = local is
//   the source of truth).
// - Skips the commit if no changes.
// - --no-push: commit only, don't push to origin.

import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { loadConfig, listLocalProjects, listGlobalEntries, fingerprint, fingerprintEntry, diff, globalEnabled, globalDataDir, SETTINGS_PATH, PERMISSIONS_BACKUP, extractSyncableSettings, portablizeSettings, extractStatusLineScript, CLAUDE_HOME } from './_lib.mjs';

const args = new Set(process.argv.slice(2));
const NO_PUSH = args.has('--no-push');

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

  const local = await listLocalProjects(cfg);
  let totals = { added: 0, changed: 0, removed: 0, unchanged: 0 };

  if (local.length === 0) {
    console.log('no per-project memory directories found under ~/.claude/projects/*/memory/');
  }

  for (const proj of local) {
    const localMap = await fingerprint(proj.localMemoryDir);
    const repoMap  = await fingerprint(proj.repoMemoryDir);
    const d = diff(localMap, repoMap);

    if (d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0) {
      totals.unchanged += d.unchanged.length;
      continue;
    }

    await mkdir(proj.repoMemoryDir, { recursive: true });
    for (const f of [...d.added, ...d.changed]) {
      const dst = join(proj.repoMemoryDir, f);
      await mkdir(dirname(dst), { recursive: true });
      await cp(join(proj.localMemoryDir, f), dst);
    }
    for (const f of d.removed) {
      await rm(join(proj.repoMemoryDir, f));
    }

    totals.added    += d.added.length;
    totals.changed  += d.changed.length;
    totals.removed  += d.removed.length;
    totals.unchanged += d.unchanged.length;

    console.log(`[${proj.localKey}] +${d.added.length} ~${d.changed.length} -${d.removed.length}`);
  }

  // Global track: ~/.claude/CLAUDE.md, RTK.md, skills/, etc.
  if (globalEnabled(cfg)) {
    const globals = await listGlobalEntries(cfg);
    for (const g of globals) {
      if (g.presence === 'repo') continue; // file is in repo but not local — leave it alone on push
      const localMap = await fingerprintEntry(g.localPath);
      const repoMap  = await fingerprintEntry(g.repoPath);
      const d = diff(localMap, repoMap);
      if (d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0) {
        totals.unchanged += d.unchanged.length;
        continue;
      }
      for (const f of [...d.added, ...d.changed]) {
        const src = f === '' ? g.localPath : join(g.localPath, f);
        const dst = f === '' ? g.repoPath  : join(g.repoPath, f);
        await mkdir(dirname(dst), { recursive: true });
        await cp(src, dst);
      }
      for (const f of d.removed) {
        await rm(f === '' ? g.repoPath : join(g.repoPath, f), { recursive: true });
      }
      totals.added    += d.added.length;
      totals.changed  += d.changed.length;
      totals.removed  += d.removed.length;
      totals.unchanged += d.unchanged.length;
      console.log(`[global:${g.name}] +${d.added.length} ~${d.changed.length} -${d.removed.length}`);
    }

    // Settings permissions: extract only permissions + skipAutoPermissionPrompt.
    // The full settings.json is never copied — it may contain env secrets.
    const oldBackupPath  = join(globalDataDir(cfg), 'settings.json');
    const permsBackupPath = join(globalDataDir(cfg), PERMISSIONS_BACKUP);
    if (existsSync(oldBackupPath)) {
      await rm(oldBackupPath);
      totals.removed++;
      console.log('[global:settings.json] removed (unsafe full copy — replaced by settings.permissions.json)');
    }
    if (existsSync(SETTINGS_PATH)) {
      const raw   = JSON.parse(await readFile(SETTINGS_PATH, 'utf8'));
      const perms = portablizeSettings(extractSyncableSettings(raw));
      if (Object.keys(perms).length > 0) {
        const newContent      = JSON.stringify(perms, null, 2) + '\n';
        const existingContent = existsSync(permsBackupPath) ? await readFile(permsBackupPath, 'utf8') : null;
        if (existingContent !== newContent) {
          await mkdir(dirname(permsBackupPath), { recursive: true });
          await writeFile(permsBackupPath, newContent, 'utf8');
          if (existingContent) { totals.changed++; console.log('[global:settings.permissions] ~1'); }
          else                  { totals.added++;   console.log('[global:settings.permissions] +1'); }
        } else {
          totals.unchanged++;
        }

        // If statusLine references a script under ~/.claude/, back it up too.
        const scriptRel = extractStatusLineScript(raw.statusLine?.command);
        if (scriptRel) {
          const scriptSrc  = join(CLAUDE_HOME, scriptRel);
          const scriptDest = join(globalDataDir(cfg), scriptRel);
          if (existsSync(scriptSrc)) {
            const newScript = await readFile(scriptSrc, 'utf8');
            const oldScript = existsSync(scriptDest) ? await readFile(scriptDest, 'utf8') : null;
            if (newScript !== oldScript) {
              await mkdir(dirname(scriptDest), { recursive: true });
              await writeFile(scriptDest, newScript, 'utf8');
              if (oldScript) { totals.changed++; console.log(`[global:${scriptRel}] ~1`); }
              else            { totals.added++;   console.log(`[global:${scriptRel}] +1`); }
            } else {
              totals.unchanged++;
            }
          }
        }
      }
    }
  }

  const status = run(REPO, 'git', ['status', '--porcelain', 'data/']);
  if (!status) {
    console.log('\n✓ no changes to commit. local and backup repo are in sync.');
    return;
  }

  run(REPO, 'git', ['add', 'data/']);
  const msg = `backup: +${totals.added} ~${totals.changed} -${totals.removed} (${new Date().toISOString()})`;
  run(REPO, 'git', ['commit', '-m', msg]);
  const sha = run(REPO, 'git', ['rev-parse', '--short', 'HEAD']);
  console.log(`\n✓ committed ${sha} in ${REPO}`);
  console.log(`  ${msg}`);

  if (NO_PUSH) {
    console.log('  (--no-push passed; commit not pushed)');
    return;
  }
  const remotes = run(REPO, 'git', ['remote']);
  if (!remotes.includes('origin')) {
    console.log('  no origin remote in backup repo; commit stays local.');
    return;
  }
  run(REPO, 'git', ['push', 'origin', 'HEAD']);
  console.log('  pushed to origin');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

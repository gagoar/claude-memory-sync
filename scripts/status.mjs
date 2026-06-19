#!/usr/bin/env node
// status.mjs — show what would change if you pushed or pulled. No mutation.
// Filtered projects (excluded by include/exclude config) are listed at the
// end so nothing disappears silently.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, listLocalProjects, listRepoProjects, listGlobalEntries, fingerprint, fingerprintEntry, diff, globalEnabled, globalDataDir, SETTINGS_PATH, PERMISSIONS_BACKUP, extractSyncableSettings, localizeSettings, analyzeStatusLineCommand, CLAUDE_HOME } from './_lib.mjs';

async function main() {
  const cfg = loadConfig();
  console.log(`backup repo: ${cfg.backup_repo_path}\n`);

  // Fetch all projects including filtered-out ones.
  const localAll = await listLocalProjects(cfg, { includeFiltered: true });
  const repoAll  = await listRepoProjects(cfg, { includeFiltered: true });

  const local = localAll.filter(p => p.selected);
  const repo  = repoAll.filter(p => p.selected);

  // Collect portable ids of filtered-out projects (union from both sides).
  const filteredIds = new Set([
    ...localAll.filter(p => !p.selected).map(p => p.portableId || '(root)'),
    ...repoAll.filter(p => !p.selected).map(p => p.portableId || '(root)'),
  ]);

  const allKeys = new Set([
    ...local.map(p => p.localKey),
    ...repo.map(p => p.localKey),
  ]);

  if (allKeys.size === 0 && filteredIds.size === 0) {
    console.log('no per-project memory directories anywhere.');
    return;
  }

  const byKey = new Map();
  for (const p of local) byKey.set(p.localKey, { ...byKey.get(p.localKey), ...p, hasLocal: true });
  for (const p of repo)  byKey.set(p.localKey, { ...byKey.get(p.localKey), ...p, hasRepo:  true });

  let any = false;
  for (const key of [...allKeys].sort()) {
    const proj = byKey.get(key);
    const localMap = await fingerprint(proj.localMemoryDir);
    const repoMap  = await fingerprint(proj.repoMemoryDir);
    const pushDiff = diff(localMap, repoMap);
    const pullDiff = diff(repoMap, localMap);

    if (
      pushDiff.added.length || pushDiff.changed.length || pushDiff.removed.length ||
      pullDiff.added.length || pullDiff.changed.length
    ) {
      any = true;
      console.log(`[${key}]`);
      if (!proj.hasLocal) console.log('  local: MISSING (would be created on pull)');
      if (!proj.hasRepo)  console.log('  repo:  MISSING (would be created on push)');
      if (pushDiff.added.length)   console.log(`  push would add:    ${pushDiff.added.length} file(s)`);
      if (pushDiff.changed.length) console.log(`  push would change: ${pushDiff.changed.length} file(s)`);
      if (pushDiff.removed.length) console.log(`  push would remove: ${pushDiff.removed.length} file(s) from repo`);
      if (pullDiff.added.length)   console.log(`  pull would add:    ${pullDiff.added.length} file(s) to local`);
      if (pullDiff.changed.length) console.log(`  pull would change: ${pullDiff.changed.length} file(s) in local`);
    }
  }

  // Global track — always print a summary line, then detail on drift.
  if (globalEnabled(cfg)) {
    const globals = await listGlobalEntries(cfg);
    const SYNC_KEYS = ['permissions', 'skipAutoPermissionPrompt', 'statusLine'];
    const permsBackupPath = join(globalDataDir(cfg), PERMISSIONS_BACKUP);

    // Build global summary: list all tracked names + sync status.
    const globalNames = [...globals.map(g => g.name), 'settings.permissions'];
    const syncStates  = [];

    for (const g of globals) {
      const localMap = await fingerprintEntry(g.localPath);
      const repoMap  = await fingerprintEntry(g.repoPath);
      const pushDiff = diff(localMap, repoMap);
      const pullDiff = diff(repoMap, localMap);
      const hasDrift = pushDiff.added.length || pushDiff.changed.length || pushDiff.removed.length ||
                       pullDiff.added.length || pullDiff.changed.length;
      syncStates.push(hasDrift ? `${g.name}(!)` : `${g.name}(✓)`);
      if (hasDrift) {
        any = true;
        console.log(`[global:${g.name}]`);
        if (g.presence === 'local') console.log('  repo:  MISSING (would be created on push)');
        if (g.presence === 'repo')  console.log('  local: MISSING (would be created on pull)');
        if (pushDiff.added.length)   console.log(`  push would add:    ${pushDiff.added.length} file(s)`);
        if (pushDiff.changed.length) console.log(`  push would change: ${pushDiff.changed.length} file(s)`);
        if (pushDiff.removed.length) console.log(`  push would remove: ${pushDiff.removed.length} file(s) from repo`);
        if (pullDiff.added.length)   console.log(`  pull would add:    ${pullDiff.added.length} file(s) to local`);
        if (pullDiff.changed.length) console.log(`  pull would change: ${pullDiff.changed.length} file(s) in local`);
      }
    }

    // Settings permissions + statusLine drift.
    let permsDrift = false;
    if (existsSync(permsBackupPath) && existsSync(SETTINGS_PATH)) {
      const backed  = localizeSettings(JSON.parse(await readFile(permsBackupPath, 'utf8')));
      const local   = extractSyncableSettings(JSON.parse(await readFile(SETTINGS_PATH, 'utf8')));
      const drifted = SYNC_KEYS.filter(k => JSON.stringify(local[k]) !== JSON.stringify(backed[k]) && backed[k] !== undefined);
      if (drifted.length) {
        permsDrift = true; any = true;
        console.log('[global:settings.permissions]');
        console.log(`  pull would merge: ${drifted.join(', ')} → ~/.claude/settings.json`);
      }
    } else if (existsSync(permsBackupPath) && !existsSync(SETTINGS_PATH)) {
      permsDrift = true; any = true;
      console.log('[global:settings.permissions]');
      console.log('  pull would create: ~/.claude/settings.json with backed-up settings');
    } else if (!existsSync(permsBackupPath) && existsSync(SETTINGS_PATH)) {
      const local = extractSyncableSettings(JSON.parse(await readFile(SETTINGS_PATH, 'utf8')));
      if (Object.keys(local).length > 0) {
        permsDrift = true; any = true;
        console.log('[global:settings.permissions]');
        console.log('  push would create: settings.permissions.json in backup repo');
      }
    }
    syncStates.push(permsDrift ? 'settings.permissions(!)' : 'settings.permissions(✓)');

    // statusLine script: show as named entry if backed up; warn about external deps.
    // Analyze the PORTABLIZED command (with '~') so path classification is correct.
    const rawBackedSettings = existsSync(permsBackupPath)
      ? JSON.parse(await readFile(permsBackupPath, 'utf8'))
      : null;
    const backedSettings = rawBackedSettings ? localizeSettings(rawBackedSettings) : null;
    const { localScript: scriptRel, externalDeps } = analyzeStatusLineCommand(rawBackedSettings?.statusLine?.command);
    if (scriptRel) {
      const scriptInRepo  = join(globalDataDir(cfg), scriptRel);
      const scriptLocal   = join(CLAUDE_HOME, scriptRel);
      const repoContent   = existsSync(scriptInRepo) ? await readFile(scriptInRepo,  'utf8') : null;
      const localContent  = existsSync(scriptLocal)  ? await readFile(scriptLocal,   'utf8') : null;
      const scriptDrifted = repoContent !== localContent;
      syncStates.push(scriptDrifted ? `${scriptRel}(!)` : `${scriptRel}(✓)`);
      if (scriptDrifted) {
        any = true;
        console.log(`[global:${scriptRel}]`);
        if (!repoContent)  console.log('  repo:  MISSING (would be created on push)');
        if (!localContent) console.log('  local: MISSING (would be created on pull)');
        if (repoContent && localContent) console.log('  out of sync — push or pull to reconcile');
      }
    }
    for (const dep of externalDeps) {
      console.log(`\n  ⚠ statusLine references external path: ${dep}`);
      console.log('    Not backed up — must be installed on each machine separately.');
    }

    // Always print what the global track covers.
    console.log(`\nglobal track: ${syncStates.join('  ')}`);
  }

  if (!any) {
    if (allKeys.size > 0) {
      console.log('✓ local and backup repo are in sync.');
    } else {
      console.log('no selected projects have memory directories.');
    }
  }

  if (filteredIds.size > 0) {
    const ids = [...filteredIds].sort().join(', ');
    console.log(`\n  (${filteredIds.size} project(s) not shown — filtered by include/exclude: ${ids})`);
    console.log('  Use `/memory-sync list` to see all projects.');
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

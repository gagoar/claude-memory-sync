#!/usr/bin/env node
// status.mjs — show what would change if you pushed or pulled. No mutation.

import { loadConfig, listLocalProjects, listRepoProjects, fingerprint, diff } from './_lib.mjs';

async function main() {
  const cfg = loadConfig();
  console.log(`backup repo: ${cfg.backup_repo_path}\n`);

  const local = await listLocalProjects(cfg);
  const repo  = await listRepoProjects(cfg);

  const allKeys = new Set([
    ...local.map(p => p.projectKey),
    ...repo.map(p => p.projectKey),
  ]);

  if (allKeys.size === 0) {
    console.log('no per-project memory directories anywhere.');
    return;
  }

  const byKey = new Map();
  for (const p of local) byKey.set(p.projectKey, { ...byKey.get(p.projectKey), ...p, hasLocal: true });
  for (const p of repo)  byKey.set(p.projectKey, { ...byKey.get(p.projectKey), ...p, hasRepo:  true });

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

  if (!any) console.log('✓ local and backup repo are in sync.');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

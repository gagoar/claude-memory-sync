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

import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { loadConfig, listLocalProjects, listRepoProjects, fingerprint, diff } from './_lib.mjs';

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
  if (local.length === 0) {
    console.log('no per-project memory directories found under ~/.claude/projects/*/memory/');
    return;
  }

  let totals = { added: 0, changed: 0, removed: 0, unchanged: 0 };

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

#!/usr/bin/env node
// doctor.mjs — read-only diagnostic for memory-sync problems.
//
// Emits a human summary followed by a fenced ```memory-sync-doctor block
// that you can paste back into a Claude Code session for analysis.
//
// Usage:
//   node scripts/doctor.mjs         # summary + pasteable block
//   node scripts/doctor.mjs --json  # raw JSON only (no fence)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import {
  loadConfig,
  homePrefix,
  listRepoProjects,
  fingerprint,
  diff,
  selectionReason,
} from './_lib.mjs';

const RAW_JSON = process.argv.includes('--json');
const SCHEMA_VERSION = 1;

function run(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function main() {
  // Load config — report error inline if missing.
  let cfg;
  try { cfg = loadConfig(); }
  catch (e) {
    emit({
      schemaVersion: SCHEMA_VERSION,
      os: platform(),
      nodeVersion: process.version,
      homedir: homedir(),
      homePrefix: homePrefix(),
      config: null,
      backupGit: null,
      projects: [],
      verdict: [`config error: ${e.message}`],
    });
    return;
  }

  const REPO = cfg.backup_repo_path;

  // Git state of the backup repo.
  const hasOrigin = (run(REPO, 'git', ['remote']) || '').includes('origin');
  const headBefore = run(REPO, 'git', ['rev-parse', '--short', 'HEAD']) || 'unknown';
  let fetchError = null;
  let behindBy = 0;
  if (hasOrigin) {
    const fr = spawnSync('git', ['fetch', '--quiet', 'origin'], { cwd: REPO, encoding: 'utf8' });
    if (fr.status !== 0) {
      fetchError = fr.stderr.trim() || 'git fetch failed';
    } else {
      const cnt = run(REPO, 'git', ['rev-list', '--count', 'HEAD..origin/HEAD']);
      behindBy = parseInt(cnt || '0', 10);
    }
  }
  const head = run(REPO, 'git', ['rev-parse', '--short', 'HEAD']) || headBefore;

  // All repo projects including filtered-out ones.
  const repoAll = await listRepoProjects(cfg, { includeFiltered: true });

  // Per-project dry-run pull analysis.
  const projects = [];
  for (const proj of repoAll) {
    const slug = proj.portableId || '__root__';
    const reason = selectionReason(slug, cfg);
    const localMap = await fingerprint(proj.localMemoryDir);
    const repoMap  = await fingerprint(proj.repoMemoryDir);
    const d = diff(repoMap, localMap); // what pull would apply

    // Conflicts: local files that pull (without --force) would clobber.
    let conflictCount = 0;
    for (const [p, sha] of localMap) {
      if (!repoMap.has(p) || repoMap.get(p) !== sha) conflictCount++;
    }

    projects.push({
      portableId: proj.portableId,
      kind: proj.portableKind,
      selected: proj.selected,
      filterReason: reason,
      localKey: proj.localKey,
      localExists: existsSync(proj.localMemoryDir),
      plan: {
        add: d.added.length,
        change: d.changed.length,
        unchanged: d.unchanged.length,
        conflict: conflictCount,
      },
    });
  }

  // Build verdict lines.
  const verdicts = [];
  if (behindBy > 0)   verdicts.push(`backup clone is ${behindBy} commit(s) behind origin — run \`git pull\` in ${REPO}`);
  if (fetchError)     verdicts.push(`could not reach origin to check freshness: ${fetchError}`);
  if (!hasOrigin)     verdicts.push(`backup repo has no "origin" remote — clone may be local-only`);

  const filtered   = projects.filter(p => !p.selected);
  const blocking   = projects.filter(p => p.selected && p.plan.conflict > 0);
  const pullable   = projects.filter(p => p.selected && p.plan.conflict === 0 && (p.plan.add + p.plan.change) > 0);
  const inSync     = projects.filter(p => p.selected && p.plan.conflict === 0 && p.plan.add === 0 && p.plan.change === 0);

  if (filtered.length)
    verdicts.push(`${filtered.length} project(s) filtered out by include/exclude: ${filtered.map(p => p.portableId || '(root)').join(', ')}`);
  if (blocking.length)
    verdicts.push(`pull would skip ${blocking.length} project(s) due to conflicts (local-only or modified files): ${blocking.map(p => p.portableId || '(root)').join(', ')}`);
  if (pullable.length)
    verdicts.push(`${pullable.length} project(s) ready to pull: ${pullable.map(p => `${p.portableId || '(root)'} (+${p.plan.add} ~${p.plan.change})`).join(', ')}`);
  if (inSync.length && !blocking.length && !pullable.length && !filtered.length && behindBy === 0)
    verdicts.push('everything looks healthy — local and backup are in sync');
  if (verdicts.length === 0)
    verdicts.push('no data in backup repo yet — push from another machine first');

  emit({
    schemaVersion: SCHEMA_VERSION,
    os: platform(),
    nodeVersion: process.version,
    homedir: homedir(),
    homePrefix: homePrefix(),
    config: {
      backup_repo_path: REPO,
      include: cfg.projects?.include ?? [],
      exclude: cfg.projects?.exclude ?? [],
    },
    backupGit: { hasOrigin, head, behindBy, fetchError },
    projects,
    verdict: verdicts,
  });
}

function emit(report) {
  if (RAW_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('memory-sync doctor\n');
  for (const line of report.verdict) console.log(`  → ${line}`);
  console.log('\nPaste the block below into a Claude Code session to get a full diagnosis:\n');
  console.log('```memory-sync-doctor');
  console.log(JSON.stringify(report));
  console.log('```');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

// Shared helpers for push/pull/status.
//
// Resolves the backup destination repo from ~/.claude/memory-sync.config.json.
// That config is written by install.mjs and points at any git checkout the
// user wants to use as the memory data store (typically a private repo on
// their own account, separate from this tool repo).

import { readdir, stat, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = join(homedir(), '.claude', 'memory-sync.config.json');
export const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');

// Read the install-time config. Throws with a helpful message if missing.
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `config not found at ${CONFIG_PATH}.\n` +
      `Run install first:\n` +
      `  node ${join(TOOL_ROOT, 'scripts', 'install.mjs')} --backup-repo=/absolute/path/to/your/backup/repo`
    );
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) { throw new Error(`config at ${CONFIG_PATH} is not valid JSON: ${e.message}`); }
  if (!cfg.backup_repo_path) {
    throw new Error(`config at ${CONFIG_PATH} is missing "backup_repo_path". Re-run install.`);
  }
  if (!existsSync(cfg.backup_repo_path)) {
    throw new Error(
      `backup repo path does not exist: ${cfg.backup_repo_path}\n` +
      `Either clone it there, or re-run install with the correct --backup-repo=.`
    );
  }
  if (!existsSync(join(cfg.backup_repo_path, '.git'))) {
    throw new Error(
      `backup repo path is not a git repo: ${cfg.backup_repo_path}\n` +
      `Initialize it with \`git init\` + remote, or point at a different path.`
    );
  }
  return cfg;
}

// Compute the data directory inside the backup repo.
export function dataDir(cfg) {
  return join(cfg.backup_repo_path, 'data', 'projects');
}

// Discover all per-project memory directories on the local machine.
export async function listLocalProjects(cfg) {
  if (!existsSync(CLAUDE_PROJECTS)) return [];
  const entries = await readdir(CLAUDE_PROJECTS, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const localMemoryDir = join(CLAUDE_PROJECTS, ent.name, 'memory');
    if (!existsSync(localMemoryDir)) continue;
    out.push({
      projectKey: ent.name,
      localMemoryDir,
      repoMemoryDir: join(dataDir(cfg), ent.name, 'memory'),
    });
  }
  return out;
}

// Discover all per-project memory directories in the backup repo.
export async function listRepoProjects(cfg) {
  const dd = dataDir(cfg);
  if (!existsSync(dd)) return [];
  const entries = await readdir(dd, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const repoMemoryDir = join(dd, ent.name, 'memory');
    if (!existsSync(repoMemoryDir)) continue;
    out.push({
      projectKey: ent.name,
      localMemoryDir: join(CLAUDE_PROJECTS, ent.name, 'memory'),
      repoMemoryDir,
    });
  }
  return out;
}

// Walk a directory and return relative-path → sha256 map of every file.
export async function fingerprint(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  await walk(dir, dir, map);
  return map;
}

async function walk(rootDir, currentDir, map) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.gitkeep') continue;
    const full = join(currentDir, ent.name);
    if (ent.isDirectory()) {
      await walk(rootDir, full, map);
    } else if (ent.isFile()) {
      const rel = full.slice(rootDir.length + 1);
      const buf = await readFile(full);
      const sha = createHash('sha256').update(buf).digest('hex');
      map.set(rel, sha);
    }
  }
}

// Diff two fingerprint maps. Returns { added, changed, removed, unchanged }.
export function diff(localMap, repoMap) {
  const added = [], changed = [], removed = [], unchanged = [];
  for (const [path, sha] of localMap) {
    if (!repoMap.has(path)) added.push(path);
    else if (repoMap.get(path) !== sha) changed.push(path);
    else unchanged.push(path);
  }
  for (const path of repoMap.keys()) {
    if (!localMap.has(path)) removed.push(path);
  }
  return { added, changed, removed, unchanged };
}

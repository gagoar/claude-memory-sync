// Shared helpers for push/pull/status/configure.
//
// Storage layout in the backup repo:
//   data/
//     home-projects/<portable-id>/memory/   — projects under $HOME (portable)
//     absolute-projects/<encoded>/memory/   — projects outside $HOME (non-portable)
//
// "portable-id" is the path-encoded Claude project key with the user's
// $HOME prefix stripped. e.g.:
//   local key:    "-Users-gago-base-BYOB-Sports-React-Native"
//   $HOME prefix: "-Users-gago"
//   portable-id:  "base-BYOB-Sports-React-Native"
//
// On pull from a different machine ($HOME=/Users/german), we prepend that
// machine's home prefix:
//   "-Users-german" + "-" + "base-BYOB-Sports-React-Native"
//   = "-Users-german-base-BYOB-Sports-React-Native"

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CLAUDE_HOME = join(homedir(), '.claude');
export const CONFIG_PATH = join(CLAUDE_HOME, 'memory-sync.config.json');
export const CLAUDE_PROJECTS = join(CLAUDE_HOME, 'projects');

// Default files/dirs in ~/.claude/ that the global track covers.
// Each entry is a path relative to ~/.claude/ — can be a file or a directory.
export const DEFAULT_GLOBAL_FILES = ['CLAUDE.md', 'RTK.md', 'skills', 'keybindings.json'];

// ───────────────────────────────────────────────────────────────
// Path encoding helpers
// ───────────────────────────────────────────────────────────────

// Path-encode an absolute path the same way Claude does:
// "/Users/gago/base/foo" → "-Users-gago-base-foo"
export function encodeClaudePath(absPath) {
  return absPath.replace(/\//g, '-');
}

// Current machine's $HOME in Claude's encoded form.
export function homePrefix() {
  return encodeClaudePath(homedir());
}

// Given an encoded local project key, classify it:
//   - "home": project lives under $HOME. portableId is the encoded path
//     *relative* to $HOME (e.g. "base-foo"), without a leading dash.
//   - "absolute": project lives outside $HOME. portableId is the full
//     encoded key (non-portable across machines with different layouts).
export function toPortable(encodedKey, prefix = homePrefix()) {
  if (encodedKey === prefix) {
    return { kind: 'home', portableId: '' };
  }
  if (encodedKey.startsWith(prefix + '-')) {
    return { kind: 'home', portableId: encodedKey.slice(prefix.length + 1) };
  }
  return { kind: 'absolute', portableId: encodedKey };
}

// Reverse of toPortable for the current machine.
export function fromPortable(kind, portableId, prefix = homePrefix()) {
  if (kind === 'home') {
    return portableId ? `${prefix}-${portableId}` : prefix;
  }
  return portableId;
}

// ───────────────────────────────────────────────────────────────
// Config loading
// ───────────────────────────────────────────────────────────────

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `config not found at ${CONFIG_PATH}.\n` +
      `Run configure first:\n` +
      `  node ${join(TOOL_ROOT, 'scripts', 'configure.mjs')} --backup-repo=/abs/path/to/your/backup/repo`
    );
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) { throw new Error(`config at ${CONFIG_PATH} is not valid JSON: ${e.message}`); }
  if (!cfg.backup_repo_path) {
    throw new Error(`config at ${CONFIG_PATH} is missing "backup_repo_path". Re-run configure.`);
  }
  if (!existsSync(cfg.backup_repo_path)) {
    throw new Error(
      `backup repo path does not exist: ${cfg.backup_repo_path}\n` +
      `Either clone it there, or re-run configure with the correct --backup-repo=.`
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

export function dataDir(cfg) {
  return join(cfg.backup_repo_path, 'data');
}

export function globalDataDir(cfg) {
  return join(cfg.backup_repo_path, 'data', 'global');
}

// ───────────────────────────────────────────────────────────────
// Global track: ~/.claude/CLAUDE.md, RTK.md, skills/, etc.
// ───────────────────────────────────────────────────────────────

export function globalEnabled(cfg) {
  // Default: enabled. Explicit false in config disables.
  return cfg?.global?.enabled !== false;
}

export function globalFileList(cfg) {
  return cfg?.global?.files ?? DEFAULT_GLOBAL_FILES;
}

// For each configured global entry, return its local path + repo path + the
// classification of where it currently exists. Entries that exist neither
// locally nor in the repo are omitted.
export async function listGlobalEntries(cfg) {
  if (!globalEnabled(cfg)) return [];
  const out = [];
  for (const name of globalFileList(cfg)) {
    const localPath = join(CLAUDE_HOME, name);
    const repoPath  = join(globalDataDir(cfg), name);
    let localKind = null, repoKind = null;
    if (existsSync(localPath)) {
      const st = await stat(localPath);
      localKind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
    }
    if (existsSync(repoPath)) {
      const st = await stat(repoPath);
      repoKind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
    }
    if (!localKind && !repoKind) continue;
    out.push({
      name,
      localPath,
      repoPath,
      kind: localKind ?? repoKind,           // canonical kind from whichever side has it
      presence: localKind && repoKind ? 'both' : (localKind ? 'local' : 'repo'),
    });
  }
  return out;
}

// Walk a file OR directory into a path → sha256 map. For a single file,
// uses '' as the map key (so a one-entry map represents the file). For a
// directory, falls through to fingerprint() which walks recursively.
export async function fingerprintEntry(absPath) {
  if (!existsSync(absPath)) return new Map();
  const st = await stat(absPath);
  if (st.isFile()) {
    const buf = await readFile(absPath);
    return new Map([['', createHash('sha256').update(buf).digest('hex')]]);
  }
  if (st.isDirectory()) {
    return fingerprint(absPath);
  }
  return new Map();
}

// ───────────────────────────────────────────────────────────────
// Selection: per-project include / exclude glob patterns
// ───────────────────────────────────────────────────────────────
//
// cfg.projects = { include: ["*"], exclude: ["temp-*"] }
//
// Defaults: include = ["*"] (everything), exclude = [] (nothing).
// A project is selected iff its portable id matches ANY include pattern
// AND does NOT match any exclude pattern. Patterns operate on the portable
// id (for home-projects, the suffix; for absolute-projects, the full
// encoded path). The single-segment wildcard "*" matches any characters.

function globToRegex(pattern) {
  // Escape regex specials except *, then convert * → .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function matchesAny(id, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(p => globToRegex(p).test(id));
}

export function isProjectSelected(portableId, cfg) {
  const sel = cfg?.projects ?? {};
  const include = (sel.include && sel.include.length) ? sel.include : ['*'];
  const exclude = sel.exclude ?? [];
  return matchesAny(portableId, include) && !matchesAny(portableId, exclude);
}

// ───────────────────────────────────────────────────────────────
// Project discovery
// ───────────────────────────────────────────────────────────────

// Local projects under ~/.claude/projects/*/memory/.
//
// By default returns ONLY projects that pass cfg.projects include/exclude
// filtering. Pass { includeFiltered: true } to also include excluded
// entries (each tagged with .selected: false) — useful for the `list`
// command. The push/pull/status code paths always use the filtered form.
export async function listLocalProjects(cfg, opts = {}) {
  if (!existsSync(CLAUDE_PROJECTS)) return [];
  const entries = await readdir(CLAUDE_PROJECTS, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const localMemoryDir = join(CLAUDE_PROJECTS, ent.name, 'memory');
    if (!existsSync(localMemoryDir)) continue;
    const p = toPortable(ent.name);
    const subdir = p.kind === 'home' ? 'home-projects' : 'absolute-projects';
    const portableSlug = p.portableId || '__root__';
    const selected = isProjectSelected(p.portableId || '__root__', cfg);
    if (!selected && !opts.includeFiltered) continue;
    out.push({
      localKey: ent.name,
      portableKind: p.kind,
      portableId: p.portableId,
      localMemoryDir,
      repoMemoryDir: join(dataDir(cfg), subdir, portableSlug, 'memory'),
      selected,
    });
  }
  return out;
}

// Projects stored in the backup repo.
//
// Same filtering semantics as listLocalProjects.
export async function listRepoProjects(cfg, opts = {}) {
  const out = [];
  for (const [subdir, kind] of [['home-projects', 'home'], ['absolute-projects', 'absolute']]) {
    const base = join(dataDir(cfg), subdir);
    if (!existsSync(base)) continue;
    const entries = await readdir(base, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const repoMemoryDir = join(base, ent.name, 'memory');
      if (!existsSync(repoMemoryDir)) continue;
      const portableId = ent.name === '__root__' ? '' : ent.name;
      const localKey = fromPortable(kind, portableId);
      const selected = isProjectSelected(ent.name, cfg);
      if (!selected && !opts.includeFiltered) continue;
      out.push({
        localKey,
        portableKind: kind,
        portableId,
        selected,
        localMemoryDir: join(CLAUDE_PROJECTS, localKey, 'memory'),
        repoMemoryDir,
      });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// Fingerprinting + diffing
// ───────────────────────────────────────────────────────────────

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

export function diff(a, b) {
  const added = [], changed = [], removed = [], unchanged = [];
  for (const [p, sha] of a) {
    if (!b.has(p)) added.push(p);
    else if (b.get(p) !== sha) changed.push(p);
    else unchanged.push(p);
  }
  for (const p of b.keys()) {
    if (!a.has(p)) removed.push(p);
  }
  return { added, changed, removed, unchanged };
}

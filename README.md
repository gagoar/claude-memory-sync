# claude-memory-sync

A [Claude Code](https://claude.com/claude-code) plugin that backs up and restores per-project memory to a Git repo of your choice. Once installed, the `/memory-sync` skill works from inside any session: `/memory-sync push`, `/memory-sync pull`, `/memory-sync status`.

Storage is **HOME-relative**, so a memory captured on `/Users/alice/...` restores cleanly on `/Users/bob/...` without manual renaming.

## Why

Claude Code stores per-project memory under `~/.claude/projects/<path-encoded-project-name>/memory/`. Those files accumulate user preferences, project context, and feedback session by session. They live only on the machine you set them up on — survive a disk wipe or a new laptop only if you back them up explicitly.

This plugin does that. The tool repo (this one) is public; the backup repo (your choice) is where the actual memory data lives, typically a private repo on your own account.

## Install

### 1. Install the plugin

If you have a Claude Code marketplace configured, use the standard `/plugin` flow. To install from this public repo directly as a local plugin:

```bash
# Clone the plugin somewhere persistent
git clone https://github.com/gagoar/claude-memory-sync.git ~/claude-memory-sync
```

Then register it with Claude Code's plugin manager. Exact slash command depends on your version; common forms are `/plugin install ~/claude-memory-sync` or browsing it from a local marketplace.

### 2. Create a backup destination repo

Pick any git repo you want to use as the backup store. Recommended: a **PRIVATE** repo on your own account, because memory often contains project names, internal API hostnames, and user identifiers.

```bash
gh repo create my-claude-memory --private --clone
# this clones the new empty repo to ./my-claude-memory
mv my-claude-memory ~/
```

…or use any existing private repo you already have, cloned anywhere.

### 3. Configure the plugin

From inside Claude Code:

```
/memory-sync configure --backup-repo=~/my-claude-memory
```

Or directly:

```bash
node ~/claude-memory-sync/scripts/configure.mjs --backup-repo=~/my-claude-memory
```

This writes `~/.claude/memory-sync.config.json`. Re-run any time to switch destinations.

## Use

| Goal | In Claude Code | From terminal |
|---|---|---|
| Back up new memory | `/memory-sync push` | `node $PLUGIN/scripts/push.mjs` |
| Restore on a new machine | `/memory-sync pull` | `node $PLUGIN/scripts/pull.mjs` |
| See what's drifted | `/memory-sync status` | `node $PLUGIN/scripts/status.mjs` |
| List projects + selection state | `/memory-sync list` | `node $PLUGIN/scripts/list.mjs` |
| **Interactive select** (multi-checkbox UI) | `/memory-sync select` | _(skill-driven; no terminal equivalent)_ |
| Switch destination | `/memory-sync configure --backup-repo=NEW` | `node $PLUGIN/scripts/configure.mjs --backup-repo=NEW` |
| Exclude a project | `/memory-sync configure --exclude=PATTERN` | `node $PLUGIN/scripts/configure.mjs --exclude=PATTERN` |
| Limit to specific projects | `/memory-sync configure --reset-projects --include=PATTERN` | `node $PLUGIN/scripts/configure.mjs --reset-projects --include=PATTERN` |
| Migrate older non-portable layout | `/memory-sync migrate` | `node $PLUGIN/scripts/migrate.mjs` |

Notes:
- `push.mjs` no-ops cleanly when nothing has changed.
- `pull.mjs` refuses to overwrite local files that the backup repo lacks unless `--force` is passed.
- Both `push` and `pull` only touch `~/.claude/projects/*/memory/` and your configured backup repo. Never `settings.local.json`, `sessions/`, `cache/`, or anything else under `~/.claude/`.

## Per-project selection

By default every project under `~/.claude/projects/*/memory/` is backed up. To restrict the set you have three options:

- **Interactive (recommended):** in Claude Code, run `/memory-sync select`. The skill reads the current state, asks you to multi-select projects via Claude Code's native question UI, and applies the result for you. Up to 16 projects fit in a single round-trip; for larger sets the skill falls back to asking for a glob.
- **CLI flags:** use `configure --include=PATTERN` or `configure --exclude=PATTERN` to update one at a time.
- **JSON edit:** open `~/.claude/memory-sync.config.json` and edit `projects.include` / `projects.exclude` directly.

Patterns are simple globs (`*` is the wildcard) operating on the **portable id** (the suffix shown by `/memory-sync list`).

```bash
# Back up only projects matching base-* (e.g. base-foo, base-bar)
node scripts/configure.mjs --reset-projects --include='base-*'

# Back up everything EXCEPT one project
node scripts/configure.mjs --exclude=base-throwaway

# Back up everything except all temp-* projects
node scripts/configure.mjs --exclude='temp-*'

# Reset back to "include all"
node scripts/configure.mjs --reset-projects
```

A project is selected iff its portable id matches **any** include pattern AND does **not** match any exclude pattern. An empty include list defaults to "include all."

`/memory-sync list` always shows the full picture — included projects, excluded projects, projects present only locally, and projects present only in the repo — so you can confirm changes before push/pull.

Already-pushed data for a project you later add to `--exclude` stays in the backup repo (no implicit deletion). If you want to remove it, delete it manually in the backup repo or open the data dir and `git rm` it.

## On a new machine

```bash
# 1. Clone the plugin
git clone https://github.com/gagoar/claude-memory-sync.git ~/claude-memory-sync
# (then register with Claude Code's plugin manager)

# 2. Clone your backup repo
git clone git@github.com:you/my-claude-memory.git ~/my-claude-memory

# 3. Wire them together and restore
/memory-sync configure --backup-repo=~/my-claude-memory
/memory-sync pull
```

Every memory file from every project lands back in `~/.claude/projects/<project>/memory/`, with the project keys automatically reconstructed for this machine's `$HOME`.

## How HOME-relative storage works

Claude encodes the absolute path of each project as the local directory name by replacing slashes with dashes — `/Users/gago/base/foo` becomes `-Users-gago-base-foo`. This means the original username is baked into the key.

This plugin stores memories by their **suffix** — the encoded path *after* the current `$HOME` prefix — under `data/home-projects/<suffix>/memory/` in the backup repo. On pull, it prepends the new machine's `$HOME` prefix:

| Source | Path |
|---|---|
| Original local key (machine A) | `-Users-alice-base-foo` |
| `$HOME` on machine A | `/Users/alice` → encoded `-Users-alice` |
| Stored in repo as | `data/home-projects/base-foo/memory/...` |
| `$HOME` on machine B | `/Users/bob` → encoded `-Users-bob` |
| Restored local key (machine B) | `-Users-bob-base-foo` |
| Lands at | `~/.claude/projects/-Users-bob-base-foo/memory/...` |

Projects living outside `$HOME` (e.g. `/opt/foo`) are stored under `data/absolute-projects/-opt-foo/memory/` and restore only on machines that have the same absolute path. These are rare.

## Repo layout (this plugin)

```
claude-memory-sync/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── memory-sync/
│       └── SKILL.md
├── scripts/
│   ├── configure.mjs   # First-time setup, takes --backup-repo
│   ├── push.mjs        # Local memory → backup repo
│   ├── pull.mjs        # Backup repo → local memory
│   ├── status.mjs      # Show drift
│   ├── migrate.mjs     # One-time migration from older non-portable layout
│   └── _lib.mjs        # Shared helpers
├── README.md
├── LICENSE
└── .gitignore
```

## Backup repo layout (yours)

After your first push:

```
my-claude-memory/
└── data/
    ├── home-projects/
    │   └── <suffix>/             # e.g. base-foo, code-bar, etc.
    │       └── memory/
    │           ├── MEMORY.md
    │           └── *.md
    └── absolute-projects/        # only used if you have projects outside $HOME
        └── -opt-foo/
            └── memory/
```

## Privacy

- **This plugin repo is public**, contains no user data, MIT-licensed.
- **The backup repo is yours.** Pick a private repo if your memory ever contains project names, internal API hosts, user identifiers, etc. (most do).
- The tool never reads or writes outside `~/.claude/projects/*/memory/` and your chosen backup repo.

## License

MIT. See [LICENSE](./LICENSE).

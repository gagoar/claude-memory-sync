# claude-memory-sync

Push, pull, and diff [Claude Code](https://claude.com/claude-code) per-project memory between your machine and a Git repo of your choice. Installs as a Claude Code skill so `/memory-sync push` and `/memory-sync pull` work from inside any session.

The tool itself (this repo) is public. The backup destination — where your memory data actually lives — is a separate git repo you configure at install time. Typically that's a **private** repo on your own account.

## Why

Claude Code stores per-project memory under `~/.claude/projects/<path-encoded-project-name>/memory/`. Those files capture user preferences, project context, feedback, and references that accumulate session by session. They live only on the machine you set them up on — survive a disk wipe or a new laptop only if you back them up explicitly. This tool does that.

## Install

```bash
# 1. Clone this tool
git clone https://github.com/gagoar/claude-memory-sync.git ~/claude-memory-sync

# 2. Create or clone a backup repo to store your memory data.
#    Recommended: a PRIVATE repo on your own account, since memory often
#    contains project names, internal hostnames, identifiers, etc.
#    (Example for a brand-new private repo:)
gh repo create my-claude-memory --private --clone
# …or clone an existing one you already use:
# git clone git@github.com:you/my-claude-memory.git ~/my-claude-memory

# 3. Point the tool at your backup repo
cd ~/claude-memory-sync
node scripts/install.mjs --backup-repo=~/my-claude-memory
```

`install.mjs` writes `~/.claude/memory-sync.config.json` with both repo paths, and symlinks `SKILL.md` into `~/.claude/skills/memory-sync.md` so Claude discovers it. Re-run any time you want to switch backup destinations.

## Use

| Goal | Terminal | Inside Claude Code |
|---|---|---|
| Back up new/edited memory | `node ~/claude-memory-sync/scripts/push.mjs` | `/memory-sync push` |
| Restore memory after re-cloning | `node ~/claude-memory-sync/scripts/pull.mjs` | `/memory-sync pull` |
| See what's drifted | `node ~/claude-memory-sync/scripts/status.mjs` | `/memory-sync status` |
| Switch backup destination | `node ~/claude-memory-sync/scripts/install.mjs --backup-repo=NEW` | re-run install |

- `push.mjs` no-ops cleanly if there's nothing new.
- `pull.mjs` refuses to overwrite local files that aren't in the backup repo unless `--force` is passed.
- Both scripts only ever touch `~/.claude/projects/*/memory/` — never settings, sessions, cache, or anything else under `~/.claude/`.

## On a new machine

```bash
git clone https://github.com/gagoar/claude-memory-sync.git ~/claude-memory-sync
git clone git@github.com:you/my-claude-memory.git ~/my-claude-memory
cd ~/claude-memory-sync && node scripts/install.mjs --backup-repo=~/my-claude-memory
node scripts/pull.mjs
```

Every memory file from every project lands back in `~/.claude/projects/<project>/memory/`.

## Cross-machine path differences

Claude encodes the absolute path of each project as the directory name under `~/.claude/projects/` — e.g. `-Users-gago-base-acme` for `/Users/gago/base/acme`. If your new machine has a different `$HOME` or you put a project at a different path, the directory names won't match.

Two options:

1. **Recreate projects at the same paths on the new machine** (easiest — no rename needed).
2. **Rename the backed-up directories** to match the new paths. Example: switching username `gago` → `german`:

   ```bash
   cd ~/my-claude-memory/data/projects
   for d in -Users-gago-*; do mv "$d" "${d/-Users-gago/-Users-german}"; done
   cd ~/claude-memory-sync && node scripts/push.mjs   # commits the rename
   node scripts/pull.mjs                              # populates new locations
   ```

## Repo layout (this tool)

```
claude-memory-sync/
├── SKILL.md             # Skill definition (symlinked to ~/.claude/skills/)
├── README.md            # This file
├── LICENSE              # MIT
└── scripts/
    ├── install.mjs      # First-time setup, takes --backup-repo
    ├── push.mjs         # Local memory → backup repo
    ├── pull.mjs         # Backup repo → local memory
    ├── status.mjs       # Show drift
    └── _lib.mjs         # Shared helpers
```

## Backup repo layout (yours)

After your first push, your backup repo will look like:

```
my-claude-memory/
└── data/
    └── projects/
        └── -Users-<you>-<path>/
            └── memory/
                ├── MEMORY.md
                └── *.md
```

Mirrors the path-encoded structure Claude uses locally.

## Privacy

- **The tool repo (this one) is public** and contains no user data — only scripts and the skill file.
- **The backup repo is yours.** Pick a private repo if your memory ever contains project names, internal API hosts, user identifiers, etc. (which most do).
- The tool never reads or writes anything outside `~/.claude/projects/*/memory/` and your chosen backup repo.

## License

MIT. See [LICENSE](./LICENSE).

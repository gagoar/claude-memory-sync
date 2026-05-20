---
name: memory-sync
description: Push, pull, or check sync status of Claude per-project memory between this machine and the user's configured backup git repo. Trigger when the user invokes /memory-sync or says "backup my memory", "sync memory", "pull memory", or "restore memory on this machine".
---

# Memory Sync

Sync `~/.claude/projects/*/memory/` directories between this machine and a user-configured backup git repo (typically a private repo on their own account).

## How to find the tool

1. Read `~/.claude/memory-sync.config.json` — it contains `{ "tool_repo_path": "...", "backup_repo_path": "..." }`. Both paths are absolute and set by `install.mjs` during setup.
2. If the config does not exist, the user has not run setup. Tell them:
   - Clone the tool: `git clone https://github.com/gagoar/claude-memory-sync.git ~/claude-memory-sync`
   - Clone or create their backup repo (any git repo will do, private recommended)
   - Run `node ~/claude-memory-sync/scripts/install.mjs --backup-repo=/abs/path/to/their/backup/repo`

## Operations

Resolve `tool_repo_path` from the config, then run one of:

| User asks | Run |
|---|---|
| push / backup / save / "I added new memory" | `node $TOOL/scripts/push.mjs` |
| pull / restore / "on this new machine" | `node $TOOL/scripts/pull.mjs` |
| status / diff / "what's drifted" | `node $TOOL/scripts/status.mjs` |
| switch backup destination / re-install | `node $TOOL/scripts/install.mjs --backup-repo=NEW_PATH` |

If the user didn't specify a mode, ask via AskUserQuestion which operation they want (push / pull / status). **Don't guess between push and pull** — they are not reversible without thought.

## Reporting

Each script prints a structured summary to stdout (added / changed / unchanged / removed file counts and the commit SHA on push). Relay that summary to the user verbatim and stop. Do NOT re-run a script in a different mode without explicit user instruction.

## Safety

- **Only memory directories are touched.** Scripts read only `~/.claude/projects/*/memory/` — never `settings.local.json`, `sessions/`, `cache/`, or anything else under `~/.claude/`.
- **Conflict resolution:** push is local→remote (no merge); pull is remote→local (no merge). If `pull.mjs` would overwrite local files that the backup repo doesn't have, it prints them and aborts unless `--force` is passed.
- `push.mjs` skips creating an empty commit when nothing changed.
- The tool repo and the backup repo are kept separate by design. The tool is public; the backup repo is the user's own private store.

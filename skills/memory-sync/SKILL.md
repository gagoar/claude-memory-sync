---
name: memory-sync
description: Push, pull, configure, or list Claude Code per-project memory between this machine and the user's configured backup git repo. Supports per-project include/exclude selection and HOME-relative storage so memories restore correctly on any machine. Trigger when the user invokes /memory-sync (with mode push, pull, status, list, configure, migrate) or says "backup my memory", "sync memory", "pull memory", "restore memory on this machine", "which projects do I back up", or "set up memory backup".
---

# Memory Sync

Sync `~/.claude/projects/*/memory/` directories between this machine and a user-configured backup git repo (typically a private repo on their own account).

## Finding the tool

The scripts ship inside this plugin. Read `~/.claude/plugins/installed_plugins.json` to find the plugin's install path (the entry will be named `claude-memory-sync@<marketplace>` — usually `local` if installed from a clone, or whichever marketplace the user used). The scripts live at `<installPath>/scripts/`.

If the plugin manifest isn't readable for any reason, fall back to reading `~/.claude/memory-sync.config.json` (written by the configure step) which contains `tool_repo_path`.

## Operations

The user invokes one of:

| Mode | Action |
|---|---|
| `configure` | First-time setup, switch destination, or update project selection. Flags: `--backup-repo=/abs/path`, `--include=PATTERN` (append to include list), `--exclude=PATTERN` (append to exclude list), `--reset-projects` (clear both lists). Run `node $SCRIPTS/configure.mjs <flags>`. |
| `list` | Show every known project (local and repo) with its selection state, kind, and where its data lives. No mutation. Run `node $SCRIPTS/list.mjs`. |
| `select` | **Interactive selection.** Drive a multi-select via AskUserQuestion; apply the result through `configure`. See "Select mode" below. |
| `push` | Local memory → backup repo (only selected projects). Run `node $SCRIPTS/push.mjs`. |
| `pull` | Backup repo → local memory (only selected projects). Run `node $SCRIPTS/pull.mjs`. Accepts `--force` to overwrite local-only files. |
| `status` | Show what's drifted between local and repo (only selected projects). Run `node $SCRIPTS/status.mjs`. No mutation. |
| `migrate` | One-time migration from an older non-portable layout. Run `node $SCRIPTS/migrate.mjs`. |

If the user didn't specify a mode, ask via AskUserQuestion. **Don't guess between push and pull** — they are not reversible without thought.

When the user says "which projects am I backing up" / "show what's selected" / "list my projects", invoke `list`. When they say "let me pick projects" / "select projects to back up" / "choose what to sync", invoke `select`. When they say "stop backing up X" / "exclude X" / "only back up X", you can use `configure` directly with the appropriate `--include` or `--exclude` patterns — but for anything beyond one or two projects, **prefer `select`** because the UI is clearer.

## Select mode (interactive)

When the user invokes `select` (or asks for a "fancy" / "interactive" / "pick" selection):

1. **Read current state.** Run `node $SCRIPTS/list.mjs --json` and parse the output. It returns:
   ```json
   {
     "backup_repo_path": "...",
     "include": [...patterns],
     "exclude": [...patterns],
     "projects": [
       { "localKey": "...", "portableId": "base-foo", "portableKind": "home",
         "selected": true, "hasLocal": true, "hasRepo": true },
       ...
     ]
   }
   ```

2. **Size-check.** AskUserQuestion supports up to 4 questions per call, each with 2-4 options — i.e. up to 16 projects in one round-trip. If the project count fits:
   - Group projects into questions of up to 4 options each (no more than 4 questions in the same call).
   - Use `multiSelect: true`.
   - Phrase each question like *"Which of these projects should be backed up? (Currently selected: A, C.)"* and label each option with the portable id, plus a short description that includes its current state (`included` / `excluded` / `local-only` / `repo-only`) so the user knows what they're toggling.

3. **Above 16 projects** (rare): explain the limit briefly, then ask a single free-text question for a glob pattern (e.g. `base-*`) and run `configure --reset-projects --include=PATTERN [--include=...]` with the answer.

4. **Apply the answer:**
   - User selected ALL projects → `node $SCRIPTS/configure.mjs --reset-projects` (defaults back to include-all).
   - User selected a subset → `node $SCRIPTS/configure.mjs --reset-projects --include=ID1 --include=ID2 ...` (one `--include` per chosen portable id).
   - User selected NONE → confirm with a second AskUserQuestion before disabling everything; if confirmed, `--reset-projects --exclude='*'`.

5. **Confirm by re-running list.** After `configure` exits, run `node $SCRIPTS/list.mjs` (without `--json`) and relay the human-readable output verbatim so the user sees the new state.

Never edit `~/.claude/memory-sync.config.json` directly — always go through `configure.mjs` so validation runs.

## First-time setup

If `~/.claude/memory-sync.config.json` does not exist and the user is invoking anything other than `configure`, instruct them:

1. Create or clone a backup repo (recommended: PRIVATE on their own GitHub account). Example:
   ```
   gh repo create my-claude-memory --private --clone
   ```
2. Run configure with the absolute path:
   ```
   /memory-sync configure --backup-repo=~/my-claude-memory
   ```
3. Then run their original command (push/pull/status).

## Portability

Storage in the backup repo is HOME-relative. A project at `/Users/alice/code/foo` on machine A is stored under `data/home-projects/code-foo/` in the repo. On machine B with `$HOME=/Users/bob`, pull reconstructs the local key as `-Users-bob-code-foo` and lands the files at `~/.claude/projects/-Users-bob-code-foo/memory/`. The user does not need to do any manual renaming.

Projects outside `$HOME` (rare) are stored under `data/absolute-projects/` with the full encoded path and only restore correctly on machines that have the same absolute path.

## Reporting

Each script prints a structured summary to stdout (added / changed / unchanged / removed file counts and the commit SHA on push). Relay that summary to the user verbatim and stop. Do NOT re-run a script in a different mode without explicit user instruction.

## Safety

- The tool only ever touches `~/.claude/projects/*/memory/` and the configured backup repo. Never `settings.local.json`, `sessions/`, `cache/`, or anything else under `~/.claude/`.
- `push` is local→remote (no merge). `pull` is remote→local (no merge). If `pull.mjs` would overwrite local files that the backup repo lacks, it lists them and aborts unless `--force` is passed.
- `push.mjs` skips committing when nothing changed (no empty commits).
- The plugin (this repo) is public and contains no user data. The backup repo (user's choice) is where memory data actually lives — typically private.

---
name: sync
description: "/memory-sync:sync — Back up and restore Claude Code per-project memory to a private Git repo. Supports push, pull, status, list, select, history, configure, init, doctor. HOME-relative storage works across machines."
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
| `init` | **Interactive first-time setup.** Walk the user through creating or selecting a backup repo and configuring the plugin. See "Init mode" below. |
| `configure` | Switch destination or update project selection (no prompts; flag-driven). Flags: `--backup-repo=/abs/path`, `--include=PATTERN` (append to include list), `--exclude=PATTERN` (append to exclude list), `--reset-projects` (clear both lists). Run `node $SCRIPTS/configure.mjs <flags>`. |
| `list` | Show every known project (local and repo) with its selection state, kind, and where its data lives. No mutation. Run `node $SCRIPTS/list.mjs`. |
| `select` | **Interactive project selection.** Drive a multi-select via AskUserQuestion; apply the result through `configure`. See "Select mode" below. |
| `push` | Local memory → backup repo (only selected projects). Run `node $SCRIPTS/push.mjs`. |
| `pull` | Backup repo → local memory (only selected projects). Run `node $SCRIPTS/pull.mjs`. Accepts `--force` to overwrite local-only files. |
| `status` | Show what's drifted between local and repo (only selected projects + global track). Run `node $SCRIPTS/status.mjs`. No mutation. |
| `history` | Show recent backup commits with timestamps and what each one changed. Flags: `--limit=N`, `--since=TIME`, `--paths`. Run `node $SCRIPTS/history.mjs <flags>`. No mutation. |
| `migrate` | One-time migration from an older non-portable layout. Run `node $SCRIPTS/migrate.mjs`. |
| `doctor` | **Diagnostic tool.** Read-only. Prints a human summary and a fenced `memory-sync-doctor` block the user can paste back into a Claude Code session for analysis. Checks: config validity, backup repo git state (is the clone stale?), HOME/prefix mapping, per-project pull dry-run (add/change/conflict counts), selection filter visibility, and emits a verdict. Run `node $SCRIPTS/doctor.mjs`. Accepts `--json` for raw JSON output. |

**Auto-route to `init` on first contact — this is the most important behavior of this skill.** If `~/.claude/memory-sync.config.json` does not exist (or its `backup_repo_path` field is missing, or that path doesn't resolve to a real git repo) and the user invokes ANY mode at all — including just `/memory-sync:sync` with no args, or natural-language phrases like "back up my memory" — run `init` FIRST. Do not ask the user "what do you want to do?" beforehand. Do not run any push/pull/list/status until init has completed. The presence of a valid config is the only signal that init has already happened.

When init completes, if the user's original request was a different mode (push/pull/etc.), continue with that mode. If they just typed `/memory-sync:sync init` or `/memory-sync:sync` (no args), end with a brief recap of what's available.

If a valid config DOES exist and the user invoked the skill without specifying a mode, ask via AskUserQuestion which mode they want. **Don't guess between push and pull** — they are not reversible without thought.

When the user says "which projects am I backing up" / "show what's selected" / "list my projects", invoke `list`. When they say "let me pick projects" / "select projects to back up" / "choose what to sync", invoke `select`. When they say "stop backing up X" / "exclude X" / "only back up X", you can use `configure` directly with the appropriate `--include` or `--exclude` patterns — but for anything beyond one or two projects, **prefer `select`** because the UI is clearer. When the user says "memory isn't working on another machine" / "memory not populating" / "diagnose memory sync" / "why isn't pull working", invoke `doctor` and tell them to paste the fenced block back here.

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

## Init mode (interactive setup)

Invoked explicitly as `init`, or auto-triggered when any other mode runs without a valid config. Steps:

### 1. Sanity check the environment

Before asking the user anything, verify:
- `gh --version` succeeds (GitHub CLI is installed) — needed for the "create a new repo for me" path.
- `gh auth status` shows a logged-in account — same.
- `git --version` succeeds — always required.

If `gh` is missing or unauthenticated, drop the "create new repo" option from the choices (or instruct the user to install/login first).

### 2. Ask the user which strategy to use

Use AskUserQuestion (single-select) with three options:

```
question: "How do you want to set up the backup repo for your Claude memory?"
header:   "Backup repo"
options:
  - "Create a new private repo on GitHub (recommended)"
       I'll run `gh repo create` for you and clone it locally.
  - "I already have a local clone"
       Point the plugin at an existing path on this machine.
  - "Clone an existing remote repo"
       I'll `git clone` your remote into ~/my-claude-memory.
```

### 3. Apply the chosen strategy

**Create new (recommended):** Ask a second AskUserQuestion for the repo name (default `my-claude-memory`). Then in one Bash call run:
```bash
gh repo create <name> --private --description "Personal Claude Code memory backup" --clone --remote=origin && mv <name> ~/<name>
```
The repo lands at `~/<name>`. If `mv` complains because the user ran `gh repo create` from a different cwd, just check where the clone landed and use that absolute path.

**Existing local clone:** Ask a free-text question for the absolute path. Expand `~`. Validate that the path exists AND is a git repo (`.git/` present) before proceeding.

**Clone existing remote:** Ask for the clone URL (e.g. `git@github.com:you/foo.git`). Run `git clone <url> ~/<basename>` where `<basename>` is the last segment of the URL without `.git`. Confirm the destination doesn't already exist before running.

### 4. Configure the plugin

After the repo is in place, run:
```bash
node $SCRIPTS/configure.mjs --backup-repo=<absolute-path>
```

Relay the configure output to the user.

### 5. Offer the next step

Ask whether to do a `push` (back up current local memory now) or `pull` (restore from the just-cloned repo, useful if it already has data) or `status` (just see what's there). Three-option AskUserQuestion. Run their choice.

### 6. Resume the original intent

If init was auto-triggered because the user invoked `/memory-sync:sync push` (or pull, etc.) without a config, the previous step already covered it. If they invoked `/memory-sync:sync init` explicitly, end with a recap of available modes.

## Portability

Storage in the backup repo is HOME-relative. A project at `/Users/alice/code/foo` on machine A is stored under `data/home-projects/code-foo/` in the repo. On machine B with `$HOME=/Users/bob`, pull reconstructs the local key as `-Users-bob-code-foo` and lands the files at `~/.claude/projects/-Users-bob-code-foo/memory/`. The user does not need to do any manual renaming.

Projects outside `$HOME` (rare) are stored under `data/absolute-projects/` with the full encoded path and only restore correctly on machines that have the same absolute path.

## Global track

Alongside per-project memory, the plugin also backs up global Claude Code config files that live directly under `~/.claude/`:

- `~/.claude/CLAUDE.md` — user-wide behavioral instructions
- `~/.claude/RTK.md` — referenced from CLAUDE.md
- `~/.claude/skills/` — user-authored skills (NOT plugin-shipped skills)
- `~/.claude/keybindings.json` — custom keyboard shortcuts

Stored at `data/global/` in the backup repo. Each file/directory is backed up if it exists locally; missing files are skipped. Configured via `cfg.global.files` (default: the four listed above) and `cfg.global.enabled` (default true). Pull/push/status all include the global track.

Symlinks within `~/.claude/skills/` are NOT followed — only regular files are backed up.

## Reporting

Each script prints a structured summary to stdout (added / changed / unchanged / removed file counts and the commit SHA on push). Relay that summary to the user verbatim and stop. Do NOT re-run a script in a different mode without explicit user instruction.

## Safety

- The tool only ever touches `~/.claude/projects/*/memory/` and the configured backup repo. Never `settings.local.json`, `sessions/`, `cache/`, or anything else under `~/.claude/`.
- `push` is local→remote (no merge). `pull` is remote→local (no merge). If `pull.mjs` would overwrite local files that the backup repo lacks, it lists them and aborts unless `--force` is passed.
- `push.mjs` skips committing when nothing changed (no empty commits).
- The plugin (this repo) is public and contains no user data. The backup repo (user's choice) is where memory data actually lives — typically private.

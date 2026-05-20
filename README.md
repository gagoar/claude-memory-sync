# claude-memory-sync

A [Claude Code](https://claude.com/claude-code) plugin that backs up and restores per-project memory to a Git repo of your choice.

Storage is **HOME-relative** — memory captured on `/Users/alice/...` restores cleanly on `/Users/bob/...` with no manual renaming.

---

## Install (4 steps total)

**Step 1-3 — install the plugin.** Type these in Claude Code:

```
/plugin marketplace add gagoar/claude-memory-sync
/plugin install claude-memory-sync@claude-memory-sync
/reload-plugins
```

**Step 4 — set up your backup repo.** Type:

```
/memory-sync init
```

The skill will **ask you where to put your backup repo** (and offer to create a private one on GitHub for you, if you don't have one). It then configures everything. That's it — no other typing required.

> 💡 You can also just say *"set up memory backup"* or *"back up my memory"* and Claude will route to the same setup flow. Init runs automatically the first time you invoke any memory-sync command without a configured backup.

---

## Daily use

| You type | What happens |
|---|---|
| `/memory-sync push` | Back up new/changed memory + global config to your repo |
| `/memory-sync pull` | Restore from your repo |
| `/memory-sync status` | See what's drifted |
| `/memory-sync list` | Show projects and global files that are backed up |
| `/memory-sync select` | Pick which projects to include (interactive checkboxes) |
| `/memory-sync history` | Show recent backup commits — *what* was backed up *when* |
| `/memory-sync configure --backup-repo=NEW` | Switch backup destination |

`push` no-ops when nothing has changed. `pull` refuses to overwrite local changes that aren't in the backup unless `--force` is passed.

### What's backed up

- **Per-project memory** — `~/.claude/projects/*/memory/` (stored portably; works across usernames)
- **Global config** — `~/.claude/CLAUDE.md`, `~/.claude/RTK.md`, `~/.claude/skills/`, `~/.claude/keybindings.json`

Nothing else under `~/.claude/` is touched — never `settings.json`, sessions, cache, plugins, or anything else.

---

## Updating the plugin

When the plugin gains new features:

```
/plugin update claude-memory-sync@claude-memory-sync
/reload-plugins
```

Or just refresh the marketplace + reinstall:

```
/plugin marketplace update claude-memory-sync
/plugin update claude-memory-sync@claude-memory-sync
/reload-plugins
```

Your `~/.claude/memory-sync.config.json` is preserved (the plugin manager only touches its own cache directory). Re-run `/memory-sync init` only if a release adds a new config field that needs your input.

## On a new computer

Same flow, with one change at step 4:

```
/plugin marketplace add gagoar/claude-memory-sync
/plugin install claude-memory-sync@claude-memory-sync
/reload-plugins
/memory-sync init       # pick "Clone an existing remote", give your backup-repo URL
/memory-sync pull       # restore every memory file
```

Memory lands in `~/.claude/projects/<project>/memory/` with project keys automatically rewritten for this machine's `$HOME`.

---

## How HOME-relative storage works

Claude encodes the absolute path of each project as the local directory name (slashes → dashes). This plugin stores the **suffix** after your `$HOME` prefix:

| | Path |
|---|---|
| Machine A local | `~/.claude/projects/-Users-alice-base-foo/memory/...` |
| Stored in repo | `data/home-projects/base-foo/memory/...` |
| Machine B local | `~/.claude/projects/-Users-bob-base-foo/memory/...` |

Projects outside `$HOME` (rare) live under `data/absolute-projects/` and only restore on machines with the same absolute path.

---

## Privacy

- **This plugin repo is public** and contains no user data.
- **Your backup repo is yours.** Use a private repo — memory often contains project names, hostnames, identifiers.
- The plugin only ever reads/writes `~/.claude/projects/*/memory/` and your backup repo.

---

## License

MIT.

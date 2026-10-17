# claude-memory-sync

<img src="docs/assets/icon.svg" alt="" width="72" align="right">

A [Claude Code](https://claude.com/claude-code) plugin that backs up and restores per-project memory to a Git repo of your choice.

[![Release](https://img.shields.io/github/v/release/gagoar/claude-memory-sync?color=c3a6ff)](https://github.com/gagoar/claude-memory-sync/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-7cf0c9)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-c3a6ff)](https://gagoar.github.io/claude-memory-sync/)
[![Stars](https://img.shields.io/github/stars/gagoar/claude-memory-sync?style=flat&color=ff6b9d)](https://github.com/gagoar/claude-memory-sync/stargazers)

Storage is **HOME-relative** — memory captured on `/Users/alice/...` restores cleanly on `/Users/bob/...` with no manual renaming.

**Webpage:** [gagoar.github.io/claude-memory-sync](https://gagoar.github.io/claude-memory-sync)

---

## Install

Via the [gago-plugins](https://gagoar.github.io/gago-plugins) marketplace:
```
/plugin marketplace add gagoar/gago-plugins
/plugin install memory-sync@gago-plugins
/reload-plugins
```
Or standalone:
```
/plugin marketplace add gagoar/claude-memory-sync
/plugin install memory-sync@memory-sync
/reload-plugins
```
Then set up your backup repo:
```
/memory-sync:sync init
```

The skill will **ask you where to put your backup repo** (and offer to create a private one on GitHub for you, if you don't have one). It then configures everything. That's it — no other typing required.

> You can also just say *"set up memory backup"* or *"back up my memory"* and Claude will route to the same setup flow. Init runs automatically the first time you invoke any memory-sync command without a configured backup.

---

## Daily use

| You type | What happens |
|---|---|
| `/memory-sync:sync push` | Back up new/changed memory + global config to your repo |
| `/memory-sync:sync pull` | Restore from your repo |
| `/memory-sync:sync status` | See what's drifted |
| `/memory-sync:sync list` | Show projects and global files that are backed up |
| `/memory-sync:sync select` | Pick which projects to include (interactive checkboxes) |
| `/memory-sync:sync history` | Show recent backup commits — *what* was backed up *when* |
| `/memory-sync:sync configure --backup-repo=NEW` | Switch backup destination |

`push` no-ops when nothing has changed. `pull` refuses to overwrite local changes that aren't in the backup unless `--force` is passed.

### What's backed up

- **Per-project memory** — `~/.claude/projects/*/memory/` (stored portably; works across usernames)
- **Global config** — `~/.claude/CLAUDE.md`, `~/.claude/RTK.md`, `~/.claude/skills/`, `~/.claude/keybindings.json`

Nothing else under `~/.claude/` is touched — never `settings.json`, sessions, cache, plugins, or anything else.

---

## Updating the plugin

When the plugin gains new features:

```
/plugin update memory-sync@memory-sync
/reload-plugins
```

Or just refresh the marketplace + reinstall:

```
/plugin marketplace update memory-sync
/plugin update memory-sync@memory-sync
/reload-plugins
```

Your `~/.claude/memory-sync.config.json` is preserved (the plugin manager only touches its own cache directory). Re-run `/memory-sync:sync init` only if a release adds a new config field that needs your input.

## On a new computer

Same flow, with one change at setup:

```
/plugin marketplace add gagoar/gago-plugins
/plugin install memory-sync@gago-plugins
/reload-plugins
/memory-sync:sync init       # pick "Clone an existing remote", give your backup-repo URL
/memory-sync:sync pull       # restore every memory file
```

Or standalone:

```
/plugin marketplace add gagoar/claude-memory-sync
/plugin install memory-sync@memory-sync
/reload-plugins
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

## Terms

The plugin is provided under the MIT license (see [LICENSE](./LICENSE)), as is, without warranty. It copies files between `~/.claude/projects/*/memory/` and a Git repo you choose, and you are responsible for that repo's visibility and contents. For help or to report a problem, open an issue at [github.com/gagoar/claude-memory-sync/issues](https://github.com/gagoar/claude-memory-sync/issues).

---

## License

MIT.

## Automated gate

CI runs `scripts/check-plugin-safety.ts` and `claude plugin validate --strict` on every PR. Run both before you push:

```
node scripts/check-plugin-safety.ts .
claude plugin validate . --strict
```

The gate fails on three things the plugin-directory upload scanner holds for review:

- A skill, agent, or command that pre-approves `Write`, `Edit`, or `Bash` with no path scope. Write `Write(./src/**)`, not `Write`.
- Shipped code that copies the whole environment (`...process.env`, `Object.keys(process.env)`). Read the named variables you need.
- A committed native executable. The scanner cannot read it.

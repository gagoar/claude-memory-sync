# claude-memory-sync

<img src="docs/assets/icon.svg" alt="" width="72" align="right">

**Claude remembers your projects. memory-sync makes sure it remembers them on every computer.**

[![Release](https://img.shields.io/github/v/release/gagoar/claude-memory-sync?color=c3a6ff)](https://github.com/gagoar/claude-memory-sync/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-7cf0c9)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-c3a6ff)](https://gagoar.github.io/claude-memory-sync/)
[![Stars](https://img.shields.io/github/stars/gagoar/claude-memory-sync?style=flat&color=ff6b9d)](https://github.com/gagoar/claude-memory-sync/stargazers)

[Claude Code](https://claude.com/claude-code) keeps notes about each project in `~/.claude/projects/*/memory/`: what you prefer, what it learned, what to avoid next time. Those notes live on one laptop. Buy a new one, and Claude starts from zero.

memory-sync copies the notes to a **private Git repo that you own**, and brings them back on any other machine. It works even when your username differs, because it stores paths relative to `$HOME`.

```
   machine A                  your private repo                  machine B
 ┌─────────────┐  push   ┌────────────────────────┐   pull   ┌─────────────┐
 │   memory    │ ──────▶ │  one commit per backup │ ───────▶ │   memory    │
 │ /Users/alice│         │  data/home-projects/…  │          │  /Users/bob │
 └─────────────┘         └────────────────────────┘          └─────────────┘
```

**Webpage:** [gagoar.github.io/claude-memory-sync](https://gagoar.github.io/claude-memory-sync)

## Why

- **A new computer feels familiar.** Run `pull`, and every project's notes come back where Claude looks for them.
- **Your usernames can differ.** Notes saved from `/Users/alice/...` land correctly on `/Users/bob/...`, with no renaming.
- **Every backup is a commit.** `history` shows what changed and when, and Git lets you roll back.
- **It is your repo.** Nothing goes anywhere except the repo you pick. Keep it private.
- **It is gentle.** `push` does nothing when nothing changed. `pull` will not overwrite local work unless you add `--force`.

## 60-second tour

```
/memory-sync:sync init      # Claude asks where your backup repo lives, and can create a private one for you
/memory-sync:sync push      # back up every project
/memory-sync:sync status    # see what has drifted
/memory-sync:sync pull      # on the other machine: bring it all back
```

You can also just say *"back up my memory"* or *"set up memory backup"*. Claude routes to the same flow, and `init` runs by itself the first time you use any command without a backup repo configured.

## Install

Via the [gago-plugins](https://gagoar.github.io/gago-plugins) marketplace:

```
/plugin marketplace add gagoar/gago-plugins
/plugin install memory-sync@gago-plugins
/reload-plugins
/memory-sync:sync init
```

<details>
<summary>Prefer to install it on its own?</summary>

```
/plugin marketplace add gagoar/claude-memory-sync
/plugin install memory-sync@memory-sync
/reload-plugins
/memory-sync:sync init
```

</details>

The skill asks where to put your backup repo. It offers to create a private one on GitHub with `gh`, to use a clone you already have, or to clone one from a URL. Your choice is saved in `~/.claude/memory-sync.config.json`.

## Commands

| You type | What happens |
|---|---|
| `/memory-sync:sync init` | First-time setup: pick or create your backup repo |
| `/memory-sync:sync push` | Back up new and changed memory, plus your global config |
| `/memory-sync:sync pull` | Restore from your repo (`--force` overwrites local-only files) |
| `/memory-sync:sync status` | See what has drifted between this machine and the repo |
| `/memory-sync:sync list` | Show the projects and global files that are backed up |
| `/memory-sync:sync select` | Pick which projects to include, with interactive checkboxes |
| `/memory-sync:sync history` | Show recent backup commits: what was backed up, and when (`--limit`, `--since`, `--paths`) |
| `/memory-sync:sync configure --backup-repo=NEW` | Switch to a different backup repo (also `--include`, `--exclude`, `--reset-projects`) |
| `/memory-sync:sync doctor` | Read-only check of your setup. It prints a summary and a block you can paste into a Claude Code session |
| `/memory-sync:sync migrate` | One-time move from an older, non-portable layout |

### What gets backed up

- **Per-project memory:** `~/.claude/projects/*/memory/`, stored portably.
- **Global config:** `~/.claude/CLAUDE.md`, `~/.claude/RTK.md`, `~/.claude/skills/` and `~/.claude/keybindings.json`.

Nothing else under `~/.claude/` is touched. Never `settings.json`, sessions, cache or plugins.

## On a new computer

```
/plugin marketplace add gagoar/gago-plugins
/plugin install memory-sync@gago-plugins
/reload-plugins
/memory-sync:sync init       # choose "Clone an existing remote" and paste your backup-repo URL
/memory-sync:sync pull       # restore every memory file
```

Memory lands in `~/.claude/projects/<project>/memory/`, with the project keys rewritten for this machine's `$HOME`.

## How HOME-relative storage works

Claude names each project's folder after its absolute path (slashes become dashes). memory-sync stores the part after your `$HOME`:

| | Path |
|---|---|
| Machine A, local | `~/.claude/projects/-Users-alice-base-foo/memory/...` |
| Stored in the repo | `data/home-projects/base-foo/memory/...` |
| Machine B, local | `~/.claude/projects/-Users-bob-base-foo/memory/...` |

Projects outside `$HOME` are rare. They live under `data/absolute-projects/` and only restore on machines with the same absolute path.

## FAQ

**Is my memory public?** No. This plugin's repo is public and holds no user data. Your backup repo is yours: make it private, because memory often holds project names, hostnames and identifiers.

**Can it overwrite my notes by accident?** `pull` refuses to overwrite local changes that are not in the backup, unless you pass `--force`. `push` creates a commit only when something changed, so you can always look back with `history`.

**Which projects get backed up?** All of them, by default. Run `select` to pick, or use `configure --include` and `--exclude` with project names or patterns such as `base-*`.

**Something looks wrong. What now?** Run `/memory-sync:sync doctor`. It checks the config, the state of your backup repo and the path mapping, changes nothing, and prints a block you can paste into a Claude Code session for help.

**How do I update the plugin?** `/plugin update memory-sync@gago-plugins`, then `/reload-plugins`. Your `~/.claude/memory-sync.config.json` stays as it is. Run `init` again only if a release asks for a new setting.

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

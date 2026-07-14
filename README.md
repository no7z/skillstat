# skillstat

**English** | [中文](README.zh-CN.md)

**Audit skills across Claude Code, Codex, and Cursor.** You've installed dozens
of agent skills. Which ones actually fire, in which agent, and which are just
sitting on disk? `skillstat` reads local transcript evidence and tells you.

- 🔍 **Cross-agent evidence** — one view for Claude Code, Codex, and Cursor,
  including per-agent counts, last use, projects, and trigger source.
- 💸 **Claude context cost** — estimates how many tokens Claude's skill listing
  injects per session and how much is spent on skills you never use.
- ✂️ **Reversible slimming** — moves idle skills into `skills-disabled/` so you can
  restore any of them with a single `mv`.
- 🔒 **Local & AI-free** — pure deterministic parsing. Nothing leaves your machine,
  no model calls, no tokens burned to run it.

```
$ skillstat cost
skillstat cost  (skill_listing context overhead, estimated)

METRIC                          VALUE
Skills offered per session        121
Installed skills (disk)           128
Idle offered skills (>30d)        116
Skill-listing tokens / session  ~3.9k
  ↳ wasted on idle skills       ~3.7k
Sessions analyzed                  38

116 of 121 offered skills have been idle ≥30d, costing ~3.7k tokens per session.
```

## Install

```bash
npm install -g skillstat
# or run without installing:
npx skillstat
```

Requires Node ≥ 18. No other dependencies.

### Use it as an agent skill

skillstat ships a `SKILL.md`, so your coding agent can run it for you — just ask
*"which of my skills do I actually use?"* or *"what's filling my context?"* and
it'll pick the right sub-command.

```bash
# Claude Code / Codex / Cursor (Agent Skills compatible):
npx skills add no7z/skillstat
```

Or drop it in manually — copy this repo's `SKILL.md` into
`~/.claude/skills/skillstat/SKILL.md` (Claude Code) or `~/.codex/skills/…`
(Codex). Then invoke it explicitly with `/skillstat`, or let it auto-activate
from the description. The skill just shells out to the `skillstat` CLI, so keep
the CLI installed (or it falls back to `npx`).

## Usage

```bash
skillstat                    # scan: per-skill trigger counts (default)
skillstat scan --all         # include offered-but-never-triggered skills
skillstat scan --agent codex # one source; comma-separated combinations work
skillstat cost               # how much context are idle skills costing?
skillstat report -o r.html   # self-contained HTML report (offline, shareable)
skillstat slim --days 60     # archive skills idle 60+ days (asks first)
skillstat slim --restore     # undo: move archived skills back
```

### Commands

| Command  | What it does |
|----------|--------------|
| `scan`   | Table of every skill: fires, agent, evidence type, last-fired, projects. |
| `cost`   | Claude-only `skill_listing` token overhead per session and the share wasted on idle skills. |
| `report` | Writes a self-contained dark-themed HTML dashboard (double-click, no server). |
| `slim`   | Moves idle **user** skills (never plugins) to `~/.claude/skills-disabled/`. Reversible (`--restore`), confirms first. |

### Options

| Flag | Meaning |
|------|---------|
| `-d, --days <n>` | Idle threshold for "zombie" skills (default 30). |
| `--agent <list>` | `claude`, `codex`, `cursor`, or a comma-separated combination (default all). `--source` is an alias. |
| `-a, --all` | `scan`: also list offered skills that never triggered. |
| `-o, --out <f>` | `report`: output path (default `skillstat-report.html`). |
| `-y, --yes` | `slim`: skip the confirmation prompt. |
| `--restore` | `slim`: move everything in `skills-disabled/` back into `skills/`. |
| `--json` | Machine-readable output for `scan` and `cost`. |

## How it works

The agents expose different evidence, so skillstat reports only what each local
format can prove:

| Agent | Transcript evidence | Installed-skill roots |
|-------|---------------------|------------------------|
| Claude Code | `Skill` tool calls (**explicit**) and `invoked_skills` (**auto**) | `~/.claude/skills`, `~/.claude/plugins` |
| Codex | explicit `/skill` user messages and tool calls that read a skill's `SKILL.md` (**observed**) | `~/.codex/skills`, `~/.agents/skills`, Codex plugin cache |
| Cursor | explicit `/skill` user messages | `~/.cursor/skills` |

Cursor transcript events do not currently contain timestamps, so skillstat uses
the transcript file's modification time for `last-fired`. Cursor auto-activation
and Codex offered-list/context cost are not claimed because those signals are not
present in their local transcript formats.

For context cost it reads the `skill_listing` attachment injected into each
session and estimates its token size (heuristic, no tokenizer — kept dependency-free
and offline). `cost` is therefore Claude-only, even in an all-agent scan.

Set `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or `CURSOR_CONFIG_DIR` to point at a
non-default config location.

### Caveats

- Token figures are **estimates** (chars/words heuristic), meant for relative
  comparison, not billing.
- Transcript formats are internal implementation details and may change.
  skillstat degrades gracefully (skips lines it can't parse) rather than crashing.
- `slim` only ever touches skills under `~/.claude/skills/` — plugin-provided
  skills and Codex/Cursor installs are read-only and never moved.

## License

MIT

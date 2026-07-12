# skillstat

**Audit your Claude Code skills.** You've installed dozens of agent skills. Which
ones actually fire? Which are dead weight, silently injected into every session's
context and eating tokens for nothing? `skillstat` reads your local Claude Code
transcripts and tells you — then helps you slim down.

- 🔍 **Real usage, not guesses** — parses `~/.claude` session transcripts to count
  which skills actually triggered, how often, when last, and in which projects.
- 💸 **Context cost** — estimates how many tokens the skill listing injects per
  session, and how much of that is spent on skills you never use.
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

## Usage

```bash
skillstat                    # scan: per-skill trigger counts (default)
skillstat scan --all         # include offered-but-never-triggered skills
skillstat cost               # how much context are idle skills costing?
skillstat report -o r.html   # self-contained HTML report (offline, shareable)
skillstat slim --days 60     # archive skills idle 60+ days (asks first)
skillstat slim --restore     # undo: move archived skills back
```

### Commands

| Command  | What it does |
|----------|--------------|
| `scan`   | Table of every skill: fires, explicit-vs-auto activations, last-fired, projects. |
| `cost`   | Estimated `skill_listing` token overhead per session and the share wasted on idle skills. |
| `report` | Writes a self-contained dark-themed HTML dashboard (double-click, no server). |
| `slim`   | Moves idle **user** skills (never plugins) to `~/.claude/skills-disabled/`. Reversible (`--restore`), confirms first. |

### Options

| Flag | Meaning |
|------|---------|
| `-d, --days <n>` | Idle threshold for "zombie" skills (default 30). |
| `-a, --all` | `scan`: also list offered skills that never triggered. |
| `-o, --out <f>` | `report`: output path (default `skillstat-report.html`). |
| `-y, --yes` | `slim`: skip the confirmation prompt. |
| `--restore` | `slim`: move everything in `skills-disabled/` back into `skills/`. |
| `--json` | Machine-readable output for `scan` and `cost`. |

## How it works

Every Claude Code session is recorded as a JSONL transcript under
`~/.claude/projects/`. skillstat walks those files and counts two trigger signals:

- **explicit** — a `Skill` tool call (you typed `/skill-name` or the agent invoked it), and
- **auto** — an `invoked_skills` attachment (a skill auto-activated from description matching).

For context cost it reads the `skill_listing` attachment injected into each
session and estimates its token size (heuristic, no tokenizer — kept dependency-free
and offline). Installed skills are discovered from `~/.claude/skills/` and
`~/.claude/plugins/`.

Set `CLAUDE_CONFIG_DIR` to point at a non-default config location.

### Caveats

- Token figures are **estimates** (chars/words heuristic), meant for relative
  comparison, not billing.
- The transcript format is an internal Claude Code detail, not a public API; a
  future version could change field names. skillstat degrades gracefully (skips
  lines it can't parse) rather than crashing.
- `slim` only ever touches skills under `~/.claude/skills/` — plugin-provided
  skills are read-only and never moved.

## License

MIT

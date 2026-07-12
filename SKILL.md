---
name: skillstat
description: Audit which installed Claude Code / agent skills actually fire versus sit unused eating context tokens, and slim the unused ones down. Use when the user asks which skills they actually use, whether they have too many skills installed, what is bloating or filling their context window, why the skill list is so long, or wants to find, disable, archive, clean up, or slim down unused / dead / zombie skills. Runs the local skillstat CLI (offline, AI-free).
license: MIT
allowed-tools:
  - Bash
---

# skillstat — audit your installed skills

`skillstat` is a local, zero-dependency CLI that parses `~/.claude` transcripts
to report which installed skills actually trigger, which are dead weight eating
context tokens, and lets the user slim them down. Everything runs locally; no
data leaves the machine and no model tokens are spent.

## How to run it

Prefer a globally installed binary; fall back to `npx`:

```bash
skillstat <command>        # if installed: npm i -g skillstat
npx -y skillstat <command> # otherwise
```

## Choosing the command

Pick the sub-command from what the user is asking:

| User intent | Command |
|---|---|
| "Which skills do I actually use?" / usage breakdown | `skillstat scan` |
| "Show every skill, even unused ones" | `skillstat scan --all` |
| "What's filling my context?" / "are my skills expensive?" | `skillstat cost` |
| "Give me a report I can look at / share" | `skillstat report -o skillstat-report.html` |
| "Clean up / disable / archive unused skills" | `skillstat slim` (see safety note) |
| "Undo that / bring my skills back" | `skillstat slim --restore` |

Useful flags: `--days <n>` sets the idle threshold (default 30); `--json` gives
machine-readable output for `scan` and `cost`; `--all` includes never-triggered
skills in `scan`.

## Workflow

1. Run `skillstat scan` (or `cost`) and summarize the result for the user:
   how many skills are installed, how many are actually active, and — for
   `cost` — the estimated per-session token overhead and how much is wasted on
   idle skills. Note that token figures are heuristic estimates.
2. If they want to act on it, run `skillstat cost` to quantify the savings
   before suggesting `slim`.

## Safety note for `slim`

`skillstat slim` moves idle **user** skills (never plugin skills) into
`~/.claude/skills-disabled/`. It is reversible via `skillstat slim --restore`.

- Do **not** pass `-y`/`--yes` on the user's behalf without explicit confirmation
  — let the user see the list and confirm the move.
- Always tell the user the move is reversible and how to undo it
  (`skillstat slim --restore`).

---
name: skillstat
description: Audit which installed Claude Code, Codex, and Cursor skills actually fire, compare usage across agents, estimate Claude context cost, and safely slim unused Claude user skills. Use when the user asks which skills they use, which agent used them, whether they have too many skills, or what is bloating context. Runs the local skillstat CLI offline.
license: MIT
allowed-tools:
  - Bash
---

# skillstat — audit your installed skills

`skillstat` is a local, zero-dependency CLI that parses Claude Code, Codex, and
Cursor transcripts to report which installed skills actually trigger. Claude
provides explicit/auto evidence, Codex provides explicit/observed evidence, and
Cursor provides explicit evidence only. Everything runs locally.

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
| "Which Codex skills did I use?" | `skillstat scan --agent codex` |
| "Compare Claude and Cursor" | `skillstat scan --agent claude,cursor` |
| "Show every skill, even unused ones" | `skillstat scan --all` |
| "What's filling my context?" / "are my skills expensive?" | `skillstat cost` |
| "Give me a report I can look at / share" | `skillstat report -o skillstat-report.html` |
| "Clean up / disable / archive unused skills" | `skillstat slim` (see safety note) |
| "Undo that / bring my skills back" | `skillstat slim --restore` |

Useful flags: `--days <n>` sets the idle threshold (default 30); `--json` gives
machine-readable output for `scan` and `cost`; `--all` includes never-triggered
skills in `scan`; `--agent claude,codex,cursor` selects sources.

## Workflow

1. Run `skillstat scan` (or `cost`) and summarize the result for the user:
   how many skills are installed, how many are actually active, and — for
   `cost` — the estimated per-session token overhead and how much is wasted on
   idle skills. Note that context cost is Claude-only, Cursor uses transcript
   file mtime, and unsupported auto-trigger signals are intentionally omitted.
2. If they want to act on it, run `skillstat cost` to quantify the savings
   before suggesting `slim`.

## Safety note for `slim`

`skillstat slim` moves idle **user** skills (never plugin skills) into
`~/.claude/skills-disabled/`. It is reversible via `skillstat slim --restore`.

- Do **not** pass `-y`/`--yes` on the user's behalf without explicit confirmation
  — let the user see the list and confirm the move.
- Always tell the user the move is reversible and how to undo it
  (`skillstat slim --restore`).

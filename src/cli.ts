#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { analyze, daysAgo, isZombie, Analysis } from "./stats.js";
import { c, table, relTime } from "./term.js";
import { fmtTokens } from "./tokens.js";
import { renderHtml } from "./report.js";
import { userSkillsDir, exists } from "./paths.js";

const require = createRequire(import.meta.url);
// Single source of truth for the version — read from package.json so the CLI
// string can never drift from what npm publishes.
const VERSION: string = (() => {
  try {
    return require("../package.json").version as string;
  } catch {
    return "0.0.0";
  }
})();

interface Flags {
  days: number;
  json: boolean;
  all: boolean;
  out?: string;
  yes: boolean;
  restore: boolean;
  _: string[];
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { days: 30, json: false, all: false, yes: false, restore: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days" || a === "-d") f.days = parseInt(argv[++i], 10) || 30;
    else if (a === "--json") f.json = true;
    else if (a === "--all" || a === "-a") f.all = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--restore") f.restore = true;
    else if (a === "--out" || a === "-o") f.out = argv[++i];
    else f._.push(a);
  }
  return f;
}

function cmdScan(a: Analysis, f: Flags): void {
  if (f.json) {
    console.log(JSON.stringify(a.skills, null, 2));
    return;
  }
  const shown = f.all ? a.skills : a.skills.filter((s) => s.installed || s.triggers > 0);
  const rows = shown.map((s) => {
    const d = daysAgo(s.lastTriggered, a.now);
    const name = s.triggers > 0 ? s.name : c.dim(s.name);
    return [
      name,
      s.triggers > 0 ? c.bold(String(s.triggers)) : c.red("0"),
      c.dim(`${s.explicit}/${s.auto}`),
      relTime(d),
      c.gray(s.source),
      c.gray(s.projects.slice(0, 3).join(",")),
    ];
  });
  console.log(
    table(
      [
        { header: "SKILL" },
        { header: "FIRES", align: "right" },
        { header: "EXP/AUTO", align: "right" },
        { header: "LAST", align: "right" },
        { header: "SRC" },
        { header: "PROJECTS" },
      ],
      rows,
    ),
  );
  const active = a.skills.filter((s) => s.triggers > 0).length;
  console.log(
    "\n" +
      c.dim(
        `${a.sessionCount} sessions · ${active} active · ${a.installed.length} installed · ${a.totalTriggers} total fires` +
          (f.all ? "" : c.dim("  (use --all to include untriggered offered skills)")),
      ),
  );
}

function cmdCost(a: Analysis, f: Flags): void {
  const now = a.now;
  const installed = a.installed.length;
  const zombiesInstalled = a.installed.filter((s) => {
    const st = a.skills.find((x) => x.name === s.name);
    return !st || isZombie(st, now, f.days);
  });
  const perSession = a.avgListingTokens;
  // The listing tax is only paid for skills actually IN the listing, so the
  // waste fraction must be computed over offered names — never over on-disk
  // installs (which can exceed the offered set and push the share past 1).
  const offeredZombies = [...a.offeredNames].filter((name) => {
    const st = a.skills.find((x) => x.name === name);
    return !st || isZombie(st, now, f.days);
  });
  const offeredCount = a.offeredNames.size || 1;
  const zombieShare = Math.min(1, offeredZombies.length / offeredCount);
  const wastedPerSession = Math.round(perSession * zombieShare);

  if (f.json) {
    console.log(
      JSON.stringify(
        {
          installed,
          offered: a.offeredNames.size,
          zombieInstalled: zombiesInstalled.length,
          avgListingTokensPerSession: perSession,
          estWastedTokensPerSession: wastedPerSession,
          sessionsAnalyzed: a.sessionsWithListing,
          zombieDays: f.days,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(c.bold("skillstat cost") + c.dim(`  (skill_listing context overhead, estimated)`));
  console.log();
  const rows: string[][] = [
    ["Skills offered per session", c.bold(String(a.offeredNames.size))],
    ["Installed skills (disk)", String(installed)],
    [`Idle offered skills (>${f.days}d)`, c.red(String(offeredZombies.length))],
    ["Skill-listing tokens / session", c.yellow("~" + fmtTokens(perSession))],
    ["  ↳ wasted on idle skills", c.red("~" + fmtTokens(wastedPerSession))],
    ["Sessions analyzed", c.dim(String(a.sessionsWithListing))],
  ];
  console.log(table([{ header: "METRIC" }, { header: "VALUE", align: "right" }], rows));
  console.log();
  console.log(
    c.dim(
      "Every offered skill's description is injected into every session's context. " +
        `${offeredZombies.length} of ${a.offeredNames.size} offered skills have been idle ≥${f.days}d, ` +
        `costing ~${fmtTokens(wastedPerSession)} tokens per session. Token counts are heuristic estimates.`,
    ),
  );
  if (zombiesInstalled.length) {
    console.log(c.dim("\nRun ") + c.cyan(`skillstat slim --days ${f.days}`) + c.dim(" to move idle skills aside."));
  }
}

function cmdReport(a: Analysis, f: Flags): void {
  const out = f.out || "skillstat-report.html";
  const html = renderHtml(a, f.days);
  fs.writeFileSync(out, html, "utf8");
  console.log(c.green("✓") + ` wrote ${c.bold(out)} ` + c.dim(`(${a.skills.length} skills, ${a.sessionCount} sessions)`));
  console.log(c.dim("  open it: ") + c.cyan(`open ${out}`));
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + " ", (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

function disabledRootPath(): string {
  return path.join(userSkillsDir(), "..", "skills-disabled");
}

async function cmdRestore(f: Flags): Promise<void> {
  const disabledRoot = disabledRootPath();
  const skillsRoot = userSkillsDir();
  if (!exists(disabledRoot)) {
    console.log(c.green("✓") + ` nothing to restore — ${disabledRoot} doesn't exist.`);
    return;
  }
  const names = fs
    .readdirSync(disabledRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (!names.length) {
    console.log(c.green("✓") + ` nothing to restore — ${disabledRoot} is empty.`);
    return;
  }

  console.log(
    c.bold(`${names.length} disabled skill(s):`) + c.dim(`  → will move back to ${skillsRoot}`),
  );
  for (const n of names) console.log("  " + c.yellow(n));
  console.log();

  if (!f.yes) {
    const ok = await confirm(c.bold(`Restore these ${names.length} skills?`) + " [y/N]");
    if (!ok) {
      console.log(c.dim("aborted — nothing moved."));
      return;
    }
  }

  fs.mkdirSync(skillsRoot, { recursive: true });
  let moved = 0;
  for (const n of names) {
    const dest = path.join(skillsRoot, n);
    try {
      if (exists(dest)) {
        console.log(c.dim(`  skip ${n} (already present in skills/)`));
        continue;
      }
      fs.renameSync(path.join(disabledRoot, n), dest);
      moved++;
    } catch (e) {
      console.log(c.red(`  failed ${n}: ${(e as Error).message}`));
    }
  }
  console.log(c.green(`✓ restored ${moved} skill(s)`) + c.dim(` to ${skillsRoot}`));
  // Clean up the disabled dir if it's now empty.
  try {
    if (fs.readdirSync(disabledRoot).length === 0) fs.rmdirSync(disabledRoot);
  } catch {
    /* ignore */
  }
}

async function cmdSlim(a: Analysis, f: Flags): Promise<void> {
  if (f.restore) return cmdRestore(f);
  const now = a.now;
  // Only slim USER skills we can safely move; never touch plugin caches.
  const candidates = a.installed.filter((s) => {
    if (s.source !== "user") return false;
    const st = a.skills.find((x) => x.name === s.name);
    return !st || isZombie(st, now, f.days);
  });

  if (!candidates.length) {
    console.log(c.green("✓") + ` no user skills idle for ≥${f.days}d — nothing to slim.`);
    return;
  }

  const disabledRoot = disabledRootPath();
  console.log(
    c.bold(`${candidates.length} user skill(s) idle for ≥${f.days}d:`) +
      c.dim(`  → will move to ${disabledRoot}`),
  );
  for (const s of candidates) {
    const st = a.skills.find((x) => x.name === s.name);
    const d = st ? daysAgo(st.lastTriggered, now) : null;
    console.log("  " + c.yellow(s.name) + c.dim(`  (${relTime(d)})`));
  }
  console.log();

  if (!f.yes) {
    const ok = await confirm(c.bold(`Move these ${candidates.length} skills aside? This is reversible.`) + " [y/N]");
    if (!ok) {
      console.log(c.dim("aborted — nothing moved."));
      return;
    }
  }

  fs.mkdirSync(disabledRoot, { recursive: true });
  let moved = 0;
  for (const s of candidates) {
    const dest = path.join(disabledRoot, path.basename(s.dir));
    try {
      if (exists(dest)) {
        console.log(c.dim(`  skip ${s.name} (already in disabled dir)`));
        continue;
      }
      fs.renameSync(s.dir, dest);
      moved++;
    } catch (e) {
      console.log(c.red(`  failed ${s.name}: ${(e as Error).message}`));
    }
  }
  console.log(c.green(`✓ moved ${moved} skill(s)`) + c.dim(` to ${disabledRoot}`));
  console.log(c.dim(`  restore them all with: `) + c.cyan(`skillstat slim --restore`));
}

function help(): void {
  console.log(`${c.bold("skillstat")} v${VERSION} — audit your Claude Code skills

${c.bold("USAGE")}
  skillstat <command> [options]

${c.bold("COMMANDS")}
  scan            Per-skill trigger counts, last-fired, active vs zombie   ${c.dim("(default)")}
  cost            Estimate skill_listing context tokens & zombie waste
  report          Write a self-contained HTML report (offline)
  slim            Move idle user skills to skills-disabled/ (reversible)
                  slim --restore moves them all back

${c.bold("OPTIONS")}
  -d, --days <n>  Idle threshold for "zombie" (default 30)
  -a, --all       scan: include offered-but-never-triggered skills
  -o, --out <f>   report: output path (default skillstat-report.html)
  -y, --yes       slim: skip the confirmation prompt
      --restore   slim: move skills-disabled/* back into skills/
      --json      Machine-readable output (scan, cost)

${c.bold("EXAMPLES")}
  skillstat                     ${c.dim("# scan")}
  skillstat cost                ${c.dim("# how much context are dead skills costing?")}
  skillstat report -o r.html    ${c.dim("# shareable HTML")}
  skillstat slim --days 60      ${c.dim("# archive skills idle 60+ days")}
  skillstat slim --restore      ${c.dim("# undo: bring archived skills back")}

Reads ~/.claude transcripts & skills locally. Nothing leaves your machine.`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const f = parseFlags(argv);
  const cmd = f._[0] || "scan";

  if (cmd === "help" || cmd === "--help" || cmd === "-h") return help();
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }

  // Restore reads only skills-disabled/ — it must work even when transcripts
  // and the skills dir are empty (which is exactly the post-slim state).
  if (cmd === "slim" && f.restore) return cmdRestore(f);

  const a = analyze();
  if (a.sessionCount === 0 && a.installed.length === 0) {
    console.log(
      c.yellow("No Claude Code data found.") +
        c.dim(`\nLooked in ~/.claude/projects and ~/.claude/skills. Set CLAUDE_CONFIG_DIR to override.`),
    );
    return;
  }

  switch (cmd) {
    case "scan":
      return cmdScan(a, f);
    case "cost":
      return cmdCost(a, f);
    case "report":
      return cmdReport(a, f);
    case "slim":
      return cmdSlim(a, f);
    default:
      console.log(c.red(`unknown command: ${cmd}`));
      help();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(c.red("skillstat error: ") + (e as Error).message);
  process.exitCode = 1;
});

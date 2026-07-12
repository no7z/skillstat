#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { analyze, daysAgo, Analysis } from "./stats.js";
import { c, table, relTime } from "./term.js";
import { fmtTokens } from "./tokens.js";
import { renderHtml } from "./report.js";
import { userSkillsDir, exists } from "./paths.js";

const VERSION = "0.1.0";

interface Flags {
  days: number;
  json: boolean;
  all: boolean;
  out?: string;
  yes: boolean;
  _: string[];
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { days: 30, json: false, all: false, yes: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days" || a === "-d") f.days = parseInt(argv[++i], 10) || 30;
    else if (a === "--json") f.json = true;
    else if (a === "--all" || a === "-a") f.all = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--out" || a === "-o") f.out = argv[++i];
    else f._.push(a);
  }
  return f;
}

function isZombie(s: Analysis["skills"][number], now: number, days: number): boolean {
  if (s.triggers === 0) return true;
  const d = daysAgo(s.lastTriggered, now);
  return d !== null && d >= days;
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

async function cmdSlim(a: Analysis, f: Flags): Promise<void> {
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

  const disabledRoot = path.join(userSkillsDir(), "..", "skills-disabled");
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
  console.log(c.dim(`  restore any with: `) + c.cyan(`mv "${disabledRoot}/<name>" "${userSkillsDir()}/"`));
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

${c.bold("OPTIONS")}
  -d, --days <n>  Idle threshold for "zombie" (default 30)
  -a, --all       scan: include offered-but-never-triggered skills
  -o, --out <f>   report: output path (default skillstat-report.html)
  -y, --yes       slim: skip the confirmation prompt
      --json      Machine-readable output (scan, cost)

${c.bold("EXAMPLES")}
  skillstat                     ${c.dim("# scan")}
  skillstat cost                ${c.dim("# how much context are dead skills costing?")}
  skillstat report -o r.html    ${c.dim("# shareable HTML")}
  skillstat slim --days 60      ${c.dim("# archive skills idle 60+ days")}

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

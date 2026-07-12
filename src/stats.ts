import { parseAll, ParseResult } from "./transcripts.js";
import { discoverInstalled, InstalledSkill } from "./installed.js";

export interface SkillStat {
  name: string;
  triggers: number;
  explicit: number;
  auto: number;
  lastTriggered: number; // epoch ms, 0 if never
  projects: string[];
  installed: boolean;
  description: string;
  source: InstalledSkill["source"] | "unknown";
  origin: string;
}

export interface Analysis {
  skills: SkillStat[];
  sessionCount: number;
  /** Sessions that injected a skill_listing (i.e. skills were available). */
  sessionsWithListing: number;
  avgListingTokens: number;
  totalTriggers: number;
  parseErrors: number;
  offeredNames: Set<string>;
  raw: ParseResult;
  installed: InstalledSkill[];
  now: number;
}

export function analyze(now = Date.now()): Analysis {
  const raw = parseAll();
  const installed = discoverInstalled();
  const installedByName = new Map(installed.map((s) => [s.name, s]));

  const stat = new Map<string, SkillStat>();
  const ensure = (name: string): SkillStat => {
    let s = stat.get(name);
    if (!s) {
      const inst = installedByName.get(name);
      s = {
        name,
        triggers: 0,
        explicit: 0,
        auto: 0,
        lastTriggered: 0,
        projects: [],
        installed: !!inst,
        description: inst?.description ?? "",
        source: inst?.source ?? "unknown",
        origin: inst?.origin ?? "",
      };
      stat.set(name, s);
    }
    return s;
  };

  const projSets = new Map<string, Set<string>>();
  for (const t of raw.triggers) {
    const s = ensure(t.skill);
    s.triggers++;
    if (t.source === "explicit") s.explicit++;
    else s.auto++;
    if (t.timestamp > s.lastTriggered) s.lastTriggered = t.timestamp;
    let ps = projSets.get(t.skill);
    if (!ps) projSets.set(t.skill, (ps = new Set()));
    if (t.project) ps.add(t.project);
  }
  for (const [name, ps] of projSets) ensure(name).projects = [...ps].sort();

  // Union of every skill offered in any session's skill_listing, plus every
  // installed skill — so "never triggered but present" shows up.
  const offeredNames = new Set<string>();
  for (const sess of raw.sessions) for (const n of sess.offered) offeredNames.add(n);
  for (const n of offeredNames) ensure(n);
  for (const s of installed) ensure(s.name);

  const sessionsWithListing = raw.sessions.filter((s) => s.offered.size > 0);
  const avgListingTokens = sessionsWithListing.length
    ? Math.round(
        sessionsWithListing.reduce((a, s) => a + s.listingTokens, 0) /
          sessionsWithListing.length,
      )
    : 0;

  const skills = [...stat.values()].sort(
    (a, b) => b.triggers - a.triggers || a.name.localeCompare(b.name),
  );

  return {
    skills,
    sessionCount: raw.sessions.length,
    sessionsWithListing: sessionsWithListing.length,
    avgListingTokens,
    totalTriggers: raw.triggers.length,
    parseErrors: raw.parseErrors,
    offeredNames,
    raw,
    installed,
    now,
  };
}

export function daysAgo(ts: number, now: number): number | null {
  if (!ts) return null;
  return Math.floor((now - ts) / 86_400_000);
}

/** A skill is a "zombie" if it never fired, or last fired >= `days` ago. */
export function isZombie(s: SkillStat, now: number, days: number): boolean {
  if (s.triggers === 0) return true;
  const d = daysAgo(s.lastTriggered, now);
  return d !== null && d >= days;
}

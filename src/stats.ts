import { AgentName, ALL_AGENTS, agentCounts } from "./agents.js";
import { parseAll, ParseResult } from "./transcripts.js";
import { discoverInstalled, InstalledSkill } from "./installed.js";

export interface SkillStat {
  name: string;
  triggers: number;
  explicit: number;
  auto: number;
  observed: number;
  byAgent: Record<AgentName, number>;
  lastByAgent: Record<AgentName, number>;
  lastTriggered: number;
  projects: string[];
  agents: AgentName[];
  installed: boolean;
  description: string;
  source: InstalledSkill["source"] | "mixed" | "unknown";
  origin: string;
}

export interface Analysis {
  agents: AgentName[];
  skills: SkillStat[];
  sessionCount: number;
  sessionsWithListing: number;
  avgListingTokens: number;
  totalTriggers: number;
  parseErrors: number;
  offeredNames: Set<string>;
  raw: ParseResult;
  installed: InstalledSkill[];
  now: number;
}

export function analyze(agents: readonly AgentName[] = ALL_AGENTS, now = Date.now()): Analysis {
  const selected = [...new Set(agents)];
  const raw = parseAll(selected);
  const installed = discoverInstalled(selected);
  const installedByName = new Map<string, InstalledSkill[]>();
  for (const skill of installed) {
    const list = installedByName.get(skill.name) ?? [];
    list.push(skill);
    installedByName.set(skill.name, list);
  }

  const stats = new Map<string, SkillStat>();
  const ensure = (name: string): SkillStat => {
    let stat = stats.get(name);
    if (!stat) {
      const installs = installedByName.get(name) ?? [];
      const sources = new Set(installs.map((skill) => skill.source));
      stat = {
        name,
        triggers: 0,
        explicit: 0,
        auto: 0,
        observed: 0,
        byAgent: agentCounts(),
        lastByAgent: agentCounts(),
        lastTriggered: 0,
        projects: [],
        agents: [...new Set(installs.map((skill) => skill.agent))],
        installed: installs.length > 0,
        description: installs.find((skill) => skill.description)?.description ?? "",
        source: sources.size > 1 ? "mixed" : installs[0]?.source ?? "unknown",
        origin: [...new Set(installs.map((skill) => skill.origin))].join(","),
      };
      stats.set(name, stat);
    }
    return stat;
  };

  const projects = new Map<string, Set<string>>();
  for (const trigger of raw.triggers) {
    const stat = ensure(trigger.skill);
    stat.triggers++;
    stat[trigger.source]++;
    stat.byAgent[trigger.agent]++;
    if (trigger.timestamp > stat.lastTriggered) stat.lastTriggered = trigger.timestamp;
    if (trigger.timestamp > stat.lastByAgent[trigger.agent]) stat.lastByAgent[trigger.agent] = trigger.timestamp;
    if (!stat.agents.includes(trigger.agent)) stat.agents.push(trigger.agent);
    const set = projects.get(trigger.skill) ?? new Set<string>();
    if (trigger.project) set.add(trigger.project);
    projects.set(trigger.skill, set);
  }
  for (const [name, set] of projects) ensure(name).projects = [...set].sort();

  const offeredNames = new Set<string>();
  for (const session of raw.sessions) for (const name of session.offered) offeredNames.add(name);
  for (const name of offeredNames) ensure(name);
  for (const skill of installed) ensure(skill.name);

  const listedSessions = raw.sessions.filter((session) => session.agent === "claude" && session.offered.size > 0);
  const avgListingTokens = listedSessions.length
    ? Math.round(listedSessions.reduce((sum, session) => sum + session.listingTokens, 0) / listedSessions.length)
    : 0;
  const skills = [...stats.values()].sort((a, b) => b.triggers - a.triggers || a.name.localeCompare(b.name));
  return {
    agents: selected,
    skills,
    sessionCount: raw.sessions.length,
    sessionsWithListing: listedSessions.length,
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

export function isZombie(skill: SkillStat, now: number, days: number): boolean {
  if (skill.triggers === 0) return true;
  const age = daysAgo(skill.lastTriggered, now);
  return age !== null && age >= days;
}

export function isAgentZombie(skill: SkillStat, agent: AgentName, now: number, days: number): boolean {
  if (skill.byAgent[agent] === 0) return true;
  const age = daysAgo(skill.lastByAgent[agent], now);
  return age !== null && age >= days;
}

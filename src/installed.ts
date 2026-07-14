import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentName, ALL_AGENTS } from "./agents.js";
import { claudeHome, codexHome, cursorHome, exists } from "./paths.js";

export interface InstalledSkill {
  name: string;
  description: string;
  dir: string;
  agent: AgentName;
  source: "user" | "plugin" | "system";
  origin: string;
}

function parseFrontmatter(md: string): { name?: string; description?: string } {
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end === -1) return {};
  const lines = md.slice(3, end).split("\n");
  const out: { name?: string; description?: string } = {};
  for (let i = 0; i < lines.length; i++) {
    const match = /^(name|description)\s*:\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const key = match[1] as "name" | "description";
    let value = match[2].trim();
    if ([">", ">-", "|", "|-"].includes(value)) {
      const parts: string[] = [];
      const fold = value.startsWith(">");
      for (let j = i + 1; j < lines.length; j++) {
        if (!/^\s+\S/.test(lines[j])) break;
        parts.push(lines[j].trim());
        i = j;
      }
      value = fold ? parts.join(" ") : parts.join("\n");
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    out[key] = value;
  }
  return out;
}

function readSkillMd(
  dir: string,
  agent: AgentName,
  source: InstalledSkill["source"],
  origin: string,
): InstalledSkill | null {
  const file = path.join(dir, "SKILL.md");
  if (!exists(file)) return null;
  try {
    const frontmatter = parseFrontmatter(fs.readFileSync(file, "utf8"));
    return {
      name: frontmatter.name || path.basename(dir),
      description: frontmatter.description || "",
      dir,
      agent,
      source,
      origin,
    };
  } catch {
    return null;
  }
}

function scanSkills(
  root: string,
  agent: AgentName,
  sourceFor: (dir: string) => InstalledSkill["source"],
  originFor: (dir: string) => string,
): InstalledSkill[] {
  if (!exists(root)) return [];
  const out: InstalledSkill[] = [];
  const stack = [root];
  const seen = new Set<string>();
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md") && !seen.has(dir)) {
      seen.add(dir);
      const skill = readSkillMd(dir, agent, sourceFor(dir), originFor(dir));
      if (skill) out.push(skill);
    }
    for (const entry of entries) if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
  }
  return out;
}

function claudeSkills(): InstalledSkill[] {
  const home = claudeHome();
  return [
    ...scanSkills(path.join(home, "skills"), "claude", () => "user", () => "user"),
    ...scanSkills(
      path.join(home, "plugins"),
      "claude",
      () => "plugin",
      (dir) => path.relative(path.join(home, "plugins"), dir).split(path.sep)[1] || "plugin",
    ),
  ];
}

function codexSkills(): InstalledSkill[] {
  const home = codexHome();
  const shared = path.join(os.homedir(), ".agents", "skills");
  return [
    ...scanSkills(
      path.join(home, "skills"),
      "codex",
      (dir) => path.relative(path.join(home, "skills"), dir).split(path.sep)[0] === ".system" ? "system" : "user",
      () => "codex",
    ),
    ...scanSkills(shared, "codex", () => "user", () => "agents"),
    ...scanSkills(path.join(home, "plugins", "cache"), "codex", () => "plugin", (dir) => {
      const parts = path.relative(path.join(home, "plugins", "cache"), dir).split(path.sep);
      return parts[0] || "plugin";
    }),
  ];
}

function cursorSkills(): InstalledSkill[] {
  return scanSkills(path.join(cursorHome(), "skills"), "cursor", () => "user", () => "cursor");
}

export function discoverInstalled(agents: readonly AgentName[] = ALL_AGENTS): InstalledSkill[] {
  const all = [
    ...(agents.includes("claude") ? claudeSkills() : []),
    ...(agents.includes("codex") ? codexSkills() : []),
    ...(agents.includes("cursor") ? cursorSkills() : []),
  ];
  const rank = { user: 3, plugin: 2, system: 1 } as const;
  const unique = new Map<string, InstalledSkill>();
  for (const skill of all) {
    const key = `${skill.agent}:${skill.name}`;
    const previous = unique.get(key);
    if (!previous || rank[skill.source] > rank[previous.source]) unique.set(key, skill);
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || a.agent.localeCompare(b.agent));
}

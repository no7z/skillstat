import fs from "node:fs";
import path from "node:path";
import { userSkillsDir, pluginsDir, exists } from "./paths.js";

export interface InstalledSkill {
  name: string;
  description: string;
  dir: string; // directory containing SKILL.md
  source: "user" | "plugin";
  origin: string; // e.g. "user" or plugin/marketplace name
}

function parseFrontmatter(md: string): { name?: string; description?: string } {
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = md.slice(3, end);
  const lines = block.split("\n");
  const out: { name?: string; description?: string } = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1] as "name" | "description";
    let v = m[2].trim();
    if (v === ">" || v === ">-" || v === "|" || v === "|-") {
      // YAML block scalar: value is the following more-indented lines.
      const parts: string[] = [];
      const fold = v[0] === ">";
      for (let j = i + 1; j < lines.length; j++) {
        if (!/^\s+\S/.test(lines[j])) break; // dedent ends the block
        parts.push(lines[j].trim());
        i = j;
      }
      v = fold ? parts.join(" ") : parts.join("\n");
    } else {
      v = v.replace(/^["']|["']$/g, "");
    }
    out[key] = v;
  }
  return out;
}

function readSkillMd(dir: string, source: InstalledSkill["source"], origin: string): InstalledSkill | null {
  const skillMd = path.join(dir, "SKILL.md");
  if (!exists(skillMd)) return null;
  let md = "";
  try {
    md = fs.readFileSync(skillMd, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(md);
  const name = fm.name || path.basename(dir);
  return {
    name,
    description: fm.description || "",
    dir,
    source,
    origin,
  };
}

/** Discover skills under ~/.claude/skills (one dir per skill). */
function discoverUserSkills(): InstalledSkill[] {
  const root = userSkillsDir();
  const out: InstalledSkill[] = [];
  if (!exists(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const s = readSkillMd(path.join(root, entry.name), "user", "user");
    if (s) out.push(s);
  }
  return out;
}

/** Discover SKILL.md files anywhere under ~/.claude/plugins. */
function discoverPluginSkills(): InstalledSkill[] {
  const root = pluginsDir();
  const out: InstalledSkill[] = [];
  if (!exists(root)) return out;

  const stack: string[] = [root];
  const seen = new Set<string>();
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.name === "SKILL.md") {
        if (seen.has(dir)) continue;
        seen.add(dir);
        // origin = the marketplace/plugin segment right under plugins/
        const rel = path.relative(root, dir).split(path.sep);
        const origin = rel[1] || rel[0] || "plugin";
        const s = readSkillMd(dir, "plugin", origin);
        if (s) out.push(s);
      }
    }
  }
  return out;
}

export function discoverInstalled(): InstalledSkill[] {
  const all = [...discoverUserSkills(), ...discoverPluginSkills()];
  // De-dupe by name, preferring user skills.
  const byName = new Map<string, InstalledSkill>();
  for (const s of all) {
    const existing = byName.get(s.name);
    if (!existing || (existing.source === "plugin" && s.source === "user")) {
      byName.set(s.name, s);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

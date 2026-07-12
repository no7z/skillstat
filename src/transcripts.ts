import fs from "node:fs";
import path from "node:path";
import { projectsDir, decodeProjectDir, exists } from "./paths.js";
import { estimateTokens } from "./tokens.js";

export interface Trigger {
  skill: string;
  timestamp: number; // epoch ms, 0 if unknown
  project: string;
  session: string;
  source: "explicit" | "auto"; // Skill tool_use vs invoked_skills attachment
}

export interface SessionInfo {
  session: string;
  project: string;
  file: string;
  /** Representative skill_listing for this session: the set of offered skills. */
  offered: Set<string>;
  /** Estimated tokens of the skill_listing block injected in this session. */
  listingTokens: number;
  start: number;
  end: number;
}

export interface ParseResult {
  triggers: Trigger[];
  sessions: SessionInfo[];
  parseErrors: number;
}

function ts(o: any): number {
  const t = o?.timestamp;
  if (typeof t === "string") {
    const n = Date.parse(t);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Parse one skill_listing content blob into the set of skill names it lists. */
export function parseListingNames(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split("\n")) {
    // Lines look like: "- name: description (plugin)"
    const m = /^\s*-\s*([A-Za-z0-9_][A-Za-z0-9_.:-]*)\s*:/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function parseSession(file: string, fallbackLabel: string): {
  triggers: Trigger[];
  session: SessionInfo | null;
  errors: number;
} {
  const triggers: Trigger[] = [];
  let errors = 0;
  let sessionId = path.basename(file, ".jsonl");
  let offered = new Set<string>();
  let listingTokens = 0;
  let start = 0;
  let end = 0;
  // Events carry the real absolute cwd; use it for a truthful project label
  // (the transcript dir name is a lossy encoding that mangles worktree paths).
  const cwdCounts = new Map<string, number>();

  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      errors++;
      continue;
    }
    if (o.sessionId) sessionId = o.sessionId;
    if (typeof o.cwd === "string" && o.cwd) {
      cwdCounts.set(o.cwd, (cwdCounts.get(o.cwd) ?? 0) + 1);
    }
    const when = ts(o);
    if (when) {
      if (!start || when < start) start = when;
      if (when > end) end = when;
    }

    const type = o.type;
    if (type === "assistant") {
      const content = o.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === "tool_use" && b.name === "Skill") {
            const skill = b.input?.skill;
            if (typeof skill === "string" && skill) {
              triggers.push({
                skill,
                timestamp: when,
                project: "",
                session: sessionId,
                source: "explicit",
              });
            }
          }
        }
      }
    } else if (type === "attachment") {
      const a = o.attachment;
      if (a && a.type === "skill_listing" && typeof a.content === "string") {
        const names = parseListingNames(a.content);
        // Keep the largest listing seen as this session's representative.
        if (names.length >= offered.size) {
          offered = new Set(names);
          listingTokens = estimateTokens(a.content);
        }
      } else if (a && a.type === "invoked_skills" && Array.isArray(a.skills)) {
        for (const s of a.skills) {
          const name = s?.name;
          if (typeof name === "string" && name) {
            triggers.push({
              skill: name,
              timestamp: when,
              project: "",
              session: sessionId,
              source: "auto",
            });
          }
        }
      }
    }
  }

  // Pick the session's dominant cwd; label = its basename. Fall back to the
  // (lossy) decoded transcript dir name when no cwd was recorded.
  let bestCwd = "";
  let bestCount = -1;
  for (const [cwd, n] of cwdCounts) {
    if (n > bestCount) {
      bestCount = n;
      bestCwd = cwd;
    }
  }
  const label = bestCwd ? path.basename(bestCwd) : fallbackLabel;
  for (const t of triggers) t.project = label;

  const session: SessionInfo = {
    session: sessionId,
    project: label,
    file,
    offered,
    listingTokens,
    start,
    end,
  };
  return { triggers, session, errors };
}

export function parseAll(): ParseResult {
  const root = projectsDir();
  const triggers: Trigger[] = [];
  const sessions: SessionInfo[] = [];
  let parseErrors = 0;

  if (!exists(root)) {
    return { triggers, sessions, parseErrors };
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectLabel = decodeProjectDir(entry.name);
    const dir = path.join(root, entry.name);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const r = parseSession(full, projectLabel);
        triggers.push(...r.triggers);
        if (r.session) sessions.push(r.session);
        parseErrors += r.errors;
      } catch {
        parseErrors++;
      }
    }
  }

  return { triggers, sessions, parseErrors };
}

import fs from "node:fs";
import path from "node:path";
import { AgentName, ALL_AGENTS } from "./agents.js";
import {
  codexSessionsDir,
  cursorProjectsDir,
  projectsDir,
  decodeProjectDir,
  exists,
} from "./paths.js";
import { estimateTokens } from "./tokens.js";

export type TriggerSource = "explicit" | "auto" | "observed";

export interface Trigger {
  skill: string;
  timestamp: number;
  project: string;
  session: string;
  agent: AgentName;
  source: TriggerSource;
}

export interface SessionInfo {
  session: string;
  project: string;
  file: string;
  agent: AgentName;
  /** Claude skill_listing data; unavailable in Codex/Cursor transcripts. */
  offered: Set<string>;
  listingTokens: number;
  start: number;
  end: number;
}

export interface ParseResult {
  triggers: Trigger[];
  sessions: SessionInfo[];
  parseErrors: number;
}

function timestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function object(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function jsonl(file: string): { records: any[]; errors: number } {
  const records: any[] = [];
  let errors = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      errors++;
    }
  }
  return { records, errors };
}

function jsonlFiles(root: string, accept: (file: string) => boolean = () => true): string[] {
  if (!exists(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".jsonl") && accept(full)) out.push(full);
    }
  }
  return out.sort();
}

/** Parse one Claude skill_listing content blob into the names it lists. */
export function parseListingNames(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split("\n")) {
    const match = /^\s*-\s*([A-Za-z0-9_][A-Za-z0-9_.:-]*)\s*:/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

function explicitSkillNames(text: string): string[] {
  const names: string[] = [];
  // A slash command must end or be followed by whitespace. This deliberately
  // rejects absolute paths such as /Users/... and /home/... .
  const pattern = /(?:^|\n)\s*\/([A-Za-z0-9_][A-Za-z0-9_.:-]*)(?=\s|$)/g;
  for (const match of text.matchAll(pattern)) names.push(match[1]);
  return names;
}

function skillMdNames(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const names: string[] = [];
  const pattern = /(?:^|[\\/])([^\\/\s"'`]+)[\\/]SKILL\.md\b/g;
  for (const match of text.matchAll(pattern)) names.push(match[1]);
  return names;
}

export function parseClaudeSession(file: string, fallbackLabel = "unknown"): {
  triggers: Trigger[];
  session: SessionInfo;
  errors: number;
} {
  const { records, errors } = jsonl(file);
  const triggers: Trigger[] = [];
  let sessionId = path.basename(file, ".jsonl");
  let offered = new Set<string>();
  let listingTokens = 0;
  let start = 0;
  let end = 0;
  const cwdCounts = new Map<string, number>();

  for (const record of records) {
    if (record.sessionId) sessionId = record.sessionId;
    if (typeof record.cwd === "string" && record.cwd) {
      cwdCounts.set(record.cwd, (cwdCounts.get(record.cwd) ?? 0) + 1);
    }
    const when = timestamp(record.timestamp);
    if (when) {
      if (!start || when < start) start = when;
      if (when > end) end = when;
    }
    if (record.type === "assistant" && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block?.type === "tool_use" && block.name === "Skill" && typeof block.input?.skill === "string") {
          triggers.push({ skill: block.input.skill, timestamp: when, project: "", session: sessionId, agent: "claude", source: "explicit" });
        }
      }
    } else if (record.type === "attachment") {
      const attachment = record.attachment;
      if (attachment?.type === "skill_listing" && typeof attachment.content === "string") {
        const names = parseListingNames(attachment.content);
        if (names.length >= offered.size) {
          offered = new Set(names);
          listingTokens = estimateTokens(attachment.content);
        }
      } else if (attachment?.type === "invoked_skills" && Array.isArray(attachment.skills)) {
        for (const skill of attachment.skills) {
          if (typeof skill?.name === "string" && skill.name) {
            triggers.push({ skill: skill.name, timestamp: when, project: "", session: sessionId, agent: "claude", source: "auto" });
          }
        }
      }
    }
  }

  let bestCwd = "";
  let bestCount = -1;
  for (const [cwd, count] of cwdCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestCwd = cwd;
    }
  }
  const project = bestCwd ? path.basename(bestCwd) : fallbackLabel;
  for (const trigger of triggers) trigger.project = project;
  return {
    triggers,
    errors,
    session: { session: sessionId, project, file, agent: "claude", offered, listingTokens, start, end },
  };
}

export function parseCodexSession(file: string): {
  triggers: Trigger[];
  session: SessionInfo;
  errors: number;
} {
  const { records, errors } = jsonl(file);
  const triggers: Trigger[] = [];
  const seenExplicit = new Set<string>();
  const observed = new Map<string, number>();
  let sessionId = path.basename(file, ".jsonl");
  let cwd = "";
  let start = 0;
  let end = 0;

  const addExplicit = (skill: string, when: number) => {
    const key = `${when}\0${skill}`;
    if (!skill || seenExplicit.has(key)) return;
    seenExplicit.add(key);
    triggers.push({ skill, timestamp: when, project: "", session: sessionId, agent: "codex", source: "explicit" });
  };

  for (const record of records) {
    const payload = object(record.payload) ?? {};
    const when = timestamp(record.timestamp ?? payload.timestamp);
    if (when) {
      if (!start || when < start) start = when;
      if (when > end) end = when;
    }
    if (record.type === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      continue;
    }
    if (record.type === "event_msg" && payload.type === "user_message") {
      const text = typeof payload.message === "string" ? payload.message : typeof payload.text === "string" ? payload.text : "";
      for (const skill of explicitSkillNames(text)) addExplicit(skill, when);
    }
    if (
      record.type === "response_item" &&
      payload.type === "custom_tool_call" &&
      (payload.name === "exec" || payload.name === "exec_command")
    ) {
      const input = payload.input ?? payload.arguments;
      const inputText = typeof input === "string" ? input : JSON.stringify(input ?? "");
      // In current Codex transcripts `exec` wraps several tools. Only shell
      // execution is evidence that SKILL.md was actually read; apply_patch
      // payloads may merely contain paths as source text.
      if (payload.name === "exec_command" || inputText.includes("tools.exec_command")) {
        for (const skill of skillMdNames(input)) if (!observed.has(skill)) observed.set(skill, when);
      }
    }
  }

  const explicitNames = new Set(triggers.map((trigger) => trigger.skill));
  for (const [skill, when] of observed) {
    if (!explicitNames.has(skill)) {
      triggers.push({ skill, timestamp: when, project: "", session: sessionId, agent: "codex", source: "observed" });
    }
  }

  const project = cwd ? path.basename(cwd) : "unknown";
  for (const trigger of triggers) {
    trigger.session = sessionId;
    trigger.project = project;
  }
  return {
    triggers,
    errors,
    session: { session: sessionId, project, file, agent: "codex", offered: new Set(), listingTokens: 0, start, end },
  };
}

function cursorText(record: any): string {
  const content = record?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n");
}

export function parseCursorSession(file: string, project: string): {
  triggers: Trigger[];
  session: SessionInfo;
  errors: number;
} {
  const { records, errors } = jsonl(file);
  const stat = fs.statSync(file);
  const when = stat.mtimeMs;
  const sessionId = path.basename(path.dirname(file)) || path.basename(file, ".jsonl");
  const triggers: Trigger[] = [];
  for (const record of records) {
    if (record.role !== "user") continue;
    for (const skill of explicitSkillNames(cursorText(record))) {
      triggers.push({ skill, timestamp: when, project, session: sessionId, agent: "cursor", source: "explicit" });
    }
  }
  return {
    triggers,
    errors,
    session: { session: sessionId, project, file, agent: "cursor", offered: new Set(), listingTokens: 0, start: when, end: when },
  };
}

export function parseAll(agents: readonly AgentName[] = ALL_AGENTS): ParseResult {
  const triggers: Trigger[] = [];
  const sessions: SessionInfo[] = [];
  let parseErrors = 0;

  if (agents.includes("claude")) {
    const root = projectsDir();
    if (exists(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const file of jsonlFiles(path.join(root, entry.name))) {
          try {
            const result = parseClaudeSession(file, decodeProjectDir(entry.name));
            triggers.push(...result.triggers);
            sessions.push(result.session);
            parseErrors += result.errors;
          } catch {
            parseErrors++;
          }
        }
      }
    }
  }

  if (agents.includes("codex")) {
    for (const file of jsonlFiles(codexSessionsDir())) {
      try {
        const result = parseCodexSession(file);
        triggers.push(...result.triggers);
        sessions.push(result.session);
        parseErrors += result.errors;
      } catch {
        parseErrors++;
      }
    }
  }

  if (agents.includes("cursor")) {
    const root = cursorProjectsDir();
    for (const file of jsonlFiles(root, (candidate) => candidate.split(path.sep).includes("agent-transcripts"))) {
      try {
        const relative = path.relative(root, file).split(path.sep);
        const project = decodeProjectDir(relative[0] || "unknown");
        const result = parseCursorSession(file, project);
        triggers.push(...result.triggers);
        sessions.push(result.session);
        parseErrors += result.errors;
      } catch {
        parseErrors++;
      }
    }
  }

  return { triggers, sessions, parseErrors };
}

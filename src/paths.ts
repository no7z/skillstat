import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Root of the Claude Code config dir, honoring CLAUDE_CONFIG_DIR. */
export function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".claude");
}

export function projectsDir(): string {
  return path.join(claudeHome(), "projects");
}

export function userSkillsDir(): string {
  return path.join(claudeHome(), "skills");
}

export function pluginsDir(): string {
  return path.join(claudeHome(), "plugins");
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude Code encodes a project's cwd into its transcript directory name by
 * replacing every "/" (and ".") with "-". That transform is lossy, so we can't
 * perfectly recover the path — but the trailing path segment is a good label.
 */
export function decodeProjectDir(dirName: string): string {
  // e.g. "-Users-xylopen-projects-skillstat" → "skillstat"
  const trimmed = dirName.replace(/^-+/, "");
  const parts = trimmed.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : dirName;
}

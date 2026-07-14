import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseClaudeSession,
  parseCodexSession,
  parseCursorSession,
  parseListingNames,
} from "../dist/transcripts.js";

function fixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillstat-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

test("parses Claude explicit, auto, and listing evidence", () => {
  const file = fixture([
    { type: "attachment", timestamp: "2026-01-01T00:00:00Z", attachment: { type: "skill_listing", content: "- browse: Browser QA\n- review: Review code" } },
    { type: "assistant", timestamp: "2026-01-01T00:01:00Z", cwd: "/work/app", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "browse" } }] } },
    { type: "attachment", timestamp: "2026-01-01T00:02:00Z", attachment: { type: "invoked_skills", skills: [{ name: "review" }] } },
  ]);
  const result = parseClaudeSession(file);
  assert.deepEqual(result.triggers.map(({ skill, source }) => ({ skill, source })), [
    { skill: "browse", source: "explicit" },
    { skill: "review", source: "auto" },
  ]);
  assert.equal(result.session.project, "app");
  assert.deepEqual(parseListingNames("- a: A\n- vendor:b: B"), ["a", "vendor:b"]);
});

test("parses Codex slash commands and observed SKILL.md reads without mistaking paths for commands", () => {
  const file = fixture([
    { type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "codex-1", cwd: "/work/app" } },
    { type: "event_msg", timestamp: "2026-01-01T00:01:00Z", payload: { type: "user_message", message: "/browse audit the UI\n/Users/me/.agents/skills/review/SKILL.md" } },
    { type: "response_item", timestamp: "2026-01-01T00:02:00Z", payload: { type: "custom_tool_call", name: "exec", input: "const r = await tools.exec_command({cmd: \"sed -n '1,200p' /Users/me/.agents/skills/review/SKILL.md /Users/me/.agents/skills/browse/SKILL.md\"});" } },
  ]);
  const result = parseCodexSession(file);
  assert.deepEqual(result.triggers.map(({ skill, source }) => ({ skill, source })), [
    { skill: "browse", source: "explicit" },
    { skill: "review", source: "observed" },
  ]);
  assert.equal(result.session.session, "codex-1");
  assert.equal(result.session.project, "app");
});

test("parses Cursor explicit commands and uses file metadata for time", () => {
  const file = fixture([
    { role: "user", message: { content: [{ type: "text", text: "/review this change\n/Users/me/skills/foo/SKILL.md" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "done" }] } },
  ]);
  const result = parseCursorSession(file, "app");
  assert.deepEqual(result.triggers.map(({ skill, source }) => ({ skill, source })), [
    { skill: "review", source: "explicit" },
  ]);
  assert.ok(result.session.start > 0);
});

export const ALL_AGENTS = ["claude", "codex", "cursor"] as const;

export type AgentName = (typeof ALL_AGENTS)[number];

export function isAgentName(value: string): value is AgentName {
  return (ALL_AGENTS as readonly string[]).includes(value);
}

export function agentCounts(): Record<AgentName, number> {
  return { claude: 0, codex: 0, cursor: 0 };
}

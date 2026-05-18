import type { AgentId } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';

export interface RoutingRule {
  label: string;
  agent: AgentId;
}

export interface RouterConfig {
  defaultAgent: AgentId;
  rules: RoutingRule[];
}

const EXPLICIT_AGENT_PREFIX = 'agent:';

export class Router {
  constructor(private readonly cfg: RouterConfig) {}

  route(issue: Issue): AgentId {
    for (const label of issue.labels) {
      if (label.startsWith(EXPLICIT_AGENT_PREFIX)) {
        return label.slice(EXPLICIT_AGENT_PREFIX.length);
      }
    }
    for (const rule of this.cfg.rules) {
      if (issue.labels.includes(rule.label)) return rule.agent;
    }
    return this.cfg.defaultAgent;
  }
}

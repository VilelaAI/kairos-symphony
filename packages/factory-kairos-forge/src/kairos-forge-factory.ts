import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentDescriptor, AgentId, FactoryPort } from '@kairos-symphony/core';
import matter from 'gray-matter';

const KNOWN_PATHS = [
  // Padrão Claude Code plugins
  '.claude/plugins/cache/kairos-forge/agents',
  '.claude/plugins/kairos-forge/agents',
];

export function discoverForgeAgentsDir(home: string = homedir()): string | null {
  for (const rel of KNOWN_PATHS) {
    const candidate = join(home, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface KairosForgeFactoryOpts {
  agentsDir: string;
}

export class KairosForgeFactory implements FactoryPort {
  constructor(private readonly opts: KairosForgeFactoryOpts) {}

  async loadAgent(id: AgentId): Promise<AgentDescriptor> {
    const filePath = join(this.opts.agentsDir, `${id}.md`);
    if (!existsSync(filePath)) {
      throw new Error(`agente ${id} não encontrado em ${filePath}`);
    }
    const raw = readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    const name = (parsed.data as { name?: string }).name ?? id;
    const description = (parsed.data as { description?: string }).description ?? '';
    return { id, name, description, body: parsed.content, filePath };
  }

  async listAgents(): Promise<AgentId[]> {
    if (!existsSync(this.opts.agentsDir)) return [];
    return readdirSync(this.opts.agentsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
  }
}

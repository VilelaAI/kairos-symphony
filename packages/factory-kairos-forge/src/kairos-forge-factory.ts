import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentDescriptor, AgentId, FactoryPort, SkillDescriptor } from '@kairos-symphony/core';
import matter from 'gray-matter';

/**
 * Raízes conhecidas de instalação do kairos-forge. A raiz é a pasta que contém
 * `agents/`, `skills/` e `scripts/` — a fábrica é mais que o catálogo de personas.
 */
const KNOWN_ROOTS = [
  // Padrão Claude Code plugins
  '.claude/plugins/cache/kairos-forge/plugin',
  '.claude/plugins/cache/kairos-forge',
  '.claude/plugins/kairos-forge/plugin',
  '.claude/plugins/kairos-forge',
];

/** Raiz da instalação do Forge (a pasta que contém `agents/`). */
export function discoverForgeRoot(home: string = homedir()): string | null {
  for (const rel of KNOWN_ROOTS) {
    const candidate = join(home, rel);
    if (existsSync(join(candidate, 'agents'))) return candidate;
  }
  return null;
}

/** Compat: caminho de `agents/`. Preferir {@link discoverForgeRoot}. */
export function discoverForgeAgentsDir(home: string = homedir()): string | null {
  const root = discoverForgeRoot(home);
  return root ? join(root, 'agents') : null;
}

export interface KairosForgeFactoryOpts {
  agentsDir: string;
  /**
   * Raiz do Forge. Omitida, é derivada de `agentsDir` (o diretório pai) — mantém
   * compatível quem já construía a factory só com `agentsDir`.
   */
  forgeRoot?: string;
}

export class KairosForgeFactory implements FactoryPort {
  private readonly root: string;

  constructor(private readonly opts: KairosForgeFactoryOpts) {
    this.root = opts.forgeRoot ?? dirname(opts.agentsDir);
  }

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

  // ── Skills e scripts: a outra metade da fábrica ──────────────────────────

  private skillsDir(): string {
    return join(this.root, 'skills');
  }

  async listSkills(): Promise<string[]> {
    const dir = this.skillsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  }

  async loadSkill(name: string): Promise<SkillDescriptor> {
    const filePath = join(this.skillsDir(), name, 'SKILL.md');
    if (!existsSync(filePath)) {
      throw new Error(`skill ${name} não encontrada em ${filePath}`);
    }
    const parsed = matter(readFileSync(filePath, 'utf8'));
    const data = parsed.data as { name?: string; description?: string };
    return {
      name: data.name ?? name,
      description: data.description ?? '',
      body: parsed.content,
      filePath,
    };
  }

  /** `<root>/scripts` quando existe — é onde vive o contrato de integração. */
  scriptsDir(): string | null {
    const dir = join(this.root, 'scripts');
    return existsSync(dir) ? dir : null;
  }
}

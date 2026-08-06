import type { AgentDescriptor, AgentId } from '../domain/agent.js';

/** Uma skill da fábrica (`skills/<nome>/SKILL.md`). */
export interface SkillDescriptor {
  /** Nome da skill, igual ao diretório — ex.: `entregar`, `validar`. */
  name: string;
  /** `description` do frontmatter: é o que diz QUANDO usar. */
  description: string;
  /** Corpo do SKILL.md, sem o frontmatter. */
  body: string;
  filePath: string;
}

/**
 * Porta da fábrica de agentes.
 *
 * `loadAgent`/`listAgents` são o núcleo obrigatório. O resto é **opcional** de
 * propósito: uma fábrica pode entregar só personas, e implementações existentes
 * (inclusive fakes de teste) seguem válidas sem mudar nada.
 */
export interface FactoryPort {
  loadAgent(id: AgentId): Promise<AgentDescriptor>;
  listAgents(): Promise<AgentId[]>;

  /**
   * Skills da fábrica. Uma fábrica é mais que um catálogo de personas: as skills são
   * os procedimentos (`especificar`, `entregar`, `validar`, `revisar`…), e sem elas o
   * daemon enxerga metade do que instalou.
   */
  listSkills?(): Promise<string[]>;
  loadSkill?(name: string): Promise<SkillDescriptor>;

  /**
   * Diretório de scripts da fábrica (`ciclo.py`, `contrato.py`, `telemetria.py`…).
   * É por aqui que o daemon encontra o contrato de integração; `null` quando a
   * fábrica não publica scripts.
   */
  scriptsDir?(): string | null;
}

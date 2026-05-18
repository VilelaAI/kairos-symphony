import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KairosForgeFactory, discoverForgeAgentsDir } from './kairos-forge-factory.js';

describe('KairosForgeFactory', () => {
  it('loadAgent lê .md com frontmatter e devolve AgentDescriptor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-'));
    try {
      const agentsDir = join(dir, 'agents');
      mkdirSync(agentsDir);
      writeFileSync(
        join(agentsDir, 'lucas-backend.md'),
        '---\nname: Lucas Backend\ndescription: Engenheiro backend Node/TS\n---\n\nVocê é o Lucas.',
        'utf8',
      );
      const factory = new KairosForgeFactory({ agentsDir });
      const agent = await factory.loadAgent('lucas-backend');
      expect(agent.id).toBe('lucas-backend');
      expect(agent.name).toBe('Lucas Backend');
      expect(agent.description).toBe('Engenheiro backend Node/TS');
      expect(agent.body.trim()).toBe('Você é o Lucas.');
      expect(agent.filePath.endsWith('lucas-backend.md')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listAgents devolve ids derivados dos arquivos .md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-'));
    try {
      const agentsDir = join(dir, 'agents');
      mkdirSync(agentsDir);
      writeFileSync(join(agentsDir, 'a.md'), '---\nname: A\ndescription: D\n---\nbody');
      writeFileSync(join(agentsDir, 'b.md'), '---\nname: B\ndescription: D\n---\nbody');
      const factory = new KairosForgeFactory({ agentsDir });
      const ids = await factory.listAgents();
      expect(ids.sort()).toEqual(['a', 'b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadAgent inexistente lança erro descritivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-'));
    try {
      mkdirSync(join(dir, 'agents'));
      const factory = new KairosForgeFactory({ agentsDir: join(dir, 'agents') });
      await expect(factory.loadAgent('inexistente')).rejects.toThrow(/agente.*não encontrado/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('discoverForgeAgentsDir', () => {
  it('retorna null se nenhum path conhecido existir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'home-'));
    try {
      expect(discoverForgeAgentsDir(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('retorna o primeiro path conhecido que existir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'home-'));
    try {
      mkdirSync(join(dir, '.claude/plugins/kairos-forge/agents'), { recursive: true });
      expect(discoverForgeAgentsDir(dir)).toContain('.claude/plugins/kairos-forge/agents');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

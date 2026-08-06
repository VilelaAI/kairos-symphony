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

describe('KairosForgeFactory — skills e scripts (a outra metade da fábrica)', () => {
  function forgeFalso(): string {
    const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(
      join(root, 'agents', 'laura-techlead.md'),
      '---\nname: laura-techlead\ndescription: Tech Lead\n---\n\nOi, Laura aqui.\n',
    );
    for (const [nome, desc] of [
      ['entregar', 'Conduz o ciclo completo da fábrica'],
      ['validar', 'Valida a implementação contra a SPEC'],
    ]) {
      mkdirSync(join(root, 'skills', nome), { recursive: true });
      writeFileSync(
        join(root, 'skills', nome, 'SKILL.md'),
        `---\nname: ${nome}\ndescription: ${desc}\n---\n\n# ${nome}\n\nCorpo da skill.\n`,
      );
    }
    // diretório sem SKILL.md não conta como skill
    mkdirSync(join(root, 'skills', 'rascunho'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'ciclo.py'), '# ciclo\n');
    return root;
  }

  it('lista skills, ignorando diretório sem SKILL.md', async () => {
    const root = forgeFalso();
    const f = new KairosForgeFactory({ agentsDir: join(root, 'agents') });
    await expect(f.listSkills()).resolves.toEqual(['entregar', 'validar']);
  });

  it('carrega uma skill com description do frontmatter', async () => {
    const root = forgeFalso();
    const f = new KairosForgeFactory({ agentsDir: join(root, 'agents') });
    const s = await f.loadSkill('entregar');
    expect(s.name).toBe('entregar');
    expect(s.description).toContain('ciclo completo');
    expect(s.body).toContain('Corpo da skill');
    expect(s.body).not.toContain('---'); // frontmatter fora do corpo
  });

  it('skill inexistente falha com o caminho no erro', async () => {
    const root = forgeFalso();
    const f = new KairosForgeFactory({ agentsDir: join(root, 'agents') });
    await expect(f.loadSkill('nao-existe')).rejects.toThrow(/nao-existe/);
  });

  it('scriptsDir aponta para os scripts do Forge', () => {
    const root = forgeFalso();
    const f = new KairosForgeFactory({ agentsDir: join(root, 'agents') });
    expect(f.scriptsDir()).toBe(join(root, 'scripts'));
  });

  it('instalação sem skills/ nem scripts/ degrada sem quebrar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-magro-'));
    mkdirSync(join(root, 'agents'), { recursive: true });
    const f = new KairosForgeFactory({ agentsDir: join(root, 'agents') });
    await expect(f.listSkills()).resolves.toEqual([]);
    expect(f.scriptsDir()).toBeNull();
  });

  it('forgeRoot explícito vence a derivação por agentsDir', async () => {
    const root = forgeFalso();
    const f = new KairosForgeFactory({
      agentsDir: join(root, 'agents'),
      forgeRoot: root,
    });
    await expect(f.listSkills()).resolves.toEqual(['entregar', 'validar']);
  });
});

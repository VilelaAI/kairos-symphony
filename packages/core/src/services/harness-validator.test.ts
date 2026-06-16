import { describe, expect, it } from 'vitest';
import {
  type HarnessFsProbe,
  HarnessValidator,
  harnessRemediationMessage,
} from './harness-validator.js';

/** Probe falso a partir de um conjunto de caminhos "existentes" (dirs terminam em /). */
function fakeProbe(paths: string[]): HarnessFsProbe {
  const set = new Set(paths);
  return {
    exists: (rel) =>
      set.has(rel) || set.has(`${rel}/`) || [...set].some((p) => p.startsWith(`${rel}/`)),
    isDirectory: (rel) => set.has(`${rel}/`) || [...set].some((p) => p.startsWith(`${rel}/`)),
    listFiles: (rel) =>
      [...set]
        .filter((p) => p.startsWith(`${rel}/`) && p !== `${rel}/`)
        .map((p) => p.slice(rel.length + 1).split('/')[0] ?? ''),
  };
}

const READY = ['CLAUDE.md', '.gitignore', 'docs/adr/0001-x.md', '.github/workflows/ci.yml'];

describe('HarnessValidator (§16)', () => {
  it('repo com os 4 sinais → ready', () => {
    const report = new HarnessValidator(fakeProbe(READY)).validate();
    expect(report.ready).toBe(true);
    expect(report.failures).toHaveLength(0);
  });

  it('aceita AGENTS.md como instruction set', () => {
    const report = new HarnessValidator(
      fakeProbe(['AGENTS.md', '.gitignore', 'docs/adr/0001.md', '.gitlab-ci.yml']),
    ).validate();
    expect(report.ready).toBe(true);
  });

  it('sem AGENTS.md/CLAUDE.md → falha instruction_set', () => {
    const report = new HarnessValidator(
      fakeProbe(['.gitignore', 'docs/adr/0001.md', '.github/workflows/ci.yml']),
    ).validate();
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'instruction_set')?.ok).toBe(false);
  });

  it('sem ADRs → falha repository_as_context', () => {
    const report = new HarnessValidator(
      fakeProbe(['CLAUDE.md', '.gitignore', '.github/workflows/ci.yml']),
    ).validate();
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'repository_as_context')?.ok).toBe(false);
  });

  it('sem CI nem pre-commit → falha enforced_invariants', () => {
    const report = new HarnessValidator(
      fakeProbe(['CLAUDE.md', '.gitignore', 'docs/adr/0001.md']),
    ).validate();
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'enforced_invariants')?.ok).toBe(false);
  });

  it('aceita .pre-commit-config.yaml como invariante enforçada', () => {
    const report = new HarnessValidator(
      fakeProbe(['CLAUDE.md', '.gitignore', 'docs/adr/0001.md', '.pre-commit-config.yaml']),
    ).validate();
    expect(report.ready).toBe(true);
  });

  it('sem .gitignore → falha repo_hygiene', () => {
    const report = new HarnessValidator(
      fakeProbe(['CLAUDE.md', 'docs/adr/0001.md', '.github/workflows/ci.yml']),
    ).validate();
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'repo_hygiene')?.ok).toBe(false);
  });

  it('mensagem de remediação lista as falhas e sugere o forge', () => {
    const report = new HarnessValidator(fakeProbe([])).validate();
    const msg = harnessRemediationMessage(report);
    expect(msg).toContain('não está harness-ready');
    expect(msg).toContain('Sem AGENTS.md ou CLAUDE.md');
    expect(msg).toContain('/kairos-forge:onboardar');
  });
});

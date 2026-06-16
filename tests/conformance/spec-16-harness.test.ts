import {
  type HarnessFsProbe,
  HarnessValidator,
  harnessRemediationMessage,
} from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

function probe(paths: string[]): HarnessFsProbe {
  const set = new Set(paths);
  return {
    exists: (rel) =>
      set.has(rel) || [...set].some((p) => p === `${rel}/` || p.startsWith(`${rel}/`)),
    isDirectory: (rel) => [...set].some((p) => p.startsWith(`${rel}/`)),
    listFiles: (rel) =>
      [...set].filter((p) => p.startsWith(`${rel}/`)).map((p) => p.slice(rel.length + 1)),
  };
}

const READY = ['CLAUDE.md', '.gitignore', 'docs/adr/0001.md', '.github/workflows/ci.yml'];

describe('SPEC §16 — Harness-readiness', () => {
  it('§16.2: repo com os 4 sinais mínimos é considerado harness-ready', () => {
    const report = new HarnessValidator(probe(READY)).validate();
    expect(report.ready).toBe(true);
  });

  it('§16.2/§16.3: cada pilar ausente é diagnosticado individualmente', () => {
    // sem nenhum sinal → as 4 checagens falham
    const report = new HarnessValidator(probe([])).validate();
    expect(report.ready).toBe(false);
    const failed = new Set(report.checks.filter((c) => !c.ok).map((c) => c.id));
    expect(failed).toEqual(
      new Set(['instruction_set', 'repository_as_context', 'enforced_invariants', 'repo_hygiene']),
    );
  });

  it('§16.3: mensagem de remediação aponta as falhas e o caminho do forge', () => {
    const report = new HarnessValidator(probe(['.gitignore'])).validate();
    const msg = harnessRemediationMessage(report);
    expect(msg).toContain('Repo não está harness-ready');
    expect(msg).toContain('/plugin install kairos-forge@kairos-forge');
  });
});

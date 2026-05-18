import { PromptBuilder, PromptTooLargeError } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

describe('SPEC §6 — Prompt construction', () => {
  const pb = new PromptBuilder({ maxBytes: 1_048_576 });
  const issue = {
    id: 'r#1',
    number: 1,
    title: 'T',
    body: 'B',
    labels: ['foo'],
    state: 'ready' as const,
  };
  const agent = {
    id: 'a',
    name: 'Agent',
    description: 'D',
    body: 'AgentBody',
    filePath: '/x',
  };
  const workspace = {
    issueId: 'r#1',
    path: '/ws',
    branchName: 'symphony/r-1',
    baseBranch: 'main',
    terminalLogPath: '/ws/.symphony/terminal.log',
  };

  it('inclui identidade do agente', () => {
    const p = pb.build({ issue, agent, workspace });
    expect(p).toContain('Agent');
    expect(p).toContain('AgentBody');
  });

  it('inclui contexto da issue', () => {
    const p = pb.build({ issue, agent, workspace });
    expect(p).toContain('r#1');
    expect(p).toContain('T');
    expect(p).toContain('#1');
  });

  it('inclui workspace (branch + base)', () => {
    const p = pb.build({ issue, agent, workspace });
    expect(p).toContain('symphony/r-1');
    expect(p).toContain('main');
  });

  it('inclui Definition of Done com PR + Closes #N', () => {
    const p = pb.build({ issue, agent, workspace });
    expect(p).toContain('PR aberto');
    expect(p).toContain('Closes #1');
  });

  it('inclui mecanismo de bloqueio (BLOCKED:)', () => {
    const p = pb.build({ issue, agent, workspace });
    expect(p).toContain('BLOCKED:');
  });

  it('rejeita prompt > limite (size guard)', () => {
    expect(() =>
      pb.build({ issue: { ...issue, body: 'X'.repeat(2_000_000) }, agent, workspace }),
    ).toThrow(PromptTooLargeError);
  });
});

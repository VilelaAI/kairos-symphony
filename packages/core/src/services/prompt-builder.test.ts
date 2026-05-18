import { describe, expect, it } from 'vitest';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import { PromptBuilder, PromptTooLargeError } from './prompt-builder.js';

const issue: Issue = {
  id: 'VilelaAI/repo#42',
  number: 42,
  title: 'Corrige cálculo de imposto',
  body: 'Quando o ICMS é maior que 18%, o sistema arredonda errado.',
  labels: ['bug', 'agent:lucas-backend'],
  state: 'ready',
};

const agent: AgentDescriptor = {
  id: 'lucas-backend',
  name: 'Lucas — Backend',
  description: 'Engenheiro backend Node/TS',
  body: 'Você é o Lucas. Foca em qualidade e testes.',
  filePath: '/fake/lucas.md',
};

const workspace: WorkspaceInfo = {
  issueId: 'VilelaAI/repo#42',
  path: '/var/symphony/workspaces/VilelaAI-repo-42',
  branchName: 'symphony/42',
  baseBranch: 'main',
  terminalLogPath: '/var/symphony/workspaces/VilelaAI-repo-42/.symphony/terminal.log',
};

describe('PromptBuilder', () => {
  const builder = new PromptBuilder({ maxBytes: 1_048_576 });

  it('inclui identidade do agente, contexto da issue, info do workspace e DoD', () => {
    const prompt = builder.build({ issue, agent, workspace });
    expect(prompt).toContain('Lucas — Backend');
    expect(prompt).toContain('Engenheiro backend Node/TS');
    expect(prompt).toContain('VilelaAI/repo#42');
    expect(prompt).toContain('Corrige cálculo de imposto');
    expect(prompt).toContain('symphony/42');
    expect(prompt).toContain('main');
    expect(prompt).toContain('PR aberto');
    expect(prompt).toContain('blocked');
  });

  it('rejeita prompt > maxBytes', () => {
    const huge = 'X'.repeat(2_000_000);
    expect(() => builder.build({ issue: { ...issue, body: huge }, agent, workspace })).toThrow(
      PromptTooLargeError,
    );
  });

  it('inclui labels da issue', () => {
    const prompt = builder.build({ issue, agent, workspace });
    expect(prompt).toContain('bug');
    expect(prompt).toContain('agent:lucas-backend');
  });
});

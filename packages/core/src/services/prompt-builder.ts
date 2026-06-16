import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';

export class PromptTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly limit: number,
  ) {
    super(`Prompt de ${sizeBytes} bytes excede o limite de ${limit} bytes`);
    this.name = 'PromptTooLargeError';
  }
}

export interface PromptInput {
  issue: Issue;
  agent: AgentDescriptor;
  workspace: WorkspaceInfo;
}

export interface PromptBuilderOpts {
  maxBytes: number;
  /** Intervalo sugerido (ms) entre atualizações de heartbeat pelo agente (§8.1). */
  heartbeatIntervalMs?: number;
}

export class PromptBuilder {
  constructor(private readonly opts: PromptBuilderOpts) {}

  build(input: PromptInput): string {
    const { issue, agent, workspace } = input;
    const labelsLine = issue.labels.length > 0 ? issue.labels.join(', ') : '(sem labels)';
    const heartbeatSeconds = Math.max(
      1,
      Math.round((this.opts.heartbeatIntervalMs ?? 30_000) / 1000),
    );

    const prompt = [
      '# Identidade do agente',
      '',
      `Você é **${agent.name}**.`,
      '',
      agent.description,
      '',
      agent.body,
      '',
      '# Contexto da issue',
      '',
      `- ID: ${issue.id}`,
      `- Número: #${issue.number}`,
      `- Título: ${issue.title}`,
      `- Labels: ${labelsLine}`,
      '',
      '## Descrição',
      '',
      issue.body,
      '',
      '# Workspace',
      '',
      `- Path: ${workspace.path}`,
      `- Branch: ${workspace.branchName}`,
      `- Branch base: ${workspace.baseBranch}`,
      '',
      `Toda mudança deve ser commitada na branch ${workspace.branchName} (já criada).`,
      `Nunca dê push direto para ${workspace.baseBranch}.`,
      '',
      '# Definition of Done',
      '',
      '1. PR aberto para esta issue, com CI verde.',
      `2. O corpo do PR deve conter "Closes #${issue.number}".`,
      '',
      '# Sinal de vida (heartbeat)',
      '',
      `Enquanto trabalha, atualize o arquivo \`.symphony/heartbeat\` a cada ~${heartbeatSeconds}s`,
      '(por exemplo, antes/depois de cada passo demorado):',
      '',
      '```bash',
      'date +%s > .symphony/heartbeat',
      '```',
      '',
      'O orquestrador usa esse sinal para saber que você está vivo mesmo quando',
      'não há output no terminal (ex.: durante uma compilação ou teste longo).',
      'Se o heartbeat parar de atualizar e não houver output, seu processo será',
      'considerado travado e reiniciado.',
      '',
      '# Se você travar',
      '',
      'Se não conseguir progredir, encerre o processo deixando uma última mensagem',
      `começando com "BLOCKED:" explicando o motivo. O orquestrador moverá a issue`,
      'para o estado blocked e pedirá intervenção humana.',
      '',
    ].join('\n');

    const size = Buffer.byteLength(prompt, 'utf8');
    if (size > this.opts.maxBytes) {
      throw new PromptTooLargeError(size, this.opts.maxBytes);
    }
    return prompt;
  }
}

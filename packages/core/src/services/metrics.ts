import { ISSUE_STATES } from '../domain/states.js';

/**
 * Sink de métricas chamado pelos serviços (Daemon, AgentSupervisor) nos pontos
 * de instrumentação. Mantido como interface para que os serviços do core não
 * dependam da implementação concreta nem do servidor HTTP (§13.2).
 */
export interface MetricsSink {
  recordDispatch(): void;
  recordCrash(agentId: string): void;
  observeDispatchDuration(seconds: number): void;
}

/** Buckets (segundos) do histograma de duração de dispatch. */
const DURATION_BUCKETS = [30, 60, 120, 300, 600, 1200, 3600, 7200] as const;

export interface MetricsRegistryOpts {
  /**
   * Fonte do gauge `symphony_issues_in_state` — contagem de issues por estado,
   * lida sob demanda no momento do scrape (a partir do store).
   */
  issuesInState?: () => Record<string, number>;
}

/**
 * Registro de métricas em memória que renderiza no formato de exposição
 * Prometheus (text/plain; version=0.0.4). Sem dependências externas.
 */
export class MetricsRegistry implements MetricsSink {
  private dispatchesTotal = 0;
  private readonly crashesByAgent = new Map<string, number>();
  private readonly durationBucketCounts = new Array(DURATION_BUCKETS.length).fill(0);
  private durationSum = 0;
  private durationCount = 0;

  constructor(private readonly opts: MetricsRegistryOpts = {}) {}

  recordDispatch(): void {
    this.dispatchesTotal += 1;
  }

  recordCrash(agentId: string): void {
    this.crashesByAgent.set(agentId, (this.crashesByAgent.get(agentId) ?? 0) + 1);
  }

  observeDispatchDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.durationSum += seconds;
    this.durationCount += 1;
    DURATION_BUCKETS.forEach((bucket, i) => {
      if (seconds <= bucket) this.durationBucketCounts[i] += 1;
    });
  }

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP symphony_issues_in_state Número de issues em cada estado canônico.');
    lines.push('# TYPE symphony_issues_in_state gauge');
    const counts = this.opts.issuesInState?.() ?? {};
    for (const state of ISSUE_STATES) {
      lines.push(`symphony_issues_in_state{state="${state}"} ${counts[state] ?? 0}`);
    }

    lines.push('# HELP symphony_dispatches_total Total de dispatches de agentes.');
    lines.push('# TYPE symphony_dispatches_total counter');
    lines.push(`symphony_dispatches_total ${this.dispatchesTotal}`);

    lines.push('# HELP symphony_crashes_total Total de crashes de agentes por agente.');
    lines.push('# TYPE symphony_crashes_total counter');
    // Sem crashes ainda → série vazia, documentada apenas pelo HELP/TYPE acima.
    for (const [agent, n] of this.crashesByAgent) {
      lines.push(`symphony_crashes_total{agent="${escapeLabel(agent)}"} ${n}`);
    }

    lines.push(
      '# HELP symphony_dispatch_duration_seconds Duração de um dispatch até estado terminal.',
    );
    lines.push('# TYPE symphony_dispatch_duration_seconds histogram');
    // Cada posição de durationBucketCounts já é cumulativa (count de obs <= bucket),
    // que é exatamente o que o Prometheus espera para cada `le`.
    DURATION_BUCKETS.forEach((bucket, i) => {
      lines.push(
        `symphony_dispatch_duration_seconds_bucket{le="${bucket}"} ${this.durationBucketCounts[i]}`,
      );
    });
    lines.push(`symphony_dispatch_duration_seconds_bucket{le="+Inf"} ${this.durationCount}`);
    lines.push(`symphony_dispatch_duration_seconds_sum ${this.durationSum}`);
    lines.push(`symphony_dispatch_duration_seconds_count ${this.durationCount}`);

    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

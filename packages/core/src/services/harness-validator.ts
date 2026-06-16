import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Validação de harness-readiness (§16). Roda contra o repositório alvo
 * (`workspaces.repo_path`) e verifica os 4 sinais mínimos da §16.2, cada um
 * mapeado ao pilar de Harness Engineering que ele evidencia (§16.1).
 *
 * O acesso ao filesystem é injetado (`HarnessFsProbe`) para testes
 * determinísticos sem tocar o disco.
 */

export type HarnessCheckId =
  | 'instruction_set'
  | 'repository_as_context'
  | 'enforced_invariants'
  | 'repo_hygiene';

export interface HarnessCheckResult {
  id: HarnessCheckId;
  pillar: string;
  ok: boolean;
  detail: string;
}

export interface HarnessReport {
  ready: boolean;
  checks: HarnessCheckResult[];
  /** Detalhes das checagens que falharam, prontos para diagnóstico (§16.3). */
  failures: string[];
}

export interface HarnessFsProbe {
  /** true se o caminho relativo existe (arquivo ou diretório). */
  exists(relPath: string): boolean;
  /** true se o caminho relativo é um diretório. */
  isDirectory(relPath: string): boolean;
  /** Nomes das entradas de um diretório (vazio se não for diretório). */
  listFiles(relPath: string): string[];
}

const ADR_DIRS = ['docs/adr', 'docs/adrs', 'docs/decisoes', 'decisoes', 'adr', 'doc/adr'];

const CI_FILES = ['.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile', 'azure-pipelines.yml'];

const PRE_COMMIT_FILES = ['.pre-commit-config.yaml', 'lefthook.yml', 'lefthook.yaml'];

export class HarnessValidator {
  constructor(private readonly probe: HarnessFsProbe) {}

  validate(): HarnessReport {
    const checks: HarnessCheckResult[] = [
      this.checkInstructionSet(),
      this.checkRepositoryAsContext(),
      this.checkEnforcedInvariants(),
      this.checkRepoHygiene(),
    ];
    const failures = checks.filter((c) => !c.ok).map((c) => c.detail);
    return { ready: failures.length === 0, checks, failures };
  }

  private checkInstructionSet(): HarnessCheckResult {
    const ok = this.probe.exists('AGENTS.md') || this.probe.exists('CLAUDE.md');
    return {
      id: 'instruction_set',
      pillar: 'Instruction set evolutivo',
      ok,
      detail: ok ? 'AGENTS.md/CLAUDE.md presente' : 'Sem AGENTS.md ou CLAUDE.md na raiz',
    };
  }

  private checkRepositoryAsContext(): HarnessCheckResult {
    const dir = ADR_DIRS.find(
      (d) => this.probe.isDirectory(d) && this.probe.listFiles(d).some((f) => f.endsWith('.md')),
    );
    const ok = dir !== undefined;
    return {
      id: 'repository_as_context',
      pillar: 'Repository-as-context',
      ok,
      detail: ok
        ? `ADRs encontrados em ${dir}/`
        : `Sem ADRs (procurado em ${ADR_DIRS.map((d) => `${d}/`).join(', ')})`,
    };
  }

  private checkEnforcedInvariants(): HarnessCheckResult {
    const hasPreCommit =
      PRE_COMMIT_FILES.some((f) => this.probe.exists(f)) ||
      (this.probe.isDirectory('.husky') && this.probe.listFiles('.husky').length > 0);
    const hasCi =
      (this.probe.isDirectory('.github/workflows') &&
        this.probe.listFiles('.github/workflows').some((f) => /\.ya?ml$/.test(f))) ||
      CI_FILES.some((f) => this.probe.exists(f));
    const ok = hasPreCommit || hasCi;
    return {
      id: 'enforced_invariants',
      pillar: 'Architectural invariants mecanicamente enforçados',
      ok,
      detail: ok
        ? 'Hook de pre-commit ou config de CI presente'
        : 'Sem hook de pre-commit nem config de CI',
    };
  }

  private checkRepoHygiene(): HarnessCheckResult {
    const ok = this.probe.exists('.gitignore');
    return {
      id: 'repo_hygiene',
      pillar: 'Higiene de repo',
      ok,
      detail: ok ? '.gitignore presente' : 'Sem .gitignore',
    };
  }
}

/** Probe de filesystem real, ancorado em `repoPath`. */
export function defaultHarnessProbe(repoPath: string): HarnessFsProbe {
  return {
    exists: (rel) => existsSync(join(repoPath, rel)),
    isDirectory: (rel) => {
      const p = join(repoPath, rel);
      return existsSync(p) && statSync(p).isDirectory();
    },
    listFiles: (rel) => {
      const p = join(repoPath, rel);
      if (!existsSync(p) || !statSync(p).isDirectory()) return [];
      return readdirSync(p);
    },
  };
}

/** Monta a mensagem de diagnóstico + remediação da §16.3. */
export function harnessRemediationMessage(report: HarnessReport): string {
  const falhas = report.failures.map((f) => `    - ${f}`).join('\n');
  return [
    '❌ Repo não está harness-ready.',
    '',
    '  Falhas:',
    falhas,
    '',
    '  Para corrigir, instale e rode kairos-forge no projeto:',
    '    /plugin install kairos-forge@kairos-forge',
    '    /kairos-forge:onboardar',
    '',
    '  Ou, para domínios regulados:',
    '    /plugin install kairos-ai@kairos-ai',
    '    /kairos:iniciar',
  ].join('\n');
}

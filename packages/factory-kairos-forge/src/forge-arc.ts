import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  ARC_CONTRACT_MAJOR,
  type ArcPort,
  type ArcState,
  isArcContractSupported,
} from '@kairos-symphony/core';

const run = promisify(execFile);

/** Saída de `ciclo.py estado --json` — contrato `kairos-forge/ciclo` v1 (ADR-0034). */
interface CicloJson {
  contrato?: string;
  spec?: string;
  estado?: string;
  terminal?: boolean;
  aguardando_humano?: boolean;
  gate?: string | null;
  proximo_passo?: string;
  resultados_validos?: string[];
  motivo_escalacao?: string;
  motivo_encerramento?: string;
}

export interface ForgeArcOpts {
  /** Diretório `scripts/` do Forge (de `factory.scriptsDir()`). */
  scriptsDir: string;
  /** Interpretador Python. Default `python3`. */
  python?: string;
  /** Teto de tempo da leitura, em ms. Default 15s. */
  timeoutMs?: number;
  /** Aviso estruturado; opcional. */
  onWarn?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Lê o arco do kairos-forge chamando `ciclo.py estado --json`.
 *
 * Duas decisões deliberadas:
 *
 * **Chama o script em vez de ler `.agents/ciclo/<spec>.json`.** O JSON em disco é
 * interno e pode mudar; `estado --json` é o contrato versionado e é a camada que
 * absorve mudança. Ler o arquivo direto seria acoplar ao que ninguém prometeu.
 *
 * **Recusa contrato de major diferente.** Campos com o mesmo nome e semântica trocada
 * são o pior modo de falha possível — melhor degradar para o caminho antigo do que
 * decidir errado com convicção.
 */
export class ForgeArc implements ArcPort {
  constructor(private readonly opts: ForgeArcOpts) {}

  /** `true` se o `ciclo.py` existe onde deveria. */
  disponivel(): boolean {
    return existsSync(this.cicloPath());
  }

  private cicloPath(): string {
    return join(this.opts.scriptsDir, 'ciclo.py');
  }

  async read(workspacePath: string): Promise<ArcState | null> {
    if (!this.disponivel()) return null;

    let stdout: string;
    try {
      const res = await run(this.opts.python ?? 'python3', [this.cicloPath(), 'estado', '--json'], {
        cwd: workspacePath,
        timeout: this.opts.timeoutMs ?? 15_000,
        encoding: 'utf8',
      });
      stdout = res.stdout;
    } catch {
      // Exit != 0 é o caminho normal para "nenhum ciclo aberto" — a issue não é
      // conduzida pelo arco. Não é erro, é ausência.
      return null;
    }

    let raw: CicloJson;
    try {
      raw = JSON.parse(stdout) as CicloJson;
    } catch {
      this.opts.onWarn?.('arco: saída de `ciclo.py estado --json` não é JSON', {
        workspace: workspacePath,
      });
      return null;
    }

    const versao = raw.contrato;
    if (!versao || !isArcContractSupported(versao)) {
      this.opts.onWarn?.(
        `arco: contrato '${versao ?? 'ausente'}' incompatível — este daemon entende major ${ARC_CONTRACT_MAJOR}. Degradando para o caminho anterior em vez de interpretar campo com semântica trocada.`,
        { workspace: workspacePath, contrato: versao },
      );
      return null;
    }

    if (typeof raw.estado !== 'string' || typeof raw.terminal !== 'boolean') {
      this.opts.onWarn?.('arco: campos obrigatórios ausentes na saída do contrato', {
        workspace: workspacePath,
      });
      return null;
    }

    const state: ArcState = {
      contrato: versao,
      spec: raw.spec ?? '?',
      estado: raw.estado,
      terminal: raw.terminal,
      aguardandoHumano: raw.aguardando_humano === true,
      gate: raw.gate ?? null,
      proximoPasso: raw.proximo_passo ?? '',
      resultadosValidos: Array.isArray(raw.resultados_validos) ? raw.resultados_validos : [],
    };
    if (raw.motivo_escalacao) state.motivoEscalacao = raw.motivo_escalacao;
    if (raw.motivo_encerramento) state.motivoEncerramento = raw.motivo_encerramento;
    return state;
  }
}

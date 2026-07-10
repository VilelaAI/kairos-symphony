import type { AgentProcess, CliPort, SpawnOpts } from '@kairos-symphony/core'
import type {
  HarnessInvokeOptions,
  HarnessResult,
  HarnessRunnerDeps,
} from '@kairos.ai/runtime/harness'
import { createHarnessRunner } from '@kairos.ai/runtime/harness'

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_TURNS = 30

export interface RuntimeHarnessCliOptions {
  timeoutMs?: number
  maxTurns?: number
  maxBudgetUsd?: number
  /** Injeta deps no harness runner (testes). */
  harnessDeps?: HarnessRunnerDeps
}

function mapPermissionMode(
  mode: SpawnOpts['permissionMode'],
): HarnessInvokeOptions['permissionMode'] {
  switch (mode) {
    case 'plan':
      return 'plan'
    case 'auto':
      return 'auto'
    case 'bypass':
      return 'auto'
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

/**
 * CliPort que delega spawn ao `runtime.harness()` (SPEC-E009 HAR-09).
 * Emite stdout via onData (stall detection + terminal.log) e suporta kill().
 */
export class RuntimeHarnessCli implements CliPort {
  constructor(private readonly options: RuntimeHarnessCliOptions = {}) {}

  spawn(opts: SpawnOpts): AgentProcess {
    const abort = new AbortController()
    let dataHandler: ((chunk: string) => void) | null = null
    let exitHandler: ((exitCode: number, signal: string | null) => void) | null = null
    const pendingChunks: string[] = []
    let pendingExit: { exitCode: number; signal: string | null } | null = null
    let finished = false

    const emitChunk = (chunk: string) => {
      if (dataHandler) dataHandler(chunk)
      else pendingChunks.push(chunk)
    }

    const emitExit = (exitCode: number, signal: string | null) => {
      if (finished) return
      finished = true
      pendingExit = { exitCode, signal }
      if (exitHandler) exitHandler(exitCode, signal)
    }

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxTurns = this.options.maxTurns ?? DEFAULT_MAX_TURNS
    const binPath = opts.binaryPath || 'claude'

    void (async () => {
      emitChunk('[kairos-harness] iniciando execução…\n')

      try {
        const runner = createHarnessRunner({
          ...this.options.harnessDeps,
          binPaths: {
            'claude-code': binPath,
            ...(this.options.harnessDeps?.binPaths ?? {}),
          },
          defaults: {
            provider: 'claude-code',
            maxTurns,
            timeoutMs,
            ...(this.options.maxBudgetUsd != null
              ? { maxBudgetUsd: this.options.maxBudgetUsd }
              : {}),
            ...(this.options.harnessDeps?.defaults ?? {}),
          },
        })

        const invokeOpts: HarnessInvokeOptions = {
          prompt: opts.prompt,
          cwd: opts.cwd,
          provider: 'claude-code',
          permissionMode: mapPermissionMode(opts.permissionMode),
          timeoutMs,
          maxTurns,
          signal: abort.signal,
          onStdout: emitChunk,
          meta: { symphonyCli: 'runtime-harness' },
        }
        if (opts.env) invokeOpts.env = opts.env
        if (this.options.maxBudgetUsd != null) {
          invokeOpts.maxBudgetUsd = this.options.maxBudgetUsd
        }

        const result: HarnessResult = await runner.run(invokeOpts)

        if (result.text && result.text.length > 0) {
          emitChunk(result.text.endsWith('\n') ? result.text : `${result.text}\n`)
        }

        emitExit(result.isError ? 1 : 0, null)
      } catch {
        emitExit(1, null)
      }
    })()

    return {
      pid: process.pid,
      onData(handler) {
        dataHandler = handler
        for (const chunk of pendingChunks) handler(chunk)
        pendingChunks.length = 0
      },
      onExit(handler) {
        exitHandler = handler
        if (pendingExit) handler(pendingExit.exitCode, pendingExit.signal)
      },
      kill(_signal) {
        if (!finished) abort.abort()
      },
    }
  }
}

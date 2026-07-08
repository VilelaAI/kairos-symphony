import type { AgentProcess, CliPort, SpawnOpts } from '@kairos-symphony/core'
import type { HarnessInvokeOptions, HarnessResult } from '@kairos.ai/runtime/harness'
import { createHarnessRunner } from '@kairos.ai/runtime/harness'

function mapPermissionMode(
  mode: SpawnOpts['permissionMode'],
): HarnessInvokeOptions['permissionMode'] {
  switch (mode) {
    case 'plan':
      return 'plan'
    case 'auto':
      return 'auto'
    case 'bypass':
      // Harness não tem 'bypass'; degradar para 'auto' mantém execução.
      return 'auto'
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

export class RuntimeHarnessCli implements CliPort {
  spawn(opts: SpawnOpts): AgentProcess {
    let dataHandler: ((chunk: string) => void) | null = null
    let exitHandler: ((exitCode: number, signal: string | null) => void) | null = null
    let pendingText: string | null = null
    let pendingExit:
      | {
          exitCode: number
          signal: string | null
        }
      | null = null

    const runPromise = (async () => {
      try {
        const runner = createHarnessRunner()
        const result: HarnessResult = await runner.run({
          prompt: opts.prompt,
          cwd: opts.cwd,
          provider: 'claude-code',
          maxTurns: 30,
          maxBudgetUsd: undefined,
          permissionMode: mapPermissionMode(opts.permissionMode),
          timeoutMs: undefined,
          tools: undefined,
          schema: undefined,
          env: opts.env,
        })

        pendingText = result.text
        if (dataHandler) dataHandler(pendingText)

        pendingExit = { exitCode: result.isError ? 1 : 0, signal: null }
        if (exitHandler) exitHandler(pendingExit.exitCode, pendingExit.signal)
      } catch (err) {
        pendingExit = { exitCode: 1, signal: null }
        if (exitHandler) exitHandler(pendingExit.exitCode, pendingExit.signal)
      }
    })()

    // Sem PTY no slice HAR-09 (adapter). `pid` é best-effort.
    return {
      pid: 0,
      onData(h) {
        dataHandler = h
        if (pendingText) dataHandler(pendingText)
      },
      onExit(h) {
        exitHandler = h
        if (pendingExit) exitHandler(pendingExit.exitCode, pendingExit.signal)
        void runPromise
      },
      kill() {
        // Best-effort (slice inicial). Runtime/harness ainda não plumbou abort/cancel.
      },
    }
  }
}


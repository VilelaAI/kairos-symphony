import { describe, expect, it, vi } from 'vitest'
import type { HarnessProvider, HarnessProviderRawResult } from '@kairos.ai/runtime/harness'
import { RuntimeHarnessCli } from './runtime-harness-cli.js'

function mockProvider(
  impl: (opts: { onStdoutChunk?: (c: string) => void }) => Promise<HarnessProviderRawResult>,
): HarnessProvider {
  return {
    name: 'claude-code',
    execute: vi.fn((opts) => impl(opts)),
  }
}

describe('RuntimeHarnessCli — SPEC-E009 HAR-09', () => {
  it('emite chunks via onData e exit 0 em sucesso', async () => {
    const cli = new RuntimeHarnessCli({
      harnessDeps: {
        providerOverride: mockProvider(async ({ onStdoutChunk }) => {
          onStdoutChunk?.('progress\n')
          return {
            result: 'feito',
            numTurns: 1,
            isError: false,
            failureType: 'none',
          }
        }),
      },
    })

    const chunks: string[] = []
    let exitCode = -1

    await new Promise<void>((resolve) => {
      const proc = cli.spawn({
        binaryPath: 'claude',
        cwd: '/tmp',
        prompt: 'fix bug',
        permissionMode: 'auto',
      })
      proc.onData((c) => chunks.push(c))
      proc.onExit((code) => {
        exitCode = code
        resolve()
      })
    })

    expect(chunks.join('')).toContain('[kairos-harness] iniciando')
    expect(chunks.join('')).toContain('progress')
    expect(chunks.join('')).toContain('feito')
    expect(exitCode).toBe(0)
  })

  it('kill() aborta e emite exit != 0', async () => {
    const cli = new RuntimeHarnessCli({
      harnessDeps: {
        providerOverride: mockProvider(async ({ onStdoutChunk, signal }) => {
          return new Promise((resolve) => {
            onStdoutChunk?.('slow…\n')
            const timer = setTimeout(() => {
              resolve({
                result: 'tarde',
                numTurns: 1,
                isError: false,
                failureType: 'none',
              })
            }, 5_000)
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                resolve({
                  result: '',
                  numTurns: 0,
                  isError: true,
                  errorMessage: 'Harness abortado',
                  failureType: 'crash',
                })
              },
              { once: true },
            )
          })
        }),
      },
    })

    let exitCode = 0
    await new Promise<void>((resolve) => {
      const proc = cli.spawn({
        binaryPath: 'claude',
        cwd: '/tmp',
        prompt: 'long task',
        permissionMode: 'bypass',
      })
      proc.onExit((code) => {
        exitCode = code
        resolve()
      })
      proc.kill('SIGTERM')
    })

    expect(exitCode).toBe(1)
  })
})

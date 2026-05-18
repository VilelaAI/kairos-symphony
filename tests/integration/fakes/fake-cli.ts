import type { AgentProcess, CliPort, SpawnOpts } from '@kairos-symphony/core';

interface FakeProcess extends AgentProcess {
  emit(chunk: string): void;
  finish(exitCode: number, signal?: string | null): void;
}

export class FakeCli implements CliPort {
  spawned: FakeProcess[] = [];
  lastOpts: SpawnOpts | null = null;

  spawn(opts: SpawnOpts): AgentProcess {
    this.lastOpts = opts;
    const dataHandlers: Array<(c: string) => void> = [];
    const exitHandlers: Array<(c: number, s: string | null) => void> = [];
    const proc: FakeProcess = {
      pid: 99999 + this.spawned.length,
      onData(h) {
        dataHandlers.push(h);
      },
      onExit(h) {
        exitHandlers.push(h);
      },
      kill(_signal) {
        for (const h of exitHandlers) h(143, 'SIGTERM');
      },
      emit(chunk) {
        for (const h of dataHandlers) h(chunk);
      },
      finish(exitCode, signal = null) {
        for (const h of exitHandlers) h(exitCode, signal);
      },
    };
    this.spawned.push(proc);
    return proc;
  }

  last(): FakeProcess {
    const p = this.spawned[this.spawned.length - 1];
    if (!p) throw new Error('Nenhum processo spawned');
    return p;
  }
}

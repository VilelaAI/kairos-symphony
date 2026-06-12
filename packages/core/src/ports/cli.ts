export interface SpawnOpts {
  binaryPath: string;
  cwd: string;
  prompt: string;
  permissionMode: 'plan' | 'auto' | 'bypass';
  env?: Record<string, string>;
  ptyCols?: number;
  ptyRows?: number;
  /**
   * Nomes de variáveis de ambiente que NÃO devem ser herdadas pelo processo do
   * agente (§12) — ex.: o token do tracker. Somado aos padrões de segredo do
   * sandbox de env.
   */
  redactEnvKeys?: string[] | undefined;
}

export interface AgentProcess {
  pid: number;
  onData(handler: (chunk: string) => void): void;
  onExit(handler: (exitCode: number, signal: string | null) => void): void;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}

export interface CliPort {
  spawn(opts: SpawnOpts): AgentProcess;
}

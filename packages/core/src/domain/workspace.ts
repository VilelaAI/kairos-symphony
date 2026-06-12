export interface WorkspaceInfo {
  issueId: string;
  path: string;
  branchName: string;
  baseBranch: string;
  terminalLogPath: string;
  /**
   * Arquivo de heartbeat cooperativo (§8.1). O agente atualiza o mtime deste
   * arquivo periodicamente; o supervisor o combina com o silêncio do PTY para
   * distinguir "pensando" (vivo) de "travado" (stall).
   */
  heartbeatPath: string;
}

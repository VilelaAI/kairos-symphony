/**
 * Sandbox de ambiente do processo do agente (§12).
 *
 * O processo do agente NÃO deve herdar segredos do daemon — em especial o token
 * do tracker (que o daemon usa para falar com o GitHub) e quaisquer variáveis
 * que aparentem conter credenciais. Sem isso, um `printenv` dentro do agente (ou
 * um agente comprometido por prompt injection a partir de uma issue maliciosa)
 * vazaria o token do tracker.
 *
 * Isolamento de SO mais forte (cgroups/namespaces/container) é responsabilidade
 * da unidade de deploy (systemd/container) no modelo local-first — ver §1.1.
 */

const DEFAULT_DENY_PATTERNS: ReadonlyArray<RegExp> = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /authorization/i,
  /_key$/i,
  /credential/i,
];

export interface SanitizeEnvOpts {
  /** Nomes exatos de variáveis a remover (ex.: o nome da env do token do tracker). */
  denyKeys?: ReadonlyArray<string>;
  /**
   * Nomes exatos a SEMPRE preservar, mesmo que casem com um padrão de segredo —
   * as credenciais que o próprio CLI do agente precisa (ex.: `ANTHROPIC_API_KEY`).
   * `denyKeys` tem precedência sobre `allowKeys`.
   */
  allowKeys?: ReadonlyArray<string>;
  /** Padrões adicionais de nome a remover (somados aos padrões default de segredo). */
  denyPatterns?: ReadonlyArray<RegExp>;
}

/**
 * Retorna uma cópia de `source` sem as variáveis sensíveis. Valores `undefined`
 * são descartados (o env de um processo é sempre `Record<string,string>`).
 *
 * Precedência: `denyKeys` > `allowKeys` > padrões de segredo > manter.
 */
export function sanitizeAgentEnv(
  source: Record<string, string | undefined>,
  opts: SanitizeEnvOpts = {},
): Record<string, string> {
  const denyKeys = new Set(opts.denyKeys ?? []);
  const allowKeys = new Set(opts.allowKeys ?? []);
  const patterns = [...DEFAULT_DENY_PATTERNS, ...(opts.denyPatterns ?? [])];
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (denyKeys.has(key)) continue;
    if (allowKeys.has(key)) {
      out[key] = value;
      continue;
    }
    if (patterns.some((re) => re.test(key))) continue;
    out[key] = value;
  }
  return out;
}

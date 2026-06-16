# M3 — Segurança & Observabilidade: design

**Data:** 2026-06-12
**Status:** Implementado
**Cobre:** terceiro milestone da implementação do `kairos-symphony`, cobrindo §13.2
(endpoints e métricas) e a camada de sandbox de §12. Ver [design do M1](2026-05-14-m1-walking-skeleton-design.md), §1.

---

## 1. Escopo

| Item | Entrega |
|---|---|
| `/healthz` + `/metrics` (§13.2) | servidor HTTP local-first opcional |
| Métricas Prometheus (§13.2) | `MetricsRegistry` com as 4 séries mínimas |
| Audit log exportável (§13.2) | `listTransitions` + comando `symphony audit` |
| Sandbox do processo do agente (§12) | `sanitizeAgentEnv` (env do agente sem segredos do daemon) |

Fora do M3: harness-readiness (M4), loop autônomo (M5).

---

## 2. Endpoints e métricas (§13.2)

- **Servidor HTTP** (`packages/daemon/src/observability/server.ts`) usando só o
  módulo `http` nativo — sem dependências novas. Rotas: `GET /healthz` (200
  `{"status":"ok"}`) e `GET /metrics` (exposição Prometheus). Bind em
  `127.0.0.1` por default; **não exposto à rede** (operação remota é da
  platform, §1.1). Opcional: só sobe com `observability.metrics.enabled`.
- **`MetricsRegistry`** (`packages/core/src/services/metrics.ts`): registro em
  memória, renderiza no formato de exposição Prometheus 0.0.4. Séries mínimas
  exigidas pela §13.2:
  - `symphony_issues_in_state{state}` — gauge lido sob demanda do store no scrape.
  - `symphony_dispatches_total` — counter (Daemon.dispatch).
  - `symphony_crashes_total{agent}` — counter (AgentSupervisor em crash/spawn-fail).
  - `symphony_dispatch_duration_seconds` — histogram (do 1º start ao estado terminal).
- **Interface `MetricsSink`** desacopla os serviços do core do registro concreto;
  o sink é opcional (sem métricas → no-op).

## 3. Audit log exportável (§13.2)

As transições já eram persistidas (tabela `transitions`, append-only, M1). O M3
adiciona consulta e exportação:

- `SqliteStateStore.listTransitions(issueId?)` — método concreto (não no port),
  consumido pela CLI.
- `symphony audit [--issue <id>] [--format json|csv]` — despeja o histórico em
  JSON line-delimited (default) ou CSV. Opera só sobre o SQLite, sem IPC (§1.1).

## 4. Sandbox de ambiente do agente (§12)

**Problema.** Até o M2, o adapter do Claude Code passava `{...process.env}` ao
PTY — vazando o **token do tracker** (que o daemon usa para o GitHub) e qualquer
outro segredo do host ao processo do agente. Um prompt malicioso numa issue
poderia induzir o agente a exfiltrar `printenv`.

**Solução.** `sanitizeAgentEnv(source, { denyKeys, allowKeys, denyPatterns })`
(`packages/core/src/services/agent-env.ts`):

- Remove `denyKeys` (o nome da env do token do tracker, vindo de
  `cfg.tracker.token_env`).
- Remove variáveis cujo nome casa com padrões de segredo (`token`, `secret`,
  `password`, `api_key`, `authorization`, `_key`, `credential`).
- **Preserva** `allowKeys` — as credenciais que o próprio CLI precisa para falar
  com o modelo. Cada adapter declara as suas (`ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, … no Claude Code). Precedência: deny > allow > padrões.

**Limite honesto.** Isolamento de SO forte (cgroups/namespaces/container) **não**
é feito em-processo: no modelo local-first (§1.1) isso é responsabilidade da
unidade de deploy (systemd com `ProtectHome`/`PrivateTmp`, ou container). A
contribuição do Symphony é a sanitização de env + worktree isolada (M1) +
`permission_mode` do CLI.

---

## 5. Testes

- **Unit:** `MetricsRegistry` (séries, histograma cumulativo, formato);
  `sanitizeAgentEnv` (deny/allow/patterns/undefined); `SqliteStateStore`
  (`countByState`, `listTransitions`).
- **Daemon:** `observability/server.test.ts` — `/healthz`, `/metrics` e 404 via
  HTTP real.
- **Conformance:** `spec-13-2-endpoints-metrics` (séries Prometheus + audit log)
  e `spec-12-security` estendido (sandbox de env).

Suíte total após M3: **131 testes** em 36 arquivos, lint e typecheck verdes.

---

## 6. Próximo

M4 — Harness-readiness (§16): validação de repo agent-ready no startup,
re-validação periódica, exit != 0 em repo não-pronto e flag `--skip-harness-check`.

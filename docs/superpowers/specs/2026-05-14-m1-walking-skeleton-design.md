# M1 — Walking Skeleton: design

**Data:** 2026-05-14
**Status:** Aprovado para writing-plans
**Cobre:** primeira implementação do `kairos-symphony`, recortando um subset funcional end-to-end da SPEC v0.4.0-draft.

---

## 1. Contexto e decomposição

A SPEC v0.3 (arquivo `SPEC.md`, 18 seções) é grande demais para um único spec de implementação. Foi decomposta em 5 milestones que somam = SPEC inteira:

| # | Milestone | Cobre |
|---|---|---|
| **M1** | **Walking skeleton** *(este documento)* | Subset mínimo de §§2-7, 10, 11 + reconciliação completa §9.1 + observabilidade §13.1 + segurança mínima §12 |
| M2 | Confiabilidade | heartbeat cooperativo, cenários complexos de reconciliação remanescentes, hardening do spawn de PTY |
| M3 | Segurança & observabilidade ampla | `/healthz`, `/metrics` Prometheus, audit log estruturado, sandbox forte |
| M4 | Harness-readiness | §16 completo (check no startup + re-validação + override) |
| M5 | Loop autônomo por issue | §17 completo (checkpoint, label `iterate:loop`, max-iterations, adapter per-CLI) |

Após M5, a implementação fecha conformidade v0.3 da SPEC.

---

## 2. Escopo do M1

### 2.1 Dentro

- **Linguagem:** TypeScript (Node ≥ 22.5)
- **Estrutura:** monorepo pnpm workspaces
- **Tooling:** vitest (testes), biome (lint+format), tsx (dev runtime)
- **Tracker:** GitHub apenas (`@octokit/rest`)
- **CLI:** Claude Code apenas, spawn via `node-pty`, modo de permissão `bypass` (configurável)
- **Fábrica:** `kairos-forge` (lê agentes `.md` do filesystem do plugin)
- **Loop principal:** poll → reconcile → dispatch → monitor → cleanup
- **Roteamento:** completo (default + label `agent:<id>` + `routing.rules` por tipo)
- **Workspace:** git worktree, branch `symphony/<issue_id>`
- **Detecção de PR:** polling GitHub (auto-link `Closes #N` no corpo + branch convention `symphony/<issue_id>`)
- **Stall:** ausência de output no PTY > `stall_timeout_ms`
- **Crash:** exit code != 0 ou exit 0 sem PR detectado (~30s de janela)
- **Retry:** backoff exponencial `[60_000, 240_000, 960_000]` ms (1min, 4min, 16min), máx 3
- **Reconciliação:** todos os 6 cenários §9.1 + comando `symphony reconcile --dry-run`
- **Persistência:** SQLite via `better-sqlite3`, WAL mode, schema versionado
- **Logs:** JSON line-delimited, PT-BR nas mensagens, redaction de tokens
- **Stream PTY:** `<workspace>/.symphony/terminal.log` por agente
- **CLI bin:** `symphony start`, `symphony reconcile [--dry-run]`, `symphony attach <issue_id>`, `symphony ps`
- **Segurança §12:** validação path traversal de workspace, rejeição prompt > 1MB, tokens nunca logados, branch própria sempre (nunca direct push a main)
- **Configuração:** YAML + env `SYMPHONY_*` + CLI flags (precedência: flags > env > YAML)

### 2.2 Fora (vai para M2-M5+)

- **M2:** heartbeat cooperativo, cenários de reconciliação que requerem heurística mais profunda (estado interno perdido com reconstrução do tracker)
- **M3:** `/healthz`, `/metrics` Prometheus, audit log estruturado adicional, sandbox cgroups/container
- **M4:** harness-readiness check (§16)
- **M5:** loop autônomo por issue (§17)
- **v0.4+:** multi-CLI (Codex, OpenCode), multi-tracker (GitLab, Jira, Linear), webhook receiver

### 2.3 Definition of Done

1. **Demo manual passa** (roteiro em `docs/M1-DEMO.md`): operador roda daemon, cria issue `ready` no GitHub, vê dispatch real do Claude Code em worktree, vê PR aparecer, vê transição para `review_pending`.
2. **Suite vitest passa** com cobertura ≥ 85% em `core/`, ≥ 70% em adapters, ≥ 50% em `daemon/`.
3. **Suite de conformidade passa** validando os MUSTs da SPEC nas seções cobertas pelo M1 (mapeamento por arquivo em `tests/conformance/spec-§NN-*.test.ts`).

---

## 3. Arquitetura

### 3.1 Diagrama de dependências entre pacotes

```
        ┌──────────────┐
        │   daemon/    │  bin: parse args, carrega config, wiring DI
        └───┬─────┬────┘
            │     │
            ▼     ▼
   ┌─────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
   │ adapter-github  │  │  cli-claude-code     │  │ factory-kairos-forge │
   │ (TrackerPort)   │  │  (CliPort)           │  │ (FactoryPort)        │
   └────────┬────────┘  └──────────┬───────────┘  └──────────┬───────────┘
            │                      │                         │
            └────────┬─────────────┴─────────────┬───────────┘
                     ▼                           ▼
                ┌─────────────────────────────────────────┐
                │              core/                      │
                │  ports/      domain/      services/     │
                └─────────────────────────────────────────┘
```

Regra: **adapters dependem do core; core não conhece adapters.** O wiring (instanciar adapter concreto e passar para o serviço do core) acontece só no `daemon/` bin.

### 3.2 Pacotes (workspaces pnpm)

| Pacote | Responsabilidade | Não conhece |
|---|---|---|
| `@kairos-symphony/core` | Tipos do domínio, ports (interfaces), serviços (Daemon, AgentSupervisor, Reconciler, WorkspaceManager, PromptBuilder, Logger, StateStore SQLite) | nenhum adapter |
| `@kairos-symphony/adapter-github` | `TrackerPort` via Octokit | outros ports |
| `@kairos-symphony/cli-claude-code` | `CliPort` via node-pty | tracker, factory |
| `@kairos-symphony/factory-kairos-forge` | `FactoryPort` (lê `.md` do plugin do Forge no filesystem) | tracker, cli |
| `@kairos-symphony/daemon` | Bin `symphony` (citty), config loader, wiring, comandos auxiliares | nada (consome todos) |

### 3.3 Ports (interfaces no `core/ports/`)

```ts
interface TrackerPort {
  fetchIssuesByState(state: IssueState): Promise<Issue[]>
  transitionState(issueId: string, to: IssueState, reason: string): Promise<void>
  detectLinkedPR(issueId: string): Promise<PullRequestRef | null>
  isIssueClosed(issueId: string): Promise<boolean>
  isPRMerged(prNumber: number): Promise<boolean>
}

interface CliPort {
  spawn(opts: SpawnOpts): AgentProcess  // handle síncrono com stream PTY
}

interface FactoryPort {
  loadAgent(id: AgentId): Promise<AgentDescriptor>
  listAgents(): Promise<AgentId[]>
}

interface StateStore {
  upsertIssue(record: IssueRecord): void
  getIssue(issueId: string): IssueRecord | null
  listActiveIssues(): IssueRecord[]
  listInState(state: IssueState): IssueRecord[]
  recordTransition(t: Transition): void
  recordDispatch(d: Dispatch): void
}

interface Clock {
  now(): Date
  setTimeout(fn: () => void, ms: number): TimerHandle
  clearTimeout(h: TimerHandle): void
}
```

`Clock` é port para permitir `FakeClock` em testes (avançar tempo sem esperar).

### 3.4 Serviços principais (em `core/services/`)

- **`Daemon`** — orquestrador único, dono do loop principal e do `Map<issueId, AgentSupervisor>`
- **`AgentSupervisor`** — uma instância por agente vivo; máquina de estado interna (`spawning → running → terminating → done|crashed|stalled`); encapsula PTY handle, watch de output, timer de stall, retry counter
- **`Reconciler`** — aplica os 6 cenários §9.1 a cada poll; logs `event: state_reconciled` com evidência
- **`WorkspaceManager`** — `git worktree add/remove`, validação path traversal, descoberta de orphans em disco
- **`PromptBuilder`** — monta prompt §6 a partir de issue + agente + workspace; valida tamanho < 1MB
- **`Logger`** — JSON line, PT-BR, redaction
- **`SqliteStateStore`** — implementação `StateStore`

### 3.5 Wiring no `daemon/`

```ts
// pseudocódigo do main
const cfg = loadConfig(args)
const tracker = new GithubTracker({ token: env(cfg.tracker.token_env), repo: cfg.tracker.repo })
const cli = new ClaudeCodeCli({ binary: cfg.cli.binary_path, permissionMode: cfg.cli.permission_mode })
const factory = new KairosForgeFactory({ installation: cfg.factory.installation })
const store = new SqliteStateStore({ path: cfg.storage.path })
const clock = new SystemClock()
const log = new Logger(cfg.logging)
const daemon = new Daemon({ tracker, cli, factory, store, clock, log, cfg })

await daemon.start()
```

Sem container DI — construção manual basta.

---

## 4. Fluxos principais

### 4.1 Loop principal (`Daemon.tick()`, intervalo `poll_interval_ms`)

```
tick():
  reconciler.run()                     // §9.1: aplica os 6 cenários

  ready = tracker.fetchIssuesByState("ready")
  for issue in ready:
    if supervisors.has(issue.id): continue
    if supervisors.size >= concurrent_agent_limit: break
    dispatch(issue)

  for sup in supervisors.values():
    sup.tick()                          // checa stall, crash, PR — não bloqueia

  done = tracker.fetchIssuesByState("done")
  for issue in done:
    workspaceManager.cleanup(issue.id)
    store.markDone(issue.id)
```

### 4.2 Dispatch (`Daemon.dispatch(issue)`)

```
dispatch(issue):
  agentId = router.route(issue, cfg.routing)         // label > rules > default
  agent = factory.loadAgent(agentId)
  workspace = workspaceManager.create(issue.id)
  prompt = promptBuilder.build({issue, agent, workspace})
  validatePromptSize(prompt)                          // §12 MUST
  correlationId = uuid()
  store.upsertIssue({ ..., correlationId, state: "in_progress", startedAt })
  store.recordTransition({ from: "ready", to: "in_progress", reason: "symphony dispatched", correlationId })
  tracker.transitionState(issue.id, "in_progress", "symphony dispatched")
  sup = new AgentSupervisor({ issue, agent, workspace, prompt, correlationId, deps... })
  supervisors.set(issue.id, sup)
  sup.start()
```

### 4.3 AgentSupervisor — máquina de estado interna

```
states: idle → spawning → running → terminating → done | crashed | stalled

start():
  proc = cli.spawn({ prompt, cwd: workspace.path, permissionMode })
  proc.onData(chunk => {
    terminalLog.append(chunk)              // §13.1
    lastOutputAt = clock.now()
  })
  proc.onExit(code => onProcessExit(code))
  state = "running"

tick():                                     // chamado pelo Daemon.tick()
  if state != "running": return
  if (clock.now() - lastOutputAt) > stall_timeout_ms: return onStall()
  pr = trackerCache.detectLinkedPR(issue.id)   // TTL ~5s
  if pr: return onPRDetected(pr)

onStall():
  log.warn({ event: "agent_stalled", issueId, lastOutputAt })
  proc.kill("SIGTERM"); after 5s grace: SIGKILL
  scheduleRetry()

onProcessExit(code):
  if code != 0:
    log.error({ event: "agent_crashed", code })
    return scheduleRetry()
  pr = await tracker.detectLinkedPR(issue.id)   // janela de até 30s
  if pr: return onPRDetected(pr)
  log.warn({ event: "agent_exited_without_pr" })
  scheduleRetry()

scheduleRetry():
  retryCount++
  if retryCount > max_retries:
    transition("blocked", "symphony:max-retries-exceeded"); cleanupSupervisor()
    // workspace preservado — operador inspeciona
    return
  delay = backoffSchedule[retryCount - 1]
  clock.setTimeout(() => start(), delay)
  state = "retrying"

onPRDetected(pr):
  store.recordPR(issue.id, pr)
  tracker.transitionState(issue.id, "review_pending", `PR #${pr.number}`)
  state = "done"
  daemon.removeSupervisor(issue.id)
```

### 4.4 Reconciler (`Reconciler.run()`)

Aplica os 6 cenários §9.1 a cada `tick`:

| Cenário | Detecção | Ação |
|---|---|---|
| Issue fechada na mão | `tracker.isIssueClosed(supervisedId)` true | Terminar supervisor, limpar workspace, marcar `done` |
| Label `ready` removida | issue saiu da lista `fetchIssuesByState("ready")` antes do dispatch | Skipar dispatch (no-op natural) |
| Label `blocked` removida | issue está `blocked` no DB mas reaparece em `ready` no tracker | Re-incluir na fila de dispatch |
| PR mergeado fora do fluxo | `tracker.isPRMerged(prNumber)` true para issue em `review_pending` | `transitionState("done", "PR merged externally")` |
| Issue editada durante execução | (sem ação — não interrompemos agente vivo; mudança aplica no próximo dispatch) | Log `event: issue_edited_during_execution`, sem ação |
| Estado interno perdido | DB vazio mas worktrees existem em disco | Log `event: orphan_workspace_detected`; NÃO auto-restartar (§9 MUST); operador resolve |

Ambiguidades vão para `blocked` com `symphony:needs-reconciliation` (§9.1 princípio 3).

### 4.5 Comando `symphony reconcile --dry-run`

Roda `Reconciler.run()` em modo no-op (port `StateStore` envolto em proxy que não persiste, port `TrackerPort` que não muta), retorna lista de divergências detectadas e o que faria, sem aplicar nada. Útil para diagnóstico antes de aplicar.

---

## 5. Persistência (SQLite)

### 5.1 Localização e configuração

- Path: `cfg.storage.path` (default: `<workspaces.root>/state.db`)
- Lib: `better-sqlite3` (síncrono, sem race com `tick`)
- Mode: WAL (`PRAGMA journal_mode=WAL`) para tolerar leitura de `symphony ps`/`attach` concorrente

### 5.2 Schema (versão 1)

```sql
CREATE TABLE issues (
  issue_id          TEXT PRIMARY KEY,            -- ex: "VilelaAI/repo#42"
  tracker_type      TEXT NOT NULL,               -- "github" no M1
  state             TEXT NOT NULL,               -- IssueState canônico
  agent_id          TEXT,
  workspace_path    TEXT,
  branch_name       TEXT,                        -- "symphony/42"
  started_at        TEXT,                        -- ISO 8601 UTC
  finished_at       TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  pr_number         INTEGER,
  correlation_id    TEXT,                        -- UUID v4 do dispatch corrente
  last_synced_at    TEXT NOT NULL,
  blocked_reason    TEXT
);
CREATE INDEX idx_issues_state ON issues(state);

CREATE TABLE transitions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id          TEXT NOT NULL,
  from_state        TEXT,
  to_state          TEXT NOT NULL,
  reason            TEXT NOT NULL,
  evidence          TEXT,                        -- JSON livre
  correlation_id    TEXT NOT NULL,
  occurred_at       TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);
CREATE INDEX idx_transitions_issue ON transitions(issue_id);

CREATE TABLE dispatches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id          TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  attempt           INTEGER NOT NULL,            -- 1, 2, 3...
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  exit_code         INTEGER,
  outcome           TEXT,                        -- "pr_opened" | "stalled" | "crashed" | "exited_no_pr"
  correlation_id    TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);

CREATE TABLE schema_meta (
  version INTEGER NOT NULL
);
INSERT INTO schema_meta (version) VALUES (1);
```

### 5.3 Convenções

- Datas armazenadas como **ISO 8601 UTC** (`TEXT`)
- Operações que mudam estado são **transações curtas** (`db.transaction(...)`)
- `last_synced_at` atualizado em cada issue tocada pelo Reconciler
- Migrations futuras: runner no startup que aplica `migrations/NN.sql` se `schema_meta.version` < esperada

### 5.4 Fora do DB

- Conteúdo do PTY stream → arquivo `terminal.log` (não DB)
- Métricas agregadas → calculadas on-the-fly (M3 expõe via Prometheus)
- Tokens, prompts brutos, conteúdo de issue → não persistidos (§12)

---

## 6. Tratamento de erros

### 6.1 Princípios

1. **Falha de uma issue ≠ falha do daemon.** Erros isolados por supervisor, não derrubam o loop.
2. **Toda falha loggada com `correlation_id`** propagado.
3. **Quando em dúvida, `blocked`** (§9.1 princípio 3) com workspace preservado.

### 6.2 Catálogo

| Categoria | Origem | Tratamento |
|---|---|---|
| Tracker rate limit | GitHub 403 + `x-ratelimit-remaining: 0` | Loga `tracker_rate_limited`, espera até `x-ratelimit-reset`, segue. |
| Tracker network/5xx | Octokit retry esgotado | Backoff `poll_interval_ms × 2` (teto 5min); volta ao normal quando responder. |
| Tracker 401 | Token inválido | Loga `tracker_auth_failed`; daemon entra em "drain" (não pega novas, deixa as ativas terminarem). |
| CLI binário não encontrado | `cli.binary_path` errado | Falha fatal no startup; mensagem clara apontando o campo. |
| Spawn PTY falha | `node-pty` retorna erro | Conta como crash daquela issue → `scheduleRetry()`. |
| Agente stall | Sem PTY output > `stall_timeout_ms` | SIGTERM → 5s grace → SIGKILL → `scheduleRetry()`. |
| Agente crash | exit code != 0 | Loga últimas 50 linhas (de `terminal.log`); `scheduleRetry()`. |
| Agente exit 0 sem PR | Saiu limpo, sem PR detectado em ~30s | `scheduleRetry()` (§8 "completion errôneo"). |
| Max retries | `retry_count > max_retries` | `transitionState("blocked", "symphony:max-retries-exceeded")`; cleanup supervisor; **workspace preservado**. |
| Workspace path traversal | `issue_id` malicioso | `WorkspaceManager.create()` recusa antes de criar. |
| Worktree create falha | branch já existe / disco cheio | `transitionState("blocked", "workspace_create_failed")`; segue para próxima. |
| Prompt > 1MB | Issue gigante | `transitionState("blocked", "prompt_too_large")` (§12 MUST). |
| Config inválida | YAML malformado / campos faltando | Falha fatal no startup com lista das chaves problemáticas. |
| Reconciler ambíguo | Cenário §9.1 sem caminho seguro | `transitionState("blocked", "symphony:needs-reconciliation")`. |
| Uncaught exception | Bug | `process.on('uncaughtException')` loga, marca ativas como `blocked: "daemon_crashed"`, persiste, exit 1. |
| SIGTERM/SIGINT | Operador / systemd | Graceful: para de aceitar novas, manda SIGTERM aos ativos com 30s timeout, persiste, exit 0. **NÃO auto-restart** no próximo start (§9 MUST). |

---

## 7. Observabilidade (M1)

### 7.1 Logger

- Formato: JSON line-delimited, uma linha por evento
- Saída: stdout (default) ou arquivo (`logging.output`)
- Idioma: PT-BR nas mensagens, nomes de campos em inglês
- Redaction: campos com nome contendo `token`, `secret`, `password`, `key`, `authorization` substituídos por `"***"`

Exemplo:

```json
{"timestamp":"2026-05-14T18:32:11.402Z","level":"info","event":"issue_dispatched","issue_id":"VilelaAI/repo#42","agent_id":"lucas-backend","correlation_id":"8f3b...","message":"Despachando agente lucas-backend para a issue VilelaAI/repo#42"}
```

### 7.2 Vocabulário canônico de eventos

```
daemon_started, daemon_shutting_down, daemon_drained
config_loaded, config_invalid
tracker_polled, tracker_rate_limited, tracker_auth_failed
issue_discovered, issue_dispatched, issue_skipped
agent_spawning, agent_running, agent_stalled, agent_crashed,
  agent_exited_without_pr, agent_retrying, agent_blocked
pr_detected, state_transitioned, state_reconciled
workspace_created, workspace_cleaned, workspace_create_failed
prompt_too_large, path_traversal_blocked
```

Vocabulário fechado, validado em testes (qualquer evento fora dessa lista é erro de teste).

### 7.3 Stream PTY (§13.1)

- Cada agente vivo escreve byte-a-byte em `<workspace>/.symphony/terminal.log`
- Truncado no início de cada dispatch (overwrite)
- Removido junto com o workspace
- Não vai pro logger JSON

### 7.4 Comandos CLI auxiliares

| Comando | O que faz |
|---|---|
| `symphony start [--config=path]` | Sobe o daemon (foreground) |
| `symphony reconcile [--dry-run]` | Roda reconciliação uma única vez |
| `symphony ps` | Lista issues em estado != done lendo o DB |
| `symphony attach <issue_id>` | `tail -f` formatado do `terminal.log` |

`ps` e `attach` operam só sobre filesystem + SQLite — sem IPC com o daemon (single-tenant local-first §1.1).

### 7.5 Correlation ID

- UUID v4 gerado em `dispatch()`, armazenado em `IssueRecord.correlation_id`
- Propagado em todos os logs e transitions daquele dispatch
- Retry mantém o **mesmo** correlation_id
- Rework (issue volta para `ready` após PR rejeitado) gera **novo** correlation_id no próximo dispatch

---

## 8. Configuração

Aceita as três fontes da SPEC §10, com precedência **flags > env > YAML**.

### 8.1 Arquivo

`kairos-symphony.config.yaml` no working directory ou path passado via `--config`.

Exemplo mínimo do M1:

```yaml
tracker:
  type: github
  repo: VilelaAI/novo-projeto
  token_env: GITHUB_TOKEN
  poll_interval_ms: 30000

cli:
  type: claude-code
  binary_path: /usr/local/bin/claude
  permission_mode: bypass

factory:
  type: kairos-forge
  installation: plugin

workspaces:
  root: /var/symphony/workspaces
  base_branch: main
  branch_naming_pattern: "symphony/{issue_id}"
  retention_days: 7

routing:
  default_agent: laura-tech-lead
  rules:
    - label: bug
      agent: lucas-backend
    - label: docs
      agent: beatriz-docs

limits:
  concurrent_agents: 5
  stall_timeout_ms: 600000
  max_retries: 3
  retry_backoff_ms: [60000, 240000, 960000]
  per_issue_timeout_ms: 7200000
  prompt_max_size_bytes: 1048576

storage:
  type: sqlite
  path: /var/symphony/state.db

logging:
  level: info
  format: json
  output: stdout
  language: pt-BR
```

### 8.2 Validação

Esquema Zod por seção; falhas resultam em mensagem listando todas as chaves problemáticas (não fail-fast a uma só), e daemon não arranca.

### 8.3 Env override

Variáveis com prefixo `SYMPHONY_` mapeadas via `_` para profundidade:
`SYMPHONY_LIMITS_CONCURRENT_AGENTS=10` sobrescreve `limits.concurrent_agents`.

Tokens **só** via env (nunca em YAML): `tracker.token_env: GITHUB_TOKEN` indica o nome da env var, e o daemon lê `process.env[GITHUB_TOKEN]`.

---

## 9. Segurança (M1)

Cobre os MUSTs de §12 aplicáveis ao escopo do M1:

| Item | Implementação |
|---|---|
| Tokens nunca logados | Redaction no Logger por nome de campo |
| Workspace não escapa de `workspaces.root` | `WorkspaceManager.create()` valida via `path.resolve` |
| Prompt > 1MB rejeitado | `PromptBuilder.build()` lança erro tipado; dispatch trata como `prompt_too_large → blocked` |
| Conteúdo de issue não interpretado como shell | `PromptBuilder` só concatena strings; nunca faz `eval`/`spawn` com conteúdo de issue |
| Agente não acessa workspace de outra issue | `cli.spawn(cwd: workspace.path)` + worktree isolada (best-effort no M1; sandbox forte fica para M3) |
| PR sempre via branch própria, nunca direct push a main | Worktree é criada em branch `symphony/<issue_id>` derivada de `base_branch`; daemon nunca invoca `git push origin main` |

---

## 10. Testes & conformidade

### 10.1 Pirâmide

```
                   /\
                  /  \   E2E manual (demo) — não no CI
                 /────\
                / int. \  Integration (FakeTracker + FakeCli + tmpdir worktree)
               /────────\
              /   unit   \ Unit (PromptBuilder, Reconciler cenários, schema, etc.)
             ──────────────
```

### 10.2 Unitários (vitest, `*.test.ts` ao lado do arquivo)

Cobertura mínima por componente:

| Alvo | Cobre |
|---|---|
| `PromptBuilder` | Monta prompt mínimo §6, rejeita > 1MB, redaction de tokens em conteúdo |
| `Router` | Precedência label `agent:<id>` > `routing.rules` > default |
| `Reconciler` | Cada um dos 6 cenários §9.1 isolado |
| `AgentSupervisor` | Stall, crash, exit-no-pr, PR-detected, max-retries (com `FakeCli` + `FakeClock`) |
| `WorkspaceManager` | Path traversal blocked; cleanup; create idempotente |
| `SqliteStateStore` | Schema migrations; transitions append-only; consultas |
| `ConfigLoader` | YAML → env override → CLI flags; validação Zod |
| `Logger` | JSON line correto; redaction de campos sensíveis |
| `GithubAdapter` | Com `msw`/`nock`: rate-limit, 5xx, auth fail, paginação |

### 10.3 Integração (`tests/integration/`)

- `dispatch.integration.test.ts` — `ready → in_progress → review_pending` end-to-end com fakes e worktree real em tmpdir
- `stall.integration.test.ts` — FakeCli congela; FakeClock avança 11min; valida stall, kill, retry, eventualmente `blocked`
- `reconcile.integration.test.ts` — FakeTracker fecha issue durante execução; daemon termina supervisor e limpa
- `restart.integration.test.ts` — daemon roda, despacha, é morto, reinicia; reconcile detecta orphan; NÃO auto-restart (§9)

### 10.4 Conformidade (`tests/conformance/`)

Cada checkbox de §15 que o M1 cobre vira teste dedicado, organizado pela seção da SPEC:

```
tests/conformance/
├── spec-§02-states.test.ts          // 6 estados canônicos
├── spec-§03-main-loop.test.ts       // ordem dos passos do loop
├── spec-§04-workspace.test.ts       // worktree isolation, branch naming, cleanup
├── spec-§04.1-pty.test.ts           // spawn via PTY (não pipes)
├── spec-§05-routing.test.ts         // 3 precedências
├── spec-§06-prompt.test.ts          // campos mínimos do prompt; tokens fora
├── spec-§07-pr-detection.test.ts    // auto-link + branch convention
├── spec-§08-stall-crash.test.ts     // detecção, retry com backoff, max-retries
├── spec-§09-persistence.test.ts     // sobrevive restart; não auto-restart
├── spec-§09.1-reconciliation.test.ts // 6 cenários + comando --dry-run
├── spec-§10-config.test.ts          // YAML/env/flags precedência
├── spec-§11-logs.test.ts            // formato JSON, campos mínimos
├── spec-§12-security.test.ts        // path traversal, prompt > 1MB, no token logging
├── spec-§13.1-terminal-stream.test.ts // arquivo terminal.log, attach, ps
└── spec-§15-conformance-checklist.ts // tabela com PASS/FAIL por checkbox
```

Cada teste de conformidade carrega o `Daemon` real com adapters fakes — exercita a SPEC como um implementador externo faria.

### 10.5 CI (GitHub Actions, `.github/workflows/ci.yml`)

```yaml
matrix: [ubuntu-latest, macos-latest], node: [22.x]   # windows excluído por node-pty
steps:
  - pnpm install --frozen-lockfile
  - pnpm biome check
  - pnpm typecheck                    # tsc --noEmit em cada workspace
  - pnpm test --coverage              # unit + integration
  - pnpm test:conformance             # suite §15
  - upload coverage report
```

### 10.6 Metas de cobertura

- `core/` ≥ 85%
- `adapter-*/`, `cli-*/`, `factory-*/` ≥ 70%
- `daemon/` ≥ 50%

### 10.7 Demo manual

Roteiro em `docs/M1-DEMO.md`:

1. `pnpm install && pnpm build`
2. Operador cria `kairos-symphony.config.yaml` apontando para repo de teste pessoal
3. Operador cria issue no GitHub com label `symphony:ready`
4. `symphony start`
5. Em outro terminal, `symphony ps` mostra a issue em `in_progress`
6. `symphony attach <issue_id>` mostra o agente trabalhando ao vivo
7. Eventualmente, PR aparece no GitHub; daemon transiciona para `review_pending`
8. Operador merga; daemon detecta `done` no próximo poll, limpa worktree

---

## 11. Decisões importantes (resumo)

| Decisão | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript | Já decidido em `docs/decisao-arquitetural.md` |
| Estrutura | Monorepo pnpm workspaces | Roadmap prevê multi-tracker e multi-CLI; quebrar depois é retrabalho |
| Test runner | Vitest | Suporte TS nativo, mocks integrados, watch rápido |
| Lint+format | Biome | Uma ferramenta no lugar de eslint+prettier |
| Spawn | PTY (`node-pty`) desde M1 | §4.1 MUST; evita comportamento surpresa do CC sem TTY |
| Persistência | SQLite via `better-sqlite3` | Síncrona, sem race com `tick`, schema relacional |
| Stall | Proxy via PTY output silence | Sem cooperação do CLI; funciona com qualquer agente |
| Reconciliação | Completa §9.1 no M1 | DoD pediu conformidade; cenários simples para M1, ambíguos vão para `blocked` |
| Roteamento | Full (label + rules + default) | §5 inteiro inclui MUST e MAY; pequeno overhead |
| Detecção PR | Polling auto-link + branch convention | Sem endpoint público; cobre 2 dos 3 mecanismos da §7 |
| Permission mode CC | `bypass` (configurável) | Essencial para automação; isolamento via worktree |
| Modelo de execução | Supervisor por agente | Lifecycle isolado; testável; prepara M5 (loop autônomo) |

---

## 12. Próximos passos

1. Aprovação deste design pelo operador
2. Invocar skill `writing-plans` para gerar plano de implementação detalhado a partir deste design
3. Executar plano em sessão separada via `executing-plans` (com checkpoints de revisão)
4. Quando M1 entregue (DoD ✅), abrir M2 com novo brainstorm

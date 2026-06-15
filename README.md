# kairos-symphony

> Orquestrador always-on de coding agents para projetos de software.
> Issue tracker como state machine. Multi-tracker, multi-CLI, PT-BR oficial.

**Status:** 🟢 M1-M5 implementados (TypeScript/Node) — **conformidade v0.3 da SPEC fechada**: happy path end-to-end com GitHub + Claude Code + kairos-forge, heartbeat cooperativo, hardening de PTY, reconstrução de estado, `/metrics` Prometheus + `/healthz`, audit log, sandbox de env, gate de harness-readiness e loop autônomo por issue; 161 testes verdes. SPEC em `0.4.0-draft`. Veja [SPEC.md](SPEC.md), [estado da implementação](#estado-da-implementação) e [roadmap](#roadmap).

`kairos-symphony` é a camada de orquestração persistente do ecossistema KairOS. Pega os 45 agentes do [`kairos-forge`](https://github.com/VilelaAI/kairos-forge) (ou os agentes regulados do [`kairos-ai`](https://github.com/VilelaAI/kairos-ai)) e os põe pra trabalhar **continuamente** sobre um issue tracker — cada issue pega um agente dedicado, agentes rodam até o trabalho terminar, humano só revisa o resultado.

Inspirado pela [spec Symphony da OpenAI](https://openai.com/index/open-source-codex-orchestration-symphony/) (Apache 2.0, abril 2026), mas com 4 diferenças deliberadas:

| Symphony OpenAI | kairos-symphony |
|---|---|
| Linear-only | GitHub primeiro, plugins pra GitLab/Jira/Linear |
| Codex App Server (OpenAI-only) | Claude Code OU Codex OU OpenCode |
| Reference em Elixir/BEAM | Implementação em Node/TS (multiplataforma, ecossistema maior) |
| Genérico, sem persona curada | Acoplado ao Forge/kairos-ai (24+21 personas em PT-BR) |

## Por que existe

O bottleneck no uso de coding agents hoje não é a capacidade técnica do modelo — é **atenção humana**. Você abre 5 abas de Claude Code, distribui tarefas, vai em uma, esquece da outra, perde contexto, vira gerente de agentes. A OpenAI mediu isso internamente e ficou em 3-5 sessões paralelas como teto prático.

Symphony resolve flipando o modelo: **o issue tracker passa a ser a interface humano↔fábrica**. Você organiza trabalho como sempre organizou (issues, labels, milestones); o orquestrador despacha agentes; você revisa PRs prontos.

`kairos-symphony` é a versão MIT/multi-tracker dessa ideia, integrada ao ecossistema KairOS.

## Como funciona (em uma frase)

Um daemon polla seu tracker a cada N segundos, pega issues no estado `ready`, cria worktree git isolado, dispara o CLI escolhido (Claude Code / Codex / OpenCode) com prompt construído a partir da issue e do agente apropriado da fábrica, monitora o processo, atualiza o estado da issue conforme progresso. Veja [SPEC.md](SPEC.md) para o contrato formal.

## Posicionamento na camada Build do KairOS

```
┌─────────────────────────────────────────────────┐
│  kairos-symphony       ← orquestrador (este)    │
│  ─────────────────────────────────────────────  │
│  Pré-requisito CRÍTICO:                         │
│    └─ Repo precisa estar harness-ready          │
│       (instalar e validar via kairos-forge ou   │
│        kairos-ai antes de rodar o daemon)       │
│                                                 │
│  Lê personas e skills de:                       │
│    └─ kairos-forge (MIT) ou kairos-ai (PRO)     │
│       (lê os arquivos .md como dados)           │
│                                                 │
│  Executa agentes via:                           │
│    └─ Claude Code CLI (child_process)           │
│    └─ Codex CLI (child_process)                 │
│    └─ OpenCode CLI (child_process)              │
│                                                 │
│  Persiste estado em:                            │
│    └─ SQLite (default) ou Postgres              │
│                                                 │
│  Observa via (opcional, PRO):                   │
│    └─ kairos-platform                           │
└─────────────────────────────────────────────────┘
```

> **Nota crítica sobre harness:** Symphony assume **harness engineering** como pré-requisito (conceito da OpenAI, [Harness Engineering](https://openai.com/index/harness-engineering/)). Ou seja: o repo precisa ter scaffolding, convenções, ADRs versionados, AGENTS.md/CLAUDE.md, hooks de pre-commit, observability access pra agentes — tudo isso **antes** do daemon começar a despachar issues. Sem harness, agentes performam mal e Symphony amplifica o problema (gera N PRs ruins em paralelo). O `kairos-forge` é a forma recomendada de instalar o harness; `kairos-ai` é a versão regulada. Veja [§16 da SPEC](SPEC.md#16-harness-readiness-pré-requisito) para o protocolo de validação.

> **Nota:** O `kairos-runtime` (biblioteca NPM para chamadas LLM em aplicações)
> NÃO entra nesta arquitetura. Symphony spawna processos de CLI; quem faz a
> chamada à API LLM é o próprio CLI (Claude Code chama Anthropic; Codex chama
> OpenAI). Veja [docs/decisao-arquitetural.md](docs/decisao-arquitetural.md)
> para o porquê.

## O que NÃO é

- Não é UI / dashboard — é daemon CLI/headless. Observabilidade visual fica no `kairos-platform` (PRO).
- Não é replacement de issue tracker — usa o que você já tem (GitHub Issues, Linear, etc.).
- Não é runtime de agente — usa Claude Code, Codex ou OpenCode existentes.
- Não é orquestrador remoto multi-host — é **local-first**: o daemon roda no mesmo host onde você trabalha (laptop, devbox ou VPS pessoal). Sem control plane / data plane separados, sem runner distribuído. Operação remota gerenciada fica no `kairos-platform` (PRO). Ver §1.1 da [SPEC](SPEC.md).
- Não tem versão hosted/SaaS no v1 — você roda no seu VPS ou devbox.

## Estado da implementação

A SPEC `0.4.0-draft` (18 seções) foi decomposta em 5 milestones de implementação. **Os 5 estão prontos e verdes** — a implementação fecha a conformidade v0.3 da SPEC, validada por 161 testes (conformidade + integração + unitários) sobre 40 arquivos.

| Milestone | Cobre | Estado |
|---|---|---|
| **M1 — Walking skeleton** | subset de §§2-7, 10, 11 + reconciliação completa §9.1 + observabilidade §13.1 + segurança mínima §12 | ✅ **pronto** |
| **M2 — Confiabilidade** | heartbeat cooperativo (§8.1), hardening do PTY (§4.1), reconstrução de estado interno perdido (§9.1) | ✅ **pronto** |
| **M3 — Segurança & observabilidade** | `/healthz` + `/metrics` Prometheus, audit log exportável (§13.2), sandbox de env do agente (§12) | ✅ **pronto** |
| **M4 — Harness-readiness** | §16 completo (check no startup, modo validation-only/refuse, `--skip-harness-check`, re-validação → drain) | ✅ **pronto** |
| **M5 — Loop autônomo por issue** | §17 completo (checkpoint, label `iterate:loop[:N]`, frontmatter, stopping conditions, max-iterations, 1 slot) | ✅ **pronto** |

O que **já roda** (M1-M5):

- **Monorepo** pnpm workspaces (`packages/{core,adapter-github,cli-claude-code,factory-kairos-forge,daemon}`), TypeScript Node ≥ 22.5.
- **Loop principal** poll → reconcile → dispatch → monitor → cleanup, com os 6 estados canônicos da §2.
- **Tracker:** adapter GitHub (Issues + detecção de PR via `Closes #N` e convenção de branch `symphony/<issue_id>`).
- **CLI:** Claude Code via `node-pty` (PTY real, §4.1), modo de permissão configurável.
- **Fábrica:** `kairos-forge` — lê personas `.md` do filesystem do plugin para construir o prompt.
- **Roteamento:** default + label `agent:<id>` + `routing.rules` por tipo de issue.
- **Workspace:** git worktree isolado por issue, branch própria (nunca push direto na `main`).
- **Detecção de stall em dois sinais (M2):** silêncio do PTV **+** heartbeat cooperativo (`.symphony/heartbeat`) — distingue "pensando" de "travado".
- **Hardening do PTY (M2):** encerramento gracioso SIGTERM→grace→SIGKILL, falha de spawn tratada como crash, captura das últimas linhas para diagnóstico, `kill` idempotente.
- **Retry** com backoff exponencial (máx 3) em crash/stall/exit-sem-PR.
- **Persistência:** SQLite (`better-sqlite3`, WAL, schema versionado) — sobrevive a restart do daemon.
- **Reconciliação:** todos os 6 cenários da §9.1 — incluindo **reconstrução de estado interno perdido (M2)**: DB apagado/corrompido é reconstruído a partir do tracker + worktrees em disco, sem restart automático (§9). `symphony reconcile --dry-run`.
- **Observabilidade:** logs JSON line-delimited em PT-BR com redaction de tokens; stream de terminal por agente em `<workspace>/.symphony/terminal.log`.
- **Métricas & health (M3, §13.2):** servidor HTTP local-first opcional com `/healthz` e `/metrics` no formato Prometheus (`symphony_issues_in_state`, `symphony_dispatches_total`, `symphony_crashes_total`, `symphony_dispatch_duration_seconds`).
- **Audit log (M3):** histórico completo de transições em SQLite, exportável via `symphony audit [--issue <id>] [--format json|csv]`.
- **Sandbox de env (M3, §12):** o processo do agente não herda o token do tracker nem segredos do daemon; credenciais do próprio CLI passam por allowlist.
- **Harness-readiness (M4, §16):** gate no startup que valida 4 sinais no repo alvo (AGENTS.md/CLAUDE.md, ADRs, hook de pre-commit ou CI, `.gitignore`). Em repo não-pronto: diagnóstico + remediação e `refuse` (exit≠0) ou `validation_only` (sem dispatch); flag `--skip-harness-check` (modo unsafe, com warning por dispatch); re-validação periódica → modo drain.
- **Loop autônomo por issue (M5, §17):** issues em `iterate:loop[:N]` (label), config global por label ou frontmatter da descrição rodam iterativamente contra um checkpoint (`.perseguir/checkpoint.md`): `DONE` → `review_pending`, `BLOCKED:` → bloqueia, senão re-itera até `max-iterations`. Conta como **1 slot** durante todo o loop; aviso quando excede o limite de tempo.
- **Config:** YAML + env `SYMPHONY_*` + flags de CLI (precedência: flags > env > YAML), validada com Zod.

Fora do escopo atual (ver [roadmap](#roadmap)): multi-CLI (Codex, OpenCode), multi-tracker (GitLab, Jira, Linear), webhook receiver. O loop usa o mecanismo de re-spawn manual (§17.4 fallback) — integração com mecanismos nativos (ralph-loop, `/goal`) fica para o suporte multi-CLI.

### Desenvolvimento

```bash
pnpm install        # Node ≥ 22.5, pnpm ≥ 11
pnpm build          # tsc por package
pnpm test           # 161 testes (vitest)
pnpm test:conformance   # só a suíte de conformidade da SPEC
pnpm lint           # biome
pnpm typecheck
```

CI (`.github/workflows/ci.yml`) roda lint + typecheck + test + conformance em Ubuntu e macOS a cada push/PR.

## Running

Após `pnpm install && pnpm build`, o binário está em `packages/daemon/dist/bin.js`:

```bash
node packages/daemon/dist/bin.js --help
```

Subcomandos:

| Comando | Descrição |
|---|---|
| `start [--skip-harness-check]` | Sobe o daemon (foreground); valida harness-readiness (§16), faz polling, dispatch e monitoramento. Com `observability.metrics.enabled`, expõe `/healthz` e `/metrics` |
| `reconcile [--dry-run]` | Roda uma rodada de reconciliação (§9.1); com `--dry-run`, só lista divergências |
| `ps` | Lista issues ativas (estado != `done`) lendo o SQLite |
| `attach <issue_id>` | `tail -f` do terminal.log do agente daquela issue |
| `audit [--issue <id>] [--format json\|csv]` | Exporta o histórico de transições (audit log, §13.2) |

Para o roteiro end-to-end ver [docs/M1-DEMO.md](docs/M1-DEMO.md).

## Roadmap

Abaixo está o roadmap de **capacidades da SPEC** (evolução do contrato). O acompanhamento da **implementação** vai pela tabela de milestones em [Estado da implementação](#estado-da-implementação) — M1-M5 prontos (conformidade v0.3 fechada); o foco agora é v0.4+ (multi-CLI, multi-tracker).

### v0.3 — Loop autônomo por issue

- Issues podem rodar em modo loop iterativo (Ralph Loop pattern Anthropic + `/goal` OpenAI)
- Configuração via label da issue, config global ou frontmatter
- Checkpoint file por workspace para state preservation entre iterações
- Adaptação automática por CLI ativo (Claude Code/Codex/OpenCode)
- §17 da SPEC define contrato formal

### v0.4 — Multi-CLI

- Suporte Codex CLI (App Server quando disponível)
- Suporte OpenCode
- Detecção automática do CLI disponível no host
- Per-issue CLI override via label

### v0.5 — Multi-tracker

- Adapter para GitLab Issues
- Adapter para Jira
- Adapter para Linear
- Schema de adapter documentado para 3rd-party plugins

### v0.6 — Confiabilidade

- Stall detection (heartbeat por agent process)
- Retry com backoff exponencial (máx 3x)
- State persistence em SQLite local (sobrevive a restart do daemon)
- Cleanup automático de worktrees após N dias
- Métricas Prometheus opcionais

### v1.0 — Production-ready

- Documentação de deploy local-first (systemd, container único)
- Webhook receiver opcional (em vez de só polling)
- Audit log estruturado JSON
- Rotação de tokens
- Concurrent agent limit configurável

### v1.x — PRO (proprietário, parte do kairos-platform)

- Integração com advisor regulatório do `kairos-ai` para guardrails LGPD/NRs no loop autônomo
- Dashboard observabilidade no `kairos-platform`
- Deploy gerenciado em VPS Vilela
- SLA, suporte, multi-tenant

## Diferença vs `/kairos-forge:mobilizar`

| | `/kairos-forge:mobilizar` | `kairos-symphony` |
|---|---|---|
| Camada | Skill dentro de sessão CLI | Daemon persistente fora da CLI |
| Disparo | Humano invoca skill explicitamente | Polling automático do tracker |
| Vida | Termina quando a sessão fecha | Roda continuamente em devbox/VPS |
| Tarefa | Uma SPEC por vez | N issues em paralelo |
| Audiência | Dev individual | Time de eng + ops |
| Pré-requisito | Plugin instalado no CLI | Daemon instalado no host + token de tracker |

A `mobilizar` continua útil pra trabalho pontual paralelo. `symphony` é pra "agentes nunca dormem".

## Inspirações

- **[Symphony da OpenAI](https://openai.com/index/open-source-codex-orchestration-symphony/)** — pattern central (issue tracker como state machine, agents always-on, +500% PRs)
- **[Harness Engineering (OpenAI)](https://www.shortcut.com/blog/openai-harness-engineering)** — premissa de repo agent-friendly que Symphony assume
- **KairOS-OpenClaw / SPEC-AUTONOMOUS-INCLUA-V1 (Allyson Vilela, 2026)** — design original que antecipou o pattern; janela autônoma 22h-5h, 3-tier approval (verde/amarelo/vermelho), tracker como interface única

## Contribuir

Os 5 milestones de implementação estão entregues (conformidade v0.3 da SPEC fechada); o trabalho agora é evoluir para v0.4+ (multi-CLI, multi-tracker) sem quebrar a conformidade. Antes de abrir um PR:

1. Leia [SPEC.md](SPEC.md) — contrato formal em RFC (MUST/SHOULD/MAY). Mudança de comportamento começa pela SPEC.
2. Veja [docs/decisao-arquitetural.md](docs/decisao-arquitetural.md) — por que Node/TS, por que daemon, por que multi-tracker.
3. Rode `pnpm install && pnpm build && pnpm test` — a suíte de conformidade (`tests/conformance`) é o guard-rail; mantenha-a verde. Para o fluxo end-to-end real, veja [docs/M1-DEMO.md](docs/M1-DEMO.md).
4. Para entender o recorte de cada milestone, ver os specs de implementação em [`docs/superpowers/`](docs/superpowers).
5. Abra issue antes de PR para mudanças arquiteturais — design discussions primeiro.

## Ecossistema KairOS

`kairos-symphony` é a **camada 4 (Orchestration)** de um ecossistema maior de produtos VilelaAI:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  1. FOUNDATION  ·  Preparar repo + dar capacidades ao agente                 │
│  ──────────────────────────────────────────────────────────────────────────  │
│  kairos-forge (MIT)        Harness 5 pilares + 45 personas técnicas          │
│  kairos-ai (PRO)           Forge + harness regulado + squads negociais       │
│                            + Ralph Loop assertions                           │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  2. DOMAINS  ·  Conhecimento estruturado por domínio (proprietário)          │
│  ──────────────────────────────────────────────────────────────────────────  │
│  kairos-domains (PRO)      34 domínios totais:                               │
│                            ├─ KairOS-PRO (28 domains: Core 10 + Mkt 18)      │
│                            └─ KairOS-GovAI (6 módulos governo)               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  3. RUNTIME  ·  Como o agente executa                                        │
│  ──────────────────────────────────────────────────────────────────────────  │
│  CLI (terceiros)           Claude Code, Codex CLI, OpenCode                  │
│  kairos-runtime (MIT)      Biblioteca NPM para apps chamarem agentes via API │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  4. ORCHESTRATION  ·  Operação contínua (este projeto)                       │
│  ──────────────────────────────────────────────────────────────────────────  │
│  kairos-symphony (MIT)     Issue tracker → state machine, loop por issue     │
│                            Assume harness do Forge ou kairos-ai como pré-req │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  5. OPERATIONS  ·  Observability + governança (backend) + SDK cliente        │
│  ──────────────────────────────────────────────────────────────────────────  │
│  kairos-platform (PRO)     Backend SaaS multi-tenant: Observabilidade ·      │
│                            FinOps · AIOps · AI Studio (interface humana)     │
│  kairos-studio (PRO)       SDK cliente da platform: @kairos.ai/studio-ui     │
│                            (React) + @kairos.ai/studio-sdk (NestJS) +        │
│                            studio.kairos.ai (Next.js app)                    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  6. PRODUCTS  ·  Saídas finais aplicando o ecossistema                       │
│  ──────────────────────────────────────────────────────────────────────────  │
│  Inclua, JurixIA, Labore, ...    Produtos VilelaAI                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Veja o [diagrama detalhado e dependências no kairos-forge](https://github.com/VilelaAI/kairos-forge/blob/main/plugin/README.md#ecossistema-kairos).

## Licença

MIT. Versão PRO (integração regulada + dashboard) é proprietária e parte do `kairos-platform`.

## Sobre

Mantido por [VilelaAI](https://vilela.tech).

> "O bottleneck não é a capacidade do agente. É a atenção humana." — equipe Symphony, OpenAI

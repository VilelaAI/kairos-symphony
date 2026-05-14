# kairos-symphony

> Orquestrador always-on de coding agents para projetos de software.
> Issue tracker como state machine. Multi-tracker, multi-CLI, PT-BR oficial.

**Status:** 🚧 spec em desenvolvimento — sem implementação ainda. Veja [SPEC.md](SPEC.md) e [roadmap](#roadmap).

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

## Roadmap

### v0.3 — Loop autônomo por issue (atual)

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

Repo está em fase de spec. Antes de implementar:

1. Leia [SPEC.md](SPEC.md) — contrato formal em RFC (MUST/SHOULD/MAY)
2. Veja [docs/decisao-arquitetural.md](docs/decisao-arquitetural.md) — por que Node/TS, por que daemon, por que multi-tracker
3. Abra issue antes de PR — design discussions primeiro

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

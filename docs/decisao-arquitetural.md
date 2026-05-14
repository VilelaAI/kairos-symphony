# Decisões arquiteturais — kairos-symphony

Documento companion à SPEC.md, explicando o **porquê** das escolhas estruturais. Útil para implementadores e contribuidores.

## Por que daemon (não plugin)

Symphony exige execução **persistente**. Plugin de Claude Code ou Codex roda dentro de uma sessão CLI — quando você fecha o terminal, o plugin morre. Polling de tracker, restart de processos, monitoramento de heartbeat: tudo isso precisa de um processo que vive sozinho.

O daemon pode ser instalado de várias formas:

- `systemd` em VPS Linux
- Docker container persistente
- Kubernetes deployment
- Devbox local (laptop sempre ligado)

A escolha do método de deploy não é da spec — é do operador.

## Por que Node/TS para a reference implementation

Considerei 4 opções:

| Linguagem | Pró | Contra |
|---|---|---|
| **Node/TS** | Maior pool de devs, ecossistema GitHub Octokit/Linear SDK maduro, async natural pra polling | Single-threaded, runtime pesado |
| **Go** | Single binary, deploy trivial, concorrência nativa | Pool de devs menor que Node |
| **Python** | Mais devs ainda que Node | GIL, async ainda imaturo, deps pesadas |
| **Rust** | Fastest, safest | Curva de aprendizado, dev velocity baixa |
| **Elixir** | Concorrência ideal, hot reload | Pool de devs muito pequeno (Symphony OpenAI escolheu por ter time interno) |

Decisão: **Node/TS**. Razões:

1. **Ecossistema KairOS já é Node/TS** — Forge, kairos-ai, KDK CLI futuro. Reduz fragmentação.
2. **SDKs de tracker maduros** — Octokit (GitHub), @linear/sdk, jira.js, etc.
3. **Devs hoje são majoritariamente JS/TS** — barreira de entrada baixa pra contribuição externa.
4. **Async/await + child_process resolve 95% do que o daemon precisa**.

Implementações em outras linguagens são bem-vindas — a spec é multi-linguagem deliberadamente.

## Por que multi-tracker desde o desenho

Symphony OpenAI é Linear-only por escolha deliberada deles (time da OpenAI usa Linear). Isso é problema:

- **Brasil mainstream usa GitHub Issues e Jira** — Linear ainda é nicho aqui
- **Times pequenos usam GitHub Projects** (gratuito, integrado)
- **Enterprise usa Jira** (governança, SLA)
- **Open-source usa GitHub Issues** quase exclusivamente

Forçar Linear seria abrir mão de 90% do mercado potencial. A solução é **adapter pattern**: spec define interface (`fetch_issues_in_state`, `transition_state`, etc.); cada tracker tem implementação própria.

GitHub primeiro porque:
- KairOS já vive no GitHub
- API mais documentada
- Webhook receiver mais estabelecido
- Auto-link de PRs já existe sem configuração

## Por que estados canônicos (e não livres)

Tentei desenhar com "estados livres" (qualquer label do tracker pode ser estado). Não funciona:

- Cada tracker tem semântica de status diferente
- Roteamento entre estados precisa ser previsível pro daemon
- Métricas só fazem sentido com vocabulário comum

Solução: 6 estados canônicos (`triage`, `ready`, `in_progress`, `blocked`, `review_pending`, `done`). Cada adapter mapeia estados/labels do tracker subjacente para esses 6.

Exemplo de mapeamento:

| Estado canônico | GitHub Issues | Linear | Jira |
|---|---|---|---|
| `triage` | (issue criada, sem labels específicas) | "Backlog" status | "Open" status |
| `ready` | label `symphony:ready` | "Todo" + label "ready" | "To Do" + label "ready" |
| `in_progress` | label `symphony:in-progress` | "In Progress" | "In Progress" |
| `blocked` | label `symphony:blocked` | "In Progress" + label "blocked" | "Blocked" status |
| `review_pending` | PR linkado + estado open | "In Review" | "In Review" |
| `done` | issue closed | "Done" | "Done" |

## Por que worktree (e não clone)

Worktrees são leves — sem duplicar `.git`, sem refazer fetch. 50 worktrees ocupam quase o mesmo espaço que 1 clone.

Worktree também garante:
- Branches isoladas por design (uma worktree não vê a branch da outra)
- `git status` por worktree, sem conflito
- Cleanup trivial: `git worktree remove`

Containers são alternativa válida (isolamento mais forte) mas adicionam complexidade de runtime (Docker daemon, etc.). Spec aceita os dois; reference implementation usa worktree.

## Por que polling (e não só webhook)

Webhook é **complemento**, não substituto. Razões:

1. **Webhook precisa de endpoint público** — devbox local não tem (precisaria de ngrok ou similar)
2. **Webhook pode falhar silenciosamente** — daemon não sabe que está perdendo eventos
3. **Polling reconcilia divergência** — se daemon ficou offline e webhooks foram perdidos, polling no restart pega tudo
4. **Polling funciona com qualquer tracker** — webhook depende de suporte da API

Desenho: polling é o **floor** de garantia. Webhook é otimização opcional pra reduzir latência. Os dois trabalham juntos.

## Por que separar fábrica de orquestrador

Tentei desenhar `kairos-symphony` com agentes embutidos. Ruim:

- Duplicaria os 45 agentes do Forge
- Versionar agentes e orquestrador junto cria acoplamento desnecessário
- Não permitiria usar `kairos-ai` (regulado) em vez do Forge

Solução: orquestrador é "burro" sobre agentes. Ele lê fábrica configurada (Forge ou kairos-ai), descobre agentes via convenção (paths de plugin), constrói prompts. Atualizar agente = atualizar fábrica, não tocar no orquestrador.

## Por que NÃO ter UI no v1

Dashboard é trabalho gigante e separado:

- Frontend (React, Vue, ou similar)
- Auth (multi-user, RBAC)
- Realtime updates (websockets)
- Acessibilidade
- i18n

Tudo isso é trabalho de design system + frontend engineering. Não é orquestração. Pertence ao `kairos-platform` (PRO).

No v1, observabilidade é via:
- Logs estruturados JSON (qualquer agregador serve: Loki, Datadog, CloudWatch)
- `/metrics` Prometheus
- Audit log SQLite consultável via CLI

Quem quiser dashboard, integra com Grafana ou usa o `kairos-platform` (PRO).

## Por que advisor regulatório fica no PRO

Forge tem 45 agentes técnicos genéricos. kairos-ai tem squads negociais regulados (DPO, Mapeamento, etc.) + advisor Opus pra decisões de compliance.

No loop autônomo do Symphony, decisões regulatórias precisam de raciocínio frontier. Embutir advisor no Forge contaminaria o MIT (custo de Opus 24/7). Solução:

- **Forge + Symphony MIT** = fábrica autônoma de software técnico genérico
- **kairos-ai + Symphony PRO** = fábrica autônoma com guardrails LGPD/NRs e advisor Opus

A separação preserva o modelo de monetização do KairOS.

## Por que PT-BR oficial nos logs

Decisão estética/posicionamento. Forge é PT-BR oficial; Symphony herda. Logs em PT-BR:

- Refletem a personalidade do produto
- São lidos por operadores brasileiros majoritariamente
- Não impedem export pra agregador (JSON é language-agnostic; só os values são PT-BR)

Implementações estrangeiras MAY fazer i18n. Não é spec MUST.

## Por que NÃO usar kairos-runtime

Primeira intuição foi reaproveitar o `kairos-runtime` (biblioteca NPM da camada Build do KairOS) como motor de execução do Symphony. **Foi descartado** porque os dois resolvem problemas diferentes:

| | `kairos-runtime` | `kairos-symphony` |
|---|---|---|
| Tipo | Biblioteca NPM importada por código | Daemon persistente standalone |
| Como executa agente | Chamada direta a API LLM via Vercel AI SDK / OpenRouter | Spawn de processo de CLI (Claude Code / Codex / OpenCode) |
| Quem faz a chamada à API | A própria runtime, dentro do processo do app | O CLI invocado, fora do processo do Symphony |
| Audiência | Desenvolvedor de aplicação Next.js / Edge Function | Operador de devbox / VPS / time de eng |
| Caso de uso típico | Usuário do Inclua clica num botão → backend chama `runtime.runAgent(...)` | Issue marcada `ready` no GitHub → Symphony spawna `claude` ou `codex` no host |

**O Symphony não toca em LLM diretamente.** Ele monta prompt, escreve em arquivo (ou passa via stdin), invoca o CLI configurado, lê stdout/stderr, monitora exit code. Quem fala com Anthropic/OpenAI é o CLI — que já tem retry, routing de modelo, sandbox, tool use etc. Reimplementar isso seria duplicar trabalho que o CLI já faz bem.

A confusão é compreensível: ambos são "execução de agentes". Mas a fronteira é clara — runtime é **biblioteca pra apps**, Symphony é **orquestrador de CLIs**. Se a aplicação do usuário usar a `runtime` internamente (ex: uma feature do Inclua que chama agente), isso é independente do Symphony e segue o caminho `runtime → API LLM` direto.

Caso futuro onde poderiam se cruzar: se aparecer cenário onde o Symphony precisa rodar agente **sem** depender de CLI instalado no host (ex: deploy serverless do daemon, onde não dá pra ter binário de Claude Code em execução), aí `kairos-runtime` voltaria a ser candidato. Não é o caso na v0.1 — assume-se que o operador instala o CLI no devbox/VPS.

## Decisões deliberadamente NÃO tomadas (deixadas em aberto)

Alguns pontos foram identificados mas não resolvidos — ficam pra v0.2+ ou pra implementadores decidirem:

- **Concurrency safety multi-daemon** — 2 daemons rodando contra o mesmo tracker simultaneamente. Solução provável: lock distribuído (Redis ou tracker-side lock label). Não definido na v0.1.
- **Replay/dry-run** — modo "não execute, só mostre o que faria". Útil pra debug mas não é MUST.
- **Cost tracking** — agentes consomem tokens. Tracking de custo por issue/agente seria útil. Out of scope na v0.1; provavelmente vira métrica Prometheus na v0.4.
- **Agente human-in-the-loop opt-in por issue** — alguns trabalhos exigem aprovação humana antes de cada turn. Mecanismo via label específica. Decisão adiada pra v0.2.

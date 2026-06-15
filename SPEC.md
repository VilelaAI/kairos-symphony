# kairos-symphony — Especificação

**Versão:** 0.4.0-draft
**Status:** Em desenvolvimento — M1 (walking skeleton), M2 (confiabilidade), M3 (segurança & observabilidade) e M4 (harness-readiness) implementados em TypeScript; M5 pendente (ver README → [Estado da implementação](README.md#estado-da-implementação))
**Licença:** MIT

Esta especificação define o contrato comportamental de um orquestrador de coding agents alimentado por issue tracker. Implementações em qualquer linguagem MUST seguir as regras MUST e SHOULD seguir as regras SHOULD desta spec.

A linguagem MUST/SHOULD/MAY/MUST NOT/SHOULD NOT segue [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Visão geral

Um orquestrador `kairos-symphony` é um processo persistente que:

1. Polla periodicamente um issue tracker
2. Identifica issues em estado "ready"
3. Despacha um agente dedicado por issue, isolado em workspace próprio
4. Monitora a execução do agente
5. Atualiza o estado da issue conforme progresso
6. Pausa para revisão humana em estados terminais

O orquestrador NÃO toma decisões de código. Toda decisão técnica é delegada ao agente CLI (Claude Code, Codex, OpenCode).

### 1.1 Escopo: local-first

A v0.x do `kairos-symphony` é **local-first por design**. O daemon roda no **mesmo host** onde o desenvolvedor trabalha (laptop, devbox ou VPS pessoal) — não há separação control plane / data plane, não há comunicação de rede entre componentes, não há runner remoto.

Esta é uma decisão deliberada de escopo, não uma limitação temporária a ser "consertada". Operação remota multi-host (runners distribuídos, relay de terminal, mTLS entre componentes) é problema de **plataforma**, não de orquestrador — e fica explicitamente fora desta spec. Quem precisa de operação remota gerenciada usa o `kairos-platform` (PRO).

Consequências do local-first que valem para toda a spec:

- O daemon e o agente CLI rodam na mesma máquina, sob o mesmo usuário do SO
- Não há autenticação de rede entre daemon e agente — o limite de segurança é o processo e o filesystem (§12)
- O operador tem acesso direto ao host — observação de terminal (§13.1) pode ser feita via filesystem local, sem relay
- Deploy é instalação local (`npm install`, binário, ou container único), não orquestração distribuída

### 1.2 Assunções de ambiente

Esta spec assume, sem prover mecanismo para o contrário:

1. **CLI pré-autenticado.** O CLI configurado (`claude`, `codex`, etc.) já está instalado e autenticado no host — a API key do modelo (Anthropic, OpenAI) já está disponível ao CLI por meios próprios dele. O Symphony NÃO gerencia credenciais de modelo; gerencia apenas o token do tracker (§6, §12).
2. **Single-tenant.** Um daemon serve um operador, um tracker, um conjunto de repositórios. Não há hierarquia organização / time / usuário, não há isolamento multi-inquilino. Multi-tenancy é responsabilidade do `kairos-platform` (PRO), não desta spec.
3. **Host confiável.** O host onde o daemon roda é confiável — o modelo de ameaça cobre issues maliciosas e prompts hostis (§12), não um host comprometido.

## 2. Estados (state machine)

Toda implementação MUST suportar os 6 estados canônicos abaixo. Mapeamento para labels/status do tracker subjacente é responsabilidade do adapter.

```
            ┌──────────┐
            │  triage  │ (humano)
            └────┬─────┘
                 │ humano move pra ready
                 ▼
            ┌──────────┐
            │   ready  │
            └────┬─────┘
                 │ symphony despacha agente
                 ▼
            ┌──────────┐
   ┌────────┤in_progress├──────────┐
   │        └─────┬────┘           │
   │              │                │
   │              ▼                │
   │       ┌──────────┐            │
   │       │ blocked  │ (agente)   │
   │       └─────┬────┘            │
   │             │ humano destrava │
   │             ▼                 │
   │     (volta pra in_progress)   │
   │                               ▼
   │                      ┌─────────────┐
   │                      │review_pending│ (PR aberto)
   │                      └──────┬──────┘
   │                             │
   │                  ┌──────────┴──────────┐
   │                  │                     │
   │                  ▼                     ▼
   │            ┌──────────┐         ┌──────────┐
   │            │   done   │         │  ready   │
   │            └──────────┘         │ (rework) │
   │                                 └──────────┘
   └─── stall/crash ───┐
                       ▼
                   restart
```

| Estado | Quem move pra cá | O que symphony faz |
|---|---|---|
| `triage` | Humano (default em issue nova) | Ignora — não é trabalho do orquestrador |
| `ready` | Humano (após triagem) | Despacha agente no próximo polling |
| `in_progress` | symphony (ao despachar) | Monitora processo, detecta stall/crash |
| `blocked` | Agente (via mecanismo do CLI) | Aguarda humano, não restarta |
| `review_pending` | symphony (após PR aberto pelo agente) | Aguarda merge ou rework |
| `done` | Tracker externo (após merge) | Cleanup workspace, libera slot |

Implementações MAY adicionar estados intermediários, mas MUST mapear cada estado custom para um dos 6 canônicos para fins de roteamento.

## 3. Loop principal

O orquestrador MUST executar o seguinte loop continuamente até receber sinal de shutdown:

```
LOOP:
  1. reconciliar_estado()           ← §9.1: divergências daemon ↔ tracker
  2. fetch_issues_in_state("ready") ← do tracker
  3. para cada issue:
     a. se já há agente ativo pra essa issue → skip
     b. se concurrent_agent_limit atingido → skip
     c. dispatch(issue)
  4. para cada agente ativo:
     a. check_heartbeat()
     b. se stalled (sem output há > stall_timeout_ms) → terminate + restart (com backoff)
     c. se crashed → log + restart (com backoff, máx max_retries)
     d. se PR aberto → transition_state(issue, "review_pending")
  5. fetch_issues_in_state("done")  ← detecta merge
  6. para cada issue done:
     a. cleanup_workspace(issue)
     b. liberar slot
  7. sleep(poll_interval_ms)
```

`poll_interval_ms` MUST ser configurável. Default: 30000 (30s).
`stall_timeout_ms` MUST ser configurável. Default: 600000 (10min).
`max_retries` MUST ser configurável. Default: 3.
`concurrent_agent_limit` MUST ser configurável. Default: 5.

Implementações SHOULD suportar webhook receiver opcional para reduzir latência de polling.

## 4. Workspace por issue

Toda issue em estado `in_progress` MUST ter exatamente 1 workspace dedicado. Implementações MUST:

1. Criar workspace em path determinístico: `<workspaces_root>/<issue_id>/`
2. Inicializar como **git worktree** isolado (não clone) da branch base configurada
3. Criar branch nomeada conforme `branch_naming_pattern` (default: `symphony/<issue_id>`)
4. Garantir que processo do agente roda **somente** dentro do workspace (cwd locked)
5. Não permitir 2 agentes no mesmo workspace simultaneamente

Implementações MUST limpar (`git worktree remove`) workspaces de issues no estado `done` após `workspace_retention_days` (default: 7).

Implementações MAY usar containers (Docker/Podman) em vez de worktrees, desde que mantenham isolamento equivalente.

### 4.1 Spawn do agente — PTY, não pipe simples

Os CLIs suportados (Claude Code, Codex CLI, OpenCode) são **programas interativos**. Implementações MUST spawnar o agente anexado a um **pseudo-terminal (PTY)**, não a pipes simples de stdin/stdout.

Razão: muitos CLIs detectam ausência de TTY e mudam de comportamento — desabilitam streaming incremental, alteram formatação, suprimem prompts, ou travam aguardando input interativo que nunca chega. Um `child_process.spawn()` com pipes pode funcionar em testes triviais e falhar silenciosamente em uso real.

Implementações MUST:

1. Alocar um PTY por agente despachado (ex: `node-pty`, `pty` de Go, `ptyprocess` de Python)
2. Anexar o processo do CLI ao PTY como sessão controladora
3. Capturar o output do PTY para dois destinos simultâneos:
   - O arquivo de stream de terminal (§13.1), para observação ao vivo
   - O parser interno que detecta sinais de progresso, conclusão e bloqueio
4. Definir as dimensões do PTY explicitamente (ex: 120x40) — alguns CLIs ajustam output ao tamanho do terminal

Implementações MUST NOT assumir que o CLI se comporta igual com e sem TTY. Quando em dúvida, testar o CLI alvo nos dois modos antes de assumir equivalência.

## 5. Roteamento agente↔issue

Toda issue dispatched MUST ser associada a exatamente 1 agente da fábrica configurada (kairos-forge ou kairos-ai).

Mecanismos de roteamento aceitos (em ordem de precedência):

1. **Label explícita** — issue com label `agent:<id>` (ex: `agent:carlos-dba`) MUST ser despachada para esse agente.
2. **Label de tipo** — labels `bug`, `feature`, `docs`, etc. MAY mapear para agentes via configuração `routing_rules`.
3. **Default agent** — se nenhum dos anteriores casar, usa `default_agent` (recomendado: `laura-tech-lead`, que coordena).

Implementações MUST validar que o agente existe na fábrica configurada antes de despachar. Se não existir, MUST mover a issue para `blocked` com mensagem indicando o agente faltante.

## 6. Prompt construction

O prompt enviado ao agente MUST conter, no mínimo:

1. **Identidade do agente** — `name` e `description` do frontmatter do agente
2. **Contexto da issue** — título, descrição, labels, comentários relevantes
3. **Workspace info** — path, branch, branch base
4. **Definition of Done** — o que constitui issue resolvida (configurável; default: PR aberto + CI verde)
5. **Mecanismo de bloqueio** — instruções pro agente sinalizar `blocked` se travar

Implementações SHOULD adicionar:

- Histórico relevante do projeto (CLAUDE.md, README, ADRs recentes)
- Issues relacionadas (linked, blocking)
- Convenções do projeto (lint config, style guide)

Implementações MUST NOT injetar segredos no prompt. Tokens de tracker, API keys etc. MUST ser passados via env do processo, não via prompt.

## 7. Detecção de PR aberto

Implementações MUST detectar quando um agente abriu PR/MR e transicionar a issue para `review_pending`. Mecanismos aceitos:

1. **Polling do tracker** — verificar se issue tem PR linkado (GitHub auto-link, Linear PR association, etc.)
2. **Webhook do Git provider** — receber evento `pull_request.opened` e correlacionar com issue
3. **Convenção de branch** — branch `symphony/<issue_id>` com PR aberto MUST disparar transição

Implementações SHOULD usar webhook quando disponível (latência menor) com fallback para polling.

## 8. Detecção de crash e stall

Toda implementação MUST monitorar processos de agente via:

1. **Heartbeat** — agente MUST escrever em arquivo de heartbeat a cada N segundos. Ausência de update por > `stall_timeout_ms` indica stall.
2. **Process status** — exit code != 0 indica crash; exit code 0 sem PR aberto indica completion errôneo.

Em stall ou crash, implementações MUST:

1. Logar com correlation_id (issue_id)
2. Capturar últimas N linhas de stdout/stderr para diagnose
3. Tentar restart com backoff exponencial (1min, 4min, 16min)
4. Após `max_retries` falhas consecutivas, mover issue para `blocked` com label `symphony:max-retries-exceeded`

## 9. Persistência de estado

Implementações MUST persistir o estado interno entre reinicializações:

- Issues em `in_progress` (com workspace_path, agent_id, started_at, retry_count)
- Histórico de transições (quem moveu pra onde, quando, por quê)
- Métricas (tempo médio por agente, taxa de sucesso, etc.)

Storage MAY ser SQLite local (default), Postgres, Redis, ou outro. Schema MUST permitir consulta por `issue_id`.

Após restart do daemon, implementações MUST:

1. Reconciliar com o estado real do tracker (que pode ter mudado offline)
2. Verificar workspaces órfãos (existem em disco mas não no estado)
3. Não disparar restart automático de processos que estavam rodando antes do shutdown — exigir comando explícito de retomada

### 9.1 Reconciliação estado-daemon ↔ estado-tracker

O Symphony mantém um estado interno (qual issue está em qual fase, qual agente roda onde) **separado** do estado do tracker externo (GitHub Issues, Jira, etc.). Esses dois estados **divergem na prática** — e a divergência é a fonte número um de bugs em sistemas deste tipo.

Cenários de divergência que implementações MUST tratar:

| Cenário | O que aconteceu | O que o daemon deve fazer |
|---|---|---|
| Issue fechada na mão | Humano fechou a issue no tracker enquanto o agente rodava | Terminar o agente, limpar workspace, registrar como cancelada — não abrir PR |
| Label removida | Humano tirou a label `ready` antes do dispatch acontecer | Não despachar; remover da fila |
| Label `blocked` removida | Humano destravou a issue no tracker | Repercebe no polling, retoma para `in_progress` |
| PR mergeado fora do fluxo | Alguém mergeou o PR direto, sem passar por `review_pending` | Detectar via tracker, marcar `done`, limpar workspace |
| Issue editada durante execução | Descrição ou labels mudaram enquanto o agente trabalhava | NÃO interromper o agente em andamento; aplicar mudança só no próximo dispatch |
| Estado interno perdido | Daemon reiniciou e o SQLite corrompeu ou foi apagado | Reconstruir o estado a partir do tracker + inspeção dos worktrees em disco |

Princípios de reconciliação que implementações MUST seguir:

1. **O tracker é a fonte de verdade para o que o humano quer.** O estado interno é a fonte de verdade para o que o daemon está fazendo. Quando divergem sobre intenção (que issue trabalhar), o tracker vence. Quando divergem sobre execução (qual processo está vivo), o estado interno vence.
2. **Reconciliar a cada polling, não só no restart.** A divergência acontece durante a operação normal, não apenas após reinício. Cada ciclo do loop principal (§3) MUST incluir um passo de reconciliação.
3. **Nunca destruir trabalho por divergência ambígua.** Se o daemon não consegue determinar com segurança o que aconteceu, MUST mover a issue para `blocked` com label `symphony:needs-reconciliation` e pedir intervenção humana — nunca apagar workspace ou matar agente "no escuro".
4. **Toda reconciliação que muda estado MUST ser logada** com `event: state_reconciled`, o estado antes, o estado depois, e a evidência que motivou a mudança.

Implementações SHOULD expor um comando `symphony reconcile --dry-run` que mostra as divergências detectadas sem aplicar nenhuma mudança.

## 10. Configuração

Toda implementação MUST aceitar configuração via:

1. Arquivo `kairos-symphony.config.yaml` (ou `.toml` ou `.json`) no working directory
2. Variáveis de ambiente com prefixo `SYMPHONY_` (override do arquivo)
3. Flags CLI (override de tudo)

Campos mínimos obrigatórios:

```yaml
tracker:
  type: github                  # github | gitlab | jira | linear
  repo: VilelaAI/novo-projeto
  token_env: GITHUB_TOKEN

cli:
  type: claude-code             # claude-code | codex | opencode
  binary_path: /usr/local/bin/claude   # opcional, auto-detecta se omitido

factory:
  type: kairos-forge            # kairos-forge | kairos-ai
  installation: plugin          # plugin (assume já instalado) | local-path

workspaces:
  root: /var/symphony/workspaces
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
  poll_interval_ms: 30000
  stall_timeout_ms: 600000
  max_retries: 3
```

## 11. Logs

Implementações MUST emitir logs estruturados (JSON) com, no mínimo, os campos:

- `timestamp` (ISO 8601 UTC)
- `level` (debug | info | warn | error)
- `event` (string identificadora — ex: `issue_dispatched`, `agent_crashed`)
- `issue_id`
- `agent_id` (quando aplicável)
- `correlation_id` (UUID por dispatch, propagado em todos os logs daquela issue)
- `message` (texto livre)

Logs SHOULD ser escritos em PT-BR quando o tracker e a fábrica são PT-BR. Implementações MAY suportar i18n.

## 12. Segurança e privacidade

Implementações MUST:

- Nunca logar tokens, API keys ou conteúdo de `.env`
- Sandboxar processo do agente (filesystem, network, exec) conforme capacidades do CLI
- Validar que workspace não escapa do `workspaces_root` (path traversal)
- Rejeitar prompts construídos com conteúdo > 1MB (proteção contra issue maliciosa)

Implementações MUST NOT:

- Executar comandos shell embutidos em descrição de issue sem aprovação humana
- Permitir que agente acesse workspace de outra issue
- Submeter PR diretamente para `main`/`master` — sempre via branch própria + PR

## 13. Observabilidade

### 13.1 Observação de terminal ao vivo

Logs estruturados em JSON (§11) servem para auditoria e diagnóstico **depois** do fato. Eles NÃO servem para a pergunta mais frequente do operador: *"o que o agente está fazendo agora?"*

Quando um agente trava, faz algo inesperado, ou simplesmente demora, o operador precisa **ver o terminal do agente em tempo real** — não fazer `grep` em log JSON. Implementações MUST prover algum mecanismo de observação ao vivo do output do agente.

Como o Symphony é local-first (§1.1), esse mecanismo pode ser simples — não exige relay de rede nem WebSocket:

1. Implementações MUST escrever o output bruto do PTY de cada agente (§4.1) em um arquivo de stream determinístico: `<workspaces_root>/<issue_id>/.symphony/terminal.log`
2. O operador observa ao vivo com ferramentas padrão do SO (`tail -f`, `less +F`, etc.)
3. Implementações SHOULD prover um comando de conveniência — `symphony attach <issue_id>` — que faz o equivalente a um `tail -f` formatado do stream daquele agente
4. Implementações MAY prover um comando `symphony ps` que lista os agentes ativos, seus issue_ids, tempo de execução e caminho do stream

Implementações MUST NOT depender exclusivamente de logs JSON para observabilidade operacional. O stream de terminal é requisito, não enfeite.

> Operação remota — onde o terminal precisa viajar pela rede até o navegador do operador — fica fora desta spec (ver §1.1). Isso é responsabilidade do `kairos-platform`.

### 13.2 Endpoints e métricas

Implementações SHOULD expor:

- Endpoint `/healthz` (200 se daemon vivo)
- Endpoint `/metrics` em formato Prometheus, com no mínimo:
  - `symphony_issues_in_state{state="<estado>"}` (gauge)
  - `symphony_dispatches_total` (counter)
  - `symphony_crashes_total{agent="<id>"}` (counter)
  - `symphony_dispatch_duration_seconds` (histogram)
- Audit log com todas as transições, exportável

## 14. Anti-objetivos (o que esta spec NÃO cobre)

Esta spec deliberadamente NÃO define:

- **Operação remota multi-host** — runners distribuídos, relay de terminal pela rede, mTLS entre componentes. O Symphony é local-first (§1.1); operação remota gerenciada fica no `kairos-platform`
- **UI / dashboard** — fica no `kairos-platform`
- **Deploy** — implementações decidem (systemd, Docker, binário local, etc.)
- **Modelo de billing/SaaS** — out of scope, fica no PRO
- **Multi-tenancy** — hierarquia organização/time/usuário fica no `kairos-platform` (ver §1.2)
- **Gestão de credenciais de modelo** — o CLI já vem autenticado no host (ver §1.2)
- **Conteúdo dos prompts dos agentes** — herda da fábrica configurada
- **Política de revisão humana** — humano decide; spec só garante o estado `review_pending`

## 15. Conformidade

Uma implementação é "kairos-symphony compliant" v0.1 se:

- [ ] Implementa os 6 estados (§2)
- [ ] Implementa o loop principal, incluindo o passo de reconciliação (§3)
- [ ] Implementa workspace isolation via worktree ou container (§4)
- [ ] Spawna o agente via PTY, não pipe simples (§4.1)
- [ ] Implementa roteamento agente↔issue por label (§5)
- [ ] Constrói prompts com os campos mínimos (§6)
- [ ] Detecta PR aberto (§7)
- [ ] Detecta stall e crash com retry (§8)
- [ ] Persiste estado entre restarts (§9)
- [ ] Reconcilia divergências daemon ↔ tracker a cada polling (§9.1)
- [ ] Aceita configuração nos formatos definidos (§10)
- [ ] Emite logs estruturados (§11)
- [ ] Cumpre os requisitos de segurança (§12)
- [ ] Provê observação de terminal ao vivo por agente (§13.1)
- [ ] Valida harness-readiness no startup (§16)

Implementações que pretendem usar a marca "kairos-symphony" MUST passar por suite de testes de conformidade (a ser publicada junto com a v0.1 reference).

## 16. Harness-readiness (pré-requisito)

Symphony **MUST** validar que o repositório alvo está harness-ready antes de despachar a primeira issue. Este pré-requisito vem do conceito de [Harness Engineering](https://openai.com/index/harness-engineering/) (OpenAI, fevereiro 2026): a qualidade do output de coding agents depende mais do ambiente do que do prompt. Despachar agentes em repo despreparado amplifica problemas — Symphony pode gerar N PRs ruins em paralelo, em vez de 1 PR ruim sequencial.

### 16.1 Definição de harness-ready

Um repositório é considerado harness-ready se atende, no mínimo, os 4 pilares descritos pela OpenAI:

1. **Repository-as-context** — todo conhecimento relevante (decisões, contextos, specs, ADRs) versionado em arquivos no repo. Nenhuma decisão crítica vive apenas em chat, Slack, Google Docs ou cabeças.

2. **Instruction set evolutivo** — `AGENTS.md` (e/ou `CLAUDE.md`) presente na raiz, curto (≤ ~500 linhas), atualizado a cada falha encontrada por agentes.

3. **Architectural invariants mecanicamente enforçados** — convenções estruturais (PT-BR, naming, layered imports, allow-list de tools por agente etc.) verificadas por linter custom, hook de pre-commit, ou CI. Não basta documentar — tem que ser checado mecanicamente.

4. **Observability access para agents** — agentes têm acesso a logs estruturados, métricas e traces durante execução. Não rodam às cegas — leem o estado runtime do sistema sob teste.

### 16.2 Validação ao iniciar daemon

Implementações **MUST** rodar uma checagem de harness-readiness no startup do daemon, antes de aceitar primeira issue. A checagem verifica, no mínimo:

- Presença de `AGENTS.md` ou `CLAUDE.md` na raiz do repo
- Presença de pelo menos 1 ADR ou documento equivalente em `docs/adr/`, `decisoes/`, ou similar
- Presença de pelo menos 1 hook de pre-commit ou config de CI
- Presença de `.gitignore` (sinal mínimo de higiene de repo)

Implementações **SHOULD** integrar com a skill `/kairos-forge:harness-check` (planejada para v0.6 do `kairos-forge`) quando disponível, delegando a validação para a fábrica configurada.

### 16.3 Comportamento em repo não-pronto

Se a checagem **falhar**, implementações **MUST**:

1. Logar diagnóstico claro indicando qual pilar falhou
2. Recusar startup (exit code != 0) ou entrar em modo "validation-only" (sem dispatch)
3. Sugerir comando de remediação, ex.:

   ```
   ❌ Repo não está harness-ready.
   
   Falhas:
     - Sem AGENTS.md ou CLAUDE.md na raiz
     - Sem ADRs em docs/adr/
   
   Para corrigir, instale e rode kairos-forge no projeto:
     /plugin install kairos-forge@kairos-forge
     /kairos-forge:onboardar
   
   Ou, para domínios regulados:
     /plugin install kairos-ai@kairos-ai
     /kairos:iniciar
   ```

### 16.4 Override (modo unsafe)

Implementações **MAY** suportar flag `--skip-harness-check` ou config equivalente para forçar startup em repo não-pronto. Esta flag **MUST** emitir warning conspícuo no startup e em cada dispatch:

```
⚠️  HARNESS CHECK BYPASSED — output quality will likely be poor
```

Operadores que usam esta flag **SHOULD** entender que estão amplificando risco — Symphony foi desenhado para repos preparados, não como solução para repos legados bagunçados.

### 16.5 Re-validação periódica

Implementações **SHOULD** re-rodar harness-readiness check a cada N dispatches (default: 100) ou a cada N horas (default: 24), o que vier primeiro. Se a re-validação falhar, daemon **SHOULD** entrar em modo "drain" (deixa terminar issues em andamento, não pega novas) e alertar operador.

A justificativa: harness pode degradar ao longo do tempo (ADRs ficam desatualizados, AGENTS.md vira ficção, hooks são desabilitados). Symphony detecta isso antes de acumular dívida.

## 17. Loop autônomo por issue (opcional)

A partir da v0.3 da SPEC, Symphony **MAY** suportar execução de uma issue em **modo loop autônomo** — em vez de single-shot, o agente itera contra um critério de parada verificável até atingir ou esgotar max-iterations. Esta capability vem do 5º pilar do harness (Forge ADR-0006), inspirada em [Ralph Loop (Anthropic)](https://claude.com/plugins/ralph-loop) e [/goal (OpenAI)](https://developers.openai.com/codex/use-cases/follow-goals).

### 17.1 Quando faz sentido

Loop autônomo per-issue é útil para:

- Issues marcadas como **migração** (ex: "migrar X de A para B com parity check")
- Issues marcadas como **refactor grande** (ex: "extrair domínio Y para package separado")
- Issues marcadas como **otimização contra eval/benchmark** (ex: "atingir 85% de pass rate")
- Issues marcadas como **bug-fix complexo** com reprodução automatizável

Issues simples (small feature, doc fix, typo) **SHOULD** continuar em single-shot — loop adiciona overhead desnecessário.

### 17.2 Configuração

Implementações **MUST** suportar configuração de modo de iteração via:

1. **Label da issue** (precedência maior):
   - `iterate:loop` → modo loop autônomo
   - `iterate:single` → modo single-shot
   - `iterate:loop:N` → loop com max-iterations N (ex: `iterate:loop:20`)

2. **Config global** (fallback):

```yaml
iteration:
  default_mode: single                # single | loop
  default_max_iterations: 10
  default_completion_promise: "DONE"
  
  per_label_overrides:
    - label: migration
      mode: loop
      max_iterations: 30
    - label: refactor-large
      mode: loop
      max_iterations: 20
    - label: bug-fix
      mode: single                    # bugs simples
    - label: bug-fix-complex
      mode: loop
      max_iterations: 15
```

3. **Frontmatter na descrição da issue** (precedência máxima):

```yaml
---
iterate:
  mode: loop
  max_iterations: 25
  completion_promise: "all contract tests pass"
  validation_command: "npm run test:contract"
---

(corpo da issue continua aqui)
```

### 17.3 Execução do loop

Quando uma issue dispatched está em modo loop, implementações **MUST**:

1. Criar **checkpoint file** em `<workspace>/.perseguir/checkpoint.md` antes da primeira iteração
2. A cada iteração, passar pro CLI o prompt construído (§6) acrescido de:
   - Conteúdo atual do checkpoint
   - Comando de validação (se definido)
   - Stopping condition explícita
   - Max iterations restante
3. Após o CLI sair, **MUST** ler última linha do checkpoint:
   - `DONE` (ou completion-promise customizada) → marcar issue como `review_pending`
   - `BLOCKED: <motivo>` → marcar issue como `blocked` com label adicional indicando o bloqueio
   - Outra coisa → continuar próxima iteração
4. Após max-iterations, **MUST** marcar issue como `blocked` com label `symphony:max-iterations-exceeded` e expor checkpoint como evidência

### 17.4 Adaptação por CLI

Implementações **SHOULD** detectar o CLI configurado e usar o mecanismo nativo quando disponível:

| CLI | Mecanismo nativo | Fallback |
|---|---|---|
| Claude Code | Plugin `ralph-loop` oficial (Anthropic, 129k+ installs) | Loop manual via re-spawn de `child_process` |
| Codex CLI | Comando `/goal` nativo (requer `features.goals = true` no config.toml) | Loop manual via prompt re-feed |
| OpenCode | (sem nativo) | Loop manual via re-spawn |

A implementação fallback é mais simples mas equivalente: ao final de cada iteração, o daemon respawna o CLI com o checkpoint atualizado no prompt.

### 17.5 Concorrência

Issues em modo loop **MUST** contar como **1 slot** no `concurrent_agent_limit` durante toda a execução (não 1 por iteração). Loop é uma única "ocupação de slot" mesmo que dure múltiplas horas.

Implementações **SHOULD** alertar operador via log/métrica quando uma issue em loop está ocupando slot há > `loop_warning_threshold_ms` (default: 4 horas) — pode indicar travamento que escapou da detecção de stall.

### 17.6 Anti-objetivos

Esta seção deliberadamente NÃO define:

- **Pause/resume entre iterações** — out of scope na v0.3, fica como evolução pra v0.4. Modo loop é all-or-nothing por enquanto.
- **Hot-swap de prompt em loop ativo** — se operador quer mudar abordagem, deve cancelar loop atual e reiniciar
- **Loop multi-agente** — uma issue = um agente em loop. Pra paralelismo, abra múltiplas issues
- **Cost tracking de loop** — depende do CLI; Symphony não agrega tokens no v0.3

## 18. Mudanças e versionamento

Esta spec segue [SemVer](https://semver.org). Mudanças que quebram conformidade resultam em bump major. Adições compatíveis (novos campos opcionais, novos estados que mapeiam pros 6 canônicos) resultam em bump minor. Esclarecimentos resultam em bump patch.

Histórico de versões em [CHANGELOG.md](CHANGELOG.md).

---

**Próximos passos da spec:**

1. Recortar o MVP v0.1 — definir o subconjunto mínimo que prova o loop end-to-end
2. Validar com 2-3 desenvolvedores externos antes de freezar v0.1
3. Implementar reference em Node/TS (decisão de linguagem a confirmar — ver nota abaixo)
4. Suite de conformidade
5. Publicar v0.1 final + reference impl simultaneamente

**Nota sobre linguagem da reference implementation:** a escolha de Node/TS é razoável pelo alinhamento com o resto do ecossistema KairOS, mas implementações de referência de daemons persistentes similares (ex: AgentsMesh) escolheram Go — daemon de longa duração com alta concorrência tende a ser mais previsível sem event loop bloqueável nem pausas de GC surpresa. A decisão final de linguagem deve ser consciente, não default. Esta spec é multi-linguagem; a reference pode ser em qualquer linguagem que cumpra a conformidade (§15).

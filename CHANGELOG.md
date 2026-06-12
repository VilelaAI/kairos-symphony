# Changelog

Todas as mudanças notáveis neste projeto serão documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado — M2 Confiabilidade

Segundo milestone de implementação. Fecha os três pontos de confiabilidade que o M1 deixou em aberto, mantendo a suíte verde (**114 testes** em 32 arquivos).

- **Heartbeat cooperativo (§8.1).** Além do silêncio do PTY, o supervisor agora considera um arquivo de heartbeat (`<workspace>/.symphony/heartbeat`) que o agente atualiza periodicamente. Um agente "pensando" (sem output, mas atualizando o heartbeat) não é mais morto por engano; o stall só dispara quando **ambos** os sinais ficam silenciosos por mais de `stall_timeout_ms`. O `PromptBuilder` instrui o agente a atualizar o heartbeat; intervalo configurável via `limits.heartbeat_interval_ms`.
- **Hardening do spawn de PTY (§4.1).**
  - Encerramento gracioso **SIGTERM → grace → SIGKILL** (`limits.kill_grace_ms`, default 5s) em stall e shutdown, com guarda para não matar um processo de retry recém-spawnado.
  - Falha ao spawnar o PTY passa a ser tratada como **crash daquela issue** (retry), em vez de derrubar o daemon.
  - `kill` do adapter Claude Code agora é **idempotente** (não lança `ESRCH` ao matar processo já encerrado).
  - Captura das **últimas 50 linhas** de output (`last_output`) nos logs de `agent_crashed`/`agent_stalled` para diagnóstico (§8.2).
- **Reconstrução de estado interno perdido (§9.1, 6º cenário).** Quando o SQLite é apagado/corrompido mas há worktrees em disco, o reconciliador casa cada worktree órfão com uma issue ativa no tracker (`in_progress`/`review_pending`) e **reconstrói** o `IssueRecord`. Como o processo morreu e a §9 proíbe restart automático, a issue reconstruída entra em `blocked: symphony:needs-reconciliation` com o workspace preservado, para retomada explícita pelo operador. Worktrees sem match no tracker continuam apenas logados (política conservadora do M1). Novos eventos `state_reconstructed`/`agent_sigkilled`.
- **Config:** novos campos `limits.heartbeat_interval_ms` (default 30000) e `limits.kill_grace_ms` (default 5000).

### Adicionado — M1 Walking Skeleton (primeira implementação)

A SPEC `0.4.0-draft` deixou de ser apenas contrato: o **M1 (walking skeleton)** está implementado, com o happy path end-to-end funcionando em hardware real (GitHub + Claude Code + kairos-forge) e coberto por **105 testes** (conformidade + integração + unitários) em 31 arquivos.

- **Monorepo** pnpm workspaces em TypeScript (Node ≥ 22.5) com 5 packages: `core` (domínio + ports + serviços), `adapter-github`, `cli-claude-code`, `factory-kairos-forge` e `daemon`.
- **Loop principal** poll → reconcile → dispatch → monitor → cleanup sobre os 6 estados canônicos da §2.
- **Adapter GitHub** (Issues + detecção de PR via `Closes #N` e convenção de branch `symphony/<issue_id>`).
- **Spawn de CLI** Claude Code via `node-pty` (PTY real, §4.1), com modo de permissão configurável.
- **Fábrica kairos-forge** lendo personas `.md` do filesystem para construir o prompt (§6).
- **Roteamento** completo: default + label `agent:<id>` + `routing.rules` por tipo de issue (§5).
- **Workspace** isolado por git worktree, branch própria — nunca push direto na `main` (§12).
- **Confiabilidade básica:** detecção de stall e crash + retry com backoff exponencial `[1min, 4min, 16min]`, máx 3 (§7-§8).
- **Persistência** SQLite (`better-sqlite3`, WAL, schema versionado) que sobrevive a restart do daemon (§9).
- **Reconciliação** dos 6 cenários da §9.1 + comando `symphony reconcile --dry-run`.
- **Observabilidade:** logs JSON line-delimited em PT-BR com redaction de tokens (§11) + stream de terminal por agente em `<workspace>/.symphony/terminal.log` (§13.1).
- **Config** via YAML + env `SYMPHONY_*` + flags de CLI (precedência flags > env > YAML), validada com Zod (§10).
- **CLI `symphony`** (`packages/daemon`) com 4 subcomandos: `start`, `reconcile [--dry-run]`, `ps`, `attach <issue_id>`.
- **Suíte de conformidade** `tests/conformance` mapeando SPEC §2-§15 + testes de integração (dispatch, reconcile, restart, stall) com fakes.
- **CI** GitHub Actions (`.github/workflows/ci.yml`) rodando lint + typecheck + test + conformance em Ubuntu e macOS.
- **`docs/M1-DEMO.md`** — roteiro manual de 8 passos (DoD humano) provando o end-to-end em ambiente real.
- Specs e plano de implementação do M1 em `docs/superpowers/`.

### Mudado

- `README.md` e `SPEC.md`: status atualizado de "sem implementação" para "M1 implementado"; README ganhou a seção **Estado da implementação** (milestones M1-M5) e instruções de desenvolvimento; seção "Contribuir" reescrita para o fluxo pós-M1.

## [0.4.0] — 2026-05-14

Versão resultante de um **reality-check** da SPEC contra a arquitetura do AgentsMesh — um orquestrador de coding agents já em produção (771 commits, 14 releases). O cruzamento expôs furos estruturais que teriam travado a implementação.

### Adicionado

- **§1.1 Escopo: local-first** — decisão explícita de que a v0.x roda no mesmo host do desenvolvedor. Sem control plane / data plane separados, sem runner remoto, sem relay de rede. Operação remota multi-host é responsabilidade do `kairos-platform`, não desta spec. Corta ~70% da complexidade e tira o Symphony da rota de colisão com plataformas remotas.
- **§1.2 Assunções de ambiente** — declara explicitamente o que era implícito: CLI pré-autenticado no host, single-tenant by design, host confiável.
- **§4.1 Spawn do agente — PTY, não pipe simples** — CLIs interativos (Claude Code, Codex, OpenCode) precisam de pseudo-terminal. `child_process.spawn()` com pipes funciona em teste trivial e falha em uso real. Requisito que faltava por completo.
- **§9.1 Reconciliação estado-daemon ↔ estado-tracker** — promovida de bullet subestimado para seção própria. Tabela de 6 cenários de divergência (issue fechada na mão, label removida, PR mergeado fora do fluxo, etc.) + princípios de reconciliação. É a fonte número um de bugs em sistemas deste tipo.
- **§13.1 Observação de terminal ao vivo** — logs JSON servem para auditoria depois do fato, não para "o que o agente está fazendo agora?". Requisito de stream de terminal por agente via filesystem local, com comandos `symphony attach` e `symphony ps`.
- Passo de reconciliação adicionado ao loop principal (§3) — divergência acontece na operação normal, não só no restart.
- Checklist de conformidade (§15) atualizado com os 4 novos requisitos.
- Nota sobre escolha de linguagem da reference implementation — Node/TS vs Go deve ser decisão consciente; AgentsMesh escolheu Go para a camada de daemon.

### Corrigido

- **Numeração de seções** — havia duas `§17`. A seção "Harness-readiness" tinha header `§16` mas subseções numeradas `§17.1`–`§17.5`. Renumeradas para `§16.1`–`§16.5`. Numeração agora contígua de 1 a 18.
- **Header da SPEC** — dizia `Versão: 0.1.0-draft` enquanto o CHANGELOG estava em 0.3.2. Sincronizado para 0.4.0-draft.

### Anti-objetivos atualizados (§14)

- Operação remota multi-host, multi-tenancy e gestão de credenciais de modelo agora explicitamente listados como fora de escopo, com ponteiro para o `kairos-platform`.

## [0.3.2] — 2026-05-10

### Corrigido

- README: descrição da camada Operations estava com escopos trocados entre `kairos-studio` e `kairos-platform`. Correção: `kairos-platform` é o **backend SaaS multi-tenant** (Observabilidade + FinOps + AIOps + AI Studio); `kairos-studio` é o **SDK cliente** que produtos VilelaAI consomem (`@kairos.ai/studio-ui` + `@kairos.ai/studio-sdk` + `studio.kairos.ai`). Studio é cliente, platform é servidor.

## [0.3.1] — 2026-05-10

### Adicionado

- README atualizado com diagrama completo do **ecossistema KairOS** em 6 camadas (Foundation, Domains, Runtime, Orchestration, Operations, Products), mostrando os 8 componentes do ecossistema (`kairos-forge`, `kairos-ai`, `kairos-domains`, `kairos-runtime`, `kairos-symphony`, `kairos-studio`, `kairos-platform`, produtos finais) e onde Symphony se encaixa (camada 4).
- Link cruzado para o diagrama detalhado no `kairos-forge` (fonte canônica).

## [0.3.0] — 2026-05-10

### Adicionado

- **§17 da SPEC: Loop autônomo por issue (opcional)** — nova capability MAY que permite executar uma issue em modo loop iterativo até atingir critério verificável. Inclui: (a) configuração via label da issue (`iterate:loop`, `iterate:single`, `iterate:loop:N`), config global ou frontmatter da descrição; (b) checkpoint file por workspace; (c) detecção e stopping conditions (DONE / BLOCKED / max-iterations); (d) adaptação por CLI usando mecanismos nativos quando disponíveis (Ralph Loop oficial no Claude Code, `/goal` no Codex, fallback manual no OpenCode); (e) gestão de concorrência (1 slot por loop, não 1 por iteração); (f) warning para loops longos (>4h default).
- §18 (antiga §17) renumerada — mantém o conteúdo "Mudanças e versionamento".

### Por que importa

Antes de v0.3, toda issue era single-shot: agente trabalha 1 turn e termina. Isso falha em casos como migrações, refactors grandes, otimização contra eval suite — tarefas que exigem iteração contra critério mensurável. Loop autônomo é o **5º pilar do harness** definido pelo Forge ADR-0006 e é pré-requisito implícito pra escalar Symphony em ambientes de produção que tenham essas tarefas longas.

### Referências

- [Ralph Loop oficial (Anthropic)](https://claude.com/plugins/ralph-loop) — pattern de referência pra Claude Code
- [/goal use case (OpenAI)](https://developers.openai.com/codex/use-cases/follow-goals) — pattern de referência pra Codex
- ADR-0006 do `kairos-forge` — define protocolo de iteração como 5º pilar do harness
- Skill `/kairos-forge:perseguir` — implementação per-CLI no nível de fábrica

## [0.2.0] — 2026-05-10

### Adicionado

- **§16 da SPEC: Harness-readiness (pré-requisito)** — nova seção MUST/SHOULD definindo que Symphony deve validar harness do repo antes de despachar primeira issue. Inclui (a) definição dos 4 pilares de harness baseados em [Harness Engineering OpenAI](https://openai.com/index/harness-engineering/), (b) protocolo de validação no startup, (c) comportamento em repo não-pronto com exit code != 0, (d) flag `--skip-harness-check` opcional com warning conspícuo, (e) re-validação periódica e modo "drain" se harness degradar.
- README atualizado com nota crítica sobre dependência de harness do `kairos-forge` (ou `kairos-ai`) antes do daemon rodar. Diagrama de posicionamento revisado.

### Mudado

- Symphony agora se posiciona explicitamente como camada **acima** de uma fundação harness, não como solução standalone. Isso evita o erro de instalar o daemon em repo legado e amplificar problemas (gerar N PRs ruins em paralelo em vez de 1 PR ruim sequencial).
- §17 (antiga §16) renomeada para "Mudanças e versionamento" — mantém o conteúdo, ajusta numeração para acomodar a nova §16.

## [0.1.1] — 2026-05-10

### Corrigido

- README: removida menção errônea a `kairos-runtime` no diagrama de posicionamento. Symphony spawna processos de CLI (Claude Code, Codex, OpenCode); a chamada à API LLM é feita pelo próprio CLI, não pela `runtime`. A `kairos-runtime` é biblioteca NPM para aplicações chamarem agentes diretamente — caso de uso diferente.
- ADR: nova seção "Por que NÃO usar kairos-runtime" documenta a fronteira entre os dois projetos.

## [0.1.0] — 2026-05-10

### Adicionado

- README.md com posicionamento, roadmap e diferenças vs Symphony OpenAI
- SPEC.md v0.1-draft em formato RFC (16 seções)
- docs/decisao-arquitetural.md com whys das escolhas
- examples/kairos-symphony.config.yaml de referência
- LICENSE MIT
- .gitignore preparado pra Node/TS

### Próximo

- Validar SPEC.md com 2-3 devs externos antes de freezar
- Iniciar reference implementation em Node/TS após freeze
- Criar suite de testes de conformidade

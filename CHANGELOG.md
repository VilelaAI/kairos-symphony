# Changelog

Todas as mudanças notáveis neste projeto serão documentadas aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

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

# M1 — Demo manual (DoD humano)

Este roteiro prova end-to-end que o walking skeleton funciona em hardware real, com Claude Code real e GitHub real.

## Pré-requisitos

1. **Node ≥ 22.13** (`node --version`)
2. **pnpm ≥ 11** (`pnpm --version`)
3. **`claude` CLI** instalado no PATH, autenticado (`which claude`, `claude --version`)
4. **`gh` CLI** autenticado em conta com acesso ao repo de teste
5. **Plugin `kairos-forge` instalado** no Claude Code (ou diretório de agents apontado via `factory.local_path`)
6. **Repo GitHub** privado seu para servir de cobaia (ex: `seu-user/symphony-cobaia`)

## Preparar

```bash
git clone git@github.com:VilelaAI/kairos-symphony.git
cd kairos-symphony
pnpm install
pnpm build
```

Crie diretório de workspaces e clone o repo cobaia como "fonte" do worktree:

```bash
mkdir -p ~/.symphony/workspaces
git clone git@github.com:seu-user/symphony-cobaia.git ~/.symphony/repo
```

Crie `kairos-symphony.config.yaml` na raiz do projeto:

```yaml
tracker:
  type: github
  repo: seu-user/symphony-cobaia
  token_env: GITHUB_TOKEN
  poll_interval_ms: 30000

cli:
  type: claude-code
  binary_path: /Users/SEU_USER/.nvm/versions/node/v25.0.0/bin/claude  # ajuste
  permission_mode: bypass

factory:
  type: kairos-forge
  installation: plugin

workspaces:
  root: /Users/SEU_USER/.symphony/workspaces
  repo_path: /Users/SEU_USER/.symphony/repo
  base_branch: main
  branch_naming_pattern: "symphony/{issue_id}"
  retention_days: 7

routing:
  default_agent: laura-tech-lead

limits:
  concurrent_agents: 1
  stall_timeout_ms: 600000
  max_retries: 3

storage:
  type: sqlite
  path: /Users/SEU_USER/.symphony/state.db

logging:
  level: info
  format: json
  output: stdout
  language: pt-BR
```

Exporte o token:

```bash
export GITHUB_TOKEN=$(gh auth token)
```

## Demo (8 passos)

**1.** Crie no GitHub uma issue no repo cobaia com **título e descrição realistas** (ex: "Adicionar README inicial"). Adicione a label `symphony:ready`.

**2.** Em um terminal, suba o daemon:

```bash
node packages/daemon/dist/bin.js start --config kairos-symphony.config.yaml
```

Você deverá ver logs JSON com `event: daemon_started`, `tracker_polled`, `issue_dispatched`.

**3.** Em **outro** terminal, liste agentes ativos:

```bash
node packages/daemon/dist/bin.js ps --config kairos-symphony.config.yaml
```

Saída esperada: 1 linha com a issue em `in_progress` e path do `terminal.log`.

**4.** Veja o agente trabalhando ao vivo:

```bash
node packages/daemon/dist/bin.js attach --config kairos-symphony.config.yaml seu-user/symphony-cobaia#1
```

Você verá o output do Claude Code em tempo real.

**5.** Aguarde — o agente vai abrir um PR no repo cobaia com o branch `symphony/seu-user-symphony-cobaia-1` e corpo contendo `Closes #1`.

**6.** No próximo polling (até 30s), o daemon detecta o PR e move a issue para `review_pending`:

```bash
node packages/daemon/dist/bin.js ps --config kairos-symphony.config.yaml
```

Verá agora a issue em `review_pending`.

**7.** Aprove e merge o PR manualmente no GitHub.

**8.** No próximo polling, a issue fica `closed`/`done`; o daemon limpa o worktree:

```bash
ls ~/.symphony/workspaces/
# diretório seu-user-symphony-cobaia-1 deve ter sido removido
```

## Diagnóstico

- `symphony reconcile --dry-run` lista divergências detectadas sem aplicar nada
- `sqlite3 ~/.symphony/state.db "SELECT * FROM transitions;"` mostra histórico completo
- O `terminal.log` de qualquer worktree fica preservado em `<workspace>/.symphony/terminal.log` — útil quando agente trava

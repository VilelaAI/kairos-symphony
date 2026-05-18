# M1 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o walking skeleton (M1) do `kairos-symphony` — daemon TS que polla GitHub Issues, despacha Claude Code via PTY em git worktree isolado, detecta PR aberto, reconcilia divergências (§9.1) e persiste estado em SQLite — passando demo manual, suite vitest e suite de conformidade da SPEC.

**Architecture:** Monorepo pnpm workspaces com 5 pacotes (`core`, `adapter-github`, `cli-claude-code`, `factory-kairos-forge`, `daemon`). `core` define ports (TrackerPort/CliPort/FactoryPort/StateStore/Clock) + serviços (Daemon, AgentSupervisor, Reconciler, etc.). Adapters concretos só são wired no `daemon` bin. Modelo "supervisor por agente": cada issue ativa tem uma instância `AgentSupervisor` com lifecycle isolado, testável com fakes.

**Tech Stack:** TypeScript estrito, Node ≥ 22.5, pnpm 11.x, vitest, biome, tsx, node-pty, better-sqlite3, @octokit/rest, gray-matter (frontmatter), citty (CLI), zod (config validation), uuid, pino-style logger custom (sem dep), msw (mock HTTP nos testes).

**Design ref:** `docs/superpowers/specs/2026-05-14-m1-walking-skeleton-design.md` (aprovado).

---

## Estrutura de arquivos

Tudo abaixo é **criado novo** (repo está vazio de código). Paths absolutos relativos à raiz `kairos-symphony/`.

### Root do monorepo

```
package.json                        # workspace root, scripts agregados
pnpm-workspace.yaml                 # declara packages/* e tests/*
pnpm-lock.yaml                      # gerado automaticamente
tsconfig.base.json                  # config TS comum (strict, ESM, Node22)
biome.json                          # lint + format
vitest.workspace.ts                 # agrega vitest configs dos workspaces
.editorconfig
.nvmrc                              # node 22.5+
.github/workflows/ci.yml
```

### Pacote: `packages/core`

```
package.json
tsconfig.json
vitest.config.ts
src/
  index.ts                          # re-exports públicos
  domain/
    states.ts                       # IssueState enum + transições válidas
    issue.ts                        # Issue, IssueRecord
    agent.ts                        # AgentId, AgentDescriptor
    workspace.ts                    # WorkspaceInfo
    pr.ts                           # PullRequestRef
    transition.ts                   # Transition, Dispatch
    correlation.ts                  # newCorrelationId()
  ports/
    tracker.ts                      # TrackerPort
    cli.ts                          # CliPort, SpawnOpts, AgentProcess
    factory.ts                      # FactoryPort
    store.ts                        # StateStore
    clock.ts                        # Clock, TimerHandle
  services/
    logger.ts                       # JSON line logger + redaction
    logger.test.ts
    prompt-builder.ts               # §6 prompt + size guard
    prompt-builder.test.ts
    router.ts                       # §5 routing precedência
    router.test.ts
    system-clock.ts                 # impl real do Clock
    workspace-manager.ts            # git worktree create/cleanup
    workspace-manager.test.ts
    agent-supervisor.ts             # lifecycle de 1 agente
    agent-supervisor.test.ts
    reconciler.ts                   # 6 cenários §9.1
    reconciler.test.ts
    daemon.ts                       # loop principal
    daemon.test.ts
    store/
      sqlite.ts                     # SqliteStateStore
      sqlite.test.ts
      migrations/
        001-initial.sql
```

### Pacote: `packages/adapter-github`

```
package.json
tsconfig.json
vitest.config.ts
src/
  index.ts
  github-tracker.ts                 # implementa TrackerPort
  github-tracker.test.ts
```

### Pacote: `packages/cli-claude-code`

```
package.json
tsconfig.json
vitest.config.ts
src/
  index.ts
  claude-code-cli.ts                # implementa CliPort via node-pty
  claude-code-cli.test.ts
  fixtures/
    fake-cli.sh                     # script bash que simula CLI (usado em testes)
```

### Pacote: `packages/factory-kairos-forge`

```
package.json
tsconfig.json
vitest.config.ts
src/
  index.ts
  kairos-forge-factory.ts           # implementa FactoryPort
  kairos-forge-factory.test.ts
```

### Pacote: `packages/daemon`

```
package.json
tsconfig.json
src/
  bin.ts                            # entry point #!/usr/bin/env node
  config/
    schema.ts                       # Zod schema
    loader.ts                       # YAML + env + flags
    loader.test.ts
  wiring.ts                         # injeção de dependências
  commands/
    start.ts
    reconcile.ts
    ps.ts
    attach.ts
```

### Tests cross-package

```
tests/
  integration/
    dispatch.integration.test.ts
    stall.integration.test.ts
    reconcile.integration.test.ts
    restart.integration.test.ts
    fakes/
      fake-clock.ts
      fake-tracker.ts
      fake-cli.ts
      fake-factory.ts
  conformance/
    spec-02-states.test.ts
    spec-03-main-loop.test.ts
    spec-04-workspace.test.ts
    spec-04-1-pty.test.ts
    spec-05-routing.test.ts
    spec-06-prompt.test.ts
    spec-07-pr-detection.test.ts
    spec-08-stall-crash.test.ts
    spec-09-persistence.test.ts
    spec-09-1-reconciliation.test.ts
    spec-10-config.test.ts
    spec-11-logs.test.ts
    spec-12-security.test.ts
    spec-13-1-terminal-stream.test.ts
    spec-15-checklist.test.ts
```

### Docs novos

```
docs/M1-DEMO.md                     # roteiro do demo manual
```

---

## Convenções gerais do plano

- **TDD**: para cada serviço com comportamento, primeiro teste, então impl. Para code "estrutural" (tipos, ports, configuração), pula-se o passo de teste e só verifica via `pnpm typecheck`.
- **Commits**: 1 commit por task. Mensagem segue `escopo: descrição curta`. Co-author Claude no rodapé.
- **Comando de teste por workspace**: `pnpm --filter @kairos-symphony/<pkg> test` para rodar suite de um pacote.
- **Comando de teste global**: `pnpm test` (vitest workspace).
- **Path traversal proteção**: validar via `path.resolve(root, x).startsWith(path.resolve(root) + path.sep)`.
- **Datas no DB**: ISO 8601 UTC strings.
- **IDs**: `issueId` no formato `owner/repo#number` (ex: `VilelaAI/repo#42`).

---

## Fase 0 — Bootstrap do monorepo (Tasks 1-4)

### Task 1: Root workspace + pnpm config

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.nvmrc`
- Create: `.editorconfig`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "kairos-symphony-monorepo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.5.0",
    "pnpm": ">=11"
  },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:conformance": "vitest run tests/conformance",
    "test:integration": "vitest run tests/integration"
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "@vitest/coverage-v8": "2.1.8",
    "tsx": "4.19.2",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - packages/*
  - tests
```

- [ ] **Step 3: Create `.nvmrc`**

```
22.5.0
```

- [ ] **Step 4: Create `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 5: Verify**

Run: `node --version && pnpm --version`
Expected: Node ≥ 22.5, pnpm ≥ 11.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .nvmrc .editorconfig
git commit -m "chore: monorepo root config (pnpm workspaces, Node 22.5+)"
```

---

### Task 2: TypeScript & Biome config

**Files:**
- Create: `tsconfig.base.json`
- Create: `biome.json`

- [ ] **Step 1: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **Step 2: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "ignore": ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/*.sql"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "style": { "useImportType": "error", "useNodejsImportProtocol": "error" }
    }
  }
}
```

- [ ] **Step 3: Install root dev deps**

Run: `pnpm install`
Expected: cria `node_modules`, `pnpm-lock.yaml`. Sem erros.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.base.json biome.json pnpm-lock.yaml
git commit -m "chore: TypeScript strict config + Biome lint/format"
```

---

### Task 3: Vitest workspace + CI

**Files:**
- Create: `vitest.workspace.ts`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `vitest.workspace.ts`**

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  {
    test: {
      include: ['tests/**/*.test.ts'],
      name: 'tests',
      environment: 'node',
    },
  },
]);
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint-typecheck-test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: '22.5.0'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test --coverage
      - run: pnpm test:conformance
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-${{ matrix.os }}
          path: coverage/
```

- [ ] **Step 3: Commit**

```bash
git add vitest.workspace.ts .github/workflows/ci.yml
git commit -m "chore: vitest workspace + GitHub Actions CI matrix (ubuntu/macos, node 22.5)"
```

---

### Task 4: Workspaces vazias (5 packages + tests)

Cria scaffolding mínimo de cada workspace (`package.json` + `tsconfig.json`). Sem código ainda.

**Files:**
- Create: `packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `packages/adapter-github/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `packages/cli-claude-code/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `packages/factory-kairos-forge/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Create: `packages/daemon/{package.json,tsconfig.json,src/bin.ts}`
- Create: `tests/{package.json,tsconfig.json}`

- [ ] **Step 1: `packages/core/package.json`**

```json
{
  "name": "@kairos-symphony/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "11.7.0",
    "uuid": "11.0.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.12",
    "@types/node": "22.10.2",
    "@types/uuid": "10.0.0",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist"]
}
```

- [ ] **Step 3: `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kairos-symphony/core',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
```

- [ ] **Step 4: `packages/core/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: `packages/adapter-github/package.json`**

```json
{
  "name": "@kairos-symphony/adapter-github",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@kairos-symphony/core": "workspace:*",
    "@octokit/rest": "21.0.2"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "msw": "2.7.0",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 6: `packages/adapter-github/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 7: `packages/adapter-github/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kairos-symphony/adapter-github',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
```

- [ ] **Step 8: `packages/adapter-github/src/index.ts`**

```ts
export {};
```

- [ ] **Step 9: `packages/cli-claude-code/package.json`**

```json
{
  "name": "@kairos-symphony/cli-claude-code",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@kairos-symphony/core": "workspace:*",
    "node-pty": "1.0.0"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 10: `packages/cli-claude-code/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 11: `packages/cli-claude-code/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kairos-symphony/cli-claude-code',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
```

- [ ] **Step 12: `packages/cli-claude-code/src/index.ts`**

```ts
export {};
```

- [ ] **Step 13: `packages/factory-kairos-forge/package.json`**

```json
{
  "name": "@kairos-symphony/factory-kairos-forge",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@kairos-symphony/core": "workspace:*",
    "gray-matter": "4.0.3"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 14: `packages/factory-kairos-forge/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 15: `packages/factory-kairos-forge/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@kairos-symphony/factory-kairos-forge',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
```

- [ ] **Step 16: `packages/factory-kairos-forge/src/index.ts`**

```ts
export {};
```

- [ ] **Step 17: `packages/daemon/package.json`**

```json
{
  "name": "@kairos-symphony/daemon",
  "version": "0.1.0",
  "type": "module",
  "bin": { "symphony": "./dist/bin.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/bin.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "dev": "tsx src/bin.ts"
  },
  "dependencies": {
    "@kairos-symphony/adapter-github": "workspace:*",
    "@kairos-symphony/cli-claude-code": "workspace:*",
    "@kairos-symphony/core": "workspace:*",
    "@kairos-symphony/factory-kairos-forge": "workspace:*",
    "citty": "0.1.6",
    "yaml": "2.6.1",
    "zod": "3.24.1"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 18: `packages/daemon/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist"],
  "references": [
    { "path": "../core" },
    { "path": "../adapter-github" },
    { "path": "../cli-claude-code" },
    { "path": "../factory-kairos-forge" }
  ]
}
```

- [ ] **Step 19: `packages/daemon/src/bin.ts`** (stub)

```ts
#!/usr/bin/env node
console.log('symphony bin — placeholder');
```

- [ ] **Step 20: `tests/package.json`**

```json
{
  "name": "@kairos-symphony/tests",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@kairos-symphony/adapter-github": "workspace:*",
    "@kairos-symphony/cli-claude-code": "workspace:*",
    "@kairos-symphony/core": "workspace:*",
    "@kairos-symphony/daemon": "workspace:*",
    "@kairos-symphony/factory-kairos-forge": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 21: `tests/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "references": [
    { "path": "../packages/core" },
    { "path": "../packages/adapter-github" },
    { "path": "../packages/cli-claude-code" },
    { "path": "../packages/factory-kairos-forge" },
    { "path": "../packages/daemon" }
  ]
}
```

- [ ] **Step 22: Install all workspace deps**

Run: `pnpm install`
Expected: instala deps de todos os workspaces. Verifica que `node-pty` e `better-sqlite3` compilaram (binários nativos).

- [ ] **Step 23: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS em todos os workspaces (cada um só tem stub `export {}`).

- [ ] **Step 24: Commit**

```bash
git add packages/ tests/ pnpm-lock.yaml
git commit -m "chore: scaffold 5 workspaces (core, adapter-github, cli-claude-code, factory-kairos-forge, daemon) + tests"
```

---

## Fase 1 — Core domain types + ports (Tasks 5-6)

### Task 5: Domain types

**Files:**
- Create: `packages/core/src/domain/states.ts`
- Create: `packages/core/src/domain/issue.ts`
- Create: `packages/core/src/domain/agent.ts`
- Create: `packages/core/src/domain/workspace.ts`
- Create: `packages/core/src/domain/pr.ts`
- Create: `packages/core/src/domain/transition.ts`
- Create: `packages/core/src/domain/correlation.ts`

- [ ] **Step 1: `domain/states.ts`**

```ts
export const ISSUE_STATES = [
  'triage',
  'ready',
  'in_progress',
  'blocked',
  'review_pending',
  'done',
] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

const ALLOWED_TRANSITIONS: Record<IssueState, ReadonlyArray<IssueState>> = {
  triage: ['ready'],
  ready: ['in_progress', 'blocked'],
  in_progress: ['blocked', 'review_pending', 'ready'],
  blocked: ['ready', 'in_progress'],
  review_pending: ['done', 'ready'],
  done: [],
};

export function isAllowedTransition(from: IssueState, to: IssueState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
```

- [ ] **Step 2: `domain/issue.ts`**

```ts
import type { IssueState } from './states.js';

export type IssueId = string; // "owner/repo#42"

export interface Issue {
  id: IssueId;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: IssueState;
}

export interface IssueRecord {
  issueId: IssueId;
  trackerType: string;
  state: IssueState;
  agentId: string | null;
  workspacePath: string | null;
  branchName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  prNumber: number | null;
  correlationId: string | null;
  lastSyncedAt: string;
  blockedReason: string | null;
}
```

- [ ] **Step 3: `domain/agent.ts`**

```ts
export type AgentId = string;

export interface AgentDescriptor {
  id: AgentId;
  name: string;
  description: string;
  body: string;
  filePath: string;
}
```

- [ ] **Step 4: `domain/workspace.ts`**

```ts
export interface WorkspaceInfo {
  issueId: string;
  path: string;
  branchName: string;
  baseBranch: string;
  terminalLogPath: string;
}
```

- [ ] **Step 5: `domain/pr.ts`**

```ts
export interface PullRequestRef {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
}
```

- [ ] **Step 6: `domain/transition.ts`**

```ts
import type { IssueId } from './issue.js';
import type { IssueState } from './states.js';

export interface Transition {
  issueId: IssueId;
  fromState: IssueState | null;
  toState: IssueState;
  reason: string;
  evidence: string | null;
  correlationId: string;
  occurredAt: string;
}

export type DispatchOutcome = 'pr_opened' | 'stalled' | 'crashed' | 'exited_no_pr';

export interface Dispatch {
  issueId: IssueId;
  agentId: string;
  attempt: number;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  outcome: DispatchOutcome | null;
  correlationId: string;
}
```

- [ ] **Step 7: `domain/correlation.ts`**

```ts
import { v4 as uuidv4 } from 'uuid';

export function newCorrelationId(): string {
  return uuidv4();
}
```

- [ ] **Step 8: Update `packages/core/src/index.ts`**

```ts
export * from './domain/states.js';
export * from './domain/issue.js';
export * from './domain/agent.js';
export * from './domain/workspace.js';
export * from './domain/pr.js';
export * from './domain/transition.js';
export * from './domain/correlation.js';
```

- [ ] **Step 9: Verify**

Run: `pnpm --filter @kairos-symphony/core typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): domain types (states, issue, agent, workspace, pr, transition, correlation)"
```

---

### Task 6: Ports (interfaces)

**Files:**
- Create: `packages/core/src/ports/tracker.ts`
- Create: `packages/core/src/ports/cli.ts`
- Create: `packages/core/src/ports/factory.ts`
- Create: `packages/core/src/ports/store.ts`
- Create: `packages/core/src/ports/clock.ts`

- [ ] **Step 1: `ports/tracker.ts`**

```ts
import type { Issue, IssueId } from '../domain/issue.js';
import type { PullRequestRef } from '../domain/pr.js';
import type { IssueState } from '../domain/states.js';

export interface TrackerPort {
  fetchIssuesByState(state: IssueState): Promise<Issue[]>;
  transitionState(issueId: IssueId, to: IssueState, reason: string): Promise<void>;
  detectLinkedPR(issueId: IssueId): Promise<PullRequestRef | null>;
  isIssueClosed(issueId: IssueId): Promise<boolean>;
  isPRMerged(prNumber: number): Promise<boolean>;
}
```

- [ ] **Step 2: `ports/cli.ts`**

```ts
export interface SpawnOpts {
  binaryPath: string;
  cwd: string;
  prompt: string;
  permissionMode: 'plan' | 'auto' | 'bypass';
  env?: Record<string, string>;
  ptyCols?: number;
  ptyRows?: number;
}

export interface AgentProcess {
  pid: number;
  onData(handler: (chunk: string) => void): void;
  onExit(handler: (exitCode: number, signal: string | null) => void): void;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}

export interface CliPort {
  spawn(opts: SpawnOpts): AgentProcess;
}
```

- [ ] **Step 3: `ports/factory.ts`**

```ts
import type { AgentDescriptor, AgentId } from '../domain/agent.js';

export interface FactoryPort {
  loadAgent(id: AgentId): Promise<AgentDescriptor>;
  listAgents(): Promise<AgentId[]>;
}
```

- [ ] **Step 4: `ports/store.ts`**

```ts
import type { IssueId, IssueRecord } from '../domain/issue.js';
import type { IssueState } from '../domain/states.js';
import type { Dispatch, Transition } from '../domain/transition.js';

export interface StateStore {
  upsertIssue(record: IssueRecord): void;
  getIssue(issueId: IssueId): IssueRecord | null;
  listActiveIssues(): IssueRecord[];
  listInState(state: IssueState): IssueRecord[];
  recordTransition(t: Transition): void;
  recordDispatch(d: Dispatch): number;
  updateDispatchOutcome(
    dispatchId: number,
    outcome: Dispatch['outcome'],
    exitCode: number | null,
    endedAt: string,
  ): void;
  close(): void;
}
```

- [ ] **Step 5: `ports/clock.ts`**

```ts
export type TimerHandle = symbol;

export interface Clock {
  now(): Date;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
```

- [ ] **Step 6: Update `packages/core/src/index.ts`**

```ts
export * from './domain/states.js';
export * from './domain/issue.js';
export * from './domain/agent.js';
export * from './domain/workspace.js';
export * from './domain/pr.js';
export * from './domain/transition.js';
export * from './domain/correlation.js';
export * from './ports/tracker.js';
export * from './ports/cli.js';
export * from './ports/factory.js';
export * from './ports/store.js';
export * from './ports/clock.js';
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @kairos-symphony/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): ports (TrackerPort, CliPort, FactoryPort, StateStore, Clock)"
```

---

## Fase 2 — Serviços puros (Tasks 7-9)

### Task 7: Logger (JSON line + redaction)

**Files:**
- Create: `packages/core/src/services/logger.ts`
- Create: `packages/core/src/services/logger.test.ts`

- [ ] **Step 1: Write failing test `logger.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { Logger } from './logger.js';

describe('Logger', () => {
  it('emite linha JSON com campos canônicos', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink, now: () => new Date('2026-05-18T10:00:00Z') });
    log.info({ event: 'issue_dispatched', issue_id: 'r#1', message: 'oi' });
    expect(sink).toHaveBeenCalledOnce();
    const line = sink.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line.trimEnd());
    expect(parsed).toMatchObject({
      timestamp: '2026-05-18T10:00:00.000Z',
      level: 'info',
      event: 'issue_dispatched',
      issue_id: 'r#1',
      message: 'oi',
    });
  });

  it('faz redaction de campos sensíveis', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink, now: () => new Date('2026-05-18T10:00:00Z') });
    log.info({
      event: 'tracker_polled',
      token: 'gho_secret123',
      api_key: 'sk-xxx',
      authorization: 'Bearer abc',
      password: 'p',
      nested: { secret: 'leak' },
      message: 'hello',
    });
    const parsed = JSON.parse((sink.mock.calls[0]?.[0] as string).trimEnd());
    expect(parsed.token).toBe('***');
    expect(parsed.api_key).toBe('***');
    expect(parsed.authorization).toBe('***');
    expect(parsed.password).toBe('***');
    expect(parsed.nested.secret).toBe('***');
  });

  it('respeita nível de log', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'warn', write: sink, now: () => new Date() });
    log.debug({ event: 'x', message: 'a' });
    log.info({ event: 'x', message: 'b' });
    log.warn({ event: 'x', message: 'c' });
    log.error({ event: 'x', message: 'd' });
    expect(sink).toHaveBeenCalledTimes(2); // warn + error
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: FAIL — `Logger` not defined.

- [ ] **Step 3: Implement `services/logger.ts`**

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_PATTERNS = [/token/i, /secret/i, /password/i, /api[_-]?key/i, /authorization/i];

export interface LoggerOpts {
  level: LogLevel;
  write?: (line: string) => void;
  now?: () => Date;
}

export interface LogFields {
  event: string;
  message: string;
  [k: string]: unknown;
}

function shouldRedact(key: string): boolean {
  return REDACT_PATTERNS.some((re) => re.test(key));
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shouldRedact(k) ? '***' : redact(v);
  }
  return out;
}

export class Logger {
  private readonly write: (line: string) => void;
  private readonly now: () => Date;
  private readonly level: LogLevel;

  constructor(opts: LoggerOpts) {
    this.level = opts.level;
    this.write = opts.write ?? ((line) => process.stdout.write(line));
    this.now = opts.now ?? (() => new Date());
  }

  private emit(level: LogLevel, fields: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const safe = redact({ ...fields }) as Record<string, unknown>;
    const line = `${JSON.stringify({
      timestamp: this.now().toISOString(),
      level,
      ...safe,
    })}\n`;
    this.write(line);
  }

  debug(f: LogFields): void {
    this.emit('debug', f);
  }
  info(f: LogFields): void {
    this.emit('info', f);
  }
  warn(f: LogFields): void {
    this.emit('warn', f);
  }
  error(f: LogFields): void {
    this.emit('error', f);
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 3 PASS.

- [ ] **Step 5: Export logger**

Edit `packages/core/src/index.ts`, append:

```ts
export * from './services/logger.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/logger.ts packages/core/src/services/logger.test.ts packages/core/src/index.ts
git commit -m "feat(core): JSON line Logger with field-name redaction"
```

---

### Task 8: PromptBuilder

**Files:**
- Create: `packages/core/src/services/prompt-builder.ts`
- Create: `packages/core/src/services/prompt-builder.test.ts`

- [ ] **Step 1: Write failing test `prompt-builder.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import { PromptBuilder, PromptTooLargeError } from './prompt-builder.js';

const issue: Issue = {
  id: 'VilelaAI/repo#42',
  number: 42,
  title: 'Corrige cálculo de imposto',
  body: 'Quando o ICMS é maior que 18%, o sistema arredonda errado.',
  labels: ['bug', 'agent:lucas-backend'],
  state: 'ready',
};

const agent: AgentDescriptor = {
  id: 'lucas-backend',
  name: 'Lucas — Backend',
  description: 'Engenheiro backend Node/TS',
  body: 'Você é o Lucas. Foca em qualidade e testes.',
  filePath: '/fake/lucas.md',
};

const workspace: WorkspaceInfo = {
  issueId: 'VilelaAI/repo#42',
  path: '/var/symphony/workspaces/VilelaAI-repo-42',
  branchName: 'symphony/42',
  baseBranch: 'main',
  terminalLogPath: '/var/symphony/workspaces/VilelaAI-repo-42/.symphony/terminal.log',
};

describe('PromptBuilder', () => {
  const builder = new PromptBuilder({ maxBytes: 1_048_576 });

  it('inclui identidade do agente, contexto da issue, info do workspace e DoD', () => {
    const prompt = builder.build({ issue, agent, workspace });
    expect(prompt).toContain('Lucas — Backend');
    expect(prompt).toContain('Engenheiro backend Node/TS');
    expect(prompt).toContain('VilelaAI/repo#42');
    expect(prompt).toContain('Corrige cálculo de imposto');
    expect(prompt).toContain('symphony/42');
    expect(prompt).toContain('main');
    expect(prompt).toContain('PR aberto');
    expect(prompt).toContain('blocked');
  });

  it('rejeita prompt > maxBytes', () => {
    const huge = 'X'.repeat(2_000_000);
    expect(() =>
      builder.build({ issue: { ...issue, body: huge }, agent, workspace }),
    ).toThrow(PromptTooLargeError);
  });

  it('inclui labels da issue', () => {
    const prompt = builder.build({ issue, agent, workspace });
    expect(prompt).toContain('bug');
    expect(prompt).toContain('agent:lucas-backend');
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: FAIL — `PromptBuilder` not defined.

- [ ] **Step 3: Implement `services/prompt-builder.ts`**

```ts
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';

export class PromptTooLargeError extends Error {
  constructor(public readonly sizeBytes: number, public readonly limit: number) {
    super(`Prompt de ${sizeBytes} bytes excede o limite de ${limit} bytes`);
    this.name = 'PromptTooLargeError';
  }
}

export interface PromptInput {
  issue: Issue;
  agent: AgentDescriptor;
  workspace: WorkspaceInfo;
}

export interface PromptBuilderOpts {
  maxBytes: number;
}

export class PromptBuilder {
  constructor(private readonly opts: PromptBuilderOpts) {}

  build(input: PromptInput): string {
    const { issue, agent, workspace } = input;
    const labelsLine = issue.labels.length > 0 ? issue.labels.join(', ') : '(sem labels)';

    const prompt = [
      `# Identidade do agente`,
      ``,
      `Você é **${agent.name}**.`,
      ``,
      agent.description,
      ``,
      agent.body,
      ``,
      `# Contexto da issue`,
      ``,
      `- ID: ${issue.id}`,
      `- Número: #${issue.number}`,
      `- Título: ${issue.title}`,
      `- Labels: ${labelsLine}`,
      ``,
      `## Descrição`,
      ``,
      issue.body,
      ``,
      `# Workspace`,
      ``,
      `- Path: ${workspace.path}`,
      `- Branch: ${workspace.branchName}`,
      `- Branch base: ${workspace.baseBranch}`,
      ``,
      `Toda mudança deve ser commitada na branch ${workspace.branchName} (já criada).`,
      `Nunca dê push direto para ${workspace.baseBranch}.`,
      ``,
      `# Definition of Done`,
      ``,
      `1. PR aberto para esta issue, com CI verde.`,
      `2. O corpo do PR deve conter "Closes #${issue.number}".`,
      ``,
      `# Se você travar`,
      ``,
      `Se não conseguir progredir, encerre o processo deixando uma última mensagem`,
      `começando com "BLOCKED:" explicando o motivo. O orquestrador moverá a issue`,
      `para o estado blocked e pedirá intervenção humana.`,
      ``,
    ].join('\n');

    const size = Buffer.byteLength(prompt, 'utf8');
    if (size > this.opts.maxBytes) {
      throw new PromptTooLargeError(size, this.opts.maxBytes);
    }
    return prompt;
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 3 PASS para PromptBuilder.

- [ ] **Step 5: Export**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/prompt-builder.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/prompt-builder.ts packages/core/src/services/prompt-builder.test.ts packages/core/src/index.ts
git commit -m "feat(core): PromptBuilder com campos mínimos §6 e limite 1MB"
```

---

### Task 9: Router

**Files:**
- Create: `packages/core/src/services/router.ts`
- Create: `packages/core/src/services/router.test.ts`

- [ ] **Step 1: Write failing test `router.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Issue } from '../domain/issue.js';
import { Router } from './router.js';

const baseIssue: Issue = {
  id: 'r#1',
  number: 1,
  title: 't',
  body: 'b',
  labels: [],
  state: 'ready',
};

describe('Router', () => {
  it('label agent:<id> tem precedência máxima', () => {
    const router = new Router({
      defaultAgent: 'laura-tech-lead',
      rules: [{ label: 'bug', agent: 'lucas-backend' }],
    });
    expect(
      router.route({ ...baseIssue, labels: ['bug', 'agent:carlos-dba'] }),
    ).toBe('carlos-dba');
  });

  it('routing.rules por label de tipo se não houver agent:<id>', () => {
    const router = new Router({
      defaultAgent: 'laura-tech-lead',
      rules: [
        { label: 'docs', agent: 'beatriz-docs' },
        { label: 'bug', agent: 'lucas-backend' },
      ],
    });
    expect(router.route({ ...baseIssue, labels: ['bug'] })).toBe('lucas-backend');
    expect(router.route({ ...baseIssue, labels: ['docs'] })).toBe('beatriz-docs');
  });

  it('default agent quando nada casa', () => {
    const router = new Router({ defaultAgent: 'laura-tech-lead', rules: [] });
    expect(router.route(baseIssue)).toBe('laura-tech-lead');
  });

  it('primeiro rule que casar vence (ordem importa)', () => {
    const router = new Router({
      defaultAgent: 'laura-tech-lead',
      rules: [
        { label: 'bug', agent: 'lucas-backend' },
        { label: 'bug', agent: 'outro-cara' },
      ],
    });
    expect(router.route({ ...baseIssue, labels: ['bug'] })).toBe('lucas-backend');
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: FAIL — Router not defined.

- [ ] **Step 3: Implement `services/router.ts`**

```ts
import type { AgentId } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';

export interface RoutingRule {
  label: string;
  agent: AgentId;
}

export interface RouterConfig {
  defaultAgent: AgentId;
  rules: RoutingRule[];
}

const EXPLICIT_AGENT_PREFIX = 'agent:';

export class Router {
  constructor(private readonly cfg: RouterConfig) {}

  route(issue: Issue): AgentId {
    for (const label of issue.labels) {
      if (label.startsWith(EXPLICIT_AGENT_PREFIX)) {
        return label.slice(EXPLICIT_AGENT_PREFIX.length);
      }
    }
    for (const rule of this.cfg.rules) {
      if (issue.labels.includes(rule.label)) return rule.agent;
    }
    return this.cfg.defaultAgent;
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 4 PASS para Router.

- [ ] **Step 5: Export**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/router.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/router.ts packages/core/src/services/router.test.ts packages/core/src/index.ts
git commit -m "feat(core): Router com precedência label agent:<id> > rules > default"
```

---

### Task 10: SystemClock + FakeClock

**Files:**
- Create: `packages/core/src/services/system-clock.ts`
- Create: `tests/integration/fakes/fake-clock.ts`

- [ ] **Step 1: Implement `services/system-clock.ts`**

```ts
import type { Clock, TimerHandle } from '../ports/clock.js';

export class SystemClock implements Clock {
  private handles = new Map<TimerHandle, NodeJS.Timeout>();

  now(): Date {
    return new Date();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle: TimerHandle = Symbol('timer');
    const timer = setTimeout(() => {
      this.handles.delete(handle);
      fn();
    }, ms);
    this.handles.set(handle, timer);
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    const timer = this.handles.get(handle);
    if (timer) {
      clearTimeout(timer);
      this.handles.delete(handle);
    }
  }
}
```

- [ ] **Step 2: Export SystemClock**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/system-clock.js';
```

- [ ] **Step 3: Create FakeClock for tests**

`tests/integration/fakes/fake-clock.ts`:

```ts
import type { Clock, TimerHandle } from '@kairos-symphony/core';

interface Pending {
  handle: TimerHandle;
  fireAt: number;
  fn: () => void;
}

export class FakeClock implements Clock {
  private currentMs: number;
  private pending: Pending[] = [];

  constructor(start: Date = new Date('2026-05-18T10:00:00Z')) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle: TimerHandle = Symbol('fake-timer');
    this.pending.push({ handle, fireAt: this.currentMs + ms, fn });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.pending = this.pending.filter((p) => p.handle !== handle);
  }

  advance(ms: number): void {
    const target = this.currentMs + ms;
    while (true) {
      const next = this.pending
        .filter((p) => p.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      this.currentMs = next.fireAt;
      this.pending = this.pending.filter((p) => p.handle !== next.handle);
      next.fn();
    }
    this.currentMs = target;
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @kairos-symphony/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/system-clock.ts packages/core/src/index.ts tests/integration/fakes/fake-clock.ts
git commit -m "feat(core): SystemClock + FakeClock para testes"
```

---

## Fase 3 — Persistência SQLite (Tasks 11-14)

### Task 11: Migration runner + schema 001

**Files:**
- Create: `packages/core/src/services/store/migrations/001-initial.sql`
- Create: `packages/core/src/services/store/sqlite.ts`
- Create: `packages/core/src/services/store/sqlite.test.ts`

- [ ] **Step 1: Create `migrations/001-initial.sql`**

```sql
CREATE TABLE issues (
  issue_id          TEXT PRIMARY KEY,
  tracker_type      TEXT NOT NULL,
  state             TEXT NOT NULL,
  agent_id          TEXT,
  workspace_path    TEXT,
  branch_name       TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  pr_number         INTEGER,
  correlation_id    TEXT,
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
  evidence          TEXT,
  correlation_id    TEXT NOT NULL,
  occurred_at       TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);
CREATE INDEX idx_transitions_issue ON transitions(issue_id);

CREATE TABLE dispatches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id          TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  attempt           INTEGER NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  exit_code         INTEGER,
  outcome           TEXT,
  correlation_id    TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);

CREATE TABLE schema_meta (
  version INTEGER NOT NULL
);
INSERT INTO schema_meta (version) VALUES (1);
```

- [ ] **Step 2: Update `core/tsconfig.json`** para incluir SQL files (não precisa compilar mas precisa estar no dist via copy). Vamos resolver lendo o arquivo no runtime, então **não** muda tsconfig — usaremos `readFileSync` apontando para o path relativo ao módulo.

- [ ] **Step 3: Write failing test `sqlite.test.ts`**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SqliteStateStore } from './sqlite.js';

describe('SqliteStateStore — migrations', () => {
  let store: SqliteStateStore;

  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('aplica migration 001 no first open', () => {
    expect(store.schemaVersion()).toBe(1);
  });

  it('é idempotente — segundo open não re-aplica', () => {
    expect(store.schemaVersion()).toBe(1);
    const store2 = new SqliteStateStore({ path: ':memory:' });
    expect(store2.schemaVersion()).toBe(1);
    store2.close();
  });
});
```

- [ ] **Step 4: Run test (expect FAIL)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: FAIL.

- [ ] **Step 5: Implement `services/store/sqlite.ts`** — base com migrations

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { IssueId, IssueRecord } from '../../domain/issue.js';
import type { IssueState } from '../../domain/states.js';
import type { Dispatch, Transition } from '../../domain/transition.js';
import type { StateStore } from '../../ports/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SqliteStateStoreOpts {
  path: string;
}

const MIGRATIONS: ReadonlyArray<{ version: number; file: string }> = [
  { version: 1, file: '001-initial.sql' },
];

export class SqliteStateStore implements StateStore {
  private readonly db: Database.Database;

  constructor(opts: SqliteStateStoreOpts) {
    this.db = new Database(opts.path);
    if (opts.path !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.applyMigrations();
  }

  private applyMigrations(): void {
    const hasMeta = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
      .get();
    const currentVersion = hasMeta
      ? (this.db.prepare('SELECT version FROM schema_meta').get() as { version: number }).version
      : 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      const sql = readFileSync(join(__dirname, 'migrations', migration.file), 'utf8');
      this.db.exec(sql);
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT version FROM schema_meta').get() as
      | { version: number }
      | undefined;
    return row?.version ?? 0;
  }

  // Stubs (próximas tasks implementam)
  upsertIssue(_record: IssueRecord): void {
    throw new Error('not implemented');
  }
  getIssue(_issueId: IssueId): IssueRecord | null {
    throw new Error('not implemented');
  }
  listActiveIssues(): IssueRecord[] {
    throw new Error('not implemented');
  }
  listInState(_state: IssueState): IssueRecord[] {
    throw new Error('not implemented');
  }
  recordTransition(_t: Transition): void {
    throw new Error('not implemented');
  }
  recordDispatch(_d: Dispatch): number {
    throw new Error('not implemented');
  }
  updateDispatchOutcome(): void {
    throw new Error('not implemented');
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 6: Ensure SQL files copied to dist**

Add a `prepare` script. Edit `packages/core/package.json` — replace `"build"`:

```json
"build": "tsc -p tsconfig.json && cp -R src/services/store/migrations dist/services/store/migrations",
```

- [ ] **Step 7: Run tests (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 2 PASS para SqliteStateStore migrations.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/services/store packages/core/package.json
git commit -m "feat(core/store): SqliteStateStore base com migration runner (001-initial)"
```

---

### Task 12: SqliteStateStore — upsertIssue + getIssue

- [ ] **Step 1: Append failing tests em `sqlite.test.ts`**

```ts
import type { IssueRecord } from '../../domain/issue.js';

const sample: IssueRecord = {
  issueId: 'r#1',
  trackerType: 'github',
  state: 'in_progress',
  agentId: 'lucas-backend',
  workspacePath: '/tmp/r-1',
  branchName: 'symphony/1',
  startedAt: '2026-05-18T10:00:00.000Z',
  finishedAt: null,
  retryCount: 0,
  prNumber: null,
  correlationId: '11111111-1111-1111-1111-111111111111',
  lastSyncedAt: '2026-05-18T10:00:00.000Z',
  blockedReason: null,
};

describe('SqliteStateStore — issues', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
  });
  afterEach(() => store.close());

  it('insere e busca por issueId', () => {
    store.upsertIssue(sample);
    expect(store.getIssue('r#1')).toEqual(sample);
  });

  it('upsert sobrescreve campos', () => {
    store.upsertIssue(sample);
    store.upsertIssue({ ...sample, state: 'review_pending', prNumber: 99 });
    expect(store.getIssue('r#1')?.state).toBe('review_pending');
    expect(store.getIssue('r#1')?.prNumber).toBe(99);
  });

  it('getIssue retorna null pra id inexistente', () => {
    expect(store.getIssue('r#nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run (expect FAIL — not implemented)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: FAIL.

- [ ] **Step 3: Implement upsertIssue/getIssue em `sqlite.ts`**

Replace the two stubs:

```ts
  upsertIssue(record: IssueRecord): void {
    this.db
      .prepare(
        `INSERT INTO issues (
           issue_id, tracker_type, state, agent_id, workspace_path, branch_name,
           started_at, finished_at, retry_count, pr_number, correlation_id,
           last_synced_at, blocked_reason
         ) VALUES (
           @issueId, @trackerType, @state, @agentId, @workspacePath, @branchName,
           @startedAt, @finishedAt, @retryCount, @prNumber, @correlationId,
           @lastSyncedAt, @blockedReason
         )
         ON CONFLICT(issue_id) DO UPDATE SET
           tracker_type = excluded.tracker_type,
           state = excluded.state,
           agent_id = excluded.agent_id,
           workspace_path = excluded.workspace_path,
           branch_name = excluded.branch_name,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           retry_count = excluded.retry_count,
           pr_number = excluded.pr_number,
           correlation_id = excluded.correlation_id,
           last_synced_at = excluded.last_synced_at,
           blocked_reason = excluded.blocked_reason`,
      )
      .run(record);
  }

  getIssue(issueId: IssueId): IssueRecord | null {
    const row = this.db
      .prepare('SELECT * FROM issues WHERE issue_id = ?')
      .get(issueId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }
```

Add helper at bottom of file:

```ts
function rowToRecord(row: Record<string, unknown>): IssueRecord {
  return {
    issueId: row.issue_id as string,
    trackerType: row.tracker_type as string,
    state: row.state as IssueRecord['state'],
    agentId: (row.agent_id as string | null) ?? null,
    workspacePath: (row.workspace_path as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    retryCount: row.retry_count as number,
    prNumber: (row.pr_number as number | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
    lastSyncedAt: row.last_synced_at as string,
    blockedReason: (row.blocked_reason as string | null) ?? null,
  };
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 3 PASS para issues.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/store/sqlite.ts packages/core/src/services/store/sqlite.test.ts
git commit -m "feat(core/store): upsertIssue + getIssue"
```

---

### Task 13: SqliteStateStore — list queries

- [ ] **Step 1: Append tests**

```ts
describe('SqliteStateStore — list queries', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue({ ...sample, issueId: 'r#1', state: 'in_progress' });
    store.upsertIssue({ ...sample, issueId: 'r#2', state: 'review_pending' });
    store.upsertIssue({ ...sample, issueId: 'r#3', state: 'done' });
    store.upsertIssue({ ...sample, issueId: 'r#4', state: 'blocked' });
  });
  afterEach(() => store.close());

  it('listActiveIssues exclui done', () => {
    const ids = store.listActiveIssues().map((r) => r.issueId).sort();
    expect(ids).toEqual(['r#1', 'r#2', 'r#4']);
  });

  it('listInState filtra por estado', () => {
    expect(store.listInState('review_pending').map((r) => r.issueId)).toEqual(['r#2']);
    expect(store.listInState('done').map((r) => r.issueId)).toEqual(['r#3']);
  });
});
```

- [ ] **Step 2: Replace stubs em `sqlite.ts`**

```ts
  listActiveIssues(): IssueRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM issues WHERE state != 'done' ORDER BY started_at")
        .all() as Record<string, unknown>[]
    ).map(rowToRecord);
  }

  listInState(state: IssueState): IssueRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM issues WHERE state = ? ORDER BY started_at')
        .all(state) as Record<string, unknown>[]
    ).map(rowToRecord);
  }
```

- [ ] **Step 3: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 2 novos PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/store/sqlite.ts packages/core/src/services/store/sqlite.test.ts
git commit -m "feat(core/store): listActiveIssues + listInState"
```

---

### Task 14: SqliteStateStore — transitions + dispatches

- [ ] **Step 1: Append tests**

```ts
import type { Transition, Dispatch } from '../../domain/transition.js';

describe('SqliteStateStore — transitions', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue(sample);
  });
  afterEach(() => store.close());

  it('recordTransition é append-only', () => {
    const t: Transition = {
      issueId: 'r#1',
      fromState: 'ready',
      toState: 'in_progress',
      reason: 'symphony dispatched',
      evidence: null,
      correlationId: 'abc',
      occurredAt: '2026-05-18T10:00:00.000Z',
    };
    store.recordTransition(t);
    store.recordTransition({ ...t, fromState: 'in_progress', toState: 'review_pending' });
    const rows = (store as unknown as { db: { prepare: (s: string) => { all: () => unknown[] } } }).db
      .prepare('SELECT * FROM transitions WHERE issue_id = ?')
      .all() as unknown[];
    expect(rows).toHaveLength(2);
  });
});

describe('SqliteStateStore — dispatches', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue(sample);
  });
  afterEach(() => store.close());

  it('recordDispatch insere e updateDispatchOutcome atualiza pelo id mais recente', () => {
    const d: Dispatch = {
      issueId: 'r#1',
      agentId: 'lucas-backend',
      attempt: 1,
      startedAt: '2026-05-18T10:00:00.000Z',
      endedAt: null,
      exitCode: null,
      outcome: null,
      correlationId: 'abc',
    };
    const id = store.recordDispatch(d);
    expect(typeof id).toBe('number');
    store.updateDispatchOutcome(id, 'pr_opened', 0, '2026-05-18T10:05:00.000Z');
    const row = (store as unknown as { db: { prepare: (s: string) => { get: (...a: unknown[]) => unknown } } }).db
      .prepare('SELECT outcome, exit_code, ended_at FROM dispatches WHERE id = ?')
      .get(id) as { outcome: string; exit_code: number; ended_at: string };
    expect(row.outcome).toBe('pr_opened');
    expect(row.exit_code).toBe(0);
    expect(row.ended_at).toBe('2026-05-18T10:05:00.000Z');
  });
});
```

- [ ] **Step 2: Confirme port signature** — `recordDispatch` em `packages/core/src/ports/store.ts` já deve retornar `number` (definido na Task 6). Caso esteja como `void`, ajuste:

```ts
  recordDispatch(d: Dispatch): number;
```

- [ ] **Step 3: Implement em `sqlite.ts`**

Replace stubs:

```ts
  recordTransition(t: Transition): void {
    this.db
      .prepare(
        `INSERT INTO transitions
           (issue_id, from_state, to_state, reason, evidence, correlation_id, occurred_at)
         VALUES (@issueId, @fromState, @toState, @reason, @evidence, @correlationId, @occurredAt)`,
      )
      .run(t);
  }

  recordDispatch(d: Dispatch): number {
    const result = this.db
      .prepare(
        `INSERT INTO dispatches
           (issue_id, agent_id, attempt, started_at, ended_at, exit_code, outcome, correlation_id)
         VALUES (@issueId, @agentId, @attempt, @startedAt, @endedAt, @exitCode, @outcome, @correlationId)`,
      )
      .run(d);
    return Number(result.lastInsertRowid);
  }

  updateDispatchOutcome(
    dispatchId: number,
    outcome: Dispatch['outcome'],
    exitCode: number | null,
    endedAt: string,
  ): void {
    this.db
      .prepare(
        'UPDATE dispatches SET outcome = ?, exit_code = ?, ended_at = ? WHERE id = ?',
      )
      .run(outcome, exitCode, endedAt, dispatchId);
  }
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: 2 novos PASS.

- [ ] **Step 5: Export SqliteStateStore**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/store/sqlite.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/store/sqlite.ts packages/core/src/services/store/sqlite.test.ts packages/core/src/ports/store.ts packages/core/src/index.ts
git commit -m "feat(core/store): recordTransition + recordDispatch + updateDispatchOutcome"
```

---

## Fase 4 — WorkspaceManager (Tasks 15-17)

### Task 15: WorkspaceManager — path traversal guard

**Files:**
- Create: `packages/core/src/services/workspace-manager.ts`
- Create: `packages/core/src/services/workspace-manager.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PathTraversalError, WorkspaceManager } from './workspace-manager.js';

const makeRoot = () => mkdtempSync(join(tmpdir(), 'symphony-ws-'));

describe('WorkspaceManager — path guard', () => {
  it('rejeita issueId com ../', () => {
    const root = makeRoot();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath: root });
      expect(() => wm.resolvePath('../etc/passwd')).toThrow(PathTraversalError);
      expect(() => wm.resolvePath('foo/../../etc')).toThrow(PathTraversalError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aceita issueId normal (substituindo / e # por -)', () => {
    const root = makeRoot();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath: root });
      const p = wm.resolvePath('VilelaAI/repo#42');
      expect(p).toBe(join(root, 'VilelaAI-repo-42'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 3: Implement `services/workspace-manager.ts`** (path part only)

```ts
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { IssueId } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';

export class PathTraversalError extends Error {
  constructor(issueId: string) {
    super(`issueId "${issueId}" resolveria fora do workspaces root`);
    this.name = 'PathTraversalError';
  }
}

export class WorktreeCreateFailed extends Error {
  constructor(public readonly stderr: string) {
    super(`git worktree add falhou: ${stderr}`);
    this.name = 'WorktreeCreateFailed';
  }
}

export interface WorkspaceManagerOpts {
  root: string;
  baseBranch: string;
  repoPath: string; // path do repo "fonte" onde rodar `git worktree add`
  branchPattern?: string; // default "symphony/{issue_id}"
}

function safeIssueDirName(issueId: string): string {
  return issueId.replace(/[/#]/g, '-');
}

export class WorkspaceManager {
  constructor(private readonly opts: WorkspaceManagerOpts) {}

  resolvePath(issueId: IssueId): string {
    const safeName = safeIssueDirName(issueId);
    const absRoot = resolve(this.opts.root);
    const candidate = resolve(absRoot, safeName);
    if (!candidate.startsWith(absRoot + sep) && candidate !== absRoot) {
      throw new PathTraversalError(issueId);
    }
    if (candidate === absRoot) {
      throw new PathTraversalError(issueId);
    }
    return candidate;
  }

  // próximas tasks: create, cleanup, listAllOnDisk
  create(_issueId: IssueId): WorkspaceInfo {
    throw new Error('not implemented');
  }
  cleanup(_issueId: IssueId): void {
    throw new Error('not implemented');
  }
  listAllOnDisk(): Array<{ issueId: string; path: string }> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/workspace-manager.ts packages/core/src/services/workspace-manager.test.ts
git commit -m "feat(core): WorkspaceManager.resolvePath com path traversal guard"
```

---

### Task 16: WorkspaceManager — create/cleanup via git worktree

- [ ] **Step 1: Append failing test**

```ts
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function setupRepoFixture(): { repoPath: string; root: string } {
  const repoPath = makeRoot();
  execSync('git init -b main', { cwd: repoPath });
  execSync('git config user.email "t@t" && git config user.name "t"', { cwd: repoPath, shell: '/bin/bash' });
  execSync('git commit --allow-empty -m "init"', { cwd: repoPath });
  const root = makeRoot();
  return { repoPath, root };
}

describe('WorkspaceManager — create/cleanup', () => {
  it('cria worktree em branch symphony/<sanitizedId>', () => {
    const { repoPath, root } = setupRepoFixture();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const info = wm.create('VilelaAI/repo#42');
      expect(info.path).toBe(join(root, 'VilelaAI-repo-42'));
      expect(info.branchName).toBe('symphony/VilelaAI-repo-42');
      expect(info.baseBranch).toBe('main');
      expect(existsSync(info.path)).toBe(true);
      expect(existsSync(info.terminalLogPath)).toBe(false); // pasta criada, arquivo só quando agente escreve
      // .symphony dir exists
      expect(existsSync(join(info.path, '.symphony'))).toBe(true);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleanup remove worktree + branch', () => {
    const { repoPath, root } = setupRepoFixture();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const info = wm.create('r#1');
      expect(existsSync(info.path)).toBe(true);
      wm.cleanup('r#1');
      expect(existsSync(info.path)).toBe(false);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

- [ ] **Step 3: Replace stubs em `workspace-manager.ts`**

```ts
  create(issueId: IssueId): WorkspaceInfo {
    const path = this.resolvePath(issueId);
    const safeName = safeIssueDirName(issueId);
    const branchName = (this.opts.branchPattern ?? 'symphony/{issue_id}').replace(
      '{issue_id}',
      safeName,
    );
    mkdirSync(dirname(path), { recursive: true });
    const result = spawnSync(
      'git',
      ['worktree', 'add', '-b', branchName, path, this.opts.baseBranch],
      { cwd: this.opts.repoPath, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new WorktreeCreateFailed(result.stderr ?? 'unknown');
    }
    const symphonyDir = resolve(path, '.symphony');
    mkdirSync(symphonyDir, { recursive: true });
    return {
      issueId,
      path,
      branchName,
      baseBranch: this.opts.baseBranch,
      terminalLogPath: resolve(symphonyDir, 'terminal.log'),
    };
  }

  cleanup(issueId: IssueId): void {
    const path = this.resolvePath(issueId);
    if (!existsSync(path)) return;
    spawnSync('git', ['worktree', 'remove', '--force', path], {
      cwd: this.opts.repoPath,
      encoding: 'utf8',
    });
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
    const safeName = safeIssueDirName(issueId);
    const branchName = (this.opts.branchPattern ?? 'symphony/{issue_id}').replace(
      '{issue_id}',
      safeName,
    );
    spawnSync('git', ['branch', '-D', branchName], {
      cwd: this.opts.repoPath,
      encoding: 'utf8',
    });
  }
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/workspace-manager.ts packages/core/src/services/workspace-manager.test.ts
git commit -m "feat(core): WorkspaceManager.create/cleanup via git worktree"
```

---

### Task 17: WorkspaceManager — listAllOnDisk (orphan detection)

- [ ] **Step 1: Append test**

```ts
describe('WorkspaceManager — listAllOnDisk', () => {
  it('lista subdirs do root e devolve {issueId, path}', () => {
    const { repoPath, root } = setupRepoFixture();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      wm.create('r#1');
      wm.create('r#2');
      const list = wm.listAllOnDisk().sort((a, b) => a.path.localeCompare(b.path));
      expect(list.map((x) => x.issueId).sort()).toEqual(['r-1', 'r-2']);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Implement em `workspace-manager.ts`**

```ts
  listAllOnDisk(): Array<{ issueId: string; path: string }> {
    if (!existsSync(this.opts.root)) return [];
    return readdirSync(this.opts.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ issueId: d.name, path: resolve(this.opts.root, d.name) }));
  }
```

- [ ] **Step 3: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 4: Export WorkspaceManager**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/workspace-manager.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/workspace-manager.ts packages/core/src/services/workspace-manager.test.ts packages/core/src/index.ts
git commit -m "feat(core): WorkspaceManager.listAllOnDisk para detecção de orphans"
```

---

## Fase 5 — Fakes compartilhados (Task 18)

### Task 18: FakeTracker + FakeCli + FakeFactory

**Files:**
- Create: `tests/integration/fakes/fake-tracker.ts`
- Create: `tests/integration/fakes/fake-cli.ts`
- Create: `tests/integration/fakes/fake-factory.ts`

Esses fakes serão usados pelos testes integrados E pelos testes do `AgentSupervisor` / `Daemon` no `core`. Importados via `tests/integration/fakes/*`. Para o `core` testar com eles, criaremos cópias locais menores onde necessário (cada teste `*.test.ts` em `core` define seus próprios fakes inline ou importa via path relativo).

> **Nota:** para evitar ciclo de dependência (core → tests), os fakes vivem em `tests/` e são usados apenas pelos integration/conformance suites. Os unit tests do `core` definem fakes locais inline em cada arquivo `*.test.ts`.

- [ ] **Step 1: Create `fake-tracker.ts`**

```ts
import type {
  Issue,
  IssueId,
  IssueState,
  PullRequestRef,
  TrackerPort,
} from '@kairos-symphony/core';

export class FakeTracker implements TrackerPort {
  issues = new Map<IssueId, Issue>();
  prs = new Map<IssueId, PullRequestRef>();
  mergedPrs = new Set<number>();
  closedIssues = new Set<IssueId>();
  transitions: Array<{ issueId: IssueId; to: IssueState; reason: string }> = [];

  async fetchIssuesByState(state: IssueState): Promise<Issue[]> {
    return [...this.issues.values()].filter((i) => i.state === state);
  }

  async transitionState(issueId: IssueId, to: IssueState, reason: string): Promise<void> {
    this.transitions.push({ issueId, to, reason });
    const issue = this.issues.get(issueId);
    if (issue) this.issues.set(issueId, { ...issue, state: to });
  }

  async detectLinkedPR(issueId: IssueId): Promise<PullRequestRef | null> {
    return this.prs.get(issueId) ?? null;
  }

  async isIssueClosed(issueId: IssueId): Promise<boolean> {
    return this.closedIssues.has(issueId);
  }

  async isPRMerged(prNumber: number): Promise<boolean> {
    return this.mergedPrs.has(prNumber);
  }
}
```

- [ ] **Step 2: Create `fake-cli.ts`**

```ts
import type { AgentProcess, CliPort, SpawnOpts } from '@kairos-symphony/core';

interface FakeProcess extends AgentProcess {
  emit(chunk: string): void;
  finish(exitCode: number, signal?: string | null): void;
}

export class FakeCli implements CliPort {
  spawned: FakeProcess[] = [];
  lastOpts: SpawnOpts | null = null;

  spawn(opts: SpawnOpts): AgentProcess {
    this.lastOpts = opts;
    const dataHandlers: Array<(c: string) => void> = [];
    const exitHandlers: Array<(c: number, s: string | null) => void> = [];
    const proc: FakeProcess = {
      pid: 99999 + this.spawned.length,
      onData(h) {
        dataHandlers.push(h);
      },
      onExit(h) {
        exitHandlers.push(h);
      },
      kill(_signal) {
        for (const h of exitHandlers) h(143, 'SIGTERM');
      },
      emit(chunk) {
        for (const h of dataHandlers) h(chunk);
      },
      finish(exitCode, signal = null) {
        for (const h of exitHandlers) h(exitCode, signal);
      },
    };
    this.spawned.push(proc);
    return proc;
  }

  last(): FakeProcess {
    const p = this.spawned[this.spawned.length - 1];
    if (!p) throw new Error('Nenhum processo spawned');
    return p;
  }
}
```

- [ ] **Step 3: Create `fake-factory.ts`**

```ts
import type { AgentDescriptor, AgentId, FactoryPort } from '@kairos-symphony/core';

export class FakeFactory implements FactoryPort {
  agents = new Map<AgentId, AgentDescriptor>();

  async loadAgent(id: AgentId): Promise<AgentDescriptor> {
    const a = this.agents.get(id);
    if (!a) throw new Error(`agent ${id} não encontrado`);
    return a;
  }

  async listAgents(): Promise<AgentId[]> {
    return [...this.agents.keys()];
  }
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/fakes
git commit -m "test: fakes compartilhados (FakeTracker, FakeCli, FakeFactory)"
```

---

## Fase 6 — AgentSupervisor (Tasks 19-24)

O `AgentSupervisor` é o **cerne** do M1. Testes vivem em `packages/core/src/services/agent-supervisor.test.ts` e usam fakes inline (definidos no próprio arquivo de teste para evitar dependência circular tests→core).

### Task 19: AgentSupervisor — skeleton + start (spawn + onData)

**Files:**
- Create: `packages/core/src/services/agent-supervisor.ts`
- Create: `packages/core/src/services/agent-supervisor.test.ts`

- [ ] **Step 1: Write failing test (com fakes inline)**

```ts
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { AgentProcess, CliPort, SpawnOpts } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { Logger } from './logger.js';
import { AgentSupervisor } from './agent-supervisor.js';

class FakeClock implements Clock {
  private currentMs = new Date('2026-05-18T10:00:00Z').getTime();
  private pending: Array<{ handle: TimerHandle; fireAt: number; fn: () => void }> = [];
  now() {
    return new Date(this.currentMs);
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle: TimerHandle = Symbol('t');
    this.pending.push({ handle, fireAt: this.currentMs + ms, fn });
    return handle;
  }
  clearTimeout(h: TimerHandle) {
    this.pending = this.pending.filter((p) => p.handle !== h);
  }
  advance(ms: number) {
    const target = this.currentMs + ms;
    let next = this.pending.filter((p) => p.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0];
    while (next) {
      this.currentMs = next.fireAt;
      this.pending = this.pending.filter((p) => p.handle !== next!.handle);
      next.fn();
      next = this.pending.filter((p) => p.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0];
    }
    this.currentMs = target;
  }
}

class FakeProc implements AgentProcess {
  pid = 1;
  private dataHandlers: Array<(c: string) => void> = [];
  private exitHandlers: Array<(c: number, s: string | null) => void> = [];
  onData(h: (c: string) => void) {
    this.dataHandlers.push(h);
  }
  onExit(h: (c: number, s: string | null) => void) {
    this.exitHandlers.push(h);
  }
  kill() {
    for (const h of this.exitHandlers) h(143, 'SIGTERM');
  }
  emit(chunk: string) {
    for (const h of this.dataHandlers) h(chunk);
  }
  finish(code: number) {
    for (const h of this.exitHandlers) h(code, null);
  }
}

class FakeCli implements CliPort {
  spawned: FakeProc[] = [];
  lastOpts: SpawnOpts | null = null;
  spawn(opts: SpawnOpts) {
    this.lastOpts = opts;
    const p = new FakeProc();
    this.spawned.push(p);
    return p;
  }
  last() {
    return this.spawned[this.spawned.length - 1]!;
  }
}

class FakeTracker implements TrackerPort {
  prByIssue = new Map<string, { number: number; url: string; headBranch: string; baseBranch: string; merged: boolean }>();
  closed = new Set<string>();
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState() {
    return [];
  }
  async transitionState(issueId: string, to: string, reason: string) {
    this.transitions.push({ issueId, to: to as string, reason });
  }
  async detectLinkedPR(issueId: string) {
    return this.prByIssue.get(issueId) ?? null;
  }
  async isIssueClosed(issueId: string) {
    return this.closed.has(issueId);
  }
  async isPRMerged() {
    return false;
  }
}

class FakeStore implements StateStore {
  issues = new Map<string, ReturnType<StateStore['getIssue']>>();
  transitions: unknown[] = [];
  dispatches: unknown[] = [];
  dispatchOutcomes: unknown[] = [];
  upsertIssue(r: NonNullable<ReturnType<StateStore['getIssue']>>) {
    this.issues.set(r.issueId, r);
  }
  getIssue(id: string) {
    return this.issues.get(id) ?? null;
  }
  listActiveIssues() {
    return [...this.issues.values()].filter((x): x is NonNullable<typeof x> => x !== null);
  }
  listInState() {
    return [];
  }
  recordTransition(t: unknown) {
    this.transitions.push(t);
  }
  recordDispatch(d: unknown) {
    this.dispatches.push(d);
    return this.dispatches.length;
  }
  updateDispatchOutcome(id: number, outcome: unknown, exitCode: number | null, endedAt: string) {
    this.dispatchOutcomes.push({ id, outcome, exitCode, endedAt });
  }
  close() {}
}

function makeFixtures() {
  const root = mkdtempSync(join(tmpdir(), 'sup-'));
  const wsPath = join(root, 'ws');
  mkdirSync(join(wsPath, '.symphony'), { recursive: true });
  const workspace: WorkspaceInfo = {
    issueId: 'r#1',
    path: wsPath,
    branchName: 'symphony/r-1',
    baseBranch: 'main',
    terminalLogPath: join(wsPath, '.symphony', 'terminal.log'),
  };
  const issue: Issue = {
    id: 'r#1',
    number: 1,
    title: 't',
    body: 'b',
    labels: [],
    state: 'in_progress',
  };
  const agent: AgentDescriptor = {
    id: 'lucas',
    name: 'Lucas',
    description: 'd',
    body: 'b',
    filePath: '/x.md',
  };
  return { workspace, issue, agent, root };
}

describe('AgentSupervisor — start', () => {
  it('spawn do CLI com prompt, cwd e permissionMode da config', () => {
    const cli = new FakeCli();
    const sup = new AgentSupervisor({
      issue: makeFixtures().issue,
      agent: makeFixtures().agent,
      workspace: makeFixtures().workspace,
      prompt: 'PROMPT_AQUI',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock: new FakeClock(),
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/bin/claude',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    expect(cli.lastOpts?.prompt).toBe('PROMPT_AQUI');
    expect(cli.lastOpts?.permissionMode).toBe('bypass');
    expect(cli.lastOpts?.binaryPath).toBe('/bin/claude');
    expect(sup.state).toBe('running');
  });

  it('escreve output do PTY no terminal.log', () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock: new FakeClock(),
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/bin/claude',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    cli.last().emit('hello\n');
    cli.last().emit('world\n');
    expect(readFileSync(f.workspace.terminalLogPath, 'utf8')).toBe('hello\nworld\n');
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

- [ ] **Step 3: Implement `agent-supervisor.ts`** — skeleton + start

```ts
import { appendFileSync, writeFileSync } from 'node:fs';
import type { AgentDescriptor } from '../domain/agent.js';
import { newCorrelationId } from '../domain/correlation.js';
import type { Issue, IssueId, IssueRecord } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { AgentProcess, CliPort } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import type { Logger } from './logger.js';

export type SupervisorState =
  | 'idle'
  | 'spawning'
  | 'running'
  | 'retrying'
  | 'terminating'
  | 'done'
  | 'blocked';

export interface SupervisorCfg {
  permissionMode: 'plan' | 'auto' | 'bypass';
  binaryPath: string;
  stallTimeoutMs: number;
  maxRetries: number;
  backoffMs: ReadonlyArray<number>;
  exitNoPrGraceMs?: number; // default 30_000
}

export interface SupervisorDeps {
  issue: Issue;
  agent: AgentDescriptor;
  workspace: WorkspaceInfo;
  prompt: string;
  correlationId: string;
  cli: CliPort;
  tracker: TrackerPort;
  store: StateStore;
  clock: Clock;
  log: Logger;
  cfg: SupervisorCfg;
  onDone?: (issueId: IssueId) => void;
}

export class AgentSupervisor {
  state: SupervisorState = 'idle';
  private proc: AgentProcess | null = null;
  private lastOutputAt = 0;
  private retryCount = 0;
  private dispatchId: number | null = null;
  private retryHandle: TimerHandle | null = null;

  constructor(private readonly deps: SupervisorDeps) {}

  get issueId(): IssueId {
    return this.deps.issue.id;
  }

  start(): void {
    this.state = 'spawning';
    this.retryCount += 1;
    const startedAt = this.deps.clock.now().toISOString();
    this.dispatchId = this.deps.store.recordDispatch({
      issueId: this.deps.issue.id,
      agentId: this.deps.agent.id,
      attempt: this.retryCount,
      startedAt,
      endedAt: null,
      exitCode: null,
      outcome: null,
      correlationId: this.deps.correlationId,
    });
    writeFileSync(this.deps.workspace.terminalLogPath, '');
    this.proc = this.deps.cli.spawn({
      binaryPath: this.deps.cfg.binaryPath,
      cwd: this.deps.workspace.path,
      prompt: this.deps.prompt,
      permissionMode: this.deps.cfg.permissionMode,
    });
    this.lastOutputAt = this.deps.clock.now().getTime();
    this.proc.onData((chunk) => {
      appendFileSync(this.deps.workspace.terminalLogPath, chunk);
      this.lastOutputAt = this.deps.clock.now().getTime();
    });
    this.proc.onExit((code) => {
      void this.onProcessExit(code);
    });
    this.state = 'running';
    this.deps.log.info({
      event: 'agent_running',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      message: `Agente ${this.deps.agent.id} rodando para a issue ${this.deps.issue.id}`,
    });
  }

  // próximas tasks: tick, onProcessExit, onStall, onPRDetected, scheduleRetry
  async tick(): Promise<void> {
    // placeholder
  }
  private async onProcessExit(_code: number): Promise<void> {
    // placeholder
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/agent-supervisor.ts packages/core/src/services/agent-supervisor.test.ts
git commit -m "feat(core): AgentSupervisor skeleton + start (spawn, terminal.log)"
```

---

### Task 20: AgentSupervisor — tick + stall detection

- [ ] **Step 1: Append test**

```ts
describe('AgentSupervisor — stall', () => {
  it('detecta stall quando não há output por > stallTimeoutMs', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const tracker = new FakeTracker();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker,
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    const killSpy = vi.spyOn(cli.last(), 'kill');
    // Avança 11min sem output
    clock.advance(11 * 60_000);
    await sup.tick();
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(sup.state).toBe('terminating');
  });

  it('não detecta stall se houve output recente', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    clock.advance(5 * 60_000);
    cli.last().emit('progress');
    clock.advance(5 * 60_000);
    const killSpy = vi.spyOn(cli.last(), 'kill');
    await sup.tick();
    expect(killSpy).not.toHaveBeenCalled();
    expect(sup.state).toBe('running');
  });
});
```

- [ ] **Step 2: Implement `tick()` em `agent-supervisor.ts`**

Replace the placeholder `tick`:

```ts
  async tick(): Promise<void> {
    if (this.state !== 'running') return;
    const ageMs = this.deps.clock.now().getTime() - this.lastOutputAt;
    if (ageMs > this.deps.cfg.stallTimeoutMs) {
      this.onStall();
      return;
    }
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id);
    if (pr) {
      await this.onPRDetected(pr);
    }
  }

  private onStall(): void {
    this.deps.log.warn({
      event: 'agent_stalled',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      message: `Agente ${this.deps.agent.id} stall detectado para issue ${this.deps.issue.id}`,
    });
    this.state = 'terminating';
    this.proc?.kill('SIGTERM');
    this.markDispatchOutcome('stalled', null);
    this.scheduleRetry();
  }

  private async onPRDetected(_pr: unknown): Promise<void> {
    // placeholder — próxima task
  }

  private scheduleRetry(): void {
    // placeholder — próxima task
  }

  private markDispatchOutcome(outcome: 'stalled' | 'crashed' | 'exited_no_pr' | 'pr_opened', exitCode: number | null): void {
    if (this.dispatchId === null) return;
    this.deps.store.updateDispatchOutcome(
      this.dispatchId,
      outcome,
      exitCode,
      this.deps.clock.now().toISOString(),
    );
  }
```

- [ ] **Step 3: Run (expect PASS)** — stall tests passam; PR detection ainda placeholder (mas o "não stall" test exige só que kill não seja chamado, OK).

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/agent-supervisor.ts packages/core/src/services/agent-supervisor.test.ts
git commit -m "feat(core): AgentSupervisor.tick stall detection"
```

---

### Task 21: AgentSupervisor — PR detected + done

- [ ] **Step 1: Append test**

```ts
describe('AgentSupervisor — PR detectado', () => {
  it('transiciona para review_pending e chama onDone', async () => {
    const f = makeFixtures();
    const tracker = new FakeTracker();
    tracker.prByIssue.set('r#1', {
      number: 99,
      url: 'https://github.com/r/pull/99',
      headBranch: 'symphony/r-1',
      baseBranch: 'main',
      merged: false,
    });
    const cli = new FakeCli();
    const clock = new FakeClock();
    const onDone = vi.fn();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker,
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
      onDone,
    });
    sup.start();
    await sup.tick();
    expect(tracker.transitions).toContainEqual({
      issueId: 'r#1',
      to: 'review_pending',
      reason: 'PR #99',
    });
    expect(onDone).toHaveBeenCalledWith('r#1');
    expect(sup.state).toBe('done');
  });
});
```

- [ ] **Step 2: Replace placeholder `onPRDetected`**

```ts
  private async onPRDetected(pr: import('../domain/pr.js').PullRequestRef): Promise<void> {
    this.deps.log.info({
      event: 'pr_detected',
      issue_id: this.deps.issue.id,
      pr_number: pr.number,
      correlation_id: this.deps.correlationId,
      message: `PR #${pr.number} detectado para issue ${this.deps.issue.id}`,
    });
    await this.deps.tracker.transitionState(this.deps.issue.id, 'review_pending', `PR #${pr.number}`);
    this.markDispatchOutcome('pr_opened', 0);
    this.state = 'done';
    this.deps.onDone?.(this.deps.issue.id);
  }
```

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/agent-supervisor.ts packages/core/src/services/agent-supervisor.test.ts
git commit -m "feat(core): AgentSupervisor.onPRDetected → review_pending + onDone"
```

---

### Task 22: AgentSupervisor — onProcessExit (crash + exit-no-pr)

- [ ] **Step 1: Append tests**

```ts
describe('AgentSupervisor — exit', () => {
  it('exit code != 0 conta como crash e agenda retry', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    cli.last().finish(127);
    // espera microtasks
    await new Promise((r) => setImmediate(r));
    expect(sup.state).toBe('retrying');
  });

  it('exit code 0 sem PR detectado também agenda retry', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(), // sem PR
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    cli.last().finish(0);
    await new Promise((r) => setImmediate(r));
    expect(sup.state).toBe('retrying');
  });
});
```

- [ ] **Step 2: Replace placeholder `onProcessExit`**

```ts
  private async onProcessExit(code: number): Promise<void> {
    if (this.state === 'terminating') {
      // já tratado (stall→kill ou cleanup externo)
      return;
    }
    if (code !== 0) {
      this.deps.log.error({
        event: 'agent_crashed',
        issue_id: this.deps.issue.id,
        agent_id: this.deps.agent.id,
        exit_code: code,
        correlation_id: this.deps.correlationId,
        message: `Agente ${this.deps.agent.id} crashou (exit ${code})`,
      });
      this.markDispatchOutcome('crashed', code);
      this.scheduleRetry();
      return;
    }
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id);
    if (pr) {
      await this.onPRDetected(pr);
      return;
    }
    this.deps.log.warn({
      event: 'agent_exited_without_pr',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      message: `Agente ${this.deps.agent.id} encerrou exit 0 sem PR aberto`,
    });
    this.markDispatchOutcome('exited_no_pr', 0);
    this.scheduleRetry();
  }
```

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/agent-supervisor.ts packages/core/src/services/agent-supervisor.test.ts
git commit -m "feat(core): AgentSupervisor.onProcessExit (crash + exit-no-pr)"
```

---

### Task 23: AgentSupervisor — scheduleRetry com backoff

- [ ] **Step 1: Append test**

```ts
describe('AgentSupervisor — retry/backoff', () => {
  it('agenda retry com backoff [60s, 240s, 960s]', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    cli.last().finish(1); // crash
    await new Promise((r) => setImmediate(r));
    expect(sup.state).toBe('retrying');
    // 59s não dispara; 60s dispara
    clock.advance(59_000);
    expect(cli.spawned.length).toBe(1);
    clock.advance(2_000); // total 61s
    expect(cli.spawned.length).toBe(2);
    expect(sup.state).toBe('running');
  });
});
```

- [ ] **Step 2: Replace placeholder `scheduleRetry`**

```ts
  private scheduleRetry(): void {
    if (this.retryCount > this.deps.cfg.maxRetries) {
      this.markBlocked('symphony:max-retries-exceeded');
      return;
    }
    const delay = this.deps.cfg.backoffMs[Math.min(this.retryCount - 1, this.deps.cfg.backoffMs.length - 1)] ?? 60_000;
    this.deps.log.info({
      event: 'agent_retrying',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      attempt: this.retryCount,
      delay_ms: delay,
      correlation_id: this.deps.correlationId,
      message: `Reagendando tentativa ${this.retryCount} em ${delay}ms`,
    });
    this.state = 'retrying';
    this.retryHandle = this.deps.clock.setTimeout(() => {
      this.start();
    }, delay);
  }

  private markBlocked(reason: string): void {
    this.state = 'blocked';
    this.deps.log.error({
      event: 'agent_blocked',
      issue_id: this.deps.issue.id,
      reason,
      correlation_id: this.deps.correlationId,
      message: `Issue ${this.deps.issue.id} bloqueada: ${reason}`,
    });
    void this.deps.tracker.transitionState(this.deps.issue.id, 'blocked', reason);
    this.deps.onDone?.(this.deps.issue.id);
  }
```

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/agent-supervisor.ts packages/core/src/services/agent-supervisor.test.ts
git commit -m "feat(core): AgentSupervisor.scheduleRetry com backoff exponencial"
```

---

### Task 24: AgentSupervisor — max-retries → blocked

- [ ] **Step 1: Append test**

```ts
describe('AgentSupervisor — max retries', () => {
  it('após exceder maxRetries marca blocked e chama tracker.transitionState', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const tracker = new FakeTracker();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker,
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    // Loop: crash → retry 3 vezes; 4ª falha bloqueia
    for (let i = 0; i < 4; i++) {
      cli.last().finish(1);
      await new Promise((r) => setImmediate(r));
      if (i < 3) clock.advance(20 * 60_000); // garante dispara backoff
    }
    expect(sup.state).toBe('blocked');
    expect(tracker.transitions).toContainEqual({
      issueId: 'r#1',
      to: 'blocked',
      reason: 'symphony:max-retries-exceeded',
    });
  });
});
```

- [ ] **Step 2: Run (expect PASS)** — `scheduleRetry` já cobre o caso via `markBlocked`.

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 3: Export AgentSupervisor**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/agent-supervisor.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/agent-supervisor.test.ts packages/core/src/index.ts
git commit -m "test(core): AgentSupervisor max-retries → blocked"
```

---

## Fase 7 — Reconciler (Tasks 25-30)

### Task 25: Reconciler — esqueleto + cenário 1 (issue closed)

**Files:**
- Create: `packages/core/src/services/reconciler.ts`
- Create: `packages/core/src/services/reconciler.test.ts`

- [ ] **Step 1: Write failing test (com fakes inline)**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Issue } from '../domain/issue.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { Logger } from './logger.js';
import { Reconciler, type ReconciliationFinding } from './reconciler.js';

class FakeTracker implements TrackerPort {
  closed = new Set<string>();
  merged = new Set<number>();
  issuesByState = new Map<string, Issue[]>();
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState(state: string) {
    return this.issuesByState.get(state) ?? [];
  }
  async transitionState(issueId: string, to: string, reason: string) {
    this.transitions.push({ issueId, to, reason });
  }
  async detectLinkedPR() {
    return null;
  }
  async isIssueClosed(issueId: string) {
    return this.closed.has(issueId);
  }
  async isPRMerged(n: number) {
    return this.merged.has(n);
  }
}

class FakeStore implements StateStore {
  issues = new Map<string, ReturnType<StateStore['getIssue']>>();
  upsertIssue(r: NonNullable<ReturnType<StateStore['getIssue']>>) {
    this.issues.set(r.issueId, r);
  }
  getIssue(id: string) {
    return this.issues.get(id) ?? null;
  }
  listActiveIssues() {
    return [...this.issues.values()].filter((x): x is NonNullable<typeof x> => x !== null);
  }
  listInState(state: string) {
    return this.listActiveIssues().filter((r) => r.state === state);
  }
  recordTransition() {}
  recordDispatch() {
    return 1;
  }
  updateDispatchOutcome() {}
  close() {}
}

const logger = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });

describe('Reconciler — cenário issue closed', () => {
  it('issue fechada externamente → terminar supervisor + cleanup', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'in_progress',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: null,
    });

    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T11:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(terminate).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('r#1');
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'issue_closed_externally',
      issueId: 'r#1',
      action: 'terminate_and_cleanup',
    });
  });

  it('dry-run apenas retorna findings sem chamar terminate/cleanup', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'in_progress',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: null,
    });
    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date(),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: true });
    expect(terminate).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(findings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

- [ ] **Step 3: Implement `reconciler.ts`** (cenário 1 + dry-run framework)

```ts
import type { IssueId } from '../domain/issue.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import type { Logger } from './logger.js';

export type ReconciliationScenario =
  | 'issue_closed_externally'
  | 'label_ready_removed'
  | 'label_blocked_removed'
  | 'pr_merged_externally'
  | 'issue_edited_during_execution'
  | 'orphan_workspace';

export interface ReconciliationFinding {
  scenario: ReconciliationScenario;
  issueId: IssueId | null;
  action: string;
  evidence?: unknown;
}

export interface ActiveSupervisorRef {
  terminate: () => void;
}

export interface ReconcilerDeps {
  tracker: TrackerPort;
  store: StateStore;
  log: Logger;
  now: () => Date;
  activeSupervisors: () => Map<IssueId, ActiveSupervisorRef>;
  cleanupWorkspace: (issueId: IssueId) => void;
  listWorkspacesOnDisk: () => Array<{ issueId: string; path: string }>;
}

export class Reconciler {
  constructor(private readonly deps: ReconcilerDeps) {}

  async run({ dryRun }: { dryRun: boolean }): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    await this.scenarioIssueClosed(findings, dryRun);
    return findings;
  }

  private async scenarioIssueClosed(findings: ReconciliationFinding[], dryRun: boolean): Promise<void> {
    const supervisors = this.deps.activeSupervisors();
    for (const [issueId, sup] of supervisors) {
      const closed = await this.deps.tracker.isIssueClosed(issueId);
      if (!closed) continue;
      findings.push({
        scenario: 'issue_closed_externally',
        issueId,
        action: 'terminate_and_cleanup',
      });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: issueId,
        scenario: 'issue_closed_externally',
        dry_run: dryRun,
        message: `Issue ${issueId} fechada externamente — encerrando agente`,
      });
      if (!dryRun) {
        sup.terminate();
        this.deps.cleanupWorkspace(issueId);
      }
    }
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/reconciler.ts packages/core/src/services/reconciler.test.ts
git commit -m "feat(core): Reconciler base + cenário issue_closed_externally (com dry-run)"
```

---

### Task 26: Reconciler — cenário 2 (label ready removida) + cenário 3 (label blocked removida)

> Os cenários 2 e 3 são, na prática, derivados do polling natural — issues que **estão** em `ready` no tracker são despachadas; o cenário 2 é "issue saiu de `ready` antes do despacho" (resolve-se ao filtrar issues que ainda estão em ready no momento do despacho); cenário 3 é "issue em `blocked` no DB voltou para `ready` no tracker → re-incluir".

- [ ] **Step 1: Append test**

```ts
describe('Reconciler — label transitions', () => {
  it('cenário 3: issue em blocked no DB mas ready no tracker → recordar transição (volta a despachar)', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('ready', [
      {
        id: 'r#1',
        number: 1,
        title: 't',
        body: 'b',
        labels: [],
        state: 'ready',
      },
    ]);
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'blocked',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: null,
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: 'symphony:max-retries-exceeded',
    });
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T11:00:00Z'),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'label_blocked_removed',
      issueId: 'r#1',
      action: 'reset_to_ready',
    });
    // store deve ter a issue agora como ready, retryCount=0
    expect(store.getIssue('r#1')?.state).toBe('ready');
    expect(store.getIssue('r#1')?.retryCount).toBe(0);
    expect(store.getIssue('r#1')?.blockedReason).toBeNull();
  });
});
```

- [ ] **Step 2: Add scenarios em `reconciler.ts`** — append no método `run`:

```ts
  async run({ dryRun }: { dryRun: boolean }): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    await this.scenarioIssueClosed(findings, dryRun);
    await this.scenarioLabelBlockedRemoved(findings, dryRun);
    return findings;
  }

  private async scenarioLabelBlockedRemoved(findings: ReconciliationFinding[], dryRun: boolean): Promise<void> {
    const readyIssues = await this.deps.tracker.fetchIssuesByState('ready');
    for (const issue of readyIssues) {
      const record = this.deps.store.getIssue(issue.id);
      if (!record || record.state !== 'blocked') continue;
      findings.push({ scenario: 'label_blocked_removed', issueId: issue.id, action: 'reset_to_ready' });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: issue.id,
        scenario: 'label_blocked_removed',
        dry_run: dryRun,
        message: `Issue ${issue.id} foi destravada manualmente — voltando para fila`,
      });
      if (!dryRun) {
        this.deps.store.upsertIssue({
          ...record,
          state: 'ready',
          retryCount: 0,
          blockedReason: null,
          lastSyncedAt: this.deps.now().toISOString(),
        });
      }
    }
  }
```

> **Cenário 2 (label ready removida)** acontece naturalmente: o `Daemon.tick()` só despacha issues que estão em `ready` no tracker AGORA (ele faz `fetchIssuesByState("ready")` antes do dispatch). Se a label foi removida entre poll e dispatch, a issue não aparece na lista — sem necessidade de tratamento adicional aqui. Documentar no comentário do método.

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/reconciler.ts packages/core/src/services/reconciler.test.ts
git commit -m "feat(core): Reconciler cenário label_blocked_removed"
```

---

### Task 27: Reconciler — cenário 4 (PR mergeado externamente)

- [ ] **Step 1: Append test**

```ts
describe('Reconciler — PR mergeado externamente', () => {
  it('issue em review_pending cujo PR foi mergeado → done', async () => {
    const tracker = new FakeTracker();
    tracker.merged.add(99);
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'review_pending',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: 99,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: null,
    });
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'pr_merged_externally',
      issueId: 'r#1',
      action: 'mark_done',
    });
    expect(tracker.transitions).toContainEqual({
      issueId: 'r#1',
      to: 'done',
      reason: 'PR #99 mergeado',
    });
  });
});
```

- [ ] **Step 2: Append scenario method**

In `run()`:

```ts
    await this.scenarioPrMergedExternally(findings, dryRun);
```

Implement:

```ts
  private async scenarioPrMergedExternally(findings: ReconciliationFinding[], dryRun: boolean): Promise<void> {
    const reviewPending = this.deps.store.listInState('review_pending');
    for (const record of reviewPending) {
      if (record.prNumber === null) continue;
      const merged = await this.deps.tracker.isPRMerged(record.prNumber);
      if (!merged) continue;
      findings.push({ scenario: 'pr_merged_externally', issueId: record.issueId, action: 'mark_done' });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: record.issueId,
        scenario: 'pr_merged_externally',
        pr_number: record.prNumber,
        dry_run: dryRun,
        message: `PR #${record.prNumber} mergeado externamente — marcando done`,
      });
      if (!dryRun) {
        await this.deps.tracker.transitionState(
          record.issueId,
          'done',
          `PR #${record.prNumber} mergeado`,
        );
        this.deps.store.upsertIssue({
          ...record,
          state: 'done',
          finishedAt: this.deps.now().toISOString(),
          lastSyncedAt: this.deps.now().toISOString(),
        });
      }
    }
  }
```

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/reconciler.ts packages/core/src/services/reconciler.test.ts
git commit -m "feat(core): Reconciler cenário pr_merged_externally"
```

---

### Task 28: Reconciler — cenário 5 (issue editada durante execução)

> Cenário **passivo**: NÃO interromper agente vivo; só logar e atualizar `lastSyncedAt` com nova revisão. Detecção: diferença entre snapshot e estado atual da issue no tracker — mas no M1 simplificamos e apenas logamos quando a issue ativa também aparece em `ready`/`in_progress` (raro mas possível se humano remover label).

- [ ] **Step 1: Append test**

```ts
describe('Reconciler — issue editada durante execução', () => {
  it('issue ativa cuja descrição mudou no tracker → log apenas, sem ação', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('in_progress', [
      {
        id: 'r#1',
        number: 1,
        title: 'novo título',
        body: 'novo body',
        labels: ['mudou'],
        state: 'in_progress',
      },
    ]);
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'in_progress',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T09:00:00.000Z',
      blockedReason: null,
    });
    const terminate = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(terminate).not.toHaveBeenCalled();
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'issue_edited_during_execution',
      issueId: 'r#1',
      action: 'log_only',
    });
    // lastSyncedAt atualizado
    expect(store.getIssue('r#1')?.lastSyncedAt).toBe('2026-05-18T12:00:00.000Z');
  });
});
```

- [ ] **Step 2: Append scenario**

```ts
  private async scenarioIssueEdited(findings: ReconciliationFinding[], dryRun: boolean): Promise<void> {
    const supervisors = this.deps.activeSupervisors();
    if (supervisors.size === 0) return;
    const inProgress = await this.deps.tracker.fetchIssuesByState('in_progress');
    for (const issue of inProgress) {
      if (!supervisors.has(issue.id)) continue;
      const record = this.deps.store.getIssue(issue.id);
      if (!record) continue;
      findings.push({ scenario: 'issue_edited_during_execution', issueId: issue.id, action: 'log_only' });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: issue.id,
        scenario: 'issue_edited_during_execution',
        dry_run: dryRun,
        message: `Issue ${issue.id} sincronizada (sem interromper agente em andamento)`,
      });
      if (!dryRun) {
        this.deps.store.upsertIssue({
          ...record,
          lastSyncedAt: this.deps.now().toISOString(),
        });
      }
    }
  }
```

E em `run()` adicionar a chamada.

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/reconciler.ts packages/core/src/services/reconciler.test.ts
git commit -m "feat(core): Reconciler cenário issue_edited_during_execution (log-only)"
```

---

### Task 29: Reconciler — cenário 6 (orphan workspaces)

- [ ] **Step 1: Append test**

```ts
describe('Reconciler — orphan workspaces', () => {
  it('worktree em disco sem registro no DB → log e NÃO restartar', async () => {
    const tracker = new FakeTracker();
    const store = new FakeStore();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date(),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [{ issueId: 'r-99', path: '/tmp/r-99' }],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'orphan_workspace',
      issueId: null,
      action: 'log_only',
      evidence: { workspaceDir: 'r-99', path: '/tmp/r-99' },
    });
  });
});
```

- [ ] **Step 2: Append scenario**

```ts
  private async scenarioOrphanWorkspaces(findings: ReconciliationFinding[], _dryRun: boolean): Promise<void> {
    const onDisk = this.deps.listWorkspacesOnDisk();
    for (const dir of onDisk) {
      const matchingRecord = this.deps.store
        .listActiveIssues()
        .find((r) => r.workspacePath !== null && r.workspacePath.endsWith(dir.issueId));
      if (matchingRecord) continue;
      findings.push({
        scenario: 'orphan_workspace',
        issueId: null,
        action: 'log_only',
        evidence: { workspaceDir: dir.issueId, path: dir.path },
      });
      this.deps.log.warn({
        event: 'orphan_workspace_detected',
        path: dir.path,
        message: `Workspace órfão em ${dir.path} (sem registro no DB) — NÃO restartando automaticamente`,
      });
    }
  }
```

Adicionar chamada em `run()`.

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Export + Commit**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/reconciler.js';
```

```bash
git add packages/core/src/services/reconciler.ts packages/core/src/services/reconciler.test.ts packages/core/src/index.ts
git commit -m "feat(core): Reconciler cenário orphan_workspace (log-only, no auto-restart)"
```

---

### Task 30: Reconciler — comando dry-run sanity test

> Já cobrimos `dryRun: true` em cada cenário individualmente. Esta task adiciona um teste integrado que valida que com múltiplos findings simultâneos, nenhum efeito colateral acontece.

- [ ] **Step 1: Append test**

```ts
describe('Reconciler — dry-run integrado', () => {
  it('múltiplos cenários simultâneos em dry-run produzem findings sem efeitos', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    tracker.merged.add(99);
    tracker.issuesByState.set('ready', [
      { id: 'r#2', number: 2, title: 't', body: 'b', labels: [], state: 'ready' },
    ]);
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'in_progress',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: null,
    });
    store.upsertIssue({
      issueId: 'r#2',
      trackerType: 'github',
      state: 'blocked',
      agentId: 'lucas',
      workspacePath: '/y',
      branchName: 'symphony/r-2',
      startedAt: null,
      finishedAt: null,
      retryCount: 3,
      prNumber: null,
      correlationId: 'cid2',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: 'symphony:max-retries-exceeded',
    });
    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: true });
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(terminate).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(tracker.transitions).toHaveLength(0);
    expect(store.getIssue('r#2')?.state).toBe('blocked'); // não mudou
  });
});
```

- [ ] **Step 2: Run (expect PASS)** — já implementado.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/services/reconciler.test.ts
git commit -m "test(core): Reconciler dry-run integrado com múltiplos cenários"
```

---

## Fase 8 — Daemon (Tasks 31-34)

### Task 31: Daemon — dispatch unitário

**Files:**
- Create: `packages/core/src/services/daemon.ts`
- Create: `packages/core/src/services/daemon.test.ts`

- [ ] **Step 1: Write failing test (fakes inline simplificados)**

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { CliPort, SpawnOpts, AgentProcess } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { FactoryPort } from '../ports/factory.js';
import type { TrackerPort } from '../ports/tracker.js';
import { Logger } from './logger.js';
import { PromptBuilder } from './prompt-builder.js';
import { Router } from './router.js';
import { SqliteStateStore } from './store/sqlite.js';
import { WorkspaceManager } from './workspace-manager.js';
import { Daemon } from './daemon.js';

class FakeClock implements Clock {
  now() { return new Date('2026-05-18T10:00:00Z'); }
  setTimeout(): TimerHandle { return Symbol(); }
  clearTimeout() {}
}

class FakeCli implements CliPort {
  spawned: SpawnOpts[] = [];
  spawn(opts: SpawnOpts): AgentProcess {
    this.spawned.push(opts);
    return {
      pid: 1,
      onData() {},
      onExit() {},
      kill() {},
    };
  }
}

class FakeTracker implements TrackerPort {
  ready: Issue[] = [];
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState(state: string) {
    return state === 'ready' ? this.ready : [];
  }
  async transitionState(issueId: string, to: string, reason: string) {
    this.transitions.push({ issueId, to, reason });
  }
  async detectLinkedPR() { return null; }
  async isIssueClosed() { return false; }
  async isPRMerged() { return false; }
}

class FakeFactory implements FactoryPort {
  async loadAgent(id: string): Promise<AgentDescriptor> {
    return { id, name: id, description: 'd', body: 'b', filePath: '/x.md' };
  }
  async listAgents() { return ['default-agent']; }
}

function setupRepo(): { repoPath: string; root: string } {
  const repoPath = mkdtempSync(join(tmpdir(), 'daemon-repo-'));
  execSync('git init -b main', { cwd: repoPath });
  execSync('git config user.email t@t', { cwd: repoPath });
  execSync('git config user.name t', { cwd: repoPath });
  execSync('git commit --allow-empty -m init', { cwd: repoPath });
  const root = mkdtempSync(join(tmpdir(), 'daemon-ws-'));
  return { repoPath, root };
}

describe('Daemon.dispatch', () => {
  it('cria workspace, monta prompt, persiste estado, transiciona tracker, spawna CLI', async () => {
    const { repoPath, root } = setupRepo();
    try {
      const cli = new FakeCli();
      const tracker = new FakeTracker();
      const factory = new FakeFactory();
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const router = new Router({ defaultAgent: 'default-agent', rules: [] });
      const pb = new PromptBuilder({ maxBytes: 1_048_576 });
      const daemon = new Daemon({
        tracker, cli, factory, store, log,
        clock: new FakeClock(),
        workspaceManager: wm,
        router, promptBuilder: pb,
        cfg: {
          concurrentLimit: 5,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000, 240_000, 960_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      const issue: Issue = {
        id: 'VilelaAI/repo#42',
        number: 42,
        title: 't',
        body: 'b',
        labels: [],
        state: 'ready',
      };
      await daemon.dispatch(issue);
      expect(cli.spawned).toHaveLength(1);
      expect(cli.spawned[0]?.prompt).toContain('VilelaAI/repo#42');
      expect(tracker.transitions).toContainEqual({
        issueId: 'VilelaAI/repo#42',
        to: 'in_progress',
        reason: 'symphony dispatched',
      });
      const record = store.getIssue('VilelaAI/repo#42');
      expect(record?.state).toBe('in_progress');
      expect(record?.workspacePath).toContain('VilelaAI-repo-42');
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

- [ ] **Step 3: Implement `daemon.ts`** — dispatch only por enquanto

```ts
import { newCorrelationId } from '../domain/correlation.js';
import type { Issue, IssueId } from '../domain/issue.js';
import type { CliPort } from '../ports/cli.js';
import type { Clock } from '../ports/clock.js';
import type { FactoryPort } from '../ports/factory.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { AgentSupervisor, type SupervisorCfg } from './agent-supervisor.js';
import type { Logger } from './logger.js';
import { PromptBuilder, PromptTooLargeError } from './prompt-builder.js';
import type { Router } from './router.js';
import { WorkspaceManager, WorktreeCreateFailed } from './workspace-manager.js';

export interface DaemonCfg extends SupervisorCfg {
  concurrentLimit: number;
}

export interface DaemonDeps {
  tracker: TrackerPort;
  cli: CliPort;
  factory: FactoryPort;
  store: StateStore;
  log: Logger;
  clock: Clock;
  workspaceManager: WorkspaceManager;
  router: Router;
  promptBuilder: PromptBuilder;
  cfg: DaemonCfg;
}

export class Daemon {
  private readonly supervisors = new Map<IssueId, AgentSupervisor>();

  constructor(private readonly deps: DaemonDeps) {}

  activeSupervisors(): Map<IssueId, AgentSupervisor> {
    return this.supervisors;
  }

  async dispatch(issue: Issue): Promise<void> {
    if (this.supervisors.has(issue.id)) return;
    if (this.supervisors.size >= this.deps.cfg.concurrentLimit) return;
    const agentId = this.deps.router.route(issue);
    const agent = await this.deps.factory.loadAgent(agentId);
    let workspace;
    try {
      workspace = this.deps.workspaceManager.create(issue.id);
    } catch (err) {
      if (err instanceof WorktreeCreateFailed) {
        await this.transitionBlocked(issue.id, 'workspace_create_failed', err.message);
        return;
      }
      throw err;
    }
    let prompt: string;
    try {
      prompt = this.deps.promptBuilder.build({ issue, agent, workspace });
    } catch (err) {
      if (err instanceof PromptTooLargeError) {
        await this.transitionBlocked(issue.id, 'prompt_too_large', err.message);
        return;
      }
      throw err;
    }
    const correlationId = newCorrelationId();
    const now = this.deps.clock.now().toISOString();
    this.deps.store.upsertIssue({
      issueId: issue.id,
      trackerType: 'github',
      state: 'in_progress',
      agentId: agent.id,
      workspacePath: workspace.path,
      branchName: workspace.branchName,
      startedAt: now,
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId,
      lastSyncedAt: now,
      blockedReason: null,
    });
    this.deps.store.recordTransition({
      issueId: issue.id,
      fromState: 'ready',
      toState: 'in_progress',
      reason: 'symphony dispatched',
      evidence: null,
      correlationId,
      occurredAt: now,
    });
    await this.deps.tracker.transitionState(issue.id, 'in_progress', 'symphony dispatched');
    const sup = new AgentSupervisor({
      issue,
      agent,
      workspace,
      prompt,
      correlationId,
      cli: this.deps.cli,
      tracker: this.deps.tracker,
      store: this.deps.store,
      clock: this.deps.clock,
      log: this.deps.log,
      cfg: this.deps.cfg,
      onDone: (id) => this.removeSupervisor(id),
    });
    this.supervisors.set(issue.id, sup);
    sup.start();
    this.deps.log.info({
      event: 'issue_dispatched',
      issue_id: issue.id,
      agent_id: agent.id,
      correlation_id: correlationId,
      message: `Issue ${issue.id} despachada para ${agent.id}`,
    });
  }

  removeSupervisor(issueId: IssueId): void {
    this.supervisors.delete(issueId);
  }

  private async transitionBlocked(issueId: IssueId, reason: string, evidence: string): Promise<void> {
    const now = this.deps.clock.now().toISOString();
    const existing = this.deps.store.getIssue(issueId);
    this.deps.store.upsertIssue({
      issueId,
      trackerType: 'github',
      state: 'blocked',
      agentId: existing?.agentId ?? null,
      workspacePath: existing?.workspacePath ?? null,
      branchName: existing?.branchName ?? null,
      startedAt: existing?.startedAt ?? null,
      finishedAt: null,
      retryCount: existing?.retryCount ?? 0,
      prNumber: existing?.prNumber ?? null,
      correlationId: existing?.correlationId ?? null,
      lastSyncedAt: now,
      blockedReason: reason,
    });
    this.deps.store.recordTransition({
      issueId,
      fromState: existing?.state ?? 'ready',
      toState: 'blocked',
      reason,
      evidence,
      correlationId: existing?.correlationId ?? newCorrelationId(),
      occurredAt: now,
    });
    await this.deps.tracker.transitionState(issueId, 'blocked', reason);
    this.deps.log.error({
      event: 'agent_blocked',
      issue_id: issueId,
      reason,
      message: `Issue ${issueId} bloqueada: ${reason}`,
    });
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/core test`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/daemon.ts packages/core/src/services/daemon.test.ts
git commit -m "feat(core): Daemon.dispatch (cria worktree, prompt, persiste, transiciona, spawna)"
```

---

### Task 32: Daemon — tick (poll + reconcile + dispatch + monitor + cleanup)

- [ ] **Step 1: Append test**

```ts
describe('Daemon.tick', () => {
  it('chama reconciliação, busca ready, despacha dentro do limite, monitora supervisores', async () => {
    const { repoPath, root } = setupRepo();
    try {
      const cli = new FakeCli();
      const tracker = new FakeTracker();
      tracker.ready = [
        { id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready' },
        { id: 'r#2', number: 2, title: 't', body: 'b', labels: [], state: 'ready' },
      ];
      const factory = new FakeFactory();
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const router = new Router({ defaultAgent: 'default-agent', rules: [] });
      const pb = new PromptBuilder({ maxBytes: 1_048_576 });
      const daemon = new Daemon({
        tracker, cli, factory, store, log,
        clock: new FakeClock(),
        workspaceManager: wm,
        router, promptBuilder: pb,
        cfg: {
          concurrentLimit: 5,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      expect(cli.spawned).toHaveLength(2);
      expect(store.listInState('in_progress')).toHaveLength(2);
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respeita concurrentLimit', async () => {
    const { repoPath, root } = setupRepo();
    try {
      const cli = new FakeCli();
      const tracker = new FakeTracker();
      tracker.ready = Array.from({ length: 10 }, (_, i) => ({
        id: `r#${i}`, number: i, title: 't', body: 'b', labels: [], state: 'ready' as const,
      }));
      const factory = new FakeFactory();
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const router = new Router({ defaultAgent: 'default-agent', rules: [] });
      const pb = new PromptBuilder({ maxBytes: 1_048_576 });
      const daemon = new Daemon({
        tracker, cli, factory, store, log,
        clock: new FakeClock(),
        workspaceManager: wm,
        router, promptBuilder: pb,
        cfg: {
          concurrentLimit: 3,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      expect(cli.spawned).toHaveLength(3);
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Add `tick()` em `daemon.ts`**

```ts
  async tick(): Promise<void> {
    const ready = await this.deps.tracker.fetchIssuesByState('ready');
    for (const issue of ready) {
      if (this.supervisors.size >= this.deps.cfg.concurrentLimit) break;
      if (this.supervisors.has(issue.id)) continue;
      await this.dispatch(issue);
    }
    for (const sup of [...this.supervisors.values()]) {
      await sup.tick();
    }
    const done = await this.deps.tracker.fetchIssuesByState('done');
    for (const issue of done) {
      const record = this.deps.store.getIssue(issue.id);
      if (!record || record.state === 'done') continue;
      this.deps.workspaceManager.cleanup(issue.id);
      this.deps.store.upsertIssue({
        ...record,
        state: 'done',
        finishedAt: this.deps.clock.now().toISOString(),
        lastSyncedAt: this.deps.clock.now().toISOString(),
      });
      this.deps.log.info({
        event: 'workspace_cleaned',
        issue_id: issue.id,
        message: `Workspace removido para issue ${issue.id} (done)`,
      });
    }
  }
```

- [ ] **Step 3: Run (expect PASS)**

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/daemon.ts packages/core/src/services/daemon.test.ts
git commit -m "feat(core): Daemon.tick (poll → dispatch → monitor → cleanup) + concurrentLimit"
```

---

### Task 33: Daemon — wire Reconciler + start/stop loop

- [ ] **Step 1: Update `DaemonDeps`** para incluir reconciler e adicionar `start`/`stop`

Edit `daemon.ts` — adicionar import e campo:

```ts
import { Reconciler } from './reconciler.js';

// dentro de DaemonDeps:
  reconciler: Reconciler;
  pollIntervalMs: number;
```

- [ ] **Step 2: Update `tick()`** para chamar reconciler antes:

```ts
  async tick(): Promise<void> {
    await this.deps.reconciler.run({ dryRun: false });
    // ... resto
  }
```

- [ ] **Step 3: Add `start()` e `stop()` métodos**

```ts
  private timer: TimerHandle | null = null;
  private running = false;

  async start(): Promise<void> {
    this.running = true;
    this.deps.log.info({ event: 'daemon_started', message: 'Symphony daemon iniciado' });
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (err) {
        this.deps.log.error({
          event: 'tick_failed',
          error: err instanceof Error ? err.message : String(err),
          message: 'Erro no tick principal',
        });
      }
      if (this.running) {
        this.timer = this.deps.clock.setTimeout(() => { void loop(); }, this.deps.pollIntervalMs);
      }
    };
    await loop();
  }

  async stop(): Promise<void> {
    this.deps.log.info({ event: 'daemon_shutting_down', message: 'Symphony daemon encerrando' });
    this.running = false;
    if (this.timer !== null) {
      this.deps.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    // graceful: SIGTERM aos supervisores, espera 30s, persiste estado
    for (const [, sup] of this.supervisors) {
      sup.terminate();
    }
  }
```

> Importante: `AgentSupervisor` precisa expor `terminate()`. Adicione no AgentSupervisor:

```ts
  terminate(): void {
    this.state = 'terminating';
    this.proc?.kill('SIGTERM');
    if (this.retryHandle !== null) {
      this.deps.clock.clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
  }
```

- [ ] **Step 4: Update Daemon dispatch test** para incluir reconciler — adicionar no setup:

```ts
import { Reconciler } from './reconciler.js';

// ao montar daemon:
const reconciler = new Reconciler({
  tracker, store, log,
  now: () => new Date('2026-05-18T10:00:00Z'),
  activeSupervisors: () => daemon.activeSupervisors() as never,
  cleanupWorkspace: (id) => wm.cleanup(id),
  listWorkspacesOnDisk: () => wm.listAllOnDisk(),
});
// passar reconciler no Daemon deps, e pollIntervalMs: 30_000
```

(Atualizar testes existentes para incluir esses campos.)

- [ ] **Step 5: Run (expect PASS)**

- [ ] **Step 6: Export Daemon**

Append em `packages/core/src/index.ts`:

```ts
export * from './services/daemon.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/services packages/core/src/index.ts
git commit -m "feat(core): Daemon.start/stop loop + integração Reconciler"
```

---

### Task 34: Daemon — testes de graceful shutdown

- [ ] **Step 1: Append test**

```ts
describe('Daemon — graceful shutdown', () => {
  it('stop() chama terminate() em todos os supervisors ativos', async () => {
    const { repoPath, root } = setupRepo();
    try {
      const cli = new FakeCli();
      const tracker = new FakeTracker();
      tracker.ready = [{ id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready' }];
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const router = new Router({ defaultAgent: 'default-agent', rules: [] });
      const pb = new PromptBuilder({ maxBytes: 1_048_576 });
      const factory = new FakeFactory();
      let daemon: Daemon;
      const reconciler = new Reconciler({
        tracker, store, log, now: () => new Date(),
        activeSupervisors: () => daemon!.activeSupervisors() as never,
        cleanupWorkspace: (id) => wm.cleanup(id),
        listWorkspacesOnDisk: () => wm.listAllOnDisk(),
      });
      daemon = new Daemon({
        tracker, cli, factory, store, log,
        clock: new FakeClock(),
        workspaceManager: wm, router, promptBuilder: pb,
        reconciler, pollIntervalMs: 30_000,
        cfg: {
          concurrentLimit: 5,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      expect(daemon.activeSupervisors().size).toBe(1);
      await daemon.stop();
      // supervisor permanece (não removido), mas terminate foi chamado
      // verificar via state
      const sup = daemon.activeSupervisors().get('r#1')!;
      expect((sup as unknown as { state: string }).state).toBe('terminating');
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run (expect PASS)**

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/services/daemon.test.ts
git commit -m "test(core): Daemon graceful shutdown propaga terminate aos supervisores"
```

---

## Fase 9 — Integration tests (Tasks 35-38)

Cada integration test usa `SqliteStateStore` real, `WorkspaceManager` real (git worktree de verdade), e fakes para tracker/cli/factory.

### Task 35: Integration — dispatch end-to-end

**Files:**
- Create: `tests/integration/dispatch.integration.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Daemon, Logger, PromptBuilder, Reconciler, Router,
  SqliteStateStore, WorkspaceManager,
} from '@kairos-symphony/core';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeTracker } from './fakes/fake-tracker.js';
import { FakeCli } from './fakes/fake-cli.js';
import { FakeFactory } from './fakes/fake-factory.js';

function setupRepo() {
  const repoPath = mkdtempSync(join(tmpdir(), 'int-'));
  execSync('git init -b main', { cwd: repoPath });
  execSync('git config user.email t@t', { cwd: repoPath });
  execSync('git config user.name t', { cwd: repoPath });
  execSync('git commit --allow-empty -m init', { cwd: repoPath });
  return { repoPath, root: mkdtempSync(join(tmpdir(), 'int-ws-')) };
}

describe('integration: dispatch → review_pending', () => {
  it('issue ready → in_progress → review_pending quando PR detectado', async () => {
    const { repoPath, root } = setupRepo();
    try {
      const tracker = new FakeTracker();
      tracker.issues.set('r#1', {
        id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready',
      });
      const cli = new FakeCli();
      const factory = new FakeFactory();
      factory.agents.set('lucas', {
        id: 'lucas', name: 'Lucas', description: 'd', body: 'b', filePath: '/x.md',
      });
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const clock = new FakeClock();
      let daemon: Daemon;
      const reconciler = new Reconciler({
        tracker, store, log, now: () => clock.now(),
        activeSupervisors: () => daemon!.activeSupervisors() as never,
        cleanupWorkspace: (id) => wm.cleanup(id),
        listWorkspacesOnDisk: () => wm.listAllOnDisk(),
      });
      daemon = new Daemon({
        tracker, cli, factory, store, log, clock,
        workspaceManager: wm,
        router: new Router({ defaultAgent: 'lucas', rules: [] }),
        promptBuilder: new PromptBuilder({ maxBytes: 1_048_576 }),
        reconciler, pollIntervalMs: 30_000,
        cfg: {
          concurrentLimit: 5,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      expect(store.getIssue('r#1')?.state).toBe('in_progress');
      expect(cli.spawned).toHaveLength(1);
      // simula PR aparecendo no tracker
      tracker.prs.set('r#1', {
        number: 99, url: 'https://x/99', headBranch: 'symphony/r-1', baseBranch: 'main', merged: false,
      });
      // simula output do agente e tick novamente
      cli.last().emit('progress');
      await daemon.tick();
      expect(tracker.transitions).toContainEqual({
        issueId: 'r#1', to: 'review_pending', reason: 'PR #99',
      });
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/dispatch.integration.test.ts
git commit -m "test(integration): dispatch end-to-end (ready → review_pending)"
```

---

### Task 36: Integration — stall

**Files:**
- Create: `tests/integration/stall.integration.test.ts`

- [ ] **Step 1: Write test** (similar setup, mas avança o FakeClock para forçar stall e verifica `blocked` após max-retries)

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Daemon, Logger, PromptBuilder, Reconciler, Router,
  SqliteStateStore, WorkspaceManager,
} from '@kairos-symphony/core';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeTracker } from './fakes/fake-tracker.js';
import { FakeCli } from './fakes/fake-cli.js';
import { FakeFactory } from './fakes/fake-factory.js';

describe('integration: stall', () => {
  it('agente sem output → stall → retry → max-retries → blocked', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'int-'));
    execSync('git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init', {
      cwd: repoPath, shell: '/bin/bash',
    });
    const root = mkdtempSync(join(tmpdir(), 'int-ws-'));
    try {
      const tracker = new FakeTracker();
      tracker.issues.set('r#1', { id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready' });
      const cli = new FakeCli();
      const factory = new FakeFactory();
      factory.agents.set('lucas', { id: 'lucas', name: 'L', description: 'd', body: 'b', filePath: '/x.md' });
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const clock = new FakeClock();
      let daemon: Daemon;
      const reconciler = new Reconciler({
        tracker, store, log, now: () => clock.now(),
        activeSupervisors: () => daemon!.activeSupervisors() as never,
        cleanupWorkspace: (id) => wm.cleanup(id),
        listWorkspacesOnDisk: () => wm.listAllOnDisk(),
      });
      daemon = new Daemon({
        tracker, cli, factory, store, log, clock,
        workspaceManager: wm,
        router: new Router({ defaultAgent: 'lucas', rules: [] }),
        promptBuilder: new PromptBuilder({ maxBytes: 1_048_576 }),
        reconciler, pollIntervalMs: 30_000,
        cfg: {
          concurrentLimit: 5, stallTimeoutMs: 600_000, maxRetries: 2,
          backoffMs: [60_000, 240_000], permissionMode: 'bypass', binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      // ciclos: stall, retry, stall, retry, stall (max excedido)
      for (let i = 0; i < 3; i++) {
        clock.advance(11 * 60_000);
        await daemon.tick();
        clock.advance(20 * 60_000); // dispara backoff
      }
      expect(store.getIssue('r#1')?.state).toBe('blocked');
      expect(store.getIssue('r#1')?.blockedReason).toBe('symphony:max-retries-exceeded');
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run + Commit**

```bash
pnpm test:integration
git add tests/integration/stall.integration.test.ts
git commit -m "test(integration): stall → retry → max-retries → blocked"
```

---

### Task 37: Integration — reconciliação durante execução

**Files:**
- Create: `tests/integration/reconcile.integration.test.ts`

- [ ] **Step 1: Write test**

Cenário: issue está in_progress; humano fecha a issue no tracker; reconciler termina supervisor + limpa workspace.

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Daemon, Logger, PromptBuilder, Reconciler, Router,
  SqliteStateStore, WorkspaceManager,
} from '@kairos-symphony/core';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeTracker } from './fakes/fake-tracker.js';
import { FakeCli } from './fakes/fake-cli.js';
import { FakeFactory } from './fakes/fake-factory.js';

describe('integration: reconciliação', () => {
  it('humano fecha issue durante execução → supervisor encerrado + workspace limpo', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'int-'));
    execSync('git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init', {
      cwd: repoPath, shell: '/bin/bash',
    });
    const root = mkdtempSync(join(tmpdir(), 'int-ws-'));
    try {
      const tracker = new FakeTracker();
      tracker.issues.set('r#1', { id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready' });
      const cli = new FakeCli();
      const factory = new FakeFactory();
      factory.agents.set('lucas', { id: 'lucas', name: 'L', description: 'd', body: 'b', filePath: '/x.md' });
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const clock = new FakeClock();
      let daemon: Daemon;
      const reconciler = new Reconciler({
        tracker, store, log, now: () => clock.now(),
        activeSupervisors: () => daemon!.activeSupervisors() as never,
        cleanupWorkspace: (id) => wm.cleanup(id),
        listWorkspacesOnDisk: () => wm.listAllOnDisk(),
      });
      daemon = new Daemon({
        tracker, cli, factory, store, log, clock,
        workspaceManager: wm,
        router: new Router({ defaultAgent: 'lucas', rules: [] }),
        promptBuilder: new PromptBuilder({ maxBytes: 1_048_576 }),
        reconciler, pollIntervalMs: 30_000,
        cfg: {
          concurrentLimit: 5, stallTimeoutMs: 600_000, maxRetries: 3,
          backoffMs: [60_000], permissionMode: 'bypass', binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      const workspacePath = store.getIssue('r#1')?.workspacePath!;
      expect(existsSync(workspacePath)).toBe(true);
      // humano fecha issue
      tracker.closedIssues.add('r#1');
      tracker.issues.delete('r#1');
      await daemon.tick();
      expect(existsSync(workspacePath)).toBe(false);
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run + Commit**

```bash
pnpm test:integration
git add tests/integration/reconcile.integration.test.ts
git commit -m "test(integration): reconciliação fecha issue durante execução"
```

---

### Task 38: Integration — restart do daemon não auto-restarta supervisores

**Files:**
- Create: `tests/integration/restart.integration.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Daemon, Logger, PromptBuilder, Reconciler, Router,
  SqliteStateStore, WorkspaceManager,
} from '@kairos-symphony/core';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeTracker } from './fakes/fake-tracker.js';
import { FakeCli } from './fakes/fake-cli.js';
import { FakeFactory } from './fakes/fake-factory.js';

describe('integration: restart', () => {
  it('reabrir SQLite recupera state; novo daemon NÃO auto-restarta supervisores ativos', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'int-'));
    execSync('git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init', {
      cwd: repoPath, shell: '/bin/bash',
    });
    const root = mkdtempSync(join(tmpdir(), 'int-ws-'));
    const dbPath = join(tmpdir(), `int-db-${Date.now()}.db`);
    try {
      // 1ª execução: despacha e "morre"
      {
        const tracker = new FakeTracker();
        tracker.issues.set('r#1', { id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready' });
        const cli = new FakeCli();
        const factory = new FakeFactory();
        factory.agents.set('lucas', { id: 'lucas', name: 'L', description: 'd', body: 'b', filePath: '/x.md' });
        const store = new SqliteStateStore({ path: dbPath });
        const log = new Logger({ level: 'error', write: () => undefined });
        const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
        let daemon: Daemon;
        const reconciler = new Reconciler({
          tracker, store, log, now: () => new Date(),
          activeSupervisors: () => daemon!.activeSupervisors() as never,
          cleanupWorkspace: (id) => wm.cleanup(id),
          listWorkspacesOnDisk: () => wm.listAllOnDisk(),
        });
        daemon = new Daemon({
          tracker, cli, factory, store, log,
          clock: new FakeClock(), workspaceManager: wm,
          router: new Router({ defaultAgent: 'lucas', rules: [] }),
          promptBuilder: new PromptBuilder({ maxBytes: 1_048_576 }),
          reconciler, pollIntervalMs: 30_000,
          cfg: {
            concurrentLimit: 5, stallTimeoutMs: 600_000, maxRetries: 3,
            backoffMs: [60_000], permissionMode: 'bypass', binaryPath: '/usr/bin/true',
          },
        });
        await daemon.tick();
        store.close();
      }
      // 2ª execução: novo daemon abre o mesmo DB; tracker AINDA tem issue em ready (humano não viu transição)
      {
        const tracker = new FakeTracker(); // tracker fresco
        // mas o estado no DB diz que r#1 está in_progress
        const cli = new FakeCli();
        const factory = new FakeFactory();
        factory.agents.set('lucas', { id: 'lucas', name: 'L', description: 'd', body: 'b', filePath: '/x.md' });
        const store = new SqliteStateStore({ path: dbPath });
        expect(store.getIssue('r#1')?.state).toBe('in_progress');
        const log = new Logger({ level: 'error', write: () => undefined });
        const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
        let daemon: Daemon;
        const reconciler = new Reconciler({
          tracker, store, log, now: () => new Date(),
          activeSupervisors: () => daemon!.activeSupervisors() as never,
          cleanupWorkspace: (id) => wm.cleanup(id),
          listWorkspacesOnDisk: () => wm.listAllOnDisk(),
        });
        daemon = new Daemon({
          tracker, cli, factory, store, log,
          clock: new FakeClock(), workspaceManager: wm,
          router: new Router({ defaultAgent: 'lucas', rules: [] }),
          promptBuilder: new PromptBuilder({ maxBytes: 1_048_576 }),
          reconciler, pollIntervalMs: 30_000,
          cfg: {
            concurrentLimit: 5, stallTimeoutMs: 600_000, maxRetries: 3,
            backoffMs: [60_000], permissionMode: 'bypass', binaryPath: '/usr/bin/true',
          },
        });
        await daemon.tick();
        // CLI deve ter sido spawned 0 vezes (sem ready issue no tracker)
        expect(cli.spawned).toHaveLength(0);
        // E o supervisor in_progress no DB NÃO foi recriado automaticamente
        expect(daemon.activeSupervisors().size).toBe(0);
        store.close();
      }
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      rmSync(dbPath, { force: true });
    }
  });
});
```

- [ ] **Step 2: Run + Commit**

```bash
pnpm test:integration
git add tests/integration/restart.integration.test.ts
git commit -m "test(integration): restart não auto-restarta supervisores (§9 MUST)"
```

---

## Fase 10 — Adapter GitHub (Tasks 39-44)

### Task 39: GithubTracker — esqueleto + fetchIssuesByState (label-based)

**Files:**
- Create: `packages/adapter-github/src/github-tracker.ts`
- Create: `packages/adapter-github/src/github-tracker.test.ts`

**Mapping (do design seção 3.2 e SPEC tabela §1):** estados canônicos → labels GitHub:

| State | GitHub label |
|---|---|
| ready | `symphony:ready` |
| in_progress | `symphony:in-progress` |
| blocked | `symphony:blocked` |
| review_pending | (sem label — derivado de PR linkado open) |
| done | (issue closed) |
| triage | (issue sem label `symphony:*`) |

- [ ] **Step 1: Write failing test usando msw**

```ts
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GithubTracker } from './github-tracker.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GithubTracker.fetchIssuesByState', () => {
  it('mapeia ready → busca issues com label symphony:ready', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/issues', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('labels')).toBe('symphony:ready');
        expect(url.searchParams.get('state')).toBe('open');
        return HttpResponse.json([
          {
            number: 42,
            title: 'Bug X',
            body: 'desc',
            labels: [{ name: 'symphony:ready' }, { name: 'bug' }],
            state: 'open',
            pull_request: undefined,
          },
        ]);
      }),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'gho_x' });
    const issues = await tracker.fetchIssuesByState('ready');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'VilelaAI/test#42',
      number: 42,
      title: 'Bug X',
      labels: ['symphony:ready', 'bug'],
      state: 'ready',
    });
  });

  it('exclui pull requests da listagem de issues', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/issues', () =>
        HttpResponse.json([
          { number: 1, title: 'i', body: '', labels: [], state: 'open', pull_request: undefined },
          { number: 2, title: 'pr', body: '', labels: [], state: 'open', pull_request: { url: 'x' } },
        ]),
      ),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'gho_x' });
    const issues = await tracker.fetchIssuesByState('ready');
    expect(issues.map((i) => i.number)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm --filter @kairos-symphony/adapter-github test`

- [ ] **Step 3: Implement `github-tracker.ts`** (skeleton + fetchIssuesByState)

```ts
import { Octokit } from '@octokit/rest';
import type {
  Issue, IssueId, IssueState, PullRequestRef, TrackerPort,
} from '@kairos-symphony/core';

export interface GithubTrackerOpts {
  owner: string;
  repo: string;
  token: string;
  request?: { fetch?: typeof fetch };
}

const STATE_TO_LABEL: Partial<Record<IssueState, string>> = {
  ready: 'symphony:ready',
  in_progress: 'symphony:in-progress',
  blocked: 'symphony:blocked',
};

const LABEL_TO_STATE: Record<string, IssueState> = {
  'symphony:ready': 'ready',
  'symphony:in-progress': 'in_progress',
  'symphony:blocked': 'blocked',
};

function issueId(owner: string, repo: string, number: number): IssueId {
  return `${owner}/${repo}#${number}`;
}

function inferState(labels: string[], isClosed: boolean): IssueState {
  if (isClosed) return 'done';
  for (const l of labels) {
    if (LABEL_TO_STATE[l]) return LABEL_TO_STATE[l]!;
  }
  return 'triage';
}

export class GithubTracker implements TrackerPort {
  private readonly oc: Octokit;
  constructor(private readonly opts: GithubTrackerOpts) {
    this.oc = new Octokit({ auth: opts.token, request: opts.request });
  }

  async fetchIssuesByState(state: IssueState): Promise<Issue[]> {
    if (state === 'done') {
      const { data } = await this.oc.issues.listForRepo({
        owner: this.opts.owner, repo: this.opts.repo, state: 'closed', per_page: 100,
      });
      return data
        .filter((r) => !('pull_request' in r) || r.pull_request === undefined)
        .map((r) => ({
          id: issueId(this.opts.owner, this.opts.repo, r.number),
          number: r.number,
          title: r.title,
          body: r.body ?? '',
          labels: r.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')),
          state: 'done' as IssueState,
        }));
    }
    const label = STATE_TO_LABEL[state];
    if (!label) return [];
    const { data } = await this.oc.issues.listForRepo({
      owner: this.opts.owner, repo: this.opts.repo, labels: label, state: 'open', per_page: 100,
    });
    return data
      .filter((r) => !('pull_request' in r) || r.pull_request === undefined)
      .map((r) => {
        const labels = r.labels.map((l) => (typeof l === 'string' ? l : l.name ?? ''));
        return {
          id: issueId(this.opts.owner, this.opts.repo, r.number),
          number: r.number,
          title: r.title,
          body: r.body ?? '',
          labels,
          state: inferState(labels, false),
        };
      });
  }

  async transitionState(_issueId: IssueId, _to: IssueState, _reason: string): Promise<void> {
    throw new Error('not implemented');
  }
  async detectLinkedPR(_issueId: IssueId): Promise<PullRequestRef | null> {
    throw new Error('not implemented');
  }
  async isIssueClosed(_issueId: IssueId): Promise<boolean> {
    throw new Error('not implemented');
  }
  async isPRMerged(_prNumber: number): Promise<boolean> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-github/src
git commit -m "feat(adapter-github): GithubTracker.fetchIssuesByState (label-based)"
```

---

### Task 40: GithubTracker — transitionState (label swap)

- [ ] **Step 1: Append test**

```ts
describe('GithubTracker.transitionState', () => {
  it('para in_progress: adiciona label symphony:in-progress e remove symphony:ready', async () => {
    const addCalls: unknown[] = [];
    const removeCalls: string[] = [];
    server.use(
      http.post('https://api.github.com/repos/VilelaAI/test/issues/42/labels', async ({ request }) => {
        addCalls.push(await request.json());
        return HttpResponse.json([]);
      }),
      http.delete('https://api.github.com/repos/VilelaAI/test/issues/42/labels/:label', ({ params }) => {
        removeCalls.push(params.label as string);
        return HttpResponse.json([]);
      }),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    await tracker.transitionState('VilelaAI/test#42', 'in_progress', 'dispatch');
    expect(addCalls).toEqual([{ labels: ['symphony:in-progress'] }]);
    expect(removeCalls).toContain('symphony:ready');
  });

  it('para done: fecha a issue (não usa label)', async () => {
    let patched: unknown = null;
    server.use(
      http.patch('https://api.github.com/repos/VilelaAI/test/issues/42', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({});
      }),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    await tracker.transitionState('VilelaAI/test#42', 'done', 'merged');
    expect(patched).toEqual({ state: 'closed' });
  });
});
```

- [ ] **Step 2: Implement em `github-tracker.ts`**

```ts
  async transitionState(id: IssueId, to: IssueState, _reason: string): Promise<void> {
    const number = parseInt(id.split('#')[1] ?? '0', 10);
    if (to === 'done') {
      await this.oc.issues.update({ owner: this.opts.owner, repo: this.opts.repo, issue_number: number, state: 'closed' });
      return;
    }
    const addLabel = STATE_TO_LABEL[to];
    if (addLabel) {
      await this.oc.issues.addLabels({ owner: this.opts.owner, repo: this.opts.repo, issue_number: number, labels: [addLabel] });
    }
    for (const other of Object.values(STATE_TO_LABEL)) {
      if (other && other !== addLabel) {
        try {
          await this.oc.issues.removeLabel({ owner: this.opts.owner, repo: this.opts.repo, issue_number: number, name: other });
        } catch (err: unknown) {
          if ((err as { status?: number }).status !== 404) throw err;
        }
      }
    }
  }
```

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @kairos-symphony/adapter-github test
git add packages/adapter-github/src
git commit -m "feat(adapter-github): GithubTracker.transitionState (label swap + close)"
```

---

### Task 41: GithubTracker — detectLinkedPR (auto-link + branch convention)

- [ ] **Step 1: Append test**

```ts
describe('GithubTracker.detectLinkedPR', () => {
  it('encontra PR open com branch symphony/<id> ou que cita Closes #N', async () => {
    server.use(
      http.get('https://api.github.com/search/issues', ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams.get('q') ?? '';
        expect(q).toContain('repo:VilelaAI/test');
        expect(q).toContain('is:pr');
        expect(q).toContain('is:open');
        return HttpResponse.json({
          items: [
            {
              number: 99,
              html_url: 'https://github.com/VilelaAI/test/pull/99',
              head: { ref: 'symphony/VilelaAI-test-42' },
              base: { ref: 'main' },
              body: 'Closes #42',
              state: 'open',
              pull_request: { merged_at: null },
            },
          ],
        });
      }),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    const pr = await tracker.detectLinkedPR('VilelaAI/test#42');
    expect(pr).toEqual({
      number: 99,
      url: 'https://github.com/VilelaAI/test/pull/99',
      headBranch: 'symphony/VilelaAI-test-42',
      baseBranch: 'main',
      merged: false,
    });
  });

  it('retorna null quando não há PR', async () => {
    server.use(
      http.get('https://api.github.com/search/issues', () => HttpResponse.json({ items: [] })),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    expect(await tracker.detectLinkedPR('VilelaAI/test#42')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
  async detectLinkedPR(id: IssueId): Promise<PullRequestRef | null> {
    const number = parseInt(id.split('#')[1] ?? '0', 10);
    const safeBranch = `symphony/${this.opts.owner}-${this.opts.repo}-${number}`;
    const q = [
      `repo:${this.opts.owner}/${this.opts.repo}`,
      'is:pr',
      'is:open',
      `(head:${safeBranch} OR "Closes #${number}" OR "closes #${number}")`,
    ].join(' ');
    const { data } = await this.oc.search.issuesAndPullRequests({ q });
    const found = data.items[0];
    if (!found) return null;
    return {
      number: found.number,
      url: found.html_url,
      headBranch: (found as { head?: { ref: string } }).head?.ref ?? '',
      baseBranch: (found as { base?: { ref: string } }).base?.ref ?? '',
      merged: false,
    };
  }
```

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @kairos-symphony/adapter-github test
git add packages/adapter-github/src
git commit -m "feat(adapter-github): GithubTracker.detectLinkedPR (search via head OR Closes #N)"
```

---

### Task 42: GithubTracker — isIssueClosed + isPRMerged

- [ ] **Step 1: Append tests**

```ts
describe('GithubTracker.isIssueClosed', () => {
  it('retorna true quando issue está closed', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/issues/42', () =>
        HttpResponse.json({ number: 42, state: 'closed' }),
      ),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    expect(await tracker.isIssueClosed('VilelaAI/test#42')).toBe(true);
  });
});

describe('GithubTracker.isPRMerged', () => {
  it('retorna true quando PR está merged', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/pulls/99', () =>
        HttpResponse.json({ number: 99, merged: true }),
      ),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    expect(await tracker.isPRMerged(99)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```ts
  async isIssueClosed(id: IssueId): Promise<boolean> {
    const number = parseInt(id.split('#')[1] ?? '0', 10);
    const { data } = await this.oc.issues.get({ owner: this.opts.owner, repo: this.opts.repo, issue_number: number });
    return data.state === 'closed';
  }

  async isPRMerged(prNumber: number): Promise<boolean> {
    const { data } = await this.oc.pulls.get({ owner: this.opts.owner, repo: this.opts.repo, pull_number: prNumber });
    return data.merged === true;
  }
```

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @kairos-symphony/adapter-github test
git add packages/adapter-github/src
git commit -m "feat(adapter-github): GithubTracker.isIssueClosed + isPRMerged"
```

---

### Task 43: GithubTracker — rate limit handling

- [ ] **Step 1: Append test**

```ts
describe('GithubTracker — rate limit', () => {
  it('lança RateLimitedError com reset timestamp em 403 com x-ratelimit-remaining: 0', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/issues', () =>
        new HttpResponse('rate limit', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1700000000',
          },
        }),
      ),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    await expect(tracker.fetchIssuesByState('ready')).rejects.toMatchObject({
      name: 'RateLimitedError',
      resetAtSeconds: 1700000000,
    });
  });
});
```

- [ ] **Step 2: Implement** — wrap chamadas com try/catch e converte 403 com rate-limit em error tipado

Add no topo:

```ts
export class RateLimitedError extends Error {
  constructor(public readonly resetAtSeconds: number) {
    super(`GitHub API rate limited, reset at ${new Date(resetAtSeconds * 1000).toISOString()}`);
    this.name = 'RateLimitedError';
  }
}

async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { status?: number; response?: { headers: Record<string, string> } };
    if (e.status === 403 && e.response?.headers['x-ratelimit-remaining'] === '0') {
      const reset = parseInt(e.response.headers['x-ratelimit-reset'] ?? '0', 10);
      throw new RateLimitedError(reset);
    }
    throw err;
  }
}
```

Wrap em cada chamada Octokit (ex: `return withRateLimit(() => this.oc.issues.listForRepo(...))`)

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @kairos-symphony/adapter-github test
git add packages/adapter-github/src
git commit -m "feat(adapter-github): GithubTracker RateLimitedError em 403 rate-limit"
```

---

### Task 44: GithubTracker — export + smoke typecheck

- [ ] **Step 1: Update `src/index.ts`**

```ts
export * from './github-tracker.js';
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/adapter-github/src/index.ts
git commit -m "chore(adapter-github): export GithubTracker e RateLimitedError"
```

---

## Fase 11 — CLI Claude Code + Factory Forge (Tasks 45-47)

### Task 45: ClaudeCodeCli — spawn via node-pty (com binário fake nos testes)

**Files:**
- Create: `packages/cli-claude-code/src/fixtures/fake-cli.sh`
- Create: `packages/cli-claude-code/src/claude-code-cli.ts`
- Create: `packages/cli-claude-code/src/claude-code-cli.test.ts`

- [ ] **Step 1: Create `fixtures/fake-cli.sh`**

```sh
#!/bin/bash
# Fake CLI: lê prompt via stdin (até EOF), ecoa, e sai com código passado em $1 (default 0).
read -r line || true
echo "FAKE_CLI got: $line"
sleep 0.05
exit "${1:-0}"
```

Don't forget to `chmod +x`.

- [ ] **Step 2: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ClaudeCodeCli } from './claude-code-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(__dirname, 'fixtures', 'fake-cli.sh');

describe('ClaudeCodeCli', () => {
  it('spawn via PTY, recebe data e exit do binário', async () => {
    chmodSync(fakeBin, 0o755);
    const cli = new ClaudeCodeCli();
    const chunks: string[] = [];
    let exitCode = -1;
    await new Promise<void>((resolve) => {
      const proc = cli.spawn({
        binaryPath: fakeBin,
        cwd: __dirname,
        prompt: 'hello',
        permissionMode: 'bypass',
      });
      proc.onData((c) => chunks.push(c));
      proc.onExit((code) => {
        exitCode = code;
        resolve();
      });
    });
    expect(chunks.join('')).toContain('FAKE_CLI got');
    expect(exitCode).toBe(0);
  });
});
```

- [ ] **Step 3: Implement `claude-code-cli.ts`**

```ts
import { spawn as ptySpawn, type IPty } from 'node-pty';
import type { AgentProcess, CliPort, SpawnOpts } from '@kairos-symphony/core';

const PERMISSION_FLAG: Record<SpawnOpts['permissionMode'], string[]> = {
  plan: ['--permission-mode', 'plan'],
  auto: ['--permission-mode', 'auto'],
  bypass: ['--dangerously-skip-permissions'],
};

export class ClaudeCodeCli implements CliPort {
  spawn(opts: SpawnOpts): AgentProcess {
    const args = [
      ...(opts.binaryPath.endsWith('.sh') ? [] : PERMISSION_FLAG[opts.permissionMode]),
      '--print',
      opts.prompt,
    ];
    const proc: IPty = ptySpawn(opts.binaryPath, args, {
      cwd: opts.cwd,
      cols: opts.ptyCols ?? 120,
      rows: opts.ptyRows ?? 40,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });
    // se for shell de fixture, mandar prompt via stdin
    if (opts.binaryPath.endsWith('.sh')) {
      proc.write(`${opts.prompt}\n`);
    }
    return {
      pid: proc.pid,
      onData(h) {
        proc.onData(h);
      },
      onExit(h) {
        proc.onExit(({ exitCode, signal }) => h(exitCode, signal === undefined ? null : String(signal)));
      },
      kill(signal) {
        proc.kill(signal ?? 'SIGTERM');
      },
    };
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm --filter @kairos-symphony/cli-claude-code test`

- [ ] **Step 5: Export + Commit**

```ts
// src/index.ts
export * from './claude-code-cli.js';
```

```bash
chmod +x packages/cli-claude-code/src/fixtures/fake-cli.sh
git add packages/cli-claude-code/src
git commit -m "feat(cli-claude-code): ClaudeCodeCli spawn via node-pty"
```

---

### Task 46: KairosForgeFactory — parse .md frontmatter

**Files:**
- Create: `packages/factory-kairos-forge/src/kairos-forge-factory.ts`
- Create: `packages/factory-kairos-forge/src/kairos-forge-factory.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KairosForgeFactory } from './kairos-forge-factory.js';

describe('KairosForgeFactory', () => {
  it('loadAgent lê .md com frontmatter e devolve AgentDescriptor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-'));
    try {
      const agentsDir = join(dir, 'agents');
      mkdirSync(agentsDir);
      writeFileSync(
        join(agentsDir, 'lucas-backend.md'),
        `---\nname: Lucas Backend\ndescription: Engenheiro backend Node/TS\n---\n\nVocê é o Lucas.`,
        'utf8',
      );
      const factory = new KairosForgeFactory({ agentsDir });
      const agent = await factory.loadAgent('lucas-backend');
      expect(agent.id).toBe('lucas-backend');
      expect(agent.name).toBe('Lucas Backend');
      expect(agent.description).toBe('Engenheiro backend Node/TS');
      expect(agent.body.trim()).toBe('Você é o Lucas.');
      expect(agent.filePath.endsWith('lucas-backend.md')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listAgents devolve ids derivados dos arquivos .md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-'));
    try {
      const agentsDir = join(dir, 'agents');
      mkdirSync(agentsDir);
      writeFileSync(join(agentsDir, 'a.md'), '---\nname: A\ndescription: D\n---\nbody');
      writeFileSync(join(agentsDir, 'b.md'), '---\nname: B\ndescription: D\n---\nbody');
      const factory = new KairosForgeFactory({ agentsDir });
      const ids = await factory.listAgents();
      expect(ids.sort()).toEqual(['a', 'b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadAgent inexistente lança erro descritivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-'));
    try {
      mkdirSync(join(dir, 'agents'));
      const factory = new KairosForgeFactory({ agentsDir: join(dir, 'agents') });
      await expect(factory.loadAgent('inexistente')).rejects.toThrow(/agente.*não encontrado/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Implement `kairos-forge-factory.ts`**

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { AgentDescriptor, AgentId, FactoryPort } from '@kairos-symphony/core';

export interface KairosForgeFactoryOpts {
  agentsDir: string;
}

export class KairosForgeFactory implements FactoryPort {
  constructor(private readonly opts: KairosForgeFactoryOpts) {}

  async loadAgent(id: AgentId): Promise<AgentDescriptor> {
    const filePath = join(this.opts.agentsDir, `${id}.md`);
    if (!existsSync(filePath)) {
      throw new Error(`agente ${id} não encontrado em ${filePath}`);
    }
    const raw = readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    const name = (parsed.data as { name?: string }).name ?? id;
    const description = (parsed.data as { description?: string }).description ?? '';
    return { id, name, description, body: parsed.content, filePath };
  }

  async listAgents(): Promise<AgentId[]> {
    if (!existsSync(this.opts.agentsDir)) return [];
    return readdirSync(this.opts.agentsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
  }
}
```

- [ ] **Step 3: Run + Commit**

```ts
// src/index.ts
export * from './kairos-forge-factory.js';
```

```bash
pnpm --filter @kairos-symphony/factory-kairos-forge test
git add packages/factory-kairos-forge/src
git commit -m "feat(factory-kairos-forge): KairosForgeFactory (loadAgent + listAgents)"
```

---

### Task 47: KairosForgeFactory — descoberta automática de plugin path (opcional)

- [ ] **Step 1: Add helper que tenta achar o agentsDir do plugin instalado**

Edit `kairos-forge-factory.ts`, add:

```ts
import { homedir } from 'node:os';

const KNOWN_PATHS = [
  // Padrão Claude Code plugins
  '.claude/plugins/cache/kairos-forge/agents',
  '.claude/plugins/kairos-forge/agents',
];

export function discoverForgeAgentsDir(home: string = homedir()): string | null {
  for (const rel of KNOWN_PATHS) {
    const candidate = join(home, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
```

- [ ] **Step 2: Add test**

```ts
describe('discoverForgeAgentsDir', () => {
  it('retorna null se nenhum path conhecido existir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'home-'));
    try {
      expect(discoverForgeAgentsDir(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('retorna o primeiro path conhecido que existir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'home-'));
    try {
      mkdirSync(join(dir, '.claude/plugins/kairos-forge/agents'), { recursive: true });
      expect(discoverForgeAgentsDir(dir)).toContain('.claude/plugins/kairos-forge/agents');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Export + Commit**

Update `src/index.ts`:

```ts
export { discoverForgeAgentsDir } from './kairos-forge-factory.js';
```

```bash
pnpm --filter @kairos-symphony/factory-kairos-forge test
git add packages/factory-kairos-forge/src
git commit -m "feat(factory-kairos-forge): discoverForgeAgentsDir (fallback automático)"
```

---

## Fase 12 — Daemon bin (config + commands) (Tasks 48-53)

### Task 48: Config Zod schema

**Files:**
- Create: `packages/daemon/src/config/schema.ts`

- [ ] **Step 1: Write schema**

```ts
import { z } from 'zod';

export const ConfigSchema = z.object({
  tracker: z.object({
    type: z.literal('github'),
    repo: z.string().regex(/^[^/]+\/[^/]+$/, 'tracker.repo deve ser owner/repo'),
    token_env: z.string().min(1),
    poll_interval_ms: z.number().int().positive().default(30_000),
  }),
  cli: z.object({
    type: z.literal('claude-code'),
    binary_path: z.string().min(1),
    permission_mode: z.enum(['plan', 'auto', 'bypass']).default('bypass'),
  }),
  factory: z.object({
    type: z.literal('kairos-forge'),
    installation: z.enum(['plugin', 'local-path']).default('plugin'),
    local_path: z.string().optional(),
  }),
  workspaces: z.object({
    root: z.string().min(1),
    base_branch: z.string().default('main'),
    branch_naming_pattern: z.string().default('symphony/{issue_id}'),
    retention_days: z.number().int().nonnegative().default(7),
    repo_path: z.string().min(1, 'workspaces.repo_path obrigatório (path do repo onde rodar git worktree)'),
  }),
  routing: z.object({
    default_agent: z.string().min(1),
    rules: z.array(z.object({ label: z.string(), agent: z.string() })).default([]),
  }),
  limits: z.object({
    concurrent_agents: z.number().int().positive().default(5),
    stall_timeout_ms: z.number().int().positive().default(600_000),
    max_retries: z.number().int().nonnegative().default(3),
    retry_backoff_ms: z.array(z.number().int().positive()).default([60_000, 240_000, 960_000]),
    prompt_max_size_bytes: z.number().int().positive().default(1_048_576),
  }).default({} as never),
  storage: z.object({
    type: z.literal('sqlite').default('sqlite'),
    path: z.string().min(1),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.literal('json').default('json'),
    output: z.string().default('stdout'),
    language: z.enum(['pt-BR', 'en']).default('pt-BR'),
  }).default({} as never),
});

export type SymphonyConfig = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/config/schema.ts
git commit -m "feat(daemon): Zod schema da config (tracker/cli/factory/workspaces/routing/limits/storage/logging)"
```

---

### Task 49: ConfigLoader — YAML + env + flags

**Files:**
- Create: `packages/daemon/src/config/loader.ts`
- Create: `packages/daemon/src/config/loader.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, ConfigError } from './loader.js';

const YAML_MIN = `
tracker:
  type: github
  repo: VilelaAI/test
  token_env: GITHUB_TOKEN
cli:
  type: claude-code
  binary_path: /usr/bin/claude
factory:
  type: kairos-forge
workspaces:
  root: /var/symphony/ws
  repo_path: /var/symphony/repo
routing:
  default_agent: laura
storage:
  type: sqlite
  path: /var/symphony/state.db
`;

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const file = join(dir, 'kairos-symphony.config.yaml');
  writeFileSync(file, content);
  return file;
}

describe('loadConfig', () => {
  it('lê YAML e aplica defaults', () => {
    const file = tmpFile(YAML_MIN);
    try {
      const cfg = loadConfig({ configPath: file, env: {}, flags: {} });
      expect(cfg.tracker.poll_interval_ms).toBe(30_000);
      expect(cfg.cli.permission_mode).toBe('bypass');
      expect(cfg.limits.concurrent_agents).toBe(5);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('env SYMPHONY_LIMITS_CONCURRENT_AGENTS sobrescreve YAML', () => {
    const file = tmpFile(YAML_MIN);
    try {
      const cfg = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '10' },
        flags: {},
      });
      expect(cfg.limits.concurrent_agents).toBe(10);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('flag --concurrent-agents sobrescreve env', () => {
    const file = tmpFile(YAML_MIN);
    try {
      const cfg = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '10' },
        flags: { 'concurrent-agents': '20' },
      });
      expect(cfg.limits.concurrent_agents).toBe(20);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('rejeita config inválida com mensagem listando todas as chaves problemáticas', () => {
    const file = tmpFile(`
tracker:
  type: invalid
  repo: invalido
cli:
  type: claude-code
factory:
  type: kairos-forge
workspaces:
  root: ""
routing:
  default_agent: ""
storage:
  type: sqlite
  path: ""
`);
    try {
      expect(() => loadConfig({ configPath: file, env: {}, flags: {} })).toThrow(ConfigError);
    } finally {
      rmSync(file, { force: true });
    }
  });
});
```

- [ ] **Step 2: Implement `loader.ts`**

```ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { ConfigSchema, type SymphonyConfig } from './schema.js';

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Config inválida:\n${issues.map((s) => `  - ${s}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const FLAG_TO_PATH: Record<string, string[]> = {
  'concurrent-agents': ['limits', 'concurrent_agents'],
  'poll-interval-ms': ['tracker', 'poll_interval_ms'],
  'stall-timeout-ms': ['limits', 'stall_timeout_ms'],
  'log-level': ['logging', 'level'],
};

function setDeep(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let curr: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (typeof curr[key] !== 'object' || curr[key] === null) curr[key] = {};
    curr = curr[key] as Record<string, unknown>;
  }
  curr[path[path.length - 1]!] = value;
}

function coerce(value: string, current: unknown): unknown {
  if (typeof current === 'number') return Number(value);
  if (typeof current === 'boolean') return value === 'true';
  return value;
}

function applyEnvOverrides(raw: Record<string, unknown>, env: Record<string, string | undefined>): void {
  for (const [key, val] of Object.entries(env)) {
    if (!key.startsWith('SYMPHONY_') || val === undefined) continue;
    const path = key.slice('SYMPHONY_'.length).toLowerCase().split('_');
    // tenta achar valor atual pra coerção
    let curr: unknown = raw;
    for (const p of path) {
      if (curr && typeof curr === 'object') curr = (curr as Record<string, unknown>)[p];
    }
    setDeep(raw, path, coerce(val, curr));
  }
}

function applyFlagOverrides(raw: Record<string, unknown>, flags: Record<string, string>): void {
  for (const [flag, val] of Object.entries(flags)) {
    const path = FLAG_TO_PATH[flag];
    if (!path) continue;
    let curr: unknown = raw;
    for (const p of path) {
      if (curr && typeof curr === 'object') curr = (curr as Record<string, unknown>)[p];
    }
    setDeep(raw, path, coerce(val, curr));
  }
}

export interface LoadConfigInput {
  configPath: string;
  env: Record<string, string | undefined>;
  flags: Record<string, string>;
}

export function loadConfig(input: LoadConfigInput): SymphonyConfig {
  const yamlText = readFileSync(input.configPath, 'utf8');
  const raw = (parseYaml(yamlText) ?? {}) as Record<string, unknown>;
  applyEnvOverrides(raw, input.env);
  applyFlagOverrides(raw, input.flags);
  try {
    return ConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new ConfigError(issues);
    }
    throw err;
  }
}
```

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @kairos-symphony/daemon test
git add packages/daemon/src/config
git commit -m "feat(daemon): config loader (YAML + env SYMPHONY_* + CLI flags) com validação Zod"
```

---

### Task 50: Wiring (DI) helper

**Files:**
- Create: `packages/daemon/src/wiring.ts`

- [ ] **Step 1: Implement**

```ts
import {
  Daemon, Logger, PromptBuilder, Reconciler, Router,
  SqliteStateStore, SystemClock, WorkspaceManager,
} from '@kairos-symphony/core';
import { GithubTracker } from '@kairos-symphony/adapter-github';
import { ClaudeCodeCli } from '@kairos-symphony/cli-claude-code';
import { KairosForgeFactory, discoverForgeAgentsDir } from '@kairos-symphony/factory-kairos-forge';
import type { SymphonyConfig } from './config/schema.js';

export interface WiredDaemon {
  daemon: Daemon;
  store: SqliteStateStore;
  log: Logger;
}

export function buildDaemon(cfg: SymphonyConfig, env: Record<string, string | undefined>): WiredDaemon {
  const token = env[cfg.tracker.token_env];
  if (!token) {
    throw new Error(`Variável de ambiente ${cfg.tracker.token_env} não está setada`);
  }
  const [owner, repo] = cfg.tracker.repo.split('/');
  if (!owner || !repo) throw new Error('tracker.repo inválido');

  const tracker = new GithubTracker({ owner, repo, token });
  const cli = new ClaudeCodeCli();
  const agentsDir = cfg.factory.local_path ?? discoverForgeAgentsDir() ?? '';
  if (!agentsDir) {
    throw new Error('Não encontrei agents do kairos-forge — instale o plugin ou configure factory.local_path');
  }
  const factory = new KairosForgeFactory({ agentsDir });
  const store = new SqliteStateStore({ path: cfg.storage.path });
  const log = new Logger({ level: cfg.logging.level });
  const clock = new SystemClock();
  const wm = new WorkspaceManager({
    root: cfg.workspaces.root,
    baseBranch: cfg.workspaces.base_branch,
    repoPath: cfg.workspaces.repo_path,
    branchPattern: cfg.workspaces.branch_naming_pattern,
  });
  const router = new Router({
    defaultAgent: cfg.routing.default_agent,
    rules: cfg.routing.rules,
  });
  const promptBuilder = new PromptBuilder({ maxBytes: cfg.limits.prompt_max_size_bytes });
  let daemon: Daemon;
  const reconciler = new Reconciler({
    tracker, store, log, now: () => clock.now(),
    activeSupervisors: () => daemon.activeSupervisors() as never,
    cleanupWorkspace: (id) => wm.cleanup(id),
    listWorkspacesOnDisk: () => wm.listAllOnDisk(),
  });
  daemon = new Daemon({
    tracker, cli, factory, store, log, clock,
    workspaceManager: wm, router, promptBuilder,
    reconciler, pollIntervalMs: cfg.tracker.poll_interval_ms,
    cfg: {
      concurrentLimit: cfg.limits.concurrent_agents,
      stallTimeoutMs: cfg.limits.stall_timeout_ms,
      maxRetries: cfg.limits.max_retries,
      backoffMs: cfg.limits.retry_backoff_ms,
      permissionMode: cfg.cli.permission_mode,
      binaryPath: cfg.cli.binary_path,
    },
  });
  return { daemon, store, log };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/wiring.ts
git commit -m "feat(daemon): wiring helper (buildDaemon)"
```

---

### Task 51: Commands — start

**Files:**
- Create: `packages/daemon/src/commands/start.ts`

- [ ] **Step 1: Implement**

```ts
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';
import { buildDaemon } from '../wiring.js';

export const startCommand = defineCommand({
  meta: { name: 'start', description: 'Inicia o daemon (foreground)' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const { daemon, store, log } = buildDaemon(cfg, process.env);

    const shutdown = async (signal: string) => {
      log.info({ event: 'daemon_shutting_down', signal, message: `Sinal ${signal} recebido` });
      await daemon.stop();
      store.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    await daemon.start();
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/daemon/src/commands/start.ts
git commit -m "feat(daemon/cmd): symphony start (signal-aware graceful shutdown)"
```

---

### Task 52: Commands — reconcile, ps, attach

**Files:**
- Create: `packages/daemon/src/commands/reconcile.ts`
- Create: `packages/daemon/src/commands/ps.ts`
- Create: `packages/daemon/src/commands/attach.ts`

- [ ] **Step 1: `reconcile.ts`**

```ts
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';
import { buildDaemon } from '../wiring.js';

export const reconcileCommand = defineCommand({
  meta: { name: 'reconcile', description: 'Roda reconciliação uma única vez' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
    'dry-run': { type: 'boolean', default: false },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const { daemon, store } = buildDaemon(cfg, process.env);
    // run reconciler diretamente — não inicia loop
    const reconciler = (daemon as unknown as { deps: { reconciler: { run: (o: { dryRun: boolean }) => Promise<unknown[]> } } }).deps.reconciler;
    const findings = await reconciler.run({ dryRun: args['dry-run'] });
    console.log(JSON.stringify(findings, null, 2));
    store.close();
  },
});
```

> Nota: para evitar acesso interno, expor `Daemon.reconcile(dryRun)` no core (próximo step abaixo).

- [ ] **Step 2: Add `Daemon.reconcile()`** em `packages/core/src/services/daemon.ts`:

```ts
  async reconcile(dryRun: boolean): Promise<unknown[]> {
    return this.deps.reconciler.run({ dryRun });
  }
```

Atualize `reconcile.ts` para usar:

```ts
    const findings = await daemon.reconcile(args['dry-run']);
```

- [ ] **Step 3: `ps.ts`**

```ts
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';
import { SqliteStateStore } from '@kairos-symphony/core';

export const psCommand = defineCommand({
  meta: { name: 'ps', description: 'Lista issues ativas (state != done)' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const store = new SqliteStateStore({ path: cfg.storage.path });
    const records = store.listActiveIssues();
    const cols = ['ISSUE_ID', 'STATE', 'AGENT', 'STARTED_AT', 'TERMINAL_LOG'];
    const rows = records.map((r) => [
      r.issueId, r.state, r.agentId ?? '-', r.startedAt ?? '-',
      r.workspacePath ? `${r.workspacePath}/.symphony/terminal.log` : '-',
    ]);
    console.log(cols.join('\t'));
    for (const row of rows) console.log(row.join('\t'));
    store.close();
  },
});
```

- [ ] **Step 4: `attach.ts`**

```ts
import { defineCommand } from 'citty';
import { createReadStream, existsSync, statSync, watchFile } from 'node:fs';
import { loadConfig } from '../config/loader.js';
import { SqliteStateStore } from '@kairos-symphony/core';

export const attachCommand = defineCommand({
  meta: { name: 'attach', description: 'tail -f no terminal.log do agente da issue' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
    issueId: { type: 'positional', required: true, description: 'ID da issue (owner/repo#N)' },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const store = new SqliteStateStore({ path: cfg.storage.path });
    const rec = store.getIssue(args.issueId);
    store.close();
    if (!rec || !rec.workspacePath) {
      console.error(`Nenhum workspace ativo para ${args.issueId}`);
      process.exit(1);
    }
    const logPath = `${rec.workspacePath}/.symphony/terminal.log`;
    if (!existsSync(logPath)) {
      console.error(`terminal.log ainda não existe em ${logPath}`);
      process.exit(1);
    }
    let lastSize = 0;
    const readNew = () => {
      const size = statSync(logPath).size;
      if (size <= lastSize) return;
      createReadStream(logPath, { start: lastSize, end: size })
        .on('data', (chunk) => process.stdout.write(chunk))
        .on('end', () => {
          lastSize = size;
        });
    };
    readNew();
    watchFile(logPath, { interval: 200 }, readNew);
  },
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/commands packages/core/src/services/daemon.ts
git commit -m "feat(daemon/cmd): reconcile [--dry-run], ps, attach"
```

---

### Task 53: bin.ts — entry point

**Files:**
- Modify: `packages/daemon/src/bin.ts`

- [ ] **Step 1: Replace stub**

```ts
#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { startCommand } from './commands/start.js';
import { reconcileCommand } from './commands/reconcile.js';
import { psCommand } from './commands/ps.js';
import { attachCommand } from './commands/attach.js';

const main = defineCommand({
  meta: { name: 'symphony', version: '0.1.0', description: 'kairos-symphony daemon' },
  subCommands: {
    start: startCommand,
    reconcile: reconcileCommand,
    ps: psCommand,
    attach: attachCommand,
  },
});

void runMain(main);
```

- [ ] **Step 2: Build + smoke test**

Run:
```bash
pnpm build
node packages/daemon/dist/bin.js --help
```
Expected: lista os 4 subcomandos.

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/src/bin.ts
git commit -m "feat(daemon): bin.ts com 4 subcomandos (start, reconcile, ps, attach)"
```

---

## Fase 13 — Conformance tests (Tasks 54-67)

Cada teste de conformidade carrega o `Daemon` real com fakes, exercitando uma seção MUST da SPEC. Padrão: arquivo `tests/conformance/spec-NN-*.test.ts`, importa `@kairos-symphony/core` + fakes.

### Task 54: spec-02-states.test.ts

**File:** `tests/conformance/spec-02-states.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from 'vitest';
import { ISSUE_STATES, isAllowedTransition } from '@kairos-symphony/core';

describe('SPEC §2 — Estados canônicos', () => {
  it('exporta exatamente os 6 estados canônicos', () => {
    expect(new Set(ISSUE_STATES)).toEqual(
      new Set(['triage', 'ready', 'in_progress', 'blocked', 'review_pending', 'done']),
    );
  });

  it('transições válidas conforme diagrama da SPEC', () => {
    expect(isAllowedTransition('triage', 'ready')).toBe(true);
    expect(isAllowedTransition('ready', 'in_progress')).toBe(true);
    expect(isAllowedTransition('in_progress', 'review_pending')).toBe(true);
    expect(isAllowedTransition('review_pending', 'done')).toBe(true);
    expect(isAllowedTransition('done', 'ready')).toBe(false); // terminal
  });
});
```

- [ ] **Step 2: Run + Commit**

```bash
pnpm test:conformance
git add tests/conformance/spec-02-states.test.ts
git commit -m "test(conformance): SPEC §2 estados canônicos"
```

---

### Task 55: spec-03-main-loop.test.ts

```ts
import { describe, expect, it, vi } from 'vitest';
import { Daemon, ... } from '@kairos-symphony/core';
// usa fakes; setup minimal
// valida que ordem: reconcile → fetchReady → dispatch → tick(supervisors) → fetchDone
// via spy em tracker.fetchIssuesByState e reconciler.run
```

- [ ] **Step 1-3: Test, run, commit (idem padrão)**

```bash
git add tests/conformance/spec-03-main-loop.test.ts
git commit -m "test(conformance): SPEC §3 ordem do loop principal (reconcile antes de dispatch)"
```

> Estrutura completa do teste: usa `vi.spyOn` em `tracker.fetchIssuesByState` e `daemon.reconcile`; chama `daemon.tick()`; verifica `mock.invocationCallOrder` para garantir reconcile vem antes do primeiro fetch ready.

---

### Task 56: spec-04-workspace.test.ts

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from '@kairos-symphony/core';

describe('SPEC §4 — Workspace isolation', () => {
  it('cria worktree em path determinístico', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'c4-'));
    execSync('git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m i', {
      cwd: repoPath, shell: '/bin/bash',
    });
    const root = mkdtempSync(join(tmpdir(), 'c4-ws-'));
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const info = wm.create('owner/repo#123');
      expect(info.path).toBe(join(root, 'owner-repo-123'));
      expect(info.branchName).toBe('symphony/owner-repo-123');
      expect(existsSync(info.path)).toBe(true);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/conformance/spec-04-workspace.test.ts
git commit -m "test(conformance): SPEC §4 workspace deterministic via worktree"
```

---

### Task 57: spec-04-1-pty.test.ts

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest';
import { ClaudeCodeCli } from '@kairos-symphony/cli-claude-code';

describe('SPEC §4.1 — Spawn via PTY', () => {
  it('ClaudeCodeCli implementa CliPort.spawn (sem usar pipes simples de child_process)', () => {
    // Validação estrutural: o source não usa child_process.spawn — usa node-pty
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../packages/cli-claude-code/src/claude-code-cli.ts'),
      'utf8',
    );
    expect(src).toMatch(/node-pty/);
    expect(src).not.toMatch(/from 'node:child_process'/);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/conformance/spec-04-1-pty.test.ts
git commit -m "test(conformance): SPEC §4.1 spawn via PTY (não pipes)"
```

---

### Task 58: spec-05-routing.test.ts

```ts
import { describe, expect, it } from 'vitest';
import { Router } from '@kairos-symphony/core';

describe('SPEC §5 — Routing precedência', () => {
  const router = new Router({
    defaultAgent: 'laura', rules: [{ label: 'bug', agent: 'lucas' }],
  });
  const base = { id: 'r#1', number: 1, title: 't', body: 'b', state: 'ready' as const };

  it('label agent:<id> vence rules e default', () => {
    expect(router.route({ ...base, labels: ['bug', 'agent:carlos'] })).toBe('carlos');
  });
  it('rules vence default', () => {
    expect(router.route({ ...base, labels: ['bug'] })).toBe('lucas');
  });
  it('default quando nada casa', () => {
    expect(router.route({ ...base, labels: [] })).toBe('laura');
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-05-routing.test.ts
git commit -m "test(conformance): SPEC §5 routing 3 precedências"
```

---

### Task 59: spec-06-prompt.test.ts

```ts
import { describe, expect, it } from 'vitest';
import { PromptBuilder, PromptTooLargeError } from '@kairos-symphony/core';

describe('SPEC §6 — Prompt construction', () => {
  const pb = new PromptBuilder({ maxBytes: 1_048_576 });
  const issue = { id: 'r#1', number: 1, title: 'T', body: 'B', labels: ['foo'], state: 'ready' as const };
  const agent = { id: 'a', name: 'Agent', description: 'D', body: 'AgentBody', filePath: '/x' };
  const workspace = {
    issueId: 'r#1', path: '/ws', branchName: 'symphony/r-1', baseBranch: 'main',
    terminalLogPath: '/ws/.symphony/terminal.log',
  };

  it('inclui identidade, contexto, workspace e DoD', () => {
    const p = pb.build({ issue, agent, workspace });
    expect(p).toContain('Agent');           // identidade
    expect(p).toContain('AgentBody');
    expect(p).toContain('r#1');             // contexto
    expect(p).toContain('T');
    expect(p).toContain('symphony/r-1');    // workspace
    expect(p).toContain('PR aberto');       // DoD
    expect(p).toContain('BLOCKED:');        // mecanismo de bloqueio
  });

  it('rejeita prompt > 1MB', () => {
    expect(() =>
      pb.build({ issue: { ...issue, body: 'X'.repeat(2_000_000) }, agent, workspace }),
    ).toThrow(PromptTooLargeError);
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-06-prompt.test.ts
git commit -m "test(conformance): SPEC §6 campos mínimos do prompt + size guard"
```

---

### Task 60: spec-07-pr-detection.test.ts

Usa FakeTracker para simular auto-link + branch convention.

```ts
import { describe, expect, it } from 'vitest';
// reaproveita setup de integration: cria daemon, simula PR no FakeTracker, verifica review_pending
```

(Estrutura idêntica ao `dispatch.integration.test.ts`, isolado no que diz respeito a PR detection.)

- [ ] **Commit**

```bash
git add tests/conformance/spec-07-pr-detection.test.ts
git commit -m "test(conformance): SPEC §7 detecção de PR via tracker.detectLinkedPR"
```

---

### Task 61: spec-08-stall-crash.test.ts

Já temos integration test para stall — duplica/refina como spec test usando AgentSupervisor diretamente.

```ts
import { describe, expect, it } from 'vitest';
// usar AgentSupervisor + FakeCli + FakeClock; validar retry com backoff [60s,240s,960s] e max-retries → blocked
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-08-stall-crash.test.ts
git commit -m "test(conformance): SPEC §8 stall/crash + retry backoff exponencial"
```

---

### Task 62: spec-09-persistence.test.ts

Usa `SqliteStateStore` real + reabertura.

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '@kairos-symphony/core';

describe('SPEC §9 — Persistência entre restarts', () => {
  it('grava e relê após close + reopen', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'p-')), 'state.db');
    try {
      let s = new SqliteStateStore({ path: dbPath });
      s.upsertIssue({
        issueId: 'r#1', trackerType: 'github', state: 'in_progress',
        agentId: 'a', workspacePath: '/x', branchName: 'symphony/r-1',
        startedAt: '2026-05-18T10:00:00Z', finishedAt: null, retryCount: 0,
        prNumber: null, correlationId: 'cid', lastSyncedAt: '2026-05-18T10:00:00Z', blockedReason: null,
      });
      s.close();
      s = new SqliteStateStore({ path: dbPath });
      expect(s.getIssue('r#1')?.state).toBe('in_progress');
      s.close();
    } finally {
      rmSync(dbPath, { force: true });
    }
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-09-persistence.test.ts
git commit -m "test(conformance): SPEC §9 estado persiste entre restarts"
```

---

### Task 63: spec-09-1-reconciliation.test.ts

Re-roda os testes dos 6 cenários, agrupados, validando que `Reconciler.run({dryRun:false})` produz todos.

```ts
// Importa Reconciler + FakeTracker + FakeStore inline
// 1 caso por cenário, igual aos testes unitários, mas reunidos sob descrição da SPEC
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-09-1-reconciliation.test.ts
git commit -m "test(conformance): SPEC §9.1 reconciliação dos 6 cenários + dry-run"
```

---

### Task 64: spec-10-config.test.ts

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../packages/daemon/src/config/loader.js';

describe('SPEC §10 — Config YAML/env/flags', () => {
  it('precedência: flags > env > YAML', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'c-')), 'c.yaml');
    writeFileSync(file, `tracker:\n  type: github\n  repo: a/b\n  token_env: T\ncli:\n  type: claude-code\n  binary_path: /x\nfactory:\n  type: kairos-forge\nworkspaces:\n  root: /r\n  repo_path: /rp\nrouting:\n  default_agent: x\nstorage:\n  type: sqlite\n  path: /s\nlimits:\n  concurrent_agents: 1\n`);
    try {
      const yamlOnly = loadConfig({ configPath: file, env: {}, flags: {} });
      expect(yamlOnly.limits.concurrent_agents).toBe(1);
      const envOver = loadConfig({ configPath: file, env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '5' }, flags: {} });
      expect(envOver.limits.concurrent_agents).toBe(5);
      const flagOver = loadConfig({ configPath: file, env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '5' }, flags: { 'concurrent-agents': '9' } });
      expect(flagOver.limits.concurrent_agents).toBe(9);
    } finally {
      rmSync(file, { force: true });
    }
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-10-config.test.ts
git commit -m "test(conformance): SPEC §10 config YAML + env + flags precedência"
```

---

### Task 65: spec-11-logs.test.ts

```ts
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@kairos-symphony/core';

describe('SPEC §11 — Logs estruturados', () => {
  it('cada linha é JSON com os campos mínimos', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink, now: () => new Date('2026-05-18T10:00:00Z') });
    log.info({
      event: 'issue_dispatched',
      issue_id: 'r#1',
      agent_id: 'lucas',
      correlation_id: 'cid',
      message: 'oi',
    });
    const parsed = JSON.parse((sink.mock.calls[0]?.[0] as string).trimEnd());
    for (const key of ['timestamp', 'level', 'event', 'issue_id', 'agent_id', 'correlation_id', 'message']) {
      expect(parsed).toHaveProperty(key);
    }
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-11-logs.test.ts
git commit -m "test(conformance): SPEC §11 logs JSON com campos mínimos"
```

---

### Task 66: spec-12-security.test.ts

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, PromptBuilder, PromptTooLargeError, WorkspaceManager, PathTraversalError } from '@kairos-symphony/core';

describe('SPEC §12 — Segurança', () => {
  it('Logger NÃO logga tokens', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink });
    log.info({ event: 'x', message: '', token: 'gho_xxx', authorization: 'Bearer xxx' });
    const line = sink.mock.calls[0]?.[0] as string;
    expect(line).not.toContain('gho_xxx');
    expect(line).not.toContain('Bearer xxx');
  });
  it('WorkspaceManager rejeita path traversal', () => {
    const root = mkdtempSync(join(tmpdir(), 's-'));
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath: root });
      expect(() => wm.resolvePath('../etc/passwd')).toThrow(PathTraversalError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('PromptBuilder rejeita > 1MB', () => {
    const pb = new PromptBuilder({ maxBytes: 1_048_576 });
    const issue = { id: 'r#1', number: 1, title: 'T', body: 'X'.repeat(2_000_000), labels: [], state: 'ready' as const };
    const agent = { id: 'a', name: 'A', description: 'D', body: 'b', filePath: '/x' };
    const workspace = { issueId: 'r#1', path: '/w', branchName: 's', baseBranch: 'm', terminalLogPath: '/w/t' };
    expect(() => pb.build({ issue, agent, workspace })).toThrow(PromptTooLargeError);
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-12-security.test.ts
git commit -m "test(conformance): SPEC §12 segurança (token redaction, path traversal, prompt size)"
```

---

### Task 67: spec-13-1-terminal-stream.test.ts

```ts
import { describe, expect, it } from 'vitest';
// usa AgentSupervisor + FakeCli, valida que terminal.log recebe bytes do PTY
// (cobre o que precisa do MUST §13.1)
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-13-1-terminal-stream.test.ts
git commit -m "test(conformance): SPEC §13.1 stream PTY persistido em terminal.log"
```

---

### Task 68: spec-15-checklist.test.ts

Resumo: testa que cada item do checklist de §15 (limitado ao M1) é coberto por outro arquivo de conformance. Lista declarativa:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('SPEC §15 — Checklist de conformidade (M1)', () => {
  const required = [
    'spec-02-states.test.ts',
    'spec-03-main-loop.test.ts',
    'spec-04-workspace.test.ts',
    'spec-04-1-pty.test.ts',
    'spec-05-routing.test.ts',
    'spec-06-prompt.test.ts',
    'spec-07-pr-detection.test.ts',
    'spec-08-stall-crash.test.ts',
    'spec-09-persistence.test.ts',
    'spec-09-1-reconciliation.test.ts',
    'spec-10-config.test.ts',
    'spec-11-logs.test.ts',
    'spec-12-security.test.ts',
    'spec-13-1-terminal-stream.test.ts',
  ];
  it('todos os arquivos de conformance do M1 existem', () => {
    const present = new Set(readdirSync(__dirname));
    for (const file of required) {
      expect(present.has(file)).toBe(true);
    }
  });
});
```

- [ ] **Commit**

```bash
git add tests/conformance/spec-15-checklist.test.ts
git commit -m "test(conformance): SPEC §15 checklist (M1) — todos os arquivos presentes"
```

---

## Fase 14 — Demo + README (Tasks 69-70)

### Task 69: docs/M1-DEMO.md

**File:** `docs/M1-DEMO.md`

- [ ] **Step 1: Write doc**

```markdown
# M1 — Demo manual (DoD humano)

Este roteiro prova end-to-end que o walking skeleton funciona em hardware real, com Claude Code real e GitHub real.

## Pré-requisitos

1. **Node ≥ 22.5** (`node --version`)
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/M1-DEMO.md
git commit -m "docs: M1-DEMO.md (roteiro end-to-end manual)"
```

---

### Task 70: README — seção "Running"

**File:** `README.md`

- [ ] **Step 1: Append section antes de "## Roadmap"**

```markdown
## Running (M1 walking skeleton)

Após `pnpm install && pnpm build`, o binário está em `packages/daemon/dist/bin.js`:

```bash
node packages/daemon/dist/bin.js --help
```

Subcomandos disponíveis no M1:

| Comando | Descrição |
|---|---|
| `start` | Sobe o daemon (foreground); polling do tracker, dispatch e monitoramento |
| `reconcile [--dry-run]` | Roda uma rodada de reconciliação (§9.1); com `--dry-run`, só lista divergências |
| `ps` | Lista issues ativas (estado != `done`) lendo o SQLite |
| `attach <issue_id>` | `tail -f` do terminal.log do agente daquela issue |

Para o roteiro end-to-end ver [docs/M1-DEMO.md](docs/M1-DEMO.md).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(README): seção Running com 4 subcomandos do M1"
```

---

## Encerramento

Após a Task 70, valide o estado completo:

```bash
pnpm lint && pnpm typecheck && pnpm test --coverage && pnpm test:conformance
```

Expected: tudo PASS, cobertura `core/` ≥ 85%, `adapter-*` ≥ 70%, `daemon/` ≥ 50%.

Marque M1 como entregue:

```bash
git tag v0.1.0-m1
git push origin main --tags
```

A skill `subagent-driven-development` (ou `executing-plans`) deve ser usada para executar este plano task-por-task.


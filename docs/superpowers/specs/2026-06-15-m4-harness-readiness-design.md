# M4 — Harness-readiness: design

**Data:** 2026-06-15
**Status:** Implementado
**Cobre:** quarto milestone da implementação do `kairos-symphony`, cobrindo a §16
completa. Ver [design do M1](2026-05-14-m1-walking-skeleton-design.md), §1.

---

## 1. Escopo

§16 é um **pré-requisito MUST**: Symphony valida que o repositório alvo está
harness-ready antes de despachar a primeira issue. Despachar agentes em repo
despreparado amplifica problemas (N PRs ruins em paralelo).

| Item | SPEC | Entrega |
|---|---|---|
| Validador dos 4 sinais | §16.1/§16.2 | `HarnessValidator` (core) |
| Gate no startup | §16.2/§16.3 | comando `start`: `refuse` ou `validation_only` |
| Override unsafe | §16.4 | flag `--skip-harness-check` + warning por dispatch |
| Re-validação periódica | §16.5 | re-check no `tick` → modo drain |

---

## 2. `HarnessValidator` (§16.1/§16.2)

Roda contra `workspaces.repo_path` (o checkout local do projeto que o Symphony
opera). Quatro checagens, cada uma mapeada a um pilar de Harness Engineering:

| Check | Pilar | Sinal |
|---|---|---|
| `instruction_set` | Instruction set evolutivo | `AGENTS.md` ou `CLAUDE.md` na raiz |
| `repository_as_context` | Repository-as-context | ≥1 `.md` em `docs/adr/`, `docs/decisoes/`, `decisoes/`, … |
| `enforced_invariants` | Invariantes mecanicamente enforçadas | `.pre-commit-config.yaml`/`.husky/`/`lefthook` **ou** CI (`.github/workflows/*.yml`, `.gitlab-ci.yml`, …) |
| `repo_hygiene` | Higiene de repo | `.gitignore` |

Acesso ao filesystem via `HarnessFsProbe` injetável → testes determinísticos sem
disco; `defaultHarnessProbe(repoPath)` usa `node:fs`. `harnessRemediationMessage`
monta o diagnóstico + remediação da §16.3 (aponta `/kairos-forge:onboardar`).

## 3. Gate no startup (§16.2/§16.3)

No comando `start`, antes de subir o loop:

- `harness.enabled = false` → sem gate.
- `skip_check` (config ou `--skip-harness-check`) → warning conspícuo, prossegue.
- senão → `validate()`. Se não-ready: loga falhas + remediação e, conforme
  `harness.mode_on_failure`:
  - `refuse` → `process.exit(1)` (não sobe).
  - `validation_only` → `daemon.pauseDispatch()` (sobe, reconcilia/observa, nunca despacha).

`process.exit` fica na borda (comando), não no core.

## 4. Override unsafe (§16.4)

`--skip-harness-check` tem precedência e liga `harness.skip_check` na config
efetiva. O daemon, com `harness.skipCheck`, emite
`⚠️ HARNESS CHECK BYPASSED — output quality will likely be poor` no boot e **a
cada dispatch**, e **não** faz re-validação periódica.

## 5. Re-validação periódica → drain (§16.5)

O `Daemon.tick()` chama `maybeRevalidateHarness()` antes do loop de dispatch:
re-valida quando passaram `revalidateEveryDispatches` dispatches **ou**
`revalidateEveryHours`, o que vier primeiro. Se degradou → `dispatchPaused = true`
(modo drain: in-flight terminam, nenhuma nova é pega) + log `harness_degraded`.

Controles no Daemon: `pauseDispatch()`, `resumeDispatch()`, `isDispatchPaused()`.
Tudo opcional (`harness?` em `DaemonDeps`) → testes/integrações existentes seguem
sem mudança.

---

## 6. Testes

- **Unit:** `HarnessValidator` (ready, cada pilar ausente, pre-commit vs CI,
  remediação); `Daemon` (validation-only não despacha, re-validação falha → drain,
  skip → warning por dispatch).
- **Conformance:** `spec-16-harness` (4 sinais, diagnóstico por pilar, remediação).

Suíte total após M4: **145 testes** em 38 arquivos, lint e typecheck verdes.

---

## 7. Próximo

M5 — Loop autônomo por issue (§17): execução iterativa contra critério de parada
(checkpoint, label `iterate:loop[:N]`, max-iterations, stopping conditions,
adaptação por CLI). Fecha a conformidade v0.3 da SPEC.
